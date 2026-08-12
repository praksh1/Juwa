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
import { SLOT_GAMES } from './slot-games.generated';
import { ROULETTE_GAME_ID, slotPaytable, type SlotGame, type SlotModelInfo } from './games';
import { demoAct, demoPlaceBet, isInstantGame } from './demo-instant';

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
  /**
   * The winning cells as `[reel, row]`, leftmost first, sent by the server.
   *
   * The app has no payline table and must not grow one: it deliberately does
   * not import `@juwa/engine`, so any local copy would be a second source of
   * truth that drifts from the one the money was paid against.
   *
   * Optional because a round settled by an older server will not carry it. The
   * overlay treats a missing value as "no line to draw" rather than guessing.
   */
  cells?: [number, number][];
}

export interface SpinResult {
  grid: string[][];
  lineWins: LineWin[];
  scatterCount: number;
  scatterMultiplier: number;
  totalMultiplier: number;
  /**
   * Tumbles after the first grid, in order.
   *
   * Each is a grid of its own with its own wins, because that is what the
   * player is shown: the winning symbols vanish, everything above falls into
   * the hole, and the new grid is scored again at a higher rate. A client
   * given only the final state would show a cascade as a single large win and
   * throw away the entire mechanic.
   *
   * Optional so a round settled by an older server still renders — it simply
   * has nothing to tumble.
   */
  cascades?: CascadeStep[];
  /**
   * Reels a wild grew to fill.
   *
   * Sent rather than inferred from a column of identical wilds, because a reel
   * can spin three wilds honestly and animating that as an expansion would show
   * a feature the player did not get.
   */
  expandedReels?: number[];
}

export interface CascadeStep {
  grid: string[][];
  lineWins: LineWin[];
  /** Where on the ladder this drop paid: 2x, 3x, and so on. */
  stepMultiplier: number;
  totalMultiplier: number;
}

/** A cell holding a coin during a hold-and-spin round, and what it is worth. */
export interface HeldCoin {
  reel: number;
  row: number;
  value: number;
}

export interface HoldSpinStep {
  gained: HeldCoin[];
  respinsLeft: number;
}

/**
 * The feature round, already decided.
 *
 * The server plays the round out and sends the whole thing; the client draws
 * it a step at a time. That split is deliberate and is the same one free spins
 * use — a client that decided any part of a bonus would be a client that could
 * be persuaded to decide it differently.
 */
export type FeatureOutcome =
  | {
      kind: 'hold-spin';
      seed: HeldCoin[];
      steps: HoldSpinStep[];
      full: boolean;
      multiplier: number;
    }
  | { kind: 'wheel'; index: number; multiplier: number };

export interface SlotsState {
  baseSpin: SpinResult;
  freeSpins: SpinResult[];
  freeSpinsAwarded: number;
  /** Present only when this game has a feature round and it triggered. */
  feature?: FeatureOutcome;
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
  /**
   * Set only when this account is an agent. Used to decide whether the agent
   * tab exists.
   *
   * Presentation ONLY. Hiding a tab is not access control — every `/agent/*`
   * route resolves the caller's agent record from the verified token before it
   * will do anything, so a player who forges this in their own browser gets a
   * dashboard whose every request comes back 404.
   */
  agent?: AgentSummary | null;
  /**
   * The display name of the agent this player belongs to, if any.
   *
   * Read-only, and there is deliberately no endpoint that lets a player change
   * it — reassignment is an operator action. It is here so a player can answer
   * "who gave me these coins" without opening a support ticket.
   */
  agentName?: string | null;
  /**
   * True while a temporary password set by an agent is still in force.
   *
   * The app blocks everything else until the player replaces it — that flag is
   * the only thing that stops an agent-set password from working for the life
   * of the account, so it is not a nag that can be dismissed.
   */
  mustSetPassword?: boolean;
  /** The responsible-gaming settings actually in force. */
  limits?: PlayerLimits;
}

export interface PlayerLimits {
  /** Coins this player may stake per day, or null for no cap. */
  dailyWagerLimit: number | null;
  /** A loosening waiting out its 24 hours, if any. */
  pendingWagerLimit: number | null;
  pendingAt: string | null;
  sessionReminderMinutes: number | null;
  selfExcludedUntil: string | null;
}

