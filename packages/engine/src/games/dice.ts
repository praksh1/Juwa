/**
 * Dice — roll 0.00 to 99.99, bet over or under a line you choose.
 *
 * The simplest game in the catalogue and the most scrutinised. There is
 * nothing to hide behind: a player can compute the correct payout for any
 * target in their head, so a wrong multiplier is not a subtle bug, it is a
 * public one. That is exactly why the game is worth having — it is the game
 * players use to decide whether a site is honest.
 *
 * All of the maths lives in `instant-math.ts`. This file is the plumbing.
 */

import { minor, mul, type Minor } from '@juwa/money';
import type { RngStream } from '../rng.js';
import {
  DEFAULT_HOUSE_EDGE,
  DICE_MIN_MULTIPLIER,
  diceMultiplier,
  diceRoll,
} from './instant-math.js';
import {
  assertWithinLimits,
  IllegalActionError,
  type BetLimits,
  type GameAction,
  type GameEngine,
  type RoundState,
} from './types.js';

export type DiceDirection = 'over' | 'under';

export interface DicePublic {
  roll: number;
  target: number;
  direction: DiceDirection;
  multiplier: number;
  won: boolean;
}

/** See the note in `crash.ts`: the stake comes from `init`, never the action. */
interface StakeHeld {
  stake: Minor;
}

export class DiceEngine implements GameEngine<DicePublic, StakeHeld, { houseEdge: number }> {
  readonly id = 'juwa-dice';
  readonly name = 'Dice';
  readonly category = 'instant' as const;
  readonly limits: BetLimits;
  readonly rtp = 1 - DEFAULT_HOUSE_EDGE;
  readonly config = {
    houseEdge: DEFAULT_HOUSE_EDGE,
    minMultiplier: DICE_MIN_MULTIPLIER,
  };

  constructor(limits?: BetLimits) {
    this.limits = limits ?? { min: minor(50), max: minor(500_000) };
  }

  init(stake: Minor, _rng: RngStream): RoundState<DicePublic, StakeHeld> {
    assertWithinLimits(stake, this.limits);
    return {
      status: 'awaiting-action',
      public: { roll: 0, target: 0, direction: 'over', multiplier: 0, won: false },
      private: { stake },
      availableActions: ['roll'],
    };
  }

  act(
    state: RoundState<DicePublic, StakeHeld>,
    action: GameAction,
    rng: RngStream,
  ): RoundState<DicePublic, StakeHeld> {
    if (action.type !== 'roll' || !state.availableActions.includes('roll')) {
      throw new IllegalActionError(action.type, state.availableActions);
    }

    const target = action['target'];
    const direction = action['direction'];
    if (typeof target !== 'number') {
      throw new IllegalActionError('A numeric target is required', state.availableActions);
    }
    if (direction !== 'over' && direction !== 'under') {
      throw new IllegalActionError('Direction must be "over" or "under"', state.availableActions);
    }

    // `diceMultiplier` validates the target's range and decimal places, and
    // rejects the degenerate near-certain bets. Its RangeErrors are turned into
    // IllegalActionError here so the API answers 400 rather than 500 — this is
    // bad input from a client, not a fault in the server.
    let multiplier: number;
    try {
      multiplier = diceMultiplier(target, direction, this.config.houseEdge);
    } catch (error) {
      throw new IllegalActionError((error as Error).message, state.availableActions);
    }

    const { stake } = state.private;
    const roll = diceRoll(rng);
    const won = direction === 'over' ? roll > target : roll < target;

    return {
      status: 'settled',
      public: { roll, target, direction, multiplier, won },
      private: state.private,
      availableActions: [],
      settlement: {
        stake,
        payout: won ? mul(stake, multiplier) : minor(0),
        multiplier: won ? multiplier : 0,
      },
    };
  }
}
