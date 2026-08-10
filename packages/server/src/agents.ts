/**
 * The agent data layer.
 *
 * Every method here maps to a `security definer` function or a plain query
 * against `db/migrations/0009_agents.sql`, in exactly the style `pg.ts` uses
 * for play: the interesting work — the ownership check, the inventory check,
 * the atomic transfer — lives in the database, and this calls it.
 *
 * ## Why the authorisation checks appear twice
 *
 * `allocate_to_player` already refuses to fund a player who is not the agent's,
 * and refuses a suspended agent. The API checks the same things before calling
 * it. That is not redundancy for its own sake: the database check is the
 * CONTROL — it cannot be bypassed by a bug, a new route or a psql session — and
 * the API check exists to turn a Postgres exception into an HTTP status and a
 * sentence a person can read. If they ever disagree, the database wins and the
 * player keeps their coins.
 */

import { createHash, randomBytes } from 'node:crypto';
// The same client interface the play layer uses, so an allocation and a bet
// travel over one pool and can queue behind each other on the same row lock.
import type { QueryClient } from './pg.js';

export interface AgentSummary {
  agentId: string;
  displayName: string;
  status: 'pending' | 'active' | 'suspended';
  inventory: number;
  playerCount: number;
}

export interface AgentPlayer {
  playerId: string;
  username: string;
  balance: number;
  assignedAt: string;
  lastSeenAt: string | null;
}

export interface AgentTxn {
  id: string;
  type: string;
  amount: number;
  at: string;
  /** The counterparty, resolved to a username where there is one. */
  counterparty: string | null;
  metadata: Record<string, unknown>;
}

export interface AgentInvite {
  id: string;
  label: string | null;
  createdAt: string;
  expiresAt: string;
  redeemedAt: string | null;
  redeemedBy: string | null;
}

const toInt = (value: unknown): number => Number(value ?? 0);

/**
 * How long an invitation stays good.
 *
 * Long enough that an agent can hand out a link and the player can use it that
 * evening; short enough that a link posted somewhere public stops working
 * before it is found. Seven days is the usual compromise and there is no
 * argument for a different number here.
 */
export const INVITE_TTL_HOURS = 24 * 7;

/**
 * Tokens are hashed before they touch the database.
 *
 * Same reason operator sessions are: a database dump then holds nothing that
 * can be redeemed. SHA-256 without a salt is correct here and would not be for
 * a password — the input is 32 bytes of `randomBytes`, so there is no
 * dictionary to attack and nothing for a salt to defend against.
 */
export function hashInviteToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function newInviteToken(): string {
  return randomBytes(32).toString('base64url');
}

export class AgentsDb {
  constructor(private readonly client: QueryClient) {}

  /**
   * Who is this, as far as agent functionality is concerned.
   *
   * Returns null for a player, which is the common case and must stay cheap: a
   * primary-key lookup on a table with one row per agent.
   */
  async agentStatus(profileId: string): Promise<AgentSummary | null> {
    const { rows } = await this.client.query(
      `select a.profile_id, a.display_name, a.status,
              coalesce(c.balance, 0) as inventory,
              (select count(*) from player_agents p where p.agent_id = a.profile_id) as players
         from agents a
         left join accounts acc
           on acc.owner_id = a.profile_id and acc.kind = 'agent' and acc.currency = 'GC'
         left join account_balance_cache c on c.account_id = acc.id
        where a.profile_id = $1`,
      [profileId],
    );
    const row = rows[0] as Record<string, string> | undefined;
    if (!row) return null;
    return {
      agentId: row['profile_id']!,
      displayName: row['display_name']!,
      status: row['status'] as AgentSummary['status'],
      inventory: toInt(row['inventory']),
      playerCount: toInt(row['players']),
    };
  }

  /**
   * The agent's players.
   *
   * Scoped by `agent_id` in the WHERE clause, which is the whole of "agent A
   * cannot see agent B's players": there is no parameter on this query that a
   * caller could manipulate to widen it, because the agent id comes from the
   * verified token and never from the request body.
   */
  async players(agentId: string, limit = 200): Promise<AgentPlayer[]> {
    const { rows } = await this.client.query(
      `select pa.player_id, p.username, pa.assigned_at, p.last_seen_at,
              coalesce(c.balance, 0) as balance
         from player_agents pa
         join profiles p on p.id = pa.player_id
         left join accounts acc
           on acc.owner_id = pa.player_id and acc.kind = 'player' and acc.currency = 'GC'
         left join account_balance_cache c on c.account_id = acc.id
        where pa.agent_id = $1
        order by pa.assigned_at desc
        limit $2`,
      [agentId, limit],
    );
    return (rows as Record<string, string>[]).map((row) => ({
      playerId: row['player_id']!,
      username: row['username']!,
      balance: toInt(row['balance']),
      assignedAt: String(row['assigned_at']),
      lastSeenAt: row['last_seen_at'] ? String(row['last_seen_at']) : null,
    }));
  }