export interface AgentSummary {
  agentId: string;
  displayName: string;
  status: 'pending' | 'active' | 'suspended';
  /** Undistributed coins. Separate from the agent's own playable balance. */
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
  /** Negative when coins left the inventory. */
  amount: number;
  at: string;
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


/* --------------------------------------------------------- casino cash */

/**
 * The second currency.
 *
 * Not a replacement for anything: GC is still what the games are played with,
 * and CC is a conversion balance that buys GC back. Held in its own account so
 * the two can never be added together by accident — see migration 0014.
 */
export interface WalletBalances {
  gc: number;
  cc: number;
}

export type ConversionDirection = 'gc_to_cc' | 'cc_to_gc';
export type ConversionStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';

export interface ConversionRequest {
  id: string;
  playerId: string;
  /** Present when an AGENT is reading the row; null on a player's own list. */
  username: string | null;
  agentId: string;
  direction: ConversionDirection;
  gcAmount: number;
  ccAmount: number;
  /**
   * The rate this request was priced at, copied when it was raised.
   *
   * Never re-read from the rate table, so a settled conversion cannot be
   * re-priced by a later rate change.
   */
  gcPerCc: number;
  status: ConversionStatus;
  requestedAt: string;
  decidedAt: string | null;
  reason: string | null;
}

export interface WalletResponse {
  wallet: WalletBalances;
  /**
   * GC per CC, for THIS player.
   *
   * Only the player-facing rate. The operator rate an agent gets is their own
   * commercial term and is deliberately not sent here.
   */
  rate: number;
  agent: { agentId: string; displayName: string } | null;
  requests: ConversionRequest[];
}

export interface AgentConversions {
  wallet: WalletBalances;
  rates: { playerAgent: number; agentOperator: number };
  requests: ConversionRequest[];
  redemptions: { id: string; ccAmount: number; gcAmount: number; gcPerCc: number; createdAt: string }[];
}

export interface PlayApi {
  getBalance(): Promise<{
    balance: number;
    dailyStreak: number;
    vipLevel: number;
    bonusClaimedToday?: boolean;
  }>;
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
    /**
     * An agent's invitation, if the visitor arrived through one. Sent WITH the
     * registration so the player is bound to their agent in the same request
     * that creates them — see `api/invite`.
     */
    inviteToken?: string;
    country: string;
    /** USPS state code. Required for US players; the server re-checks it. */
    region: string;
  }): Promise<{ username: string; balance: number; ageVerified: boolean }>;
  claimDailyBonus(): Promise<{ granted: boolean; coins: number; streakDay: number; balance: number; reason?: string }>;
  /**
   * The free top-up. No purchase is ever necessary to play, and this is the
   * mechanism that makes that true rather than a sentence in a footer.
   */
  claimTopUp(): Promise<{ granted: boolean; coins: number; balance: number; reason?: string }>;
  startCheckout(packId: string): Promise<{ purchaseId: string; checkoutUrl: string; coins: number }>;
  getHistory(before?: string): Promise<{ entries: HistoryEntry[]; nextBefore: string | null }>;
  /** Continue a multi-step round: hit, stand, double, split. */
  act(request: {
    roundId: string;
    action: { type: string; [key: string]: unknown };
    idempotencyKey: string;
  }): Promise<RoundResponse>;
  getPurchase(id: string): Promise<{ id: string; status: string; coins: number; packId: string }>;

  /* --------------------------------------------------------------- agents */

  /**
   * The agent side of the app, present on every implementation so the screen
   * does not have to know which one it is talking to.
   *
   * All of them are scoped SERVER-SIDE to the calling agent. None takes an
   * agent id — there is no parameter here that could widen what comes back,
   * which is what makes one agent unable to see another's players regardless of
   * what this client does.
   */
  getAgentSummary(): Promise<AgentSummary>;
  getAgentPlayers(): Promise<{ players: AgentPlayer[] }>;
  allocateToPlayer(request: {
    playerId: string;
    amount: number;
    idempotencyKey: string;
  }): Promise<{ txnId: string; inventory: number; playerBalance: number }>;
  getAgentTransactions(): Promise<{ transactions: AgentTxn[] }>;
  getAgentInvites(): Promise<{ invites: AgentInvite[] }>;
  createAgentInvite(label?: string): Promise<{ token: string; id: string; expiresAt: string }>;
  /**
   * Create a player account on their behalf.
   *
   * The agent chooses the username and a temporary password and hands both over
   * in person. The account comes back flagged `mustSetPassword`.
   */
  createAgentPlayer(details: {
    username: string;
    password: string;
    dateOfBirth: string;
    country: string;
    region: string;
  }): Promise<{
    playerId: string;
    username: string;
    balance: number;
    signInWith: string;
    mustSetPassword: boolean;
  }>;
  /**
   * Reset one of the agent's own players to a new temporary password.
   *
   * These accounts have no real email address, by design, so there is no reset
   * link to send and never can be — recovery has to be the agent doing it in
   * person. The account is flagged again, so the temporary password the agent
   * chooses is replaced at the player's next sign-in.
   */
  resetPlayerPassword(request: {
    playerId: string;
    password: string;
  }): Promise<{ ok: boolean; mustSetPassword: boolean }>;
  /** Ask to become an agent. Creates a pending application, which grants nothing. */
  applyToBeAgent(displayName: string, notes?: string): Promise<{ status: string }>;
  /** Record that the player has replaced their temporary password. */
  confirmPasswordSet(): Promise<{ ok: boolean }>;

  /* --------------------------------------------------------- casino cash */

  /**
   * Both balances, the player's rate and their conversion requests.
   *
   * One call rather than three, because the wallet screen shows all of it at
   * once and three round trips means three chances for the numbers on screen to
   * disagree with each other for a second.
   */
  getWallet(): Promise<WalletResponse>;
  /**
   * Ask to convert. MOVES NOTHING — it creates a request an agent has to
   * approve, and the balances are unchanged until they do.
   *
   * `amount` is GC for `gc_to_cc` and CC for `cc_to_gc`: the side the player
   * names is exact and the other is derived, so they are never surprised by
   * rounding.
   */
  requestConversion(request: {
    direction: ConversionDirection;
    amount: number;
  }): Promise<{ request: ConversionRequest }>;
  cancelConversion(requestId: string): Promise<{ ok: boolean }>;

  /** The agent side: the queue addressed to them, their balances, both rates. */
  getAgentConversions(status?: 'pending' | 'approved' | 'rejected' | 'all'): Promise<AgentConversions>;
  approveConversion(requestId: string): Promise<{ player: WalletBalances }>;
  rejectConversion(requestId: string, reason?: string): Promise<{ ok: boolean }>;
  /** Spend CC with the operator on GC inventory. */
  redeemAgentCc(request: {
    ccAmount: number;
    idempotencyKey: string;
  }): Promise<{ gcAmount: number; gcPerCc: number; wallet: WalletBalances }>;

  /* ------------------------------------------------- responsible gaming */

  /**
   * Change the player's own limits.
   *
   * Send only what is changing. `dailyWagerLimit: null` clears the cap;
   * omitting it leaves it alone. Tightening applies at once, loosening waits
   * 24 hours, and a break only ever extends — all decided by the server.
   */
  setLimits(changes: {
    dailyWagerLimit?: number | null;
    sessionReminderMinutes?: number | null;
    breakDays?: number;
  }): Promise<PlayerLimits>;
  /**
   * A fresh seed pair, for provable fairness.
   *
   * `revealed` is the OLD server seed, now safe to publish because no future
   * round can use it — that is what makes past rounds checkable. `next` carries
   * the hash of the new one, committing us to it before anything is played.
   */
  rotateSeed(clientSeed?: string): Promise<{
    revealed: { serverSeed: string; serverSeedHash: string; clientSeed: string } | null;
    next: { serverSeedHash: string };
  }>;
}

