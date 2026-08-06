/**
 * Crash and Limbo.
 *
 * Two games, one random variable. A multiplier climbs from 1.00x and stops at
 * a point the server committed to before the bet. Crash animates the climb;
 * Limbo skips the animation and prints the number. They share `crashPoint` so
 * they cannot drift apart, and they carry the same 1% edge.
 *
 * ## The one design decision that matters here
 *
 * On the sites this game comes from, Crash is a shared multiplayer round: a
 * curve rises on everyone's screen at once, and you tap CASH OUT while it is
 * moving. **Ours is not that, and the difference is deliberate.**
 *
 * Ours takes an auto-cash-out target *before* the round and settles instantly.
 *
 * Three reasons, in increasing order of how much they cost to ignore:
 *
 *  1. **A pure engine has no clock.** `GameEngine` may not read the time — that
 *     is what makes every round replayable from its seeds. A live cash-out is
 *     resolved by *when the tap arrived*, which is not a function of the seeds
 *     and cannot be replayed or proven. The provable-fairness guarantee and the
 *     live curve are mutually exclusive; we keep the guarantee.
 *
 *  2. **A live curve is unfair over a network.** The winner of a close cash-out
 *     is whoever has the better connection. A player on hotel wifi loses bets a
 *     player on fibre wins, with identical timing and identical intent. That is
 *     a real, well-known complaint about the format, and it is unfixable.
 *
 *  3. **A shared round needs infrastructure we do not have.** Every player
 *     watching the same curve means a socket server holding a synchronised
 *     round, which is a stateful always-on service — the exact opposite of the
 *     stateless API this app is built on, and a monthly bill besides.
 *
 * What is lost is the social feel of watching other people bail out. What is
 * kept is a game that is provably fair, costs nothing extra to run, and is
 * identical in maths. The client still animates the curve rising to the crash
 * point, so it *plays* the same — it just cannot be lost to lag.
 */

import { minor, mul, type Minor } from '@juwa/money';
import type { RngStream } from '../rng.js';
import {
  assertValidTarget,
  crashPoint,
  DEFAULT_HOUSE_EDGE,
  MAX_MULTIPLIER,
  MIN_TARGET,
} from './instant-math.js';
import {
  assertWithinLimits,
  IllegalActionError,
  type BetLimits,
  type GameAction,
  type GameEngine,
  type RoundState,
} from './types.js';

const DEFAULT_LIMITS: BetLimits = { min: minor(50), max: minor(500_000) };

/**
 * The stake, carried from `init` to `act`.
 *
 * It would be simpler to read the stake out of the action alongside the
 * target, and it would be a hole: the API debits `settlement.stake`, so an
 * engine that believed the action's stake would let a client open a round for
 * 50 coins and settle it for 500,000. The stake the API opened the round with
 * is the only one that has been checked against the player's balance, so it is
 * the only one that may be settled.
 */
interface StakeHeld {
  stake: Minor;
}

export interface CrashPublic {
  /** Where the curve stopped. Always revealed — it is the proof of the round. */
  crashPoint: number;
  /** The auto-cash-out the player committed to before the round. */
  target: number;
  cashedOut: boolean;
}

/**
 * Read the target out of an untrusted action.
 *
 * Everything arriving here came off the wire from a client we do not control,
 * so a missing field, a string, `NaN`, or a target with four decimals are all
 * ordinary inputs rather than impossible ones.
 */
function readTarget(action: GameAction, available: string[]): number {
  const raw = action['target'];
  if (typeof raw !== 'number') {
    throw new IllegalActionError('A numeric cash-out target is required', available);
  }
  try {
    assertValidTarget(raw);
  } catch (error) {
    throw new IllegalActionError((error as Error).message, available);
  }
  return raw;
}

/**
 * Settle one bet against a crash point.
 *
 * Shared by both engines so there is exactly one place where the comparison
 * `crashPoint >= target` is written. Getting that boundary wrong by one tick —
 * `>` instead of `>=` — is invisible in casual play and quietly removes a
 * slice of the player's return on every single bet.
 */
