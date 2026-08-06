/**
 * Mines — a 5×5 grid with hidden mines. Reveal safe tiles, cash out whenever.
 *
 * The only multi-step game in the instant category, and the one that needs the
 * most care about what the client is allowed to know.
 *
 * ## Where the randomness is drawn, and why it is drawn there
 *
 * `init` shuffles all twenty-five tiles into a random order and stores it. The
 * mines are then simply the first N tiles of that order, chosen once the player
 * says how many they want.
 *
 * The obvious alternative — wait for the mine count, then pick that many
 * positions — would draw randomness inside `act`, and `act` runs on a *fresh*
 * RNG stream rebuilt from the same seed and nonce. It would replay the same
 * bytes `init` already consumed. The engine contract in `types.ts` spells this
 * out; Mines is the game where getting it wrong would be least obvious, because
 * a repeated draw still produces a perfectly plausible-looking board.
 *
 * Shuffling everything up front sidesteps it entirely: after `init` there is no
 * randomness left to draw, only a stored order to read. It is also better for
 * verification — one permutation, derived from the published seed, and the
 * mines are its first N entries. A player can check the whole board with one
 * shuffle rather than reasoning about a sampling procedure.
 *
 * ## What the client may see
 *
 * Mine positions live in `private` and are copied into `public` **only** once
 * the round is settled. `toClientView` strips `private` before anything is
 * serialised, which is the difference between a game and a game with a map.
 */

import { minor, mul, type Minor } from '@juwa/money';
import type { RngStream } from '../rng.js';
import {
  DEFAULT_HOUSE_EDGE,
  MINES_TILES,
  minesMaxReveals,
  minesMultiplier,
  minesPaytable,
} from './instant-math.js';
import {
  assertWithinLimits,
  IllegalActionError,
  type BetLimits,
  type GameAction,
  type GameEngine,
  type RoundState,
} from './types.js';

export const MIN_MINES = 1;
export const MAX_MINES = MINES_TILES - 1; // 24 — one safe tile left to find.

export interface MinesPublic {
  mines: number;
  /** Tiles the player has safely turned over, in the order they picked them. */
  revealed: number[];
  /** What cashing out right now would pay. Zero before the first pick. */
  multiplier: number;
  /** What the next safe pick would pay, so the client can show the ladder. */
  nextMultiplier: number;
  /** Empty until the round ends, then every mine, for verification. */
  minePositions: number[];
  bust: boolean;
  /**
   * The deepest this board can be played, so the client can draw the end of the
   * ladder rather than letting a player plan a run that will be stopped short.
   */
  maxReveals: number;
}

interface MinesPrivate {
  stake: Minor;
  /** A random permutation of 0–24. The first `mines` entries are the mines. */
  order: number[];
  mines: number;
}

function requireInt(value: unknown, name: string, available: string[]): number {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new IllegalActionError(`${name} must be a whole number`, available);
  }
  return value;
}

export class MinesEngine implements GameEngine<MinesPublic, MinesPrivate, { houseEdge: number }> {
  readonly id = 'juwa-mines';
  readonly name = 'Mines';
  readonly category = 'instant' as const;
  readonly limits: BetLimits;
  readonly rtp = 1 - DEFAULT_HOUSE_EDGE;
  readonly config = {
    houseEdge: DEFAULT_HOUSE_EDGE,
    tiles: MINES_TILES,
    minMines: MIN_MINES,
    maxMines: MAX_MINES,
  };

  constructor(limits?: BetLimits) {
    this.limits = limits ?? { min: minor(50), max: minor(500_000) };
  }

  init(stake: Minor, rng: RngStream): RoundState<MinesPublic, MinesPrivate> {
    assertWithinLimits(stake, this.limits);
    const order = rng.shuffle(Array.from({ length: MINES_TILES }, (_, i) => i));
    return {
      status: 'awaiting-action',
      public: {
        mines: 0,
        revealed: [],
        multiplier: 0,
        nextMultiplier: 0,
        minePositions: [],
        bust: false,
        maxReveals: 0,
      },
      // `mines: 0` marks the board as not yet configured. Every action below
      // checks `availableActions` rather than this field, so it is a label
      // rather than a guard.
      private: { stake, order, mines: 0 },
      availableActions: ['configure'],
    };
  }