  /** Is this player one of this agent's? Used to fail early with a clear message. */
  async ownsPlayer(agentId: string, playerId: string): Promise<boolean> {
    const { rows } = await this.client.query(
      `select 1 from player_agents where agent_id = $1 and player_id = $2`,
      [agentId, playerId],
    );
    return rows.length > 0;
  }

  /**
   * Move coins from the agent's inventory to one of their players.
   *
   * The idempotency key is the caller's protection against a network timeout
   * turning one allocation into two. It is namespaced by agent so two agents
   * cannot collide on the same client-generated string.
   */
  async allocate(args: {
    agentId: string;
    playerId: string;
    amount: number;
    idempotencyKey?: string;
  }): Promise<{ txnId: string; inventory: number; playerBalance: number }> {
    const key = args.idempotencyKey ? `agent:${args.agentId}:${args.idempotencyKey}` : null;
    const { rows } = await this.client.query(
      `select * from allocate_to_player($1, $2, $3, $4)`,
      [args.agentId, args.playerId, args.amount, key],
    );
    const row = rows[0] as Record<string, string> | undefined;
    if (!row) throw new Error('Allocation returned no result');
    return {
      txnId: row['txn_id']!,
      inventory: toInt(row['agent_inventory']),
      playerBalance: toInt(row['player_balance']),
    };
  }

  /**
   * Everything that has moved into or out of this agent's inventory.
   *
   * Read from the LEDGER rather than from a side table, so it cannot disagree
   * with the money. The counterparty is resolved by looking at the other entry
   * in the same transaction.
   */
  async transactions(agentId: string, limit = 100): Promise<AgentTxn[]> {
    const { rows } = await this.client.query(
      `with mine as (
         select acc.id from accounts acc
          where acc.owner_id = $1 and acc.kind = 'agent' and acc.currency = 'GC'
       )
       select t.id, t.type, e.amount, t.created_at, t.metadata,
              other_profile.username as counterparty
         from ledger_entries e
         join mine on mine.id = e.account_id
         join transactions t on t.id = e.transaction_id
         left join ledger_entries other
           on other.transaction_id = t.id and other.account_id <> e.account_id
         left join accounts other_acc on other_acc.id = other.account_id
         left join profiles other_profile on other_profile.id = other_acc.owner_id
        order by t.created_at desc
        limit $2`,
      [agentId, limit],
    );
    return (rows as Record<string, unknown>[]).map((row) => ({
      id: String(row['id']),
      type: String(row['type']),
      amount: toInt(row['amount']),
      at: String(row['created_at']),
      counterparty: row['counterparty'] ? String(row['counterparty']) : null,
      metadata: (row['metadata'] ?? {}) as Record<string, unknown>,
    }));
  }

  /**
   * Mint an invitation.
   *
   * The RAW token is returned exactly once, here, and never stored. If the
   * agent loses the link they issue a new one — which is the same property a
   * password reset link has, and for the same reason.
   */
  async createInvite(
    agentId: string,
    label?: string,
  ): Promise<{ token: string; expiresAt: string; id: string }> {
    const token = newInviteToken();
    const { rows } = await this.client.query(
      `insert into agent_invites (agent_id, token_hash, label, expires_at)
       values ($1, $2, $3, now() + ($4 || ' hours')::interval)
       returning id, expires_at`,
      [agentId, hashInviteToken(token), label ?? null, String(INVITE_TTL_HOURS)],
    );
    const row = rows[0] as Record<string, string>;
    return { token, id: row['id']!, expiresAt: String(row['expires_at']) };
  }

  async invites(agentId: string, limit = 50): Promise<AgentInvite[]> {
    const { rows } = await this.client.query(
      `select i.id, i.label, i.created_at, i.expires_at, i.redeemed_at, p.username
         from agent_invites i
         left join profiles p on p.id = i.redeemed_by
        where i.agent_id = $1
        order by i.created_at desc
        limit $2`,
      [agentId, limit],
    );
    return (rows as Record<string, unknown>[]).map((row) => ({
      id: String(row['id']),
      label: row['label'] ? String(row['label']) : null,
      createdAt: String(row['created_at']),
      expiresAt: String(row['expires_at']),
      redeemedAt: row['redeemed_at'] ? String(row['redeemed_at']) : null,
      redeemedBy: row['username'] ? String(row['username']) : null,
    }));
  }

  /**
   * Redeem an invitation at registration and bind the player to the agent.
   *
   * Single-use and expiry are enforced by the database function, not here — two
   * players redeeming the same link at the same instant cannot both succeed
   * because only one UPDATE can match a row whose `redeemed_at` is still null.
   */
  async redeemInvite(token: string, playerId: string): Promise<string> {
    const { rows } = await this.client.query(`select redeem_agent_invite($1, $2) as agent_id`, [
      hashInviteToken(token),
      playerId,
    ]);
    const row = rows[0] as Record<string, string> | undefined;
    if (!row?.['agent_id']) throw new Error('Invitation could not be redeemed');
    return row['agent_id'];
  }

