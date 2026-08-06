/**
 * Plinko — drop a ball through a triangle of pegs into a multiplier bucket.
 *
 * The player sets two dials before the drop: how many rows (8 to 16) and how
 * much risk (low, medium, high). Fifteen tables in all, each derived in
 * `instant-math.ts` to hold exactly the same 1% edge, so the dials change the
 * shape of the experience and never the price of it.
 *
 * The whole path is returned, not just the bucket. That is what lets the client
 * animate the ball bouncing left and right down the real pegs it actually took,
 * and — more importantly — it is what makes the fairness claim legible. A
 * player replaying the seed sees the same sixteen bounces, not just the same
 * final answer.
 */

import { minor, mul, type Minor } from '@juwa/money';
import type { RngStream } from '../rng.js';
import {
  DEFAULT_HOUSE_EDGE,
  PLINKO_ROWS,
  plinkoDrop,
  plinkoTable,
  type PlinkoRisk,
  type PlinkoRows,
} from './instant-math.js';
import {
  assertWithinLimits,
  IllegalActionError,
  type BetLimits,
  type GameAction,
  type GameEngine,
  type RoundState,
} from './types.js';

const RISKS: PlinkoRisk[] = ['low', 'medium', 'high'];

export interface PlinkoPublic {
  rows: PlinkoRows;
  risk: PlinkoRisk;
  /** 'L' or 'R' at each peg, in order, for the drop animation. */
  path: ('L' | 'R')[];
  bucket: number;
  multiplier: number;
  /** The full table, so the client can draw the buckets under the board. */
  table: number[];
}

/** See the note in `crash.ts`: the stake comes from `init`, never the action. */
interface StakeHeld {
  stake: Minor;
}

export class PlinkoEngine implements GameEngine<PlinkoPublic, StakeHeld, { houseEdge: number }> {
  readonly id = 'juwa-plinko';
  readonly name = 'Plinko';
  readonly category = 'instant' as const;
  readonly limits: BetLimits;
  readonly rtp = 1 - DEFAULT_HOUSE_EDGE;
  readonly config = {
    houseEdge: DEFAULT_HOUSE_EDGE,
    rows: [...PLINKO_ROWS],
    risks: RISKS,
  };

  constructor(limits?: BetLimits) {
    this.limits = limits ?? { min: minor(50), max: minor(500_000) };
  }

  init(stake: Minor, _rng: RngStream): RoundState<PlinkoPublic, StakeHeld> {
    assertWithinLimits(stake, this.limits);
    return {
      status: 'awaiting-action',
      public: { rows: 16, risk: 'medium', path: [], bucket: -1, multiplier: 0, table: [] },
      private: { stake },
      availableActions: ['drop'],
    };
  }

  act(
    state: RoundState<PlinkoPublic, StakeHeld>,
    action: GameAction,
    rng: RngStream,
  ): RoundState<PlinkoPublic, StakeHeld> {
    if (action.type !== 'drop' || !state.availableActions.includes('drop')) {
      throw new IllegalActionError(action.type, state.availableActions);
    }

    const rows = action['rows'];
    const risk = action['risk'];
    if (!PLINKO_ROWS.includes(rows as PlinkoRows)) {
      throw new IllegalActionError(
        `Rows must be one of ${PLINKO_ROWS.join(', ')}`,
        state.availableActions,
      );
    }
    if (!RISKS.includes(risk as PlinkoRisk)) {
      throw new IllegalActionError('Risk must be low, medium or high', state.availableActions);
    }

    const { stake } = state.private;
    const table = plinkoTable(rows as PlinkoRows, risk as PlinkoRisk, this.config.houseEdge);
    const { path, bucket } = plinkoDrop(rng, rows as PlinkoRows);
    const multiplier = table[bucket]!;

    return {
      status: 'settled',
      public: { rows: rows as PlinkoRows, risk: risk as PlinkoRisk, path, bucket, multiplier, table },
      private: state.private,
      availableActions: [],
      // Plinko has no losing bucket — the worst outcome returns part of the
      // stake rather than none of it. So the payout is always positive, and the
      // multiplier is reported as-is rather than zeroed on a "loss", because
      // there is no loss to detect.
      settlement: { stake, payout: mul(stake, multiplier), multiplier },
    };
  }
}
