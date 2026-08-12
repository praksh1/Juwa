/**
 * GC <-> CC conversions, as the API sees them.
 *
 * Every method here is a thin call onto a `security definer` function from
 * migration 0014, and that is the whole design. The authorisation — whose
 * request this is, whether the agent may settle it, whether the inventory
 * covers it, whether it has already been settled — lives inside the transaction
 * that moves the coins, so a bug in this file cannot move money that should not
 * move. What this file adds is the shape the client wants and error messages a
 * person can act on.
 *
 * ## Why there is no `setBalance` and never will be
 *
 * A balance is the sum of a ledger, and the ledger only accepts balanced
 * transactions through `post_transfer`. There is no method on this class that
 * takes an amount and an account and writes it, because there is no such
 * function in the database to call.
 */

import type { QueryClient } from './pg.js';

const toInt = (value: unknown): number => Number(value ?? 0);

/** Which way round a conversion goes. */
export type ConversionDirection = 'gc_to_cc' | 'cc_to_gc';

export type ConversionStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';

export interface ConversionRequest {
  id: string;
  playerId: string;
  /** The player's username, for an agent reading a queue of these. */
  username: string | null;
  agentId: string;
  direction: ConversionDirection;
  gcAmount: number;
  ccAmount: number;
  /** The rate this request was priced at. Never re-read from the rate table. */
  gcPerCc: number;
  status: ConversionStatus;
  requestedAt: string;
  decidedAt: string | null;
  reason: string | null;
}

/** What a player holds, in both currencies. */
export interface Wallet {
  gc: number;
  cc: number;
}

export interface RateCard {
  /** GC per CC when a player converts with their agent. */
  playerAgent: number;
  /** GC per CC when an agent converts with the operator. */
  agentOperator: number;
}

export interface AgentCcRedemption {
  id: string;
  ccAmount: number;
  gcAmount: number;
  gcPerCc: number;
  createdAt: string;
}

const REQUEST_COLUMNS = `
  r.id, r.player_id, r.agent_id, r.direction, r.gc_amount, r.cc_amount,
  r.gc_per_cc, r.status, r.requested_at, r.decided_at, r.reason`;

function toRequest(row: Record<string, unknown>): ConversionRequest {
  return {
    id: String(row['id']),
    playerId: String(row['player_id']),
    username: (row['username'] as string | null) ?? null,
    agentId: String(row['agent_id']),
    direction: row['direction'] as ConversionDirection,
    gcAmount: toInt(row['gc_amount']),
    ccAmount: toInt(row['cc_amount']),
    gcPerCc: toInt(row['gc_per_cc']),
    status: row['status'] as ConversionStatus,
    requestedAt: new Date(row['requested_at'] as string).toISOString(),
    decidedAt: row['decided_at'] ? new Date(row['decided_at'] as string).toISOString() : null,
    reason: (row['reason'] as string | null) ?? null,
  };
}

export class ConversionsDb {
  constructor(private readonly client: QueryClient) {}

  /**
   * Both balances for one player, in one round trip.
   *
   * A player who has never converted has no CC account at all — accounts are
   * created on first use — so this is a LEFT JOIN with a coalesce rather than
   * two lookups, and a missing account reads as zero rather than as an error.
   */
  async wallet(playerId: string): Promise<Wallet> {
    const { rows } = await this.client.query(
      `select a.currency, coalesce(c.balance, 0) as balance
         from accounts a
         left join account_balance_cache c on c.account_id = a.id
        where a.owner_id = $1 and a.kind::text = 'player'`,
      [playerId],
    );
    const wallet: Wallet = { gc: 0, cc: 0 };
    for (const row of rows as Record<string, unknown>[]) {
      if (row['currency'] === 'GC') wallet.gc = toInt(row['balance']);
      if (row['currency'] === 'CC') wallet.cc = toInt(row['balance']);
    }
    return wallet;
  }

  /** The same, for an agent's inventory rather than their playable balance. */
  async agentWallet(agentId: string): Promise<Wallet> {
    const { rows } = await this.client.query(
      `select a.currency, coalesce(c.balance, 0) as balance
         from accounts a
         left join account_balance_cache c on c.account_id = a.id
        where a.owner_id = $1 and a.kind::text = 'agent'`,
      [agentId],
    );
    const wallet: Wallet = { gc: 0, cc: 0 };
    for (const row of rows as Record<string, unknown>[]) {
      if (row['currency'] === 'GC') wallet.gc = toInt(row['balance']);
      if (row['currency'] === 'CC') wallet.cc = toInt(row['balance']);
    }
    return wallet;
  }

