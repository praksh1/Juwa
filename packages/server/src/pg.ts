/**
 * Postgres implementation of `Db`.
 *
 * Every method is a single call to one of the `security definer` functions in
 * `db/migrations/0003_play.sql`. Deliberately so: the interesting work — row
 * locks, balance checks, the atomic debit-and-credit — belongs in the database
 * where it cannot be skipped, not in application code where a future refactor
 * might reorder it.
 *
 * This file should stay boring. If logic starts appearing here, it is in the
 * wrong place.
 */

import type { Db, FreshSeed, PlayerSummary, ReservedNonce, StoredRound } from './db.js';

/** The slice of `pg.Pool` we use, so this package need not depend on `pg`. */
export interface QueryClient {
  query<T = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<{ rows: T[] }>;
}

const toInt = (value: unknown): number => {
  // node-postgres returns bigint as a string to avoid silent precision loss.
  // Coins fit comfortably in a JS safe integer, so parse and check the bound.
  const parsed = typeof value === 'string' ? Number(value) : (value as number);
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`Value ${value} is outside JavaScript's safe integer range`);
  }
  return parsed;
};

export class PostgresDb implements Db {
  constructor(private readonly client: QueryClient) {}

  async reserveNonce(playerId: string, fresh: FreshSeed): Promise<ReservedNonce> {
    const { rows } = await this.client.query(
      `select * from reserve_nonce($1, $2, $3, $4)`,
      [playerId, fresh.serverSeed, fresh.serverSeedHash, fresh.clientSeed ?? null],
    );
    const row = rows[0] as Record<string, string>;
    if (!row) throw new Error(`Failed to reserve a nonce for player ${playerId}`);
    return {
      seedPairId: row['seed_pair_id']!,
      serverSeed: row['server_seed']!,
      serverSeedHash: row['server_seed_hash']!,
      clientSeed: row['client_seed']!,
      nonce: toInt(row['nonce']),
    };
  }

  async playInstantRound(args: {
    playerId: string;
    gameId: string;
    seedPairId: string;
    nonce: number;
    stake: number;
    payout: number;
    currency: string;
    state: unknown;
    idempotencyKey: string;
    maxWinMultiplier?: number | null;
    maxPayoutGc?: number | null;
  }): Promise<{ roundId: string; balance: number }> {
    const { rows } = await this.client.query(
      `select * from play_instant_round_with_limits($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11)`,
      [
        args.playerId, args.gameId, args.seedPairId, args.nonce,
        args.stake, args.payout, args.currency,
        JSON.stringify(args.state), args.idempotencyKey,
        args.maxWinMultiplier ?? null, args.maxPayoutGc ?? null,
      ],
    );
    const row = rows[0] as Record<string, string>;
    return { roundId: row!['round_id']!, balance: toInt(row!['balance']) };
  }

  async openRound(args: {
    playerId: string;
    gameId: string;
    seedPairId: string;
    nonce: number;
    stake: number;
    currency: string;
    state: unknown;
    idempotencyKey: string;
    maxWinMultiplier?: number | null;
    maxPayoutGc?: number | null;
  }): Promise<{ roundId: string; balance: number }> {
    const { rows } = await this.client.query(
      `select * from open_round_with_limits($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10)`,
      [
        args.playerId, args.gameId, args.seedPairId, args.nonce,
        args.stake, args.currency, JSON.stringify(args.state), args.idempotencyKey,
        args.maxWinMultiplier ?? null, args.maxPayoutGc ?? null,
      ],
    );
    const row = rows[0] as Record<string, string>;
    return { roundId: row!['round_id']!, balance: toInt(row!['balance']) };
  }

  async updateRound(args: {
    roundId: string;
    state: unknown;
    additionalStake?: number;
    idempotencyKey: string;
  }): Promise<number> {
    const { rows } = await this.client.query(
      `select update_round($1, $2::jsonb, $3, $4) as balance`,
      [args.roundId, JSON.stringify(args.state), args.additionalStake ?? 0, args.idempotencyKey],
    );
    return toInt((rows[0] as Record<string, string>)['balance']);
  }