/** Demo mode plays any slot; the ids come from the same generated list the lobby uses. */
function isSlotGame(gameId: string): boolean {
  return SLOT_GAMES.some((game) => game.id === gameId);
}

/**
 * The demo's roulette table.
 *
 * Roulette used to be refused in demo mode outright — "not available, sign
 * in" — which meant that on the only build most of this app is ever looked at
 * in, the wheel could not turn at all. That is how a game shipped with a
 * spinner that was a `setInterval` flicking random numbers into a disc: nobody
 * could see it not working, because nobody could reach it.
 *
 * The same warning applies as to the slots demo: this is Math.random() on the
 * device with no ledger and no fairness proof. It exists so the wheel, the
 * felt and the settlement can be exercised without a server.
 */
const ROULETTE_RED = new Set([
  1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36,
]);
/** Quoted as "X to 1"; the stake comes back on top. Mirrors the engine. */
const ROULETTE_ODDS: Record<string, number> = {
  straight: 35, split: 17, street: 11, corner: 8, line: 5,
  dozen: 2, column: 2, red: 1, black: 1, odd: 1, even: 1, low: 1, high: 1,
};

interface DemoBet {
  type: string;
  selection: number[];
  amount: number;
}

/** Whether a bet covers a pocket. Mirrors `covers` in the engine exactly. */
function demoCovers(bet: DemoBet, n: number): boolean {
  switch (bet.type) {
    case 'red': return n !== 0 && ROULETTE_RED.has(n);
    case 'black': return n !== 0 && !ROULETTE_RED.has(n);
    case 'odd': return n !== 0 && n % 2 === 1;
    case 'even': return n !== 0 && n % 2 === 0;
    case 'low': return n >= 1 && n <= 18;
    case 'high': return n >= 19 && n <= 36;
    case 'dozen': {
      const d = bet.selection[0] ?? 0;
      return n >= d * 12 + 1 && n <= d * 12 + 12;
    }
    case 'column': {
      const c = bet.selection[0] ?? 0;
      return n !== 0 && (n - 1) % 3 === c;
    }
    default:
      return bet.selection.includes(n);
  }
}

/**
 * The grid shape the real server would deal for this game.
 *
 * `rows` is per reel, so a ragged game deals a ragged grid. Falling back to a
 * flat 5x3 for an unknown id is deliberate — the demo should still render
 * something rather than deal a grid with no cells in it.
 */
function slotShape(gameId: string): {
  reels: number;
  rows: number[];
  ways: boolean;
  cascades: boolean;
  feature?: SlotGame['feature'];
} {
  const game = SLOT_GAMES.find((g) => g.id === gameId);
  if (!game) return { reels: 5, rows: [3, 3, 3, 3, 3], ways: false, cascades: false };
  return {
    reels: game.reels,
    rows: [...game.rows],
    ways: game.pays === 'ways',
    cascades: game.cascades === true,
    ...(game.feature ? { feature: game.feature } : {}),
  };
}

/**
 * A feature round, faked for the demo.
 *
 * Worth building properly rather than skipping, for the same reason the
 * cascades are: the demo build is the only one most of this work is ever looked
 * at in, and a bonus that cannot be reached there is a bonus nobody sees. The
 * frequencies are deliberately far higher than the real ones — the point is to
 * exercise the path, not to model the game, and the honest figures are on the
 * paytable.
 */
function demoFeature(
  kind: NonNullable<SlotGame['feature']>,
  rows: number[],
): FeatureOutcome | undefined {
  if (kind === 'wheel') {
    const segments = [2, 5, 10, 3, 20, 5, 50, 3];
    const index = Math.floor(Math.random() * segments.length);
    return { kind: 'wheel', index, multiplier: segments[index] ?? 2 };
  }
  if (kind !== 'hold-spin') return undefined;

  const values = [1, 2, 3, 5, 10, 25];
  const draw = () => values[Math.min(values.length - 1, Math.floor(-Math.log(Math.random()) * 1.6))] ?? 1;
  const cells: [number, number][] = [];
  rows.forEach((height, reel) => {
    for (let row = 0; row < height; row++) cells.push([reel, row]);
  });

  const held = new Map<string, HeldCoin>();
  const seed: HeldCoin[] = [];
  // Three to start, scattered, as a real trigger would leave them.
  for (const [reel, row] of [...cells].sort(() => Math.random() - 0.5).slice(0, 3)) {
    const coin = { reel, row, value: draw() };
    held.set(`${reel},${row}`, coin);
    seed.push(coin);
  }

  const steps: HoldSpinStep[] = [];
  let respins = 3;
  while (respins > 0 && held.size < cells.length && steps.length < 24) {
    const gained: HeldCoin[] = [];
    for (const [reel, row] of cells) {
      if (held.has(`${reel},${row}`)) continue;
      if (Math.random() >= 0.09) continue;
      const coin = { reel, row, value: draw() };
      held.set(`${reel},${row}`, coin);
      gained.push(coin);
    }
    respins = gained.length > 0 ? 3 : respins - 1;
    steps.push({ gained, respinsLeft: respins });
  }

  const full = held.size >= cells.length;
  let multiplier = 0;
  for (const coin of held.values()) multiplier += coin.value;
  if (full) multiplier += 200;
  return { kind: 'hold-spin', seed, steps, full, multiplier };
}

