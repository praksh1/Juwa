/**
 * Golden Scratch — an instant three-prize card.
 *
 * The card is visual theatre; the outcome is selected once, on the server,
 * before the client receives the round.  Probabilities below produce exactly
 * a 95% theoretical return: .21×1 + .12×2 + .06×5 + .02×10 = .95.
 */
import { minor, mul, type Minor } from '@juwa/money';
import type { RngStream } from '../rng.js';
import { assertWithinLimits, IllegalActionError, type BetLimits, type GameAction, type GameEngine, type RoundState } from './types.js';

export interface ScratchPublic {
  multiplier: number;
  /** Three values printed beneath the scratch coating; all are cosmetic until reveal. */
  prizes: readonly number[];
}

export const SCRATCH_OUTCOMES: readonly { multiplier: number; weight: number }[] = [
  { multiplier: 0, weight: 59 },
  { multiplier: 1, weight: 21 },
  { multiplier: 2, weight: 12 },
  { multiplier: 5, weight: 6 },
  { multiplier: 10, weight: 2 },
];

/** Analytic return of the finite prize table; keeps the declared RTP auditable. */
export function scratchRtp(): number {
  return SCRATCH_OUTCOMES.reduce((total, outcome) => total + (outcome.multiplier * outcome.weight) / 100, 0);
}

function draw(rng: RngStream): number {
  let ticket = rng.nextInt(100);
  for (const outcome of SCRATCH_OUTCOMES) {
    if (ticket < outcome.weight) return outcome.multiplier;
    ticket -= outcome.weight;
  }
  return 0;
}

export class ScratchEngine implements GameEngine<ScratchPublic, null, { rtp: number }> {
  readonly id = 'juwa-scratch';
  readonly name = 'Golden Scratch';
  readonly category = 'instant' as const;
  readonly limits: BetLimits;
  readonly rtp = scratchRtp();
  readonly config = { rtp: this.rtp };

  constructor(limits?: BetLimits) {
    this.limits = limits ?? { min: minor(100), max: minor(10_000) };
  }

  init(stake: Minor, rng: RngStream): RoundState<ScratchPublic, null> {
    assertWithinLimits(stake, this.limits);
    const multiplier = draw(rng);
    // Decoys are deliberately independently drawn only after the paid result.
    // They are display values, never additional winning chances.
    const prizes = [draw(rng), draw(rng), multiplier] as const;
    return {
      status: 'settled',
      public: { multiplier, prizes },
      private: null,
      availableActions: [],
      settlement: { stake, payout: multiplier > 0 ? mul(stake, multiplier) : minor(0), multiplier },
    };
  }

  act(state: RoundState<ScratchPublic, null>, action: GameAction): RoundState<ScratchPublic, null> {
    throw new IllegalActionError(action.type, state.availableActions);
  }
}