  /**
   * The rates a given player or agent is subject to.
   *
   * Resolved through `current_rate`, so an agent-specific override is applied
   * the same way here as it is when a request is priced. Reading the table
   * directly would be a second implementation of that precedence rule and the
   * two would eventually disagree — the displayed rate being the one thing a
   * player checks before pressing the button.
   */
  async rates(agentId: string | null): Promise<RateCard> {
    const { rows } = await this.client.query(
      `select current_rate('player_agent', $1::uuid) as player_agent,
              current_rate('agent_operator', $1::uuid) as agent_operator`,
      [agentId],
    );
    const row = (rows[0] ?? {}) as Record<string, unknown>;
    return {
      playerAgent: toInt(row['player_agent']),
      agentOperator: toInt(row['agent_operator']),
    };
  }

  /** A player's own requests, newest first. */
  async playerRequests(playerId: string, limit = 25): Promise<ConversionRequest[]> {
    const { rows } = await this.client.query(
      `select ${REQUEST_COLUMNS}, null::text as username
         from conversion_requests r
        where r.player_id = $1
        order by r.requested_at desc
        limit $2`,
      [playerId, limit],
    );
    return (rows as Record<string, unknown>[]).map(toRequest);
  }

  /**
   * The requests waiting on one agent.
   *
   * Scoped by `agent_id` in the WHERE clause, exactly as `players()` is: the
   * agent id comes from the verified token, and there is no parameter here a
   * caller could widen.
   */
  async agentRequests(
    agentId: string,
    status: ConversionStatus | 'all' = 'pending',
    limit = 100,
  ): Promise<ConversionRequest[]> {
    const { rows } = await this.client.query(
      `select ${REQUEST_COLUMNS}, p.username
         from conversion_requests r
         join profiles p on p.id = r.player_id
        where r.agent_id = $1
          and ($2 = 'all' or r.status = $2)
        order by r.requested_at desc
        limit $3`,
      [agentId, status, limit],
    );
    return (rows as Record<string, unknown>[]).map(toRequest);
  }

  /**
   * Raise a request. Moves nothing; returns the row so the client can show it.
   *
   * ## Two statements, and both of the one-statement forms are wrong
   *
   * `request_conversion` INSERTS, which makes it VOLATILE, and that rules out
   * both of the tidier shapes. Learned by writing each of them and watching a
   * real test fail:
   *
   *  - `... from conversion_requests r where r.id = request_conversion(...)`
   *    puts a side effect in a predicate. Postgres cannot hoist a volatile
   *    function out of a WHERE, so with an empty table the predicate is never
   *    evaluated and no request is created at all; with rows in the table it is
   *    evaluated once PER ROW and creates one request for each.
   *
   *  - `with created as (select request_conversion(...) as id) select ... join
   *    conversion_requests on ...` evaluates it exactly once, and still returns
   *    nothing: every part of one statement reads the same snapshot, so a row
   *    inserted by the CTE is not visible to the scan beside it.
   *
   * So: call the function, then read the row it returned. Two round trips on
   * the only path in this file that creates something, which is a fair price
   * for a query whose behaviour does not depend on how many rows happen to be
   * in the table.
   */
  async request(
    playerId: string,
    direction: ConversionDirection,
    amount: number,
  ): Promise<ConversionRequest> {
    const created = await this.client.query(`select request_conversion($1, $2, $3) as id`, [
      playerId,
      direction,
      amount,
    ]);
    const id = (created.rows[0] as Record<string, unknown> | undefined)?.['id'];
    if (!id) throw new Error('Conversion request was not created');

    const { rows } = await this.client.query(
      `select ${REQUEST_COLUMNS}, null::text as username
         from conversion_requests r where r.id = $1`,
      [id],
    );
    return toRequest(rows[0] as Record<string, unknown>);
  }

  /**
   * Settle a request.
   *
   * The database claims the row before it moves anything, so two of these
   * arriving together cannot both pay — see `approve_conversion`. This method
   * does not need, and deliberately does not have, a lock or a check of its own.
   */
  async approve(requestId: string, agentId: string): Promise<Wallet> {
    const { rows } = await this.client.query(
      `select player_gc, player_cc from approve_conversion($1, $2)`,
      [requestId, agentId],
    );
    const row = (rows[0] ?? {}) as Record<string, unknown>;
    return { gc: toInt(row['player_gc']), cc: toInt(row['player_cc']) };
  }

  async reject(requestId: string, agentId: string, reason?: string): Promise<void> {
    await this.client.query(`select reject_conversion($1, $2, $3)`, [
      requestId,
      agentId,
      reason ?? null,
    ]);
  }

  async cancel(requestId: string, playerId: string): Promise<void> {
    await this.client.query(`select cancel_conversion($1, $2)`, [requestId, playerId]);
  }

  /** Agent -> operator: CC out, GC inventory in, at the operator rate. */
  async redeemAgentCc(
    agentId: string,
    ccAmount: number,
    idempotencyKey?: string,
  ): Promise<{ gcAmount: number; gcPerCc: number; wallet: Wallet }> {
    const { rows } = await this.client.query(
      `select gc_amount, gc_per_cc, agent_gc, agent_cc from agent_redeem_cc($1, $2, $3)`,
      [agentId, ccAmount, idempotencyKey ?? null],
    );
    const row = (rows[0] ?? {}) as Record<string, unknown>;
    return {
      gcAmount: toInt(row['gc_amount']),
      gcPerCc: toInt(row['gc_per_cc']),
      wallet: { gc: toInt(row['agent_gc']), cc: toInt(row['agent_cc']) },
    };
  }