export class PlayApiError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
    this.name = 'PlayApiError';
  }
}

/**
 * Long enough for a sleeping free-tier container to boot, short enough that a
 * genuinely dead connection still ends in a message rather than a spinner that
 * never resolves.
 */
const COLD_START_TIMEOUT_MS = 90_000;

/**
 * Turn a fetch rejection into something a player can read.
 *
 * Deliberately says nothing about the URL. Twice before, the configured API
 * address ended up rendered on screen inside an error string — the internal
 * layout of the deployment is not a player's problem, and it is not something
 * to hand to whoever is looking for the way in.
 */
function asNetworkError(error: unknown): PlayApiError {
  const timedOut = error instanceof DOMException && error.name === 'TimeoutError';
  return new PlayApiError(
    timedOut
      ? 'The server is taking too long to answer. It may be starting up — try again in a moment.'
      : 'Cannot reach the server. Check your connection and try again.',
    timedOut ? 'timeout' : 'network',
  );
}

// ------------------------------------------------------------------- http

/**
 * Strip anything that would corrupt the path when a route is appended.
 *
 * Every route below starts with `/`, so a base URL ending in one produces
 * `https://host//balance` — which most servers 404. Copying a URL out of a
 * dashboard is how it gets a trailing slash, and the result is an app that is
 * configured correctly, looks correctly configured, and cannot reach anything.
 * Surrounding whitespace goes too; a copy-paste on a phone picks it up
 * constantly and it survives into the deployed bundle invisibly.
 */
export function normaliseBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

export class HttpPlayApi implements PlayApi {
  private readonly baseUrl: string;

  constructor(
    baseUrl: string,
    private readonly getToken: () => Promise<string | null>,
  ) {
    this.baseUrl = normaliseBaseUrl(baseUrl);
  }

