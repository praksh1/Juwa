/** Agent Vault reads and atomic operations. */
import type { QueryClient } from './pg.js';

const toInt = (value: unknown): number => Number(value ?? 0);

export type VaultRequestStatus = 'pending' | 'saved' | 'cancelled' | 'rejected' | 'restored';

export interface VaultRequest {
  id: string;
  playerId: string;
  username: string | null;
  agentId: string;
  amount: number;
  remainingAmount: number;
  status: VaultRequestStatus;
  requestedAt: string;
  decidedAt: string | null;
  reason: string | null;
}

export interface VaultWallet {
  playable: number;
  pending: number;
  saved: number;
  returnPending: number;
}

export interface VaultPolicy {
  inactiveDays: number;
  warningDays: number;
}

export interface AgentVaultPlayer extends VaultWallet {
  playerId: string;
  username: string;
  lastSeenAt: string | null;
  dormantEligibleAt: string;
  dormantEligible: boolean;
}

export type DormantVaultReturnStatus = 'warning' | 'approved' | 'cancelled' | 'rejected';
export interface DormantVaultReturn {
  id: string;
  playerId: string;
  username: string;
  agentId: string;
  agentName: string;
  amount: number;
  status: DormantVaultReturnStatus;
  lastActivityAt: string;
  warningStartedAt: string;
  eligibleAt: string;
  resolvedAt: string | null;
  reason: string | null;
}

function toDormantReturn(row: Record<string, unknown>): DormantVaultReturn {
  return {
    id: String(row['id']), playerId: String(row['player_id']),
    username: String(row['username']), agentId: String(row['agent_id']),
    agentName: String(row['agent_name']), amount: toInt(row['amount']),
    status: row['status'] as DormantVaultReturnStatus,
    lastActivityAt: new Date(row['last_activity_at'] as string).toISOString(),
    warningStartedAt: new Date(row['warning_started_at'] as string).toISOString(),
    eligibleAt: new Date(row['eligible_at'] as string).toISOString(),
    resolvedAt: row['resolved_at'] ? new Date(row['resolved_at'] as string).toISOString() : null,
    reason: (row['reason'] as string | null) ?? null,
  };
}

const REQUEST_COLUMNS = `
  r.id, r.player_id, r.agent_id, r.amount, r.remaining_amount,
  r.status, r.requested_at, r.decided_at, r.reason`;

function toRequest(row: Record<string, unknown>): VaultRequest {
  return {
    id: String(row['id']),
    playerId: String(row['player_id']),
    username: (row['username'] as string | null) ?? null,
    agentId: String(row['agent_id']),
    amount: toInt(row['amount']),
    remainingAmount: toInt(row['remaining_amount']),
    status: row['status'] as VaultRequestStatus,
    requestedAt: new Date(row['requested_at'] as string).toISOString(),
    decidedAt: row['decided_at'] ? new Date(row['decided_at'] as string).toISOString() : null,
    reason: (row['reason'] as string | null) ?? null,
  };
}

export class VaultsDb {
  constructor(private readonly client: QueryClient) {}

  async policy(): Promise<VaultPolicy> {
    const { rows } = await this.client.query(
      `select vault_inactive_days, vault_warning_days from global_settings limit 1`,
    );
    const row = (rows[0] ?? {}) as Record<string, unknown>;
    return {
      inactiveDays: toInt(row['vault_inactive_days']),
      warningDays: toInt(row['vault_warning_days']),
    };
  }

  async wallet(playerId: string): Promise<VaultWallet> {
    const { rows } = await this.client.query(
      `select a.kind::text as kind, coalesce(c.balance, 0) as balance
         from accounts a
         left join account_balance_cache c on c.account_id = a.id
        where a.owner_id = $1 and a.currency = 'GC'
          and a.kind::text in ('player', 'vault_pending', 'vault_saved', 'vault_return_pending')`,
      [playerId],
    );
    const wallet: VaultWallet = { playable: 0, pending: 0, saved: 0, returnPending: 0 };
    for (const row of rows as Record<string, unknown>[]) {
      if (row['kind'] === 'player') wallet.playable = toInt(row['balance']);
      if (row['kind'] === 'vault_pending') wallet.pending = toInt(row['balance']);
      if (row['kind'] === 'vault_saved') wallet.saved = toInt(row['balance']);
      if (row['kind'] === 'vault_return_pending') wallet.returnPending = toInt(row['balance']);
    }
    return wallet;
  }

  async playerRequests(playerId: string, limit = 50): Promise<VaultRequest[]> {
    const { rows } = await this.client.query(
      `select ${REQUEST_COLUMNS}, null::text as username
         from agent_vault_requests r
        where r.player_id = $1
        order by r.requested_at desc
        limit $2`,
      [playerId, limit],
    );
    return (rows as Record<string, unknown>[]).map(toRequest);
  }

  async agentRequests(agentId: string, limit = 200): Promise<VaultRequest[]> {
    const { rows } = await this.client.query(
      `select ${REQUEST_COLUMNS}, p.username
         from agent_vault_requests r
         join profiles p on p.id = r.player_id
        where r.agent_id = $1
        order by case when r.status = 'pending' then 0 else 1 end,
                 r.requested_at desc
        limit $2`,
      [agentId, limit],
    );
    return (rows as Record<string, unknown>[]).map(toRequest);
  }

