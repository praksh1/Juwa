/**
 * The game contract.
 *
 * This one interface is what makes "add as many games as possible" achievable.
 * Adding a game means writing a file that satisfies `GameEngine` and
 * registering it. Nothing in the wallet, the ledger, the API layer, or the
 * mobile app changes — they all speak `GameEngine`, not "slots" or "blackjack".
 *
 * Two properties are non-negotiable for every engine:
 *
 *  1. PURE. An engine may not read the clock, call Math.random(), touch the
 *     network, or hold module-level mutable state. All randomness arrives via
 *     the injected RngStream. This is what makes outcomes reproducible — we can
 *     replay any historical bet from its seeds and prove what happened.
 *
 *  2. RANDOMNESS IS DRAWN UP FRONT. A multi-step engine must materialise
 *     everything random it will ever need during `init`, into `private` state.
 *     Blackjack shuffles the whole 312-card shoe immediately and `hit` merely
 *     pops from it.
 *
 *     This is not stylistic. Between two HTTP requests the round is a row in a
 *     database; when `act` runs, the server rebuilds the RNG stream from the
 *     same (seed, nonce) and therefore replays the SAME sequence `init` already
 *     consumed. An engine that drew fresh values inside `act` would silently
 *     deal the same cards again.
 *
 *  3. SERVER-SIDE ONLY. Engines run on the server. The client is a renderer: it
 *     receives an outcome and animates it. A client that computes its own
 *     results is a client a player can patch to always win. The mobile app
 *     imports the *types* from this package, never the resolution logic.
 */

import type { Minor } from '@juwa/money';
import type { RngStream } from '../rng.js';

export type GameId = string;

export type GameCategory = 'slots' | 'table' | 'live' | 'instant' | 'poker';

/**
 * Multi-step games (blackjack) move through states. Instant games (slots,
 * roulette) go straight to 'settled' in a single call.
 */
export type RoundStatus = 'awaiting-action' | 'settled';

export interface GameAction {
  type: string;
  [key: string]: unknown;
}

/**
 * The result of a round, from the wallet's point of view.
 *
 * `payout` is the gross amount returned to the player, NOT profit. A 1x payout
 * on a $1 bet means the player got their dollar back and is even. This
 * convention matters: getting it backwards is the kind of bug that pays out the
 * house's entire float, so it is stated here once and tested everywhere.
 */
export interface Settlement {
  stake: Minor;
  payout: Minor;
  /** Multiplier applied to the stake, for display and analytics. */
  multiplier: number;
}

export interface RoundState<TPublic = unknown, TPrivate = unknown> {
  status: RoundStatus;
  /** Everything the player is allowed to see right now. Sent to the client. */
  public: TPublic;
  /**
   * Hidden state — the rest of the shoe, the dealer's hole card. Persisted
   * server-side, never serialised to the client. Leaking this is how card
   * counters and bots get a mathematical edge over the house.
   */
  private: TPrivate;
  /** Which actions are legal right now. The client renders exactly these. */
  availableActions: string[];
  /** Present once and only once, when status === 'settled'. */
  settlement?: Settlement;
}

export interface BetLimits {
  min: Minor;
  max: Minor;
}

export interface GameEngine<TPublic = unknown, TPrivate = unknown, TConfig = unknown> {
  readonly id: GameId;
  readonly name: string;
  readonly category: GameCategory;
  readonly limits: BetLimits;
  /**
   * Theoretical return to player, as a fraction (0.96 = 96%). This is a
   * mathematical property of the game's configuration, verified by simulation
   * in the test suite — not a marketing number typed in by hand.
   */
  readonly rtp: number;
  readonly config: TConfig;

  /** Open a round. Instant games settle here and return status 'settled'. */
  init(stake: Minor, rng: RngStream): RoundState<TPublic, TPrivate>;

  /**
   * Apply a player action to an open round. Must reject any action not listed
   * in `availableActions` — the client is untrusted input, always.
   */
  act(
    state: RoundState<TPublic, TPrivate>,
    action: GameAction,
    rng: RngStream,
  ): RoundState<TPublic, TPrivate>;
}

export class IllegalActionError extends Error {
  constructor(action: string, available: string[]) {
    super(`Action "${action}" is not legal here. Available: ${available.join(', ') || 'none'}`);
    this.name = 'IllegalActionError';
  }
}

export class BetLimitError extends Error {
  constructor(stake: number, limits: BetLimits) {
    super(`Stake ${stake} outside limits ${limits.min}–${limits.max}`);
    this.name = 'BetLimitError';
  }
}

export function assertWithinLimits(stake: Minor, limits: BetLimits): void {
  if (stake < limits.min || stake > limits.max) throw new BetLimitError(stake, limits);
}

/** Strip private state before anything goes over the wire. */
export function toClientView<TPublic>(
  state: RoundState<TPublic, unknown>,
): Omit<RoundState<TPublic, never>, 'private'> {
  const { status, public: pub, availableActions, settlement } = state;
  return settlement
    ? { status, public: pub, availableActions, settlement }
    : { status, public: pub, availableActions };
}
