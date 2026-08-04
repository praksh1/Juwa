/**
 * Operator game configuration, as the play path sees it.
 *
 * "Changes apply to new spins only" is the rule, and it falls out of reading
 * the config at the start of each bet rather than baking it into the engine at
 * registration. A round already in flight settles on the terms it started on,
 * which is the only defensible behaviour: changing the cap on a round a player
 * is halfway through is the kind of thing that ends up in a screenshot.
 *
 * CACHED, BRIEFLY
 *
 * Querying this per spin would put a round trip in front of every bet for data
 * that changes a handful of times a month. Thirty seconds of staleness is
 * invisible to an operator disabling a game and saves a query on the hottest
 * path in the system.
 */

export interface GameConfig {
  enabled: boolean;
  /** Ceiling on one round's payout as a multiple of the stake, or null. */
  maxWinMultiplier: number | null;
  minBet: number | null;
  maxBet: number | null;
}

export interface ConfigDb {
  query<T>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

const REFRESH_MS = 30_000;

interface Row {
  game_id: string;
  enabled: boolean;
  max_win_multiplier: string | null;
  min_bet: string | null;
  max_bet: string | null;
}

export class GameConfigCache {
  private cache = new Map<string, GameConfig>();
  private loadedAt = 0;
  private inflight: Promise<void> | null = null;

  constructor(
    private readonly db: ConfigDb,
    private readonly now: () => number = () => Date.now(),
  ) {}

  private async refresh(): Promise<void> {
    // A single in-flight refresh shared by every caller. Without this, a burst
    // of spins after the cache expires fires one query per spin — the classic
    // stampede, and it arrives exactly when the system is busiest.
    if (this.inflight) return this.inflight;

    this.inflight = (async () => {
      try {
        const { rows } = await this.db.query<Row>(`select * from game_configs`);
        const next = new Map<string, GameConfig>();
        for (const row of rows) {
          next.set(row.game_id, {
            enabled: row.enabled,
            maxWinMultiplier: row.max_win_multiplier == null ? null : Number(row.max_win_multiplier),
            minBet: row.min_bet == null ? null : Number(row.min_bet),
            maxBet: row.max_bet == null ? null : Number(row.max_bet),
          });
        }
        this.cache = next;
        this.loadedAt = this.now();
      } finally {
        this.inflight = null;
      }
    })();

    return this.inflight;
  }

  /**
   * Absent means engine defaults, NOT disabled.
   *
   * A game that disappeared because nobody had configured it yet would take the
   * whole catalogue offline the first time this table was empty.
   */
  async get(gameId: string): Promise<GameConfig> {
    if (this.now() - this.loadedAt > REFRESH_MS) await this.refresh();
    return (
      this.cache.get(gameId) ?? {
        enabled: true,
        maxWinMultiplier: null,
        minBet: null,
        maxBet: null,
      }
    );
  }

  /** Called after an operator writes, so a change is visible immediately. */
  invalidate(): void {
    this.loadedAt = 0;
  }
}

export class GameDisabledError extends Error {
  constructor(gameId: string) {
    super(`This game is temporarily unavailable`);
    this.name = 'GameDisabledError';
    this.gameId = gameId;
  }
  readonly gameId: string;
}

export class StakeOutOfRangeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StakeOutOfRangeError';
  }
}

/** Throws if this bet may not be placed under the current configuration. */
export function assertBetAllowed(config: GameConfig, gameId: string, stake: number): void {
  if (!config.enabled) throw new GameDisabledError(gameId);
  if (config.minBet != null && stake < config.minBet) {
    throw new StakeOutOfRangeError(`Minimum bet is ${config.minBet}`);
  }
  if (config.maxBet != null && stake > config.maxBet) {
    throw new StakeOutOfRangeError(`Maximum bet is ${config.maxBet}`);
  }
}

/**
 * Apply the max-win cap to a settled payout.
 *
 * Rounded DOWN, and never below zero. A cap that rounds up pays more than the
 * operator set, which defeats the point of having one.
 */
export function applyMaxWin(
  config: GameConfig,
  stake: number,
  payout: number,
): { payout: number; capped: boolean } {
  if (config.maxWinMultiplier == null) return { payout, capped: false };
  const ceiling = Math.floor(stake * config.maxWinMultiplier);
  if (payout <= ceiling) return { payout, capped: false };
  return { payout: Math.max(0, ceiling), capped: true };
}