  async agentPlayers(agentId: string): Promise<AgentVaultPlayer[]> {
    const { rows } = await this.client.query(
      `select p.id as player_id, p.username,
              coalesce(p.last_seen_at, p.registered_at, p.created_at) as last_seen_at,
              coalesce(p.last_seen_at, p.registered_at, p.created_at)
                + make_interval(days => gs.vault_inactive_days) as dormant_eligible_at,
              coalesce(p.last_seen_at, p.registered_at, p.created_at)
                <= now() - make_interval(days => gs.vault_inactive_days) as dormant_eligible,
              coalesce(max(c.balance) filter (where a.kind::text = 'player'), 0) as playable,
              coalesce(max(c.balance) filter (where a.kind::text = 'vault_pending'), 0) as pending,
              coalesce(max(c.balance) filter (where a.kind::text = 'vault_saved'), 0) as saved,
              coalesce(max(c.balance) filter (where a.kind::text = 'vault_return_pending'), 0) as return_pending
         from player_agents pa
         join profiles p on p.id = pa.player_id
         cross join global_settings gs
         left join accounts a on a.owner_id = p.id and a.currency = 'GC'
           and a.kind::text in ('player', 'vault_pending', 'vault_saved', 'vault_return_pending')
         left join account_balance_cache c on c.account_id = a.id
        where pa.agent_id = $1
        group by p.id, p.username, p.last_seen_at, p.registered_at, p.created_at,
                 gs.vault_inactive_days
        order by p.username`,
      [agentId],
    );
    return (rows as Record<string, unknown>[]).map((row) => ({
      playerId: String(row['player_id']),
      username: String(row['username']),
      playable: toInt(row['playable']),
      pending: toInt(row['pending']),
      saved: toInt(row['saved']),
      returnPending: toInt(row['return_pending']),
      lastSeenAt: row['last_seen_at'] ? new Date(row['last_seen_at'] as string).toISOString() : null,
      dormantEligibleAt: new Date(row['dormant_eligible_at'] as string).toISOString(),
      dormantEligible: Boolean(row['dormant_eligible']),
    }));
  }

  async agentReturns(agentId: string): Promise<DormantVaultReturn[]> {
    const { rows } = await this.client.query(
      `select r.*, p.username, a.display_name as agent_name
         from agent_vault_returns r join profiles p on p.id = r.player_id
         join agents a on a.profile_id = r.agent_id
        where r.agent_id = $1
        order by case when r.status = 'warning' then 0 else 1 end, r.warning_started_at desc`,
      [agentId],
    );
    return (rows as Record<string, unknown>[]).map(toDormantReturn);
  }

  async adminReturns(): Promise<DormantVaultReturn[]> {
    const { rows } = await this.client.query(
      `select r.*, p.username, a.display_name as agent_name
         from agent_vault_returns r join profiles p on p.id = r.player_id
         join agents a on a.profile_id = r.agent_id
        order by case when r.status = 'warning' then 0 else 1 end, r.warning_started_at desc
        limit 300`,
    );
    return (rows as Record<string, unknown>[]).map(toDormantReturn);
  }

  async requestDormantReturn(agentId: string, playerId: string, amount: number, key: string) {
    const { rows } = await this.client.query(
      `select request_dormant_vault_return($1, $2, $3, $4) as id`,
      [agentId, playerId, amount, key],
    );
    return String((rows[0] as Record<string, unknown>)['id']);
  }

  async cancelDormantReturn(requestId: string, agentId: string) {
    await this.client.query(`select cancel_dormant_vault_return($1, $2)`, [requestId, agentId]);
  }

  async resolveDormantReturn(
    requestId: string, operatorId: string, approve: boolean, reason?: string,
  ) {
    await this.client.query(`select resolve_dormant_vault_return($1, $2, $3, $4)`, [
      requestId, operatorId, approve, reason ?? null,
    ]);
  }

  async request(playerId: string, amount: number, idempotencyKey: string): Promise<string> {
    const { rows } = await this.client.query(
      `select request_agent_vault_save($1, $2, $3) as id`,
      [playerId, amount, idempotencyKey],
    );
    return String((rows[0] as Record<string, unknown>)['id']);
  }

  async cancel(requestId: string, playerId: string): Promise<void> {
    await this.client.query(`select cancel_agent_vault_save($1, $2)`, [requestId, playerId]);
  }

  async approve(requestId: string, agentId: string): Promise<void> {
    await this.client.query(`select approve_agent_vault_save($1, $2)`, [requestId, agentId]);
  }

  async reject(requestId: string, agentId: string, reason?: string): Promise<void> {
    await this.client.query(`select reject_agent_vault_save($1, $2, $3)`, [
      requestId,
      agentId,
      reason ?? null,
    ]);
  }

  async restore(
    agentId: string,
    playerId: string,
    amount: number,
    idempotencyKey: string,
  ): Promise<string> {
    const { rows } = await this.client.query(
      `select restore_agent_vault_gc($1, $2, $3, $4) as id`,
      [agentId, playerId, amount, idempotencyKey],
    );
    return String((rows[0] as Record<string, unknown>)['id']);
  }
}
