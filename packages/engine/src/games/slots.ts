/**
 * Video slots — one engine, driven by a config object.
 *
 * How a slot machine actually works, which is the part that surprises people:
 *
 * The machine does not "decide to pay out 96%". It picks a random stop position
 * on each reel, and the 96% *emerges* from the combination of the reel strips
 * (how many of each symbol are on each reel) and the paytable (what each
 * combination pays). Change one symbol on one strip and the RTP moves.
 *
 * That means RTP is a measured property, not a setting. `npm run rtp` simulates
 * millions of spins and reports the real number, and the test suite fails the
 * build if any game drifts outside its published band. This is how a real studio
 * works, and it is what a lab like GLI or BMM re-derives independently before a
 * regulator signs off.
 *
 * It is also why this engine takes a definition rather than hard-coding one
 * game. The whole catalogue shares this file, so the payout logic is written
 * and tested once; a new theme cannot introduce a settlement bug, because a new
 * theme is data.
 */

import { mul, type Minor } from '@juwa/money';
import type { RngStream } from '../rng.js';
import {
  assertWithinLimits,
  IllegalActionError,
  type BetLimits,
  type GameAction,
  type GameEngine,
  type RoundState,
} from './types.js';
import {
  buildStrips,
  resolveSpin,
  type SlotMath,
  type SlotSymbol,
  type SpinResult,
} from './slot-math.js';
import { SLOT_CATALOGUE, slotModel, type SlotDefinition } from './slot-catalogue.js';

export type { SlotSymbol, SpinResult, LineWin } from './slot-math.js';

export interface SlotsPublic {
  baseSpin: SpinResult;
  freeSpins: SpinResult[];
  freeSpinsAwarded: number;
  totalMultiplier: number;
}

export interface SlotsConfig {
  strips: readonly (readonly SlotSymbol[])[];
  math: SlotMath;
  theme: SlotDefinition['theme'];
}

export class SlotsEngine implements GameEngine<SlotsPublic, null, SlotsConfig> {
  readonly id: string;
  readonly name: string;
  readonly category = 'slots' as const;
  readonly limits: BetLimits;
  /** Measured by Monte Carlo simulation, not asserted by hand. */
  readonly rtp: number;
  readonly config: SlotsConfig;

  private readonly math: SlotMath;

  constructor(definition: SlotDefinition, limits?: BetLimits) {
    const model = slotModel(definition);
    this.id = definition.id;
    this.name = definition.name;
    this.limits = limits ?? definition.limits;
    this.rtp = model.rtp;
    this.math = model.math;
    // Strips are built once per engine, at registration. Rebuilding them per
    // spin would be pure waste and would also make them a moving target for
    // anyone trying to verify a past round.
    this.config = {
      strips: buildStrips(model.math),
      math: model.math,
      theme: definition.theme,
    };
  }

  init(stake: Minor, rng: RngStream): RoundState<SlotsPublic, null> {
    assertWithinLimits(stake, this.limits);

    const base = resolveSpin(this.config.strips, this.math, rng, 1);
    let totalMultiplier = base.totalMultiplier;

    const freeSpinsAwarded = this.math.freeSpinsAwarded[base.scatterCount] ?? 0;
    const freeSpins: SpinResult[] = [];
    for (let i = 0; i < freeSpinsAwarded; i++) {
      const spin = resolveSpin(
        this.config.strips,
        this.math,
        rng,
        this.math.freeSpinMultiplier,
      );
      freeSpins.push(spin);
      totalMultiplier += spin.totalMultiplier;
    }

    return {
      status: 'settled',
      public: { baseSpin: base, freeSpins, freeSpinsAwarded, totalMultiplier },
      private: null,
      availableActions: [],
      settlement: { stake, payout: mul(stake, totalMultiplier), multiplier: totalMultiplier },
    };
  }

  act(
    state: RoundState<SlotsPublic, null>,
    action: GameAction,
    _rng: RngStream,
  ): RoundState<SlotsPublic, null> {
    // Slots settle in `init`; there is nothing to act on. Anything arriving
    // here is a malformed or replayed client request.
    throw new IllegalActionError(action.type, state.availableActions);
  }
}

/**
 * The flagship game.
 *
 * Tools and tests that want "a slot machine" rather than a specific theme use
 * this, so they keep working as the catalogue grows.
 */
export function classicSlots(limits?: BetLimits): SlotsEngine {
  const definition = SLOT_CATALOGUE.find((d) => d.id === 'juwa-classic-slots');
  if (!definition) throw new Error('juwa-classic-slots is missing from the catalogue');
  return new SlotsEngine(definition, limits);
}

/** Every slot in the catalogue, ready to register. */
export function allSlotEngines(): SlotsEngine[] {
  return SLOT_CATALOGUE.map((definition) => new SlotsEngine(definition));
}

export const PAYING_SYMBOL_LIST: SlotSymbol[] = [
  'SEVEN', 'DIAMOND', 'BELL', 'BAR', 'CHERRY', 'PLUM', 'LEMON',
];
