/**
 * The data layer the play handlers depend on.
 *
 * Every method here maps to one of the `security definer` functions in
 * `db/migrations/0003_play.sql`. The atomicity that matters — debit and credit
 * inside a single transaction, nonce claimed under a row lock — lives in the
 * database, not here. This interface just calls it.
 *
 * Keeping it an interface means the handlers can be tested against a real
 * Postgres (`pg.ts`) without the tests knowing which.
 */

export interface ReservedNonce {
  seedPairId: string;
  serverSeed: string;
  serverSeedHash: string;
  clientSeed: string;
  nonce: number;
}

export interface FreshSeed {
  serverSeed: string;
  serverSeedHash: string;
  clientSeed?: string;
}

export interface StoredRound {
  roundId: string;
  playerId: string;
  gameId: string;
  status: 'open' | 'settled' | 'voided';
  seedPairId: string;
  nonce: number;
  stake: number;
  payout: number | null;
  currency: string;
  /** The complete engine RoundState, including private data. Server-only. */
  state: unknown;
}

export interface PlayerSummary {
  balance: number;
  lifetimeWagered: number;
  dailyStreak: number;
  lastBonusDate: string | null;
  hasPurchased: boolean;
}

export interface Db {
  reserveNonce(playerId: string, fresh: FreshSeed): Promise<ReservedNonce>;

  playInstantRound(args: {
    playerId: string;
    gameId: string;
    seedPairId: string;
    nonce: number;
    stake: number;
    payout: number;
    currency: string;
    state: unknown;
    idempotencyKey: string;
  }): Promise<{ roundId: string; balance: number }>;

  openRound(args: {
    playerId: string;
    gameId: string;
    seedPairId: string;
    nonce: number;
    stake: number;
    currency: string;
    state: unknown;
    idempotencyKey: string;
  }): Promise<{ roundId: string; balance: number }>;

  updateRound(args: {
    roundId: string;
    state: unknown;
    additionalStake?: number;
    idempotencyKey: string;
  }): Promise<number>;

  settleRound(args: {
    roundId: string;
    payout: number;
    state: unknown;
    idempotencyKey: string;
  }): Promise<number>;

  getRound(roundId: string): Promise<StoredRound | null>;

  /**
   * Seed material for a round.
   *
   * This returns the live `serverSeed` unconditionally, because the server needs
   * it to continue an in-flight round. It is INTERNAL — `revealed` says whether
   * the seed may be shown to the player, and `verifyRound` is the only thing
   * that puts it in a response.
   */
  getRoundFairness(roundId: string): Promise<{
    serverSeed: string;
    serverSeedHash: string;
    clientSeed: string;
    nonce: number;
    /** True once the seed has been rotated out and is safe to disclose. */
    revealed: boolean;
    gameId: string;
    stake: number;
    payout: number;
    state: unknown;
  } | null>;

  getPlayer(playerId: string): Promise<PlayerSummary | null>;

  grantBonus(args: {
    playerId: string;
    kind: 'welcome' | 'daily' | 'top_up' | 'promo';
    coins: number;
    streakDay: number | null;
    grantDate: string;
    idempotencyKey: string;
  }): Promise<number>;

  rotateSeed(
    playerId: string,
    fresh: FreshSeed,
  ): Promise<{ revealedServerSeed: string | null; revealedHash: string | null }>;
}