function settle(stake: Minor, target: number, point: number): {
  payout: Minor;
  multiplier: number;
  won: boolean;
} {
  const won = point >= target;
  const multiplier = won ? target : 0;
  return { payout: won ? mul(stake, target) : minor(0), multiplier, won };
}

/**
 * Crash — the curve rises and stops.
 *
 * Opens `awaiting-action` because the target has to arrive before the round can
 * resolve, exactly like roulette needing its bet layout.
 */
export class CrashEngine implements GameEngine<CrashPublic, StakeHeld, { houseEdge: number }> {
  readonly id = 'juwa-crash';
  readonly name = 'Crash';
  readonly category = 'instant' as const;
  readonly limits: BetLimits;
  /** Exact, and identical for every target a player could choose. */
  readonly rtp = 1 - DEFAULT_HOUSE_EDGE;
  readonly config = { houseEdge: DEFAULT_HOUSE_EDGE, minTarget: MIN_TARGET, maxTarget: MAX_MULTIPLIER };

  constructor(limits?: BetLimits) {
    this.limits = limits ?? DEFAULT_LIMITS;
  }

  init(stake: Minor, _rng: RngStream): RoundState<CrashPublic, StakeHeld> {
    assertWithinLimits(stake, this.limits);
    return {
      status: 'awaiting-action',
      public: { crashPoint: 0, target: 0, cashedOut: false },
      private: { stake },
      availableActions: ['set-target'],
    };
  }

  act(
    state: RoundState<CrashPublic, StakeHeld>,
    action: GameAction,
    rng: RngStream,
  ): RoundState<CrashPublic, StakeHeld> {
    if (action.type !== 'set-target' || !state.availableActions.includes('set-target')) {
      throw new IllegalActionError(action.type, state.availableActions);
    }
    const target = readTarget(action, state.availableActions);
    const { stake } = state.private;

    const point = crashPoint(rng, this.config.houseEdge);
    const { payout, multiplier, won } = settle(stake, target, point);

    return {
      status: 'settled',
      public: { crashPoint: point, target, cashedOut: won },
      private: state.private,
      availableActions: [],
      settlement: { stake, payout, multiplier },
    };
  }
}

export interface LimboPublic {
  /** The multiplier the round rolled. */
  result: number;
  target: number;
  won: boolean;
}

/**
 * Limbo — the same draw, shown as a number instead of a curve.
 *
 * Kept as its own engine rather than a display mode of Crash because the two
 * have different ids, different lobby tiles and different bet histories. A
 * player reviewing their history should see which game they played.
 */
export class LimboEngine implements GameEngine<LimboPublic, StakeHeld, { houseEdge: number }> {
  readonly id = 'juwa-limbo';
  readonly name = 'Limbo';
  readonly category = 'instant' as const;
  readonly limits: BetLimits;
  readonly rtp = 1 - DEFAULT_HOUSE_EDGE;
  readonly config = { houseEdge: DEFAULT_HOUSE_EDGE, minTarget: MIN_TARGET, maxTarget: MAX_MULTIPLIER };

  constructor(limits?: BetLimits) {
    this.limits = limits ?? DEFAULT_LIMITS;
  }

  init(stake: Minor, _rng: RngStream): RoundState<LimboPublic, StakeHeld> {
    assertWithinLimits(stake, this.limits);
    return {
      status: 'awaiting-action',
      public: { result: 0, target: 0, won: false },
      private: { stake },
      availableActions: ['set-target'],
    };
  }

  act(
    state: RoundState<LimboPublic, StakeHeld>,
    action: GameAction,
    rng: RngStream,
  ): RoundState<LimboPublic, StakeHeld> {
    if (action.type !== 'set-target' || !state.availableActions.includes('set-target')) {
      throw new IllegalActionError(action.type, state.availableActions);
    }
    const target = readTarget(action, state.availableActions);
    const { stake } = state.private;

    const result = crashPoint(rng, this.config.houseEdge);
    const { payout, multiplier, won } = settle(stake, target, result);

    return {
      status: 'settled',
      public: { result, target, won },
      private: state.private,
      availableActions: [],
      settlement: { stake, payout, multiplier },
    };
  }
}