  async agentRedemptions(agentId: string, limit = 50): Promise<AgentCcRedemption[]> {
    const { rows } = await this.client.query(
      `select id, cc_amount, gc_amount, gc_per_cc, created_at
         from agent_cc_redemptions
        where agent_id = $1
        order by created_at desc
        limit $2`,
      [agentId, limit],
    );
    return (rows as Record<string, unknown>[]).map((row) => ({
      id: String(row['id']),
      ccAmount: toInt(row['cc_amount']),
      gcAmount: toInt(row['gc_amount']),
      gcPerCc: toInt(row['gc_per_cc']),
      createdAt: new Date(row['created_at'] as string).toISOString(),
    }));
  }

  // ------------------------------------------------------------- operator

  /** Every rate ever set, newest first. The history IS the table. */
  async rateHistory(limit = 100) {
    const { rows } = await this.client.query(
      `select r.id, r.tier, r.agent_id, p.username as agent_name, r.gc_per_cc,
              r.effective_from, r.note
         from exchange_rates r
         left join profiles p on p.id = r.agent_id
        order by r.effective_from desc, r.created_at desc
        limit $1`,
      [limit],
    );
    return (rows as Record<string, unknown>[]).map((row) => ({
      id: String(row['id']),
      tier: String(row['tier']) as 'player_agent' | 'agent_operator',
      agentId: (row['agent_id'] as string | null) ?? null,
      agentName: (row['agent_name'] as string | null) ?? null,
      gcPerCc: toInt(row['gc_per_cc']),
      effectiveFrom: new Date(row['effective_from'] as string).toISOString(),
      note: (row['note'] as string | null) ?? null,
    }));
  }

  async setRate(args: {
    tier: 'player_agent' | 'agent_operator';
    gcPerCc: number;
    operatorId: string;
    agentId?: string | null;
    note?: string | null;
  }): Promise<string> {
    const { rows } = await this.client.query(
      `select set_exchange_rate($1, $2, $3, $4, $5) as id`,
      [args.tier, args.gcPerCc, args.operatorId, args.agentId ?? null, args.note ?? null],
    );
    return String((rows[0] as Record<string, unknown>)['id']);
  }

  /**
   * An operator correcting a balance by hand.
   *
   * Kept on this class rather than on AgentsDb because it can touch either
   * currency, and because it belongs next to the rate controls: they are the
   * two things in the product that a human does directly to the money, and
   * both write an audit row.
   */
  async adjust(args: {
    ownerId: string;
    kind: 'player' | 'agent';
    currency: 'GC' | 'CC';
    delta: number;
    operatorId: string;
    reason: string;
  }): Promise<number> {
    const { rows } = await this.client.query(
      `select admin_adjust_balance($1, $2, $3, $4, $5, $6) as balance`,
      [args.ownerId, args.kind, args.currency, args.delta, args.operatorId, args.reason],
    );
    return toInt((rows[0] as Record<string, unknown>)['balance']);
  }

  /** Both balances for every agent, for the operator console. */
  async agentBalances(limit = 200) {
    const { rows } = await this.client.query(
      `select a.profile_id, a.display_name, a.status,
              coalesce(max(case when acc.currency = 'GC' then c.balance end), 0) as gc,
              coalesce(max(case when acc.currency = 'CC' then c.balance end), 0) as cc
         from agents a
         left join accounts acc
           on acc.owner_id = a.profile_id and acc.kind::text = 'agent'
         left join account_balance_cache c on c.account_id = acc.id
        group by a.profile_id, a.display_name, a.status
        order by a.display_name
        limit $1`,
      [limit],
    );
    return (rows as Record<string, unknown>[]).map((row) => ({
      agentId: String(row['profile_id']),
      displayName: String(row['display_name']),
      status: String(row['status']) as 'pending' | 'active' | 'suspended',
      gc: toInt(row['gc']),
      cc: toInt(row['cc']),
    }));
  }

  /** Hand an agent CC. The operator side of the chain. */
  async grantCc(args: {
    agentId: string;
    amount: number;
    operatorId: string;
    idempotencyKey?: string;
    reference?: string;
  }): Promise<number> {
    const { rows } = await this.client.query(
      `select cc_balance from grant_agent_cc($1, $2, $3, $4, $5)`,
      [
        args.agentId,
        args.amount,
        args.operatorId,
        args.idempotencyKey ?? null,
        args.reference ?? null,
      ],
    );
    return toInt((rows[0] as Record<string, unknown>)['cc_balance']);
  }
}
