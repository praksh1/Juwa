/**
 * The play API client.
 *
 * Two implementations behind one interface:
 *
 *   HttpPlayApi — talks to the real server. This is what ships.
 *   DemoPlayApi — a local stub so the app runs with no backend at all.
 *
 * ⚠️ The demo adapter is for UI development ONLY. It fakes grids with
 * Math.random() on the device, has no ledger behind it, no provable fairness,
 * and its payouts are not the certified 96.25% RTP — it does not run the real
 * slot maths at all. Nothing about it is a game you could ship. It exists so
 * that reel timing and win presentation can be worked on without standing up
 * Postgres, and `USE_DEMO_API` must be false in any build that reaches a player.
 *
 * NOTE ON TYPES: these mirror the contract in `@juwa/server`. The app cannot
 * import that package, because it pulls in `@juwa/engine` — and an engine on the
 * device is an engine a player can patch. The duplication is the price of that
 * boundary; a shared types-only package would remove it and is worth doing once
 * the contract stops moving.
 */

export type RoundStatus = 'awaiting-action' | 'settled';

export interface Settlement {
  stake: number;
  payout: number;
  multiplier: number;
}

export interface LineWin {
  line: number;
  symbol: string;
  count: number;
  multiplier: number;
}

export interface SpinResult {
  grid: string[][];
  lineWins: LineWin[];
  scatterCount: number;
  scatterMultiplier: number;
  totalMultiplier: number;
}

export interface SlotsState {
  baseSpin: SpinResult;
  freeSpins: SpinResult[];
  freeSpinsAwarded: number;
  totalMultiplier: number;
}

export interface RoundResponse {
  roundId: string;
  gameId: string;
  status: RoundStatus;
  state: unknown;
  availableActions: string[];
  settlement?: Settlement;
  balance: number;
  fairness: { serverSeedHash: string; clientSeed: string; nonce: number };
}

export interface PlayApi {
  getBalance(): Promise<{ balance: number; dailyStreak: number; vipLevel: number }>;
  placeBet(request: {
    gameId: string;
    stake: number;
    idempotencyKey: string;
  }): Promise<RoundResponse>;
}

export class PlayApiError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = 'PlayApiError';
  }
}

// ------------------------------------------------------------------- http

export class HttpPlayApi implements PlayApi {
  constructor(
    private readonly baseUrl: string,
    private readonly getToken: () => string | null,
  ) {}

  private async request<T>(path: string, body?: unknown): Promise<T> {
    const token = this.getToken();
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: body ? 'POST' : 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });

    if (!response.ok) {
      const detail = (await response.json().catch(() => ({}))) as {
        message?: string;
        code?: string;
      };
      throw new PlayApiError(
        detail.message ?? `Request failed (${response.status})`,
        detail.code ?? 'unknown',
      );
    }
    return (await response.json()) as T;
  }

  getBalance() {
    return this.request<{ balance: number; dailyStreak: number; vipLevel: number }>('/balance');
  }

  placeBet(request: { gameId: string; stake: number; idempotencyKey: string }) {
    return this.request<RoundResponse>('/bet', request);
  }
}

// ------------------------------------------------------------------- demo

const DEMO_SYMBOLS = ['SEVEN', 'DIAMOND', 'BELL', 'BAR', 'CHERRY', 'PLUM', 'LEMON', 'WILD', 'SCATTER'];
const DEMO_WEIGHTS = [2, 2, 3, 4, 6, 6, 6, 1, 1];

function weightedSymbol(): string {
  const total = DEMO_WEIGHTS.reduce((a, b) => a + b, 0);
  let roll = Math.random() * total;
  for (let i = 0; i < DEMO_SYMBOLS.length; i++) {
    roll -= DEMO_WEIGHTS[i]!;
    if (roll <= 0) return DEMO_SYMBOLS[i]!;
  }
  return DEMO_SYMBOLS[0]!;
}

/** See the warning at the top of this file. Not a game. */
export class DemoPlayApi implements PlayApi {
  private balance: number;

  constructor(startingBalance = 100_000) {
    this.balance = startingBalance;
  }

  async getBalance() {
    return { balance: this.balance, dailyStreak: 3, vipLevel: 2 };
  }

  async placeBet(request: { gameId: string; stake: number; idempotencyKey: string }) {
    if (request.stake > this.balance) {
      throw new PlayApiError(
        `Not enough coins: balance ${this.balance}, stake ${request.stake}`,
        'insufficient_funds',
      );
    }
    // Simulate the round trip so the UI is built against realistic latency.
    await new Promise((resolve) => setTimeout(resolve, 180));

    const grid: string[][] = Array.from({ length: 5 }, () =>
      Array.from({ length: 3 }, () => weightedSymbol()),
    );

    // A crude payout, purely so win presentation has something to render.
    const lineWins: LineWin[] = [];
    for (const row of [0, 1, 2]) {
      const symbols = grid.map((reel) => reel[row]!);
      const first = symbols[0]!;
      let count = 1;
      while (count < 5 && (symbols[count] === first || symbols[count] === 'WILD')) count++;
      if (count >= 3) {
        lineWins.push({ line: row, symbol: first, count, multiplier: count * 4 });
      }
    }
    const totalMultiplier = lineWins.reduce((sum, w) => sum + w.multiplier, 0) / 20;
    const payout = Math.floor(request.stake * totalMultiplier);

    this.balance = this.balance - request.stake + payout;

    const state: SlotsState = {
      baseSpin: { grid, lineWins, scatterCount: 0, scatterMultiplier: 0, totalMultiplier },
      freeSpins: [],
      freeSpinsAwarded: 0,
      totalMultiplier,
    };

    return {
      roundId: `demo-${Date.now()}`,
      gameId: request.gameId,
      status: 'settled' as const,
      state,
      availableActions: [],
      settlement: { stake: request.stake, payout, multiplier: totalMultiplier },
      balance: this.balance,
      fairness: { serverSeedHash: 'demo-mode-no-fairness-proof', clientSeed: 'demo', nonce: 0 },
    };
  }
}

/**
 * Flip to false and set EXPO_PUBLIC_API_URL to run against the real server.
 * Left true here so `npx expo start` works immediately after a clone.
 */
export const USE_DEMO_API = true;

export function createPlayApi(): PlayApi {
  if (USE_DEMO_API) return new DemoPlayApi();
  const baseUrl = process.env['EXPO_PUBLIC_API_URL'];
  if (!baseUrl) throw new Error('EXPO_PUBLIC_API_URL is required when USE_DEMO_API is false');
  return new HttpPlayApi(baseUrl, () => null);
}
