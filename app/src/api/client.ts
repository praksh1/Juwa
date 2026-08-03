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
 * Postgres. It is selected only when EXPO_PUBLIC_API_URL is unset, so a
 * configured build can never accidentally ship it.
 *
 * NOTE ON TYPES: these mirror the contract in `@juwa/server`. The app cannot
 * import that package, because it pulls in `@juwa/engine` — and an engine on the
 * device is an engine a player can patch. The duplication is the price of that
 * boundary; a shared types-only package would remove it and is worth doing once
 * the contract stops moving.
 */

import { getAccessToken } from './auth';

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

export interface HistoryEntry {
  id: string;
  /** Positive is coins in, negative is coins out. Never a net figure. */
  amount: number;
  type: 'deposit' | 'withdrawal' | 'bet' | 'payout' | 'bonus' | 'adjustment' | 'refund';
  at: string;
  meta: Record<string, unknown>;
}

export interface Profile {
  registered: boolean;
  username?: string;
  ageVerified?: boolean;
  dailyStreak?: number;
  /** Drives the one-time first-purchase doubler in the store. */
  hasPurchased?: boolean;
}

export interface PlayApi {
  getBalance(): Promise<{ balance: number; dailyStreak: number; vipLevel: number }>;
  placeBet(request: {
    gameId: string;
    stake: number;
    idempotencyKey: string;
    /**
     * Games that need their bet layout before the wheel turns — roulette —
     * send it here, and the server applies it in the same request.
     */
    action?: { type: string; [key: string]: unknown };
  }): Promise<RoundResponse>;
  getProfile(): Promise<Profile>;
  register(details: {
    username: string;
    dateOfBirth: string;
    country: string;
  }): Promise<{ username: string; balance: number; ageVerified: boolean }>;
  claimDailyBonus(): Promise<{ granted: boolean; coins: number; streakDay: number; balance: number; reason?: string }>;
  startCheckout(packId: string): Promise<{ purchaseId: string; checkoutUrl: string; coins: number }>;
  getHistory(before?: string): Promise<{ entries: HistoryEntry[]; nextBefore: string | null }>;
  /** Continue a multi-step round: hit, stand, double, split. */
  act(request: {
    roundId: string;
    action: { type: string; [key: string]: unknown };
    idempotencyKey: string;
  }): Promise<RoundResponse>;
  getPurchase(id: string): Promise<{ id: string; status: string; coins: number; packId: string }>;
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
    private readonly getToken: () => Promise<string | null>,
  ) {}

  private async request<T>(path: string, body?: unknown): Promise<T> {
    // Fetched per request rather than cached: Supabase rotates the access token
    // roughly hourly, and a stale one becomes a mystery 401 mid-session.
    const token = await this.getToken();

    const response = await fetch(`${this.baseUrl}${path}`, {
      method: body ? 'POST' : 'GET',
      headers: {
        'Content-Type': 'application/json',
        // The player's timezone, so the daily bonus turns over at their
        // midnight rather than the server's.
        'X-UTC-Offset': String(-new Date().getTimezoneOffset()),
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

  placeBet(request: {
    gameId: string;
    stake: number;
    idempotencyKey: string;
    action?: { type: string; [key: string]: unknown };
  }) {
    return this.request<RoundResponse>('/bet', request);
  }

  getProfile() {
    return this.request<Profile>('/me');
  }

  register(details: { username: string; dateOfBirth: string; country: string }) {
    return this.request<{ username: string; balance: number; ageVerified: boolean }>(
      '/register',
      details,
    );
  }

  claimDailyBonus() {
    return this.request<{
      granted: boolean;
      coins: number;
      streakDay: number;
      balance: number;
      reason?: string;
    }>('/bonus/daily', {});
  }

  startCheckout(packId: string) {
    return this.request<{ purchaseId: string; checkoutUrl: string; coins: number }>(
      '/store/checkout',
      { packId },
    );
  }

  getPurchase(id: string) {
    return this.request<{ id: string; status: string; coins: number; packId: string }>(
      `/store/purchase?id=${encodeURIComponent(id)}`,
    );
  }

  getHistory(before?: string) {
    const query = before ? `?before=${encodeURIComponent(before)}` : '';
    return this.request<{ entries: HistoryEntry[]; nextBefore: string | null }>(
      `/history${query}`,
    );
  }

  act(request: {
    roundId: string;
    action: { type: string; [key: string]: unknown };
    idempotencyKey: string;
  }) {
    return this.request<RoundResponse>('/act', request);
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

  async getProfile(): Promise<Profile> {
    return { registered: true, username: 'demo', ageVerified: true, dailyStreak: 3, hasPurchased: false };
  }

  async register() {
    return { username: 'demo', balance: this.balance, ageVerified: true };
  }

  async claimDailyBonus() {
    this.balance += 12_000;
    return { granted: true, coins: 12_000, streakDay: 3, balance: this.balance };
  }

  async startCheckout(): Promise<never> {
    // Never fake a payment. A demo that pretends to sell coins is a demo that
    // hides whether the real thing works.
    throw new PlayApiError(
      'The store needs a configured server — set EXPO_PUBLIC_API_URL.',
      'store_unavailable',
    );
  }

  async getPurchase(id: string) {
    return { id, status: 'pending', coins: 0, packId: '' };
  }

  async act(): Promise<RoundResponse> {
    // Multi-step games need a real dealer holding a real shoe. Faking one on
    // the device would mean the client deciding card outcomes, which is exactly
    // what the whole architecture exists to prevent.
    throw new PlayApiError(
      'Blackjack needs a configured server — set EXPO_PUBLIC_API_URL.',
      'server_required',
    );
  }

  async getHistory() {
    const now = Date.now();
    return {
      entries: [
        { id: '3', amount: 12_500, type: 'payout' as const, at: new Date(now - 120_000).toISOString(), meta: { game_id: 'juwa-classic-slots' } },
        { id: '2', amount: -2_000, type: 'bet' as const, at: new Date(now - 121_000).toISOString(), meta: { game_id: 'juwa-classic-slots' } },
        { id: '1', amount: 100_000, type: 'bonus' as const, at: new Date(now - 86_400_000).toISOString(), meta: { kind: 'welcome' } },
      ],
      nextBefore: null,
    };
  }

  async placeBet(request: {
    gameId: string;
    stake: number;
    idempotencyKey: string;
    action?: { type: string; [key: string]: unknown };
  }) {
    if (request.gameId !== 'juwa-classic-slots') {
      // Only the slot stub exists. Faking a roulette wheel on the device would
      // mean the client deciding outcomes, which is the one thing the whole
      // architecture exists to prevent.
      throw new PlayApiError(
        'This game needs a configured server — set EXPO_PUBLIC_API_URL.',
        'server_required',
      );
    }
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
 * Demo mode is no longer a flag anyone has to remember to flip — it is simply
 * what happens when the app has not been told where the server is. Configure
 * EXPO_PUBLIC_API_URL and the real client is used automatically.
 *
 * This matters: a hard-coded boolean is exactly the kind of thing that ships to
 * production still set to `true`.
 */
const API_URL = process.env['EXPO_PUBLIC_API_URL'];

export const USE_DEMO_API = !API_URL;

export function createPlayApi(): PlayApi {
  if (!API_URL) return new DemoPlayApi();
  return new HttpPlayApi(API_URL, getAccessToken);
}