  /**
   * Who an unredeemed invitation belongs to.
   *
   * Read-only and deliberately narrow: it answers "is this link still good, and
   * whose is it", which is what the sign-up screen needs to say "invited by
   * Sunrise Gaming" before the player has an account. It never returns the
   * agent's id, so the raw token is not a way to learn who to impersonate.
   *
   * Safe to expose without a session because the token is 32 bytes of
   * `randomBytes` — there is nothing to enumerate — but it is still rate
   * limited by address at the route, because "nothing to enumerate" is an
   * argument about arithmetic and rate limiting is an argument about bandwidth.
   */
  async inviteAgentName(token: string): Promise<string | null> {
    const { rows } = await this.client.query(
      `select a.display_name
         from agent_invites i
         join agents a on a.profile_id = i.agent_id
        where i.token_hash = $1
          and i.redeemed_at is null
          and i.expires_at > now()
          and a.status = 'active'`,
      [hashInviteToken(token)],
    );
    const row = rows[0] as Record<string, string> | undefined;
    return row ? row['display_name']! : null;
  }

  /** The agent a player belongs to, if any. Read-only; players cannot change it. */
  async agentForPlayer(playerId: string): Promise<{ agentId: string; displayName: string } | null> {
    const { rows } = await this.client.query(
      `select a.profile_id, a.display_name
         from player_agents pa join agents a on a.profile_id = pa.agent_id
        where pa.player_id = $1`,
      [playerId],
    );
    const row = rows[0] as Record<string, string> | undefined;
    return row ? { agentId: row['profile_id']!, displayName: row['display_name']! } : null;
  }

  /* ------------------------------------------------------------ admin side */

  async listAgents(limit = 200): Promise<AgentSummary[]> {
    const { rows } = await this.client.query(
      `select a.profile_id, a.display_name, a.status,
              coalesce(c.balance, 0) as inventory,
              (select count(*) from player_agents p where p.agent_id = a.profile_id) as players
         from agents a
         left join accounts acc
           on acc.owner_id = a.profile_id and acc.kind = 'agent' and acc.currency = 'GC'
         left join account_balance_cache c on c.account_id = acc.id
        order by a.created_at desc
        limit $1`,
      [limit],
    );
    return (rows as Record<string, string>[]).map((row) => ({
      agentId: row['profile_id']!,
      displayName: row['display_name']!,
      status: row['status'] as AgentSummary['status'],
      inventory: toInt(row['inventory']),
      playerCount: toInt(row['players']),
    }));
  }

  /**
   * Promote an existing profile to agent.
   *
   * Deliberately takes a USERNAME rather than creating an account. The person
   * signs up as a player through the normal flow — email, password, their own
   * credentials — and is then marked as an agent. Nothing in this system ever
   * creates a login on someone else's behalf or knows their password.
   */
  async createAgent(args: {
    username: string;
    displayName: string;
    operatorId: string | null;
    notes?: string;
  }): Promise<AgentSummary> {
    const { rows } = await this.client.query(
      `insert into agents (profile_id, display_name, created_by, notes)
       select p.id, $2, $3, $4 from profiles p where p.username = $1
       on conflict (profile_id) do update set display_name = excluded.display_name
       returning profile_id, display_name, status`,
      [args.username, args.displayName, args.operatorId, args.notes ?? null],
    );
    const row = rows[0] as Record<string, string> | undefined;
    if (!row) throw new Error(`No player named ${args.username}`);
    return {
      agentId: row['profile_id']!,
      displayName: row['display_name']!,
      status: row['status'] as AgentSummary['status'],
      inventory: 0,
      playerCount: 0,
    };
  }

  /**
   * Activate, suspend or park an agent.
   *
   * Goes through `set_agent_status` rather than issuing the UPDATE here, so the
   * audit row names the operator who actually did it. Attribution has to be set
   * inside the same statement as the write — see 0010 for why a transaction
   * opened across a connection pool cannot do that.
   */
  async setAgentStatus(
    agentId: string,
    status: 'pending' | 'active' | 'suspended',
    operatorId: string | null,
  ): Promise<void> {
    await this.client.query(`select set_agent_status($1, $2, $3)`, [agentId, status, operatorId]);
  }

  async grantInventory(args: {
    agentId: string;
    amount: number;
    operatorId: string | null;
    reference?: string;
    idempotencyKey?: string;
  }): Promise<{ txnId: string; inventory: number }> {
    const { rows } = await this.client.query(
      `select * from grant_agent_inventory($1, $2, $3, $4, $5)`,
      [
        args.agentId,
        args.amount,
        args.operatorId,
        args.idempotencyKey ?? null,
        args.reference ?? null,
      ],
    );
    const row = rows[0] as Record<string, string>;
    return { txnId: row['txn_id']!, inventory: toInt(row['inventory']) };
  }

  /** Reassign a player to a different agent. Admin only, and audited by trigger. */
  async reassignPlayer(playerId: string, agentId: string, operatorId: string | null): Promise<void> {
    await this.client.query(
      `insert into player_agents (player_id, agent_id, assigned_by)
       values ($1, $2, $3)
       on conflict (player_id) do update
         set agent_id = excluded.agent_id,
             assigned_at = now(),
             assigned_by = excluded.assigned_by`,
      [playerId, agentId, operatorId],
    );
  }
}
