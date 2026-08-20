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
}

export interface AgentVaultPlayer extends VaultWallet {
  playerId: string;
  username: string;
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

  async wallet(playerId: string): Promise<VaultWallet> {
    const { rows } = await this.client.query(
      `select a.kind::text as kind, coalesce(c.balance, 0) as balance
         from accounts a
         left join account_balance_cache c on c.account_id = a.id
        where a.owner_id = $1 and a.currency = 'GC'
          and a.kind::text in ('player', 'vault_pending', 'vault_saved')`,
      [playerId],
    );
    const wallet: VaultWallet = { playable: 0, pending: 0, saved: 0 };
    for (const row of rows as Record<string, unknown>[]) {
      if (row['kind'] === 'player') wallet.playable = toInt(row['balance']);
      if (row['kind'] === 'vault_pending') wallet.pending = toInt(row['balance']);
      if (row['kind'] === 'vault_saved') wallet.saved = toInt(row['balance']);
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
              coalesce(max(c.balance) filter (where a.kind::text = 'player'), 0) as playable,
              coalesce(max(c.balance) filter (where a.kind::text = 'vault_pending'), 0) as pending,
              coalesce(max(c.balance) filter (where a.kind::text = 'vault_saved'), 0) as saved
         from player_agents pa
         join profiles p on p.id = pa.player_id
         left join accounts a on a.owner_id = p.id and a.currency = 'GC'
           and a.kind::text in ('player', 'vault_pending', 'vault_saved')
         left join account_balance_cache c on c.account_id = a.id
        where pa.agent_id = $1
        group by p.id, p.username
        order by p.username`,
      [agentId],
    );
    return (rows as Record<string, unknown>[]).map((row) => ({
      playerId: String(row['player_id']),
      username: String(row['username']),
      playable: toInt(row['playable']),
      pending: toInt(row['pending']),
      saved: toInt(row['saved']),
    }));
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