  /** The cash-out ladder for a mine count, for the client to render up front. */
  paytable(mines: number): number[] {
    return minesPaytable(mines, this.config.houseEdge);
  }

  act(
    state: RoundState<MinesPublic, MinesPrivate>,
    action: GameAction,
    _rng: RngStream,
  ): RoundState<MinesPublic, MinesPrivate> {
    if (!state.availableActions.includes(action.type)) {
      throw new IllegalActionError(action.type, state.availableActions);
    }
    switch (action.type) {
      case 'configure':
        return this.configure(state, action);
      case 'reveal':
        return this.reveal(state, action);
      case 'cashout':
        return this.cashout(state);
      default:
        throw new IllegalActionError(action.type, state.availableActions);
    }
  }

  private configure(
    state: RoundState<MinesPublic, MinesPrivate>,
    action: GameAction,
  ): RoundState<MinesPublic, MinesPrivate> {
    const mines = requireInt(action['mines'], 'mines', state.availableActions);
    if (mines < MIN_MINES || mines > MAX_MINES) {
      throw new IllegalActionError(
        `Mines must be between ${MIN_MINES} and ${MAX_MINES}`,
        state.availableActions,
      );
    }
    return {
      status: 'awaiting-action',
      public: {
        ...state.public,
        mines,
        nextMultiplier: minesMultiplier(mines, 1, this.config.houseEdge),
        maxReveals: minesMaxReveals(mines, this.config.houseEdge),
      },
      private: { ...state.private, mines },
      // No cash-out yet: with nothing revealed there is nothing to cash out,
      // and offering the action would only let a player hand back their stake
      // for a zero payout.
      availableActions: ['reveal'],
    };
  }

  private reveal(
    state: RoundState<MinesPublic, MinesPrivate>,
    action: GameAction,
  ): RoundState<MinesPublic, MinesPrivate> {
    const tile = requireInt(action['tile'], 'tile', state.availableActions);
    if (tile < 0 || tile >= MINES_TILES) {
      throw new IllegalActionError(`Tile must be 0–${MINES_TILES - 1}`, state.availableActions);
    }
    if (state.public.revealed.includes(tile)) {
      throw new IllegalActionError('That tile is already revealed', state.availableActions);
    }

    const { stake, order, mines } = state.private;
    const minePositions = order.slice(0, mines);

    if (minePositions.includes(tile)) {
      // Bust. The board is opened so the player can check it against the seed.
      return {
        status: 'settled',
        public: { ...state.public, minePositions, bust: true, multiplier: 0, nextMultiplier: 0 },
        private: state.private,
        availableActions: [],
        settlement: { stake, payout: minor(0), multiplier: 0 },
      };
    }

    const revealed = [...state.public.revealed, tile];
    const safeTiles = MINES_TILES - mines;
    const multiplier = minesMultiplier(mines, revealed.length, this.config.houseEdge);

    // Two ways the round ends on its own: the board is cleared, or the next
    // rung of the ladder would be worth more than the game is allowed to pay.
    //
    // The second is the important one. The alternative — let the player keep
    // going and clip the payout at the cap — pays a fifth of what the odds were
    // worth on the rarest run in the game. Stopping here pays every coin
    // advertised; it just declines to sell a rung that cannot be honoured.
    if (revealed.length >= Math.min(safeTiles, state.public.maxReveals)) {
      return {
        status: 'settled',
        public: { ...state.public, revealed, multiplier, nextMultiplier: 0, minePositions },
        private: state.private,
        availableActions: [],
        settlement: { stake, payout: mul(stake, multiplier), multiplier },
      };
    }

    return {
      status: 'awaiting-action',
      public: {
        ...state.public,
        revealed,
        multiplier,
        nextMultiplier: minesMultiplier(mines, revealed.length + 1, this.config.houseEdge),
      },
      private: state.private,
      availableActions: ['reveal', 'cashout'],
    };
  }

  private cashout(state: RoundState<MinesPublic, MinesPrivate>): RoundState<MinesPublic, MinesPrivate> {
    const { stake, order, mines } = state.private;
    const multiplier = state.public.multiplier;
    return {
      status: 'settled',
      public: { ...state.public, minePositions: order.slice(0, mines), nextMultiplier: 0 },
      private: state.private,
      availableActions: [],
      settlement: { stake, payout: mul(stake, multiplier), multiplier },
    };
  }
}