  private async request<T>(path: string, body?: unknown): Promise<T> {
    // Fetched per request rather than cached: Supabase rotates the access token
    // roughly hourly, and a stale one becomes a mystery 401 mid-session.
    const token = await this.getToken();

    const send = () =>
      fetch(`${this.baseUrl}${path}`, {
        method: body ? 'POST' : 'GET',
        headers: {
          'Content-Type': 'application/json',
          // The player's timezone, so the daily bonus turns over at their
          // midnight rather than the server's.
          'X-UTC-Offset': String(-new Date().getTimezoneOffset()),
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        // Without this a request can hang for minutes on a dead connection —
        // the spin button stays disabled and the only fix a player finds is
        // reloading, which loses the round they are watching.
        signal: AbortSignal.timeout(COLD_START_TIMEOUT_MS),
      });

    let response: Response;
    try {
      response = await send();
    } catch (error) {
      // A free-tier host sleeps when idle and takes most of a minute to come
      // back, so the first request after a quiet spell fails outright. Retrying
      // reads costs one round trip and turns that into a slow load instead of
      // an error screen.
      //
      // Reads only. A write that failed at the network layer may still have
      // reached the server, and replaying a bet nobody could confirm is how a
      // player gets charged twice for one spin.
      if (body !== undefined) throw asNetworkError(error);
      try {
        response = await send();
      } catch (retryError) {
        throw asNetworkError(retryError);
      }
    }

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
    return this.request<{
      balance: number;
      dailyStreak: number;
      vipLevel: number;
      bonusClaimedToday?: boolean;
    }>('/balance');
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

  register(details: {
    username: string;
    dateOfBirth: string;
    country: string;
    region: string;
    inviteToken?: string;
  }) {
    return this.request<{
      username: string;
      balance: number;
      ageVerified: boolean;
      agentName?: string | null;
    }>('/register', details);
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

  claimTopUp() {
    return this.request<{ granted: boolean; coins: number; balance: number; reason?: string }>(
      '/bonus/topup',
      {},
    );
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

  /* --------------------------------------------------------------- agents */

  getAgentSummary() {
    return this.request<AgentSummary>('/agent/summary');
  }

  getAgentPlayers() {
    return this.request<{ players: AgentPlayer[] }>('/agent/players');
  }

  allocateToPlayer(request: { playerId: string; amount: number; idempotencyKey: string }) {
    return this.request<{ txnId: string; inventory: number; playerBalance: number }>(
      '/agent/allocate',
      request,
    );
  }

  getAgentTransactions() {
    return this.request<{ transactions: AgentTxn[] }>('/agent/transactions');
  }

  getAgentInvites() {
    return this.request<{ invites: AgentInvite[] }>('/agent/invites');
  }

  createAgentInvite(label?: string) {
    return this.request<{ token: string; id: string; expiresAt: string }>('/agent/invites', {
      ...(label ? { label } : {}),
    });
  }

  createAgentPlayer(details: {
    username: string;
    password: string;
    dateOfBirth: string;
    country: string;
    region: string;
  }) {
    return this.request<{
      playerId: string;
      username: string;
      balance: number;
      signInWith: string;
      mustSetPassword: boolean;
    }>('/agent/players', details);
  }

  /**
   * Give a player who has forgotten their password a new temporary one.
   *
   * The password goes up, nothing comes back but an acknowledgement — the agent
   * already has it on their own screen, and echoing it would put it in a
   * response body for no gain. The account is flagged to demand a replacement
   * at the player's next sign-in.
   */
  resetPlayerPassword(request: { playerId: string; password: string }) {
    return this.request<{ ok: boolean; mustSetPassword: boolean }>(
      '/agent/players/reset-password',
      request,
    );
  }

  /* --------------------------------------------------------- casino cash */

  getWallet() {
    return this.request<WalletResponse>('/wallet');
  }

  requestConversion(request: { direction: ConversionDirection; amount: number }) {
    return this.request<{ request: ConversionRequest }>('/wallet/convert', request);
  }

  cancelConversion(requestId: string) {
    return this.request<{ ok: boolean }>('/wallet/convert/cancel', { requestId });
  }

  getAgentConversions(status: 'pending' | 'approved' | 'rejected' | 'all' = 'pending') {
    return this.request<AgentConversions>(`/agent/conversions?status=${status}`);
  }

  approveConversion(requestId: string) {
    return this.request<{ player: WalletBalances }>('/agent/conversions/approve', { requestId });
  }

  rejectConversion(requestId: string, reason?: string) {
    return this.request<{ ok: boolean }>('/agent/conversions/reject', {
      requestId,
      ...(reason ? { reason } : {}),
    });
  }

  redeemAgentCc(request: { ccAmount: number; idempotencyKey: string }) {
    return this.request<{ gcAmount: number; gcPerCc: number; wallet: WalletBalances }>(
      '/agent/conversions/redeem',
      request,
    );
  }

  applyToBeAgent(displayName: string, notes?: string) {
    return this.request<{ status: string }>('/agent/apply', {
      displayName,
      ...(notes ? { notes } : {}),
    });
  }

  confirmPasswordSet() {
    return this.request<{ ok: boolean }>('/agent/password-set', {});
  }

  setLimits(changes: {
    dailyWagerLimit?: number | null;
    sessionReminderMinutes?: number | null;
    breakDays?: number;
  }) {
    return this.request<PlayerLimits>('/me/limits', changes);
  }

  rotateSeed(clientSeed?: string) {
    return this.request<{
      revealed: { serverSeed: string; serverSeedHash: string; clientSeed: string } | null;
      next: { serverSeedHash: string };
    }>('/seed/rotate', { ...(clientSeed ? { clientSeed } : {}) });
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
/**
 * Payline shapes for the offline demo only.
 *
 * Straight rows plus the two classic V and inverted-V shapes, which is enough
 * to exercise a bent line without pretending to be the real table. The real
 * shapes live in the engine and reach the client as `cells` on each win.
 */
function demoPaylines(reels: number, rows: number): number[][] {
  const lines: number[][] = [];
  for (let row = 0; row < rows; row++) lines.push(Array.from({ length: reels }, () => row));
  if (rows >= 3 && reels >= 3) {
    // A V and its mirror, stretched to whatever grid this game has: top row at
    // the outer reels, bottom row in the middle.
    const half = (reels - 1) / 2;
    const v = Array.from({ length: reels }, (_, reel) => {
      const fromCentre = Math.abs(reel - half) / half; // 1 at the edges, 0 in the middle
      return Math.round((1 - fromCentre) * (rows - 1));
    });
    lines.push(v);
    lines.push(v.map((row) => rows - 1 - row));
  }
  return lines;
}

/**
 * A crude payout for the demo, purely so win presentation has something to
 * render.
 *
 * The line shapes are INVENTED FOR THE DEMO. They are not the engine's
 * paylines and are not meant to match them — the whole spin is fabricated
 * here, so there is nothing to be consistent with. What matters is that they
 * include zig-zags: a stub that only ever produced straight rows would let the
 * win-line overlay look finished while every bent line it will meet in
 * production went untested.
 *
 * The per-symbol RATE, on the other hand, is the real one. The app carries the
 * paytable for the rules screen, and paying an invented figure would put the
 * demo in visible contradiction with the paytable printed two taps away. A
 * player cannot tell "the demo's odds are fake" from "the paytable is wrong",
 * and only one of those is true.
 */
function demoLineWins(
  grid: string[][],
  reels: number,
  rows: number,
  paytable: SlotModelInfo | undefined,
): { lineWins: LineWin[]; baseMultiplier: number } {
  const demoLines = demoPaylines(reels, rows);
  const lineWins: LineWin[] = [];
  for (const [lineIndex, line] of demoLines.entries()) {
    const symbols = line.map((row, reel) => grid[reel]![row]!);
    const first = symbols[0]!;
    let count = 1;
    while (count < reels && (symbols[count] === first || symbols[count] === 'WILD')) count++;
    if (count < 3) continue;

    const cells: [number, number][] = [];
    for (let reel = 0; reel < count; reel++) cells.push([reel, line[reel]!]);
    const pays = paytable?.symbols.find((sym) => sym.id === first)?.pays;
    const multiplier = pays?.[String(Math.min(count, 5)) as '3' | '4' | '5'] ?? count * 4;
    lineWins.push({ line: lineIndex, symbol: first, count, multiplier, cells });
  }
  // Divided by the game's own payline count, exactly as the engine does —
  // line wins are quoted per line.
  const lineCount = paytable?.lines ?? demoLines.length;
  return {
    lineWins,
    baseMultiplier: lineWins.reduce((sum, w) => sum + w.multiplier, 0) / lineCount,
  };
}

/**
 * The same, for a ways game.
 *
 * Worth having rather than falling back to lines, because the two are visibly
 * different on screen: a ways win lights several cells per reel at once, and a
 * demo that only ever drew single-cell lines would leave that entirely
 * unexercised on the three games that use it.
 *
 * NOT divided by anything. A ways paytable is quoted against the whole stake,
 * which is the same rule the engine follows and the one place this stub has to
 * agree with it or the demo balance moves at a completely different rate from
 * the real one.
 */
function demoWaysWins(
  grid: string[][],
  paytable: SlotModelInfo | undefined,
): { lineWins: LineWin[]; baseMultiplier: number } {
  const lineWins: LineWin[] = [];
  for (const [index, spec] of (paytable?.symbols ?? []).entries()) {
    if (spec.kind !== 'normal') continue;

    const hits: [number, number][][] = [];
    for (const [reel, column] of grid.entries()) {
      const onReel: [number, number][] = [];
      for (const [row, symbol] of column.entries()) {
        if (symbol === spec.id || symbol === 'WILD') onReel.push([reel, row]);
      }
      if (onReel.length === 0) break;
      hits.push(onReel);
    }
    if (hits.length < 3) continue;

    const rate = spec.pays[String(Math.min(hits.length, 5)) as '3' | '4' | '5'] ?? 0;
    if (rate <= 0) continue;
    const waysCount = hits.reduce((product, onReel) => product * onReel.length, 1);
    lineWins.push({
      line: index,
      symbol: spec.id,
      count: hits.length,
      multiplier: rate * waysCount,
      cells: hits.flat(),
    });
  }
  return {
    lineWins,
    baseMultiplier: lineWins.reduce((sum, w) => sum + w.multiplier, 0),
  };
}

export class DemoPlayApi implements PlayApi {
  private balance: number;

  constructor(startingBalance = 100_000) {
    this.balance = startingBalance;
  }

  async getBalance() {
    return { balance: this.balance, dailyStreak: 3, vipLevel: 2, bonusClaimedToday: false };
  }

  async getProfile(): Promise<Profile> {
    return {
      registered: true,
      username: 'demo',
      ageVerified: true,
      dailyStreak: 3,
      hasPurchased: false,
      /**
       * The demo is NOT an agent, and this is the correct answer rather than a
       * missing feature.
       *
       * The demo build is what anyone sees without signing in. An agent
       * dashboard there would be a coin-distribution screen offered to the
       * public — every button on it would fail against the real API, but it
       * would still be advertising a capability to people who do not have it.
       * The agent screens are reachable only with a session that resolves to a
       * real agent record.
       */
      agent: null,
      agentName: null,
      mustSetPassword: false,
      limits: { ...this.limits },
    };
  }

  async register() {
    return { username: 'demo', balance: this.balance, ageVerified: true };
  }

  async claimDailyBonus() {
    this.balance += 12_000;
    return { granted: true, coins: 12_000, streakDay: 3, balance: this.balance };
  }

  async claimTopUp() {
    // The stub mirrors the server's rules rather than always saying yes, so the
    // "why can't I claim?" path is visible during UI work instead of only in
    // production.
    if (this.balance >= 2_000) {
      return {
        granted: false,
        coins: 0,
        balance: this.balance,
        reason: 'Top-ups are for when you are running low.',
      };
    }
    this.balance += 2_500;
    return { granted: true, coins: 2_500, balance: this.balance };
  }

  async startCheckout(): Promise<never> {
    // Never fake a payment. A demo that pretends to sell coins is a demo that
    // hides whether the real thing works.
    throw new PlayApiError(
      'The store is not available in demo mode.',
      'store_unavailable',
    );
  }

  async getPurchase(id: string) {
    return { id, status: 'pending', coins: 0, packId: '' };
  }

  async act(request: {
    roundId: string;
    action: { type: string; [key: string]: unknown };
    idempotencyKey: string;
  }): Promise<RoundResponse> {
    await new Promise((resolve) => setTimeout(resolve, 140));
    // Mines is the one multi-step game the demo can carry. Its hidden state is
    // a tile layout, which the stub simply keeps to itself — the same trick as
    // the fake slot grids. Blackjack is not: a shoe has to be dealt from and
    // counted, and a client holding one is a client that can read it.
    let round;
    try {
      round = demoAct(request.roundId, request.action);
    } catch {
      throw new PlayApiError(
        'This game is not available in demo mode. Sign in to play it.',
        'server_required',
      );
    }
    if (round.status === 'settled') this.balance += round.payout;
    return {
      roundId: request.roundId,
      gameId: 'juwa-mines',
      status: round.status,
      state: round.state,
      availableActions: round.availableActions,
      ...(round.status === 'settled'
        ? { settlement: { stake: 0, payout: round.payout, multiplier: round.multiplier } }
        : {}),
      balance: this.balance,
      fairness: { serverSeedHash: 'demo', clientSeed: 'demo', nonce: 0 },
    };
  }

  /** See the note by ROULETTE_ODDS. Math.random() on the device, no ledger. */
  private demoRoulette(request: {
    gameId: string;
    stake: number;
    action?: { type: string; [key: string]: unknown };
  }): RoundResponse {
    const bets = ((request.action?.['bets'] as DemoBet[] | undefined) ?? []).filter(
      (bet) => bet && Array.isArray(bet.selection) && typeof bet.amount === 'number',
    );
    const winningNumber = Math.floor(Math.random() * 37);

    const winningBets: number[] = [];
    let payout = 0;
    for (const [i, bet] of bets.entries()) {
      if (!demoCovers(bet, winningNumber)) continue;
      winningBets.push(i);
      payout += Math.floor(bet.amount * ((ROULETTE_ODDS[bet.type] ?? 0) + 1));
    }

    this.balance = this.balance - request.stake + payout;
    return {
      roundId: `demo-${Date.now()}`,
      gameId: request.gameId,
      status: 'settled' as const,
      state: {
        winningNumber,
        color: winningNumber === 0 ? 'green' : ROULETTE_RED.has(winningNumber) ? 'red' : 'black',
        bets,
        winningBets,
      },
      availableActions: [],
      settlement: {
        stake: request.stake,
        payout,
        multiplier: request.stake === 0 ? 0 : payout / request.stake,
      },
      balance: this.balance,
      fairness: { serverSeedHash: 'demo-mode-no-fairness-proof', clientSeed: 'demo', nonce: 0 },
    };
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
    // Every slot in the catalogue runs on the stub: they share one engine on
    // the server, so a demo that only knew the flagship left twenty-two games
    // in the lobby that could be opened and not played.
    //
    if (request.gameId === ROULETTE_GAME_ID) return this.demoRoulette(request);

    // Other table games still need the server. Faking a card game on the device
    // would mean the client deciding outcomes, which is the one thing the whole
    // architecture exists to prevent.
    if (!isSlotGame(request.gameId) && !isInstantGame(request.gameId)) {
      throw new PlayApiError(
        'This game is not available in demo mode. Sign in to play it.',
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

    if (isInstantGame(request.gameId)) {
      const roundId = `demo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const round = demoPlaceBet(request.gameId, request.stake, roundId, request.action);
      this.balance = this.balance - request.stake + round.payout;
      return {
        roundId,
        gameId: request.gameId,
        status: round.status,
        state: round.state,
        availableActions: round.availableActions,
        ...(round.status === 'settled'
          ? { settlement: { stake: request.stake, payout: round.payout, multiplier: round.multiplier } }
          : {}),
        balance: this.balance,
        fairness: { serverSeedHash: 'demo', clientSeed: 'demo', nonce: 0 },
      };
    }

    // Deal the shape the real server would for this game. The catalogue holds
    // three-reel classics and 3-4-5-4-3 diamonds as well as 5x3s, and a stub
    // that always dealt a flat rectangle would render columns and rows the
    // game does not have.
    const { reels, rows, ways, cascades: tumbles, feature: featureKind } = slotShape(request.gameId);
    const grid: string[][] = rows.map((height) =>
      Array.from({ length: height }, () => weightedSymbol()),
    );

    const paytable = slotPaytable(request.gameId);
    const score = (g: string[][]) =>
      ways ? demoWaysWins(g, paytable) : demoLineWins(g, reels, rows[0] ?? 3, paytable);
    const { lineWins, baseMultiplier } = score(grid);

    /*
     * Tumbles, for the models that have them.
     *
     * Worth faking properly rather than skipping. Three of the catalogue's
     * games cascade, and a demo that settled them as a single grid would leave
     * the entire playback path — the hold, the drop, the climbing ladder,
     * the running total — unexercised on the only build most of this work is
     * ever looked at in.
     */
    const cascades: CascadeStep[] = [];
    if (tumbles) {
      const ladder = paytable?.cascade?.ladder ?? [2, 3, 5];
      const maxDrops = paytable?.cascade?.maxDrops ?? 4;
      let current = grid.map((reel) => [...reel]);
      let previous = lineWins;
      for (let drop = 0; drop < maxDrops && previous.length > 0; drop++) {
        const cleared = new Set(
          previous.flatMap((w) => (w.cells ?? []).map(([r, row]) => `${r},${row}`)),
        );
        current = current.map((reel, r) => {
          const survivors = reel.filter((_, row) => !cleared.has(`${r},${row}`));
          const fresh = Array.from({ length: reel.length - survivors.length }, () =>
            weightedSymbol(),
          );
          return [...fresh, ...survivors];
        });
        const step = ladder[Math.min(drop, ladder.length - 1)] ?? 1;
        const scored = score(current);
        previous = scored.lineWins;
        if (previous.length === 0) break;
        cascades.push({
          grid: current.map((reel) => [...reel]),
          lineWins: scored.lineWins,
          stepMultiplier: step,
          totalMultiplier: scored.baseMultiplier * step,
        });
      }
    }
    const cascadeTotal = cascades.reduce((sum, step) => sum + step.totalMultiplier, 0);

    /**
     * The bonus round, occasionally.
     *
     * The stub used to hard-code `freeSpinsAwarded: 0`, which made the entire
     * free-spins sequence unreachable without a server — so the most elaborate
     * part of the presentation could never be seen, demonstrated or checked.
     * One spin in twelve is far more often than the real 1-in-117, because the
     * point of the demo is to exercise the path rather than to model the game.
     */
    const scatterCount = Math.random() < 1 / 12 ? 3 : 0;
    /*
     * A feature round REPLACES free spins, exactly as the engine's
     * `resolveRound` does. Two bonuses from one trigger would be a demo that
     * teaches the presentation a shape the real server never sends.
     */
    const roundFeature =
      scatterCount >= 3 && featureKind && featureKind !== 'expanding-wild'
        ? demoFeature(featureKind, rows)
        : undefined;
    const freeSpinsAwarded = scatterCount >= 3 && !roundFeature ? 8 : 0;
    const freeSpins = Array.from({ length: freeSpinsAwarded }, () => {
      const fsGrid: string[][] = rows.map((height) =>
        Array.from({ length: height }, () => weightedSymbol()),
      );
      const multiplier = (Math.random() < 0.45 ? Math.random() * 6 : 0);
      return {
        grid: fsGrid,
        lineWins: [] as LineWin[],
        scatterCount: 0,
        scatterMultiplier: 0,
        totalMultiplier: multiplier,
      };
    });

    // The cascades are part of what this spin paid, not an extra on top of a
    // settled figure. `baseSpin.totalMultiplier` below carries them for the
    // same reason the engine's does: the screen subtracts the drops back out
    // to find what the first grid alone was worth, and pays them in as each
    // one lands.
    const totalMultiplier =
      baseMultiplier +
      cascadeTotal +
      (roundFeature?.multiplier ?? 0) +
      freeSpins.reduce((sum, spin) => sum + spin.totalMultiplier, 0);
    const payout = Math.floor(request.stake * totalMultiplier);

    this.balance = this.balance - request.stake + payout;

    const state: SlotsState = {
      baseSpin: {
        grid,
        lineWins,
        scatterCount,
        scatterMultiplier: 0,
        totalMultiplier: baseMultiplier + cascadeTotal,
        cascades,
      },
      freeSpins,
      freeSpinsAwarded,
      ...(roundFeature ? { feature: roundFeature } : {}),
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

  /* --------------------------------------------------------------- agents */

  /**
   * Every agent method refuses, and that is the feature.
   *
   * The demo simulates PLAY because play is the thing this app is for and a
   * lobby you cannot touch demonstrates nothing. Distributing coins is not
   * that: a simulated allocation would show a coin count going up on a screen
   * where no coins moved, which is worse than an error in the one area of the
   * product where the numbers have to be real. `getProfile` already returns
   * `agent: null`, so nothing in the app reaches these — they exist so that if
   * anything ever does, it says so out loud.
   */
  private noAgentInDemo(): never {
    throw new PlayApiError(
      'Agent tools need a signed-in agent account. Sign in to use them.',
      'server_required',
    );
  }

  async getAgentSummary(): Promise<never> {
    this.noAgentInDemo();
  }
  async getAgentPlayers(): Promise<never> {
    this.noAgentInDemo();
  }
  async allocateToPlayer(): Promise<never> {
    this.noAgentInDemo();
  }
  async getAgentTransactions(): Promise<never> {
    this.noAgentInDemo();
  }
  async getAgentInvites(): Promise<never> {
    this.noAgentInDemo();
  }
  async createAgentInvite(): Promise<never> {
    this.noAgentInDemo();
  }
  async createAgentPlayer(): Promise<never> {
    this.noAgentInDemo();
  }
  async resetPlayerPassword(): Promise<never> {
    this.noAgentInDemo();
  }

  /* --------------------------------------------------------- casino cash */

  /**
   * The wallet still LOADS in demo mode, and shows an empty CC balance.
   *
   * Deliberately not `noAgentInDemo()`. The wallet screen is the one place a
   * player sees both balances, and a screen that throws in the demo build is a
   * screen nobody looks at during development — which is how it ships with the
   * layout wrong. A demo player has no agent, so `agent: null` puts the screen
   * into exactly the state a real unaffiliated player would see, which is the
   * state most likely to be got wrong.
   *
   * Everything that MOVES coins still refuses, below.
   */
  async getWallet(): Promise<WalletResponse> {
    return {
      wallet: { gc: this.balance, cc: 0 },
      rate: 0,
      agent: null,
      requests: [],
    };
  }

  async requestConversion(): Promise<never> {
    this.noAgentInDemo();
  }
  async cancelConversion(): Promise<never> {
    this.noAgentInDemo();
  }
  async getAgentConversions(): Promise<never> {
    this.noAgentInDemo();
  }
  async approveConversion(): Promise<never> {
    this.noAgentInDemo();
  }
  async rejectConversion(): Promise<never> {
    this.noAgentInDemo();
  }
  async redeemAgentCc(): Promise<never> {
    this.noAgentInDemo();
  }
  async applyToBeAgent(): Promise<never> {
    this.noAgentInDemo();
  }
  async confirmPasswordSet(): Promise<never> {
    this.noAgentInDemo();
  }

  /** The demo keeps limits in memory, so the screen can be worked on offline. */
  private limits: PlayerLimits = {
    dailyWagerLimit: null,
    pendingWagerLimit: null,
    pendingAt: null,
    sessionReminderMinutes: null,
    selfExcludedUntil: null,
  };

  async setLimits(changes: {
    dailyWagerLimit?: number | null;
    sessionReminderMinutes?: number | null;
    breakDays?: number;
  }) {
    if (changes.dailyWagerLimit !== undefined) {
      this.limits.dailyWagerLimit = changes.dailyWagerLimit;
    }
    if (changes.sessionReminderMinutes !== undefined) {
      this.limits.sessionReminderMinutes = changes.sessionReminderMinutes || null;
    }
    if (changes.breakDays !== undefined) {
      this.limits.selfExcludedUntil = new Date(
        Date.now() + changes.breakDays * 86_400_000,
      ).toISOString();
    }
    return { ...this.limits };
  }

  async rotateSeed(clientSeed?: string) {
    return {
      revealed: {
        serverSeed: 'demo-mode-no-fairness-proof',
        serverSeedHash: 'demo-mode-no-fairness-proof',
        clientSeed: clientSeed ?? Math.random().toString(36).slice(2, 14),
      },
      next: { serverSeedHash: 'demo-mode-no-fairness-proof' },
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
// Normalised BEFORE the emptiness test, not after. A variable set to a single
// space is truthy, so the raw check would pick the real client and hand it an
// empty base URL — demo mode refused for a value that points nowhere.
const API_URL = normaliseBaseUrl(process.env['EXPO_PUBLIC_API_URL'] ?? '');

export const USE_DEMO_API = !API_URL;

/**
 * Where the API lives, for the one call that has no session to make it with:
 * looking up who an invitation belongs to before the visitor has an account.
 * Empty string in demo mode, and `lookupInvite` treats that as "cannot ask".
 */
export const API_BASE_URL = API_URL;

export function createPlayApi(): PlayApi {
  if (!API_URL) return new DemoPlayApi();
  return new HttpPlayApi(API_URL, getAccessToken);
}