  async settleRound(args: {
    roundId: string;
    payout: number;
    state: unknown;
    idempotencyKey: string;
  }): Promise<number> {
    const { rows } = await this.client.query(
      `select settle_round($1, $2, $3::jsonb, $4) as balance`,
      [args.roundId, args.payout, JSON.stringify(args.state), args.idempotencyKey],
    );
    return toInt((rows[0] as Record<string, string>)['balance']);
  }

  async getRound(roundId: string): Promise<StoredRound | null> {
    const { rows } = await this.client.query(
      `select id, player_id, game_id, status, seed_pair_id, nonce, stake, payout, currency, state,
              max_win_multiplier, max_payout_gc
         from game_rounds where id = $1`,
      [roundId],
    );
    const row = rows[0] as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      roundId: row['id'] as string,
      playerId: row['player_id'] as string,
      gameId: row['game_id'] as string,
      status: row['status'] as StoredRound['status'],
      seedPairId: row['seed_pair_id'] as string,
      nonce: toInt(row['nonce']),
      stake: toInt(row['stake']),
      payout: row['payout'] === null ? null : toInt(row['payout']),
      currency: row['currency'] as string,
      state: row['state'],
      maxWinMultiplier: row['max_win_multiplier'] == null ? null : Number(row['max_win_multiplier']),
      maxPayoutGc: row['max_payout_gc'] == null ? null : toInt(row['max_payout_gc']),
    };
  }

  async getRoundFairness(roundId: string) {
    const { rows } = await this.client.query(
      `select s.server_seed, s.server_seed_hash, s.client_seed,
              s.revealed_at is not null as revealed,
              r.nonce, r.game_id, r.stake, coalesce(r.payout, 0) as payout, r.state
         from game_rounds r
         join seed_pairs s on s.id = r.seed_pair_id
        where r.id = $1`,
      [roundId],
    );
    const row = rows[0] as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      serverSeed: row['server_seed'] as string,
      serverSeedHash: row['server_seed_hash'] as string,
      clientSeed: row['client_seed'] as string,
      revealed: row['revealed'] as boolean,
      nonce: toInt(row['nonce']),
      gameId: row['game_id'] as string,
      stake: toInt(row['stake']),
      payout: toInt(row['payout']),
      state: row['state'],
    };
  }

  async getPlayer(playerId: string): Promise<PlayerSummary | null> {
    const { rows } = await this.client.query(
      `select p.lifetime_wagered, p.daily_streak, p.last_bonus_date, p.has_purchased,
              coalesce(b.balance, 0) as balance
         from profiles p
         left join accounts a
           on a.owner_id = p.id and a.kind = 'player' and a.currency = 'GC'
         left join account_balance_cache b on b.account_id = a.id
        where p.id = $1`,
      [playerId],
    );
    const row = rows[0] as Record<string, unknown> | undefined;
    if (!row) return null;
    const lastBonus = row['last_bonus_date'];
    return {
      balance: toInt(row['balance']),
      lifetimeWagered: toInt(row['lifetime_wagered']),
      dailyStreak: toInt(row['daily_streak']),
      lastBonusDate:
        lastBonus instanceof Date
          ? lastBonus.toISOString().slice(0, 10)
          : ((lastBonus as string | null) ?? null),
      hasPurchased: row['has_purchased'] as boolean,
    };
  }

  async grantBonus(args: {
    playerId: string;
    kind: 'welcome' | 'daily' | 'top_up' | 'promo';
    coins: number;
    streakDay: number | null;
    grantDate: string;
    idempotencyKey: string;
  }): Promise<number> {
    const { rows } = await this.client.query(
      `select grant_bonus($1, $2, $3, $4, $5::date, $6) as balance`,
      [args.playerId, args.kind, args.coins, args.streakDay, args.grantDate, args.idempotencyKey],
    );
    return toInt((rows[0] as Record<string, string>)['balance']);
  }

  async rotateSeed(playerId: string, fresh: FreshSeed) {
    const { rows } = await this.client.query(
      `select * from rotate_seed($1, $2, $3, $4)`,
      [playerId, fresh.serverSeed, fresh.serverSeedHash, fresh.clientSeed ?? null],
    );
    const row = rows[0] as Record<string, string | null> | undefined;
    return {
      revealedServerSeed: row?.['revealed_server_seed'] ?? null,
      revealedHash: row?.['revealed_hash'] ?? null,
    };
  }
}
