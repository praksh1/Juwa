/**
 * European roulette — single zero, 37 pockets.
 *
 * We use the European wheel rather than the American double-zero wheel on
 * purpose. American roulette has a 5.26% house edge versus European's 2.70%.
 * The higher edge earns more per spin but is measurably worse for retention:
 * players bust out faster, and a player who has run out of money is worth
 * nothing. Single zero is the better commercial choice, not just the fairer one.
 */

import { minor, mul, type Minor } from '@juwa/money';
import type { RngStream } from '../rng.js';
import {
  assertWithinLimits,
  IllegalActionError,
  type BetLimits,
  type GameAction,
  type GameEngine,
  type RoundState,
} from './types.js';

const POCKETS = 37; // 0–36

const RED = new Set([
  1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36,
]);

export type BetType =
  | 'straight'   // one number, 35:1
  | 'split'      // two adjacent numbers, 17:1
  | 'street'     // three in a row, 11:1
  | 'corner'     // four in a square, 8:1
  | 'line'       // six across two rows, 5:1
  | 'column'     // twelve, 2:1
  | 'dozen'      // twelve, 2:1
  | 'red' | 'black' | 'odd' | 'even' | 'low' | 'high'; // even-money, 1:1

/** Payout is quoted as "X to 1"; the returned stake is added on top. */
const ODDS: Record<BetType, number> = {
  straight: 35, split: 17, street: 11, corner: 8, line: 5,
  column: 2, dozen: 2,
  red: 1, black: 1, odd: 1, even: 1, low: 1, high: 1,
};

export interface RouletteBet {
  type: BetType;
  /** Numbers covered for positional bets; the index (0-2) for column/dozen. */
  selection: number[];
  amount: Minor;
}

export interface RoulettePublic {
  winningNumber: number;
  color: 'red' | 'black' | 'green';
  bets: RouletteBet[];
  winningBets: number[];
}

function colorOf(n: number): 'red' | 'black' | 'green' {
  if (n === 0) return 'green';
  return RED.has(n) ? 'red' : 'black';
}

function covers(bet: RouletteBet, n: number): boolean {
  switch (bet.type) {
    case 'red': return colorOf(n) === 'red';
    case 'black': return colorOf(n) === 'black';
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
      // Positional bets: straight, split, street, corner, line.
      return bet.selection.includes(n);
  }
}

const EXPECTED_SELECTION_SIZE: Partial<Record<BetType, number>> = {
  straight: 1, split: 2, street: 3, corner: 4, line: 6,
};

function validateBet(bet: RouletteBet): void {
  const expected = EXPECTED_SELECTION_SIZE[bet.type];
  if (expected !== undefined) {
    if (bet.selection.length !== expected) {
      throw new IllegalActionError(
        `${bet.type} bet needs exactly ${expected} number(s), got ${bet.selection.length}`,
        [],
      );
    }
    for (const n of bet.selection) {
      if (!Number.isInteger(n) || n < 0 || n > 36) {
        throw new IllegalActionError(`${n} is not a roulette number`, []);
      }
    }
  }
  if (bet.type === 'dozen' || bet.type === 'column') {
    const idx = bet.selection[0];
    if (idx === undefined || idx < 0 || idx > 2) {
      throw new IllegalActionError(`${bet.type} index must be 0, 1 or 2`, []);
    }
  }
}

export class RouletteEngine implements GameEngine<RoulettePublic, null, { pockets: number }> {
  readonly id = 'juwa-roulette-eu';
  readonly name = 'European Roulette';
  readonly category = 'table' as const;
  readonly limits: BetLimits;
  /** 36/37 — mathematically exact for every bet type on a single-zero wheel. */
  readonly rtp = 36 / 37;
  readonly config = { pockets: POCKETS };

  constructor(limits?: BetLimits) {
    this.limits = limits ?? { min: minor(50), max: minor(500_000) };
  }

  /**
   * Roulette needs the bet layout before it can spin, so the round opens via
   * `act` with a 'place-bets' action. `init` just opens an empty table.
   */
  init(stake: Minor, _rng: RngStream): RoundState<RoulettePublic, null> {
    assertWithinLimits(stake, this.limits);
    return {
      status: 'awaiting-action',
      public: { winningNumber: -1, color: 'green', bets: [], winningBets: [] },
      private: null,
      availableActions: ['place-bets'],
    };
  }

  act(
    state: RoundState<RoulettePublic, null>,
    action: GameAction,
    rng: RngStream,
  ): RoundState<RoulettePublic, null> {
    if (action.type !== 'place-bets' || !state.availableActions.includes('place-bets')) {
      throw new IllegalActionError(action.type, state.availableActions);
    }

    const bets = action['bets'] as RouletteBet[] | undefined;
    if (!Array.isArray(bets) || bets.length === 0) {
      throw new IllegalActionError('place-bets requires at least one bet', state.availableActions);
    }
    for (const bet of bets) validateBet(bet);

    const stake = minor(bets.reduce((sum, b) => sum + b.amount, 0));
    assertWithinLimits(stake, this.limits);

    const winningNumber = rng.nextInt(POCKETS);
    const winningBets: number[] = [];
    let payout = 0;

    bets.forEach((bet, i) => {
      if (!covers(bet, winningNumber)) return;
      winningBets.push(i);
      // Winner gets the stake back plus the odds.
      payout += mul(bet.amount, ODDS[bet.type] + 1);
    });

    const total = minor(payout);
    return {
      status: 'settled',
      public: { winningNumber, color: colorOf(winningNumber), bets, winningBets },
      private: null,
      availableActions: [],
      settlement: { stake, payout: total, multiplier: stake === 0 ? 0 : total / stake },
    };
  }
}

export const ROULETTE_ODDS = ODDS;
export { colorOf as rouletteColor };
