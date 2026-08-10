/**
 * What happens when something good happens.
 *
 * ## Why this exists
 *
 * Every game in the catalogue used to answer that question the same way: three
 * scatters, a handful of free spins, every win multiplied. The three-reelers did
 * not answer it at all — they had no bonus of any kind. So twenty-three games
 * with different art, different grids and genuinely different maths still had
 * one moment between them, and a player who had seen one had seen them all.
 *
 * Nobody experiences a slot as a paytable. They experience it as a rhythm and a
 * few moments, and the moment is the part they describe to someone else.
 *
 * ## Why the round is resolved in one place
 *
 * `SlotsEngine.init` used to run the free-spin loop itself, and the RTP tool ran
 * its own copy of the same loop to measure it. Two implementations of "what a
 * round pays", one of them the thing that gets played and the other the thing
 * that gets published. They agreed only because both were four lines long, and
 * the first feature added to one and not the other would have produced a machine
 * whose real return was not the number printed on it.
 *
 * `resolveRound` is now the only answer, and both callers ask it. A feature
 * cannot be added to the game without also being added to the measurement,
 * because they are the same code.
 */

import type { RngStream } from '../rng.js';
import {
  reelHeights,
  resolveSpin,
  type SlotFeature,
  type SlotMath,
  type SlotSymbol,
  type SpinResult,
} from './slot-math.js';

/* ------------------------------------------------------------ hold & spin */

/** A cell holding a coin, and what that coin is worth in stake multiples. */
export interface HeldCoin {
  reel: number;
  row: number;
  value: number;
}

/** One respin of a hold-and-spin round. */
export interface HoldSpinStep {
  /** Coins that stuck on this respin. Empty is the normal case. */
  gained: HeldCoin[];
  /** Respins remaining after this one — reset to full whenever a coin sticks. */
  respinsLeft: number;
}

export interface HoldSpinOutcome {
  kind: 'hold-spin';
  /** The coins that triggered the round, from the base grid. */
  seed: HeldCoin[];
  steps: HoldSpinStep[];
  /** Every cell filled. The reason anyone plays this mechanic. */
  full: boolean;
  /** Total stake multiple awarded by the round, bonus included. */
  multiplier: number;
}

/* ------------------------------------------------------------------ wheel */

export interface WheelOutcome {
  kind: 'wheel';
  /** Which segment came up, as an index into the model's segment list. */
  index: number;
  multiplier: number;
}

export type FeatureOutcome = HoldSpinOutcome | WheelOutcome;

/**
 * Draw from a weighted list.
 *
 * One `nextInt` over the summed weights rather than a float compare per entry,
 * so the draw consumes exactly one number from the stream whatever the list
 * looks like. That matters for replay: a round is audited by re-running the
 * same seed, and a draw whose RNG consumption depends on its own outcome makes
 * every subsequent draw in the round unreproducible.
 */
function weightedPick(weights: readonly number[], rng: RngStream): number {
  let total = 0;
  for (const w of weights) total += Math.max(0, w);
  if (total <= 0) return 0;
  let roll = rng.nextInt(total);
  for (const [i, w] of weights.entries()) {
    roll -= Math.max(0, w);
    if (roll < 0) return i;
  }
  return weights.length - 1;
}

/**
 * Play out a hold-and-spin round.
 *
 * The triggering scatters lock where they landed and everything else respins.
 * Three respins; every coin that sticks puts it back to three. The round ends
 * on three consecutive nothings or when the grid is full — and the second of
 * those is the one the whole mechanic exists for, so it pays a bonus.
 *
 * The respin counter resetting is what makes this feel different from free
 * spins rather than being free spins with extra steps: a free spin round has a
 * length you are told up front, and this one is being fought for a cell at a
 * time.
 */
export function resolveHoldSpin(
  feature: Extract<SlotFeature, { kind: 'hold-spin' }>,
  math: SlotMath,
  grid: readonly (readonly SlotSymbol[])[],
  rng: RngStream,
): HoldSpinOutcome {
  const scatters = new Set(
    math.symbols.filter((s) => s.kind === 'scatter').map((s) => s.id),
  );
  const heights = reelHeights(math);
  const cells = heights.reduce((sum, rows) => sum + rows, 0);

  /*
   * Coin values obey `payoutScale` like every other payout.
   *
   * Without this a model's return stops being linear in its scale — the base
   * game moves and the feature does not — and calibrating it becomes an
   * afternoon of nudging instead of one measurement and one division, which is
   * the whole reason `payoutScale` exists.
   */
  const scale = math.payoutScale ?? 1;
  const drawValue = () => (feature.values[weightedPick(feature.weights, rng)] ?? 0) * scale;

  const held = new Map<string, HeldCoin>();
  const seed: HeldCoin[] = [];
  for (const [reel, symbols] of grid.entries()) {
    for (const [row, symbol] of symbols.entries()) {
      if (!scatters.has(symbol)) continue;
      const coin = { reel, row, value: drawValue() };
      held.set(`${reel},${row}`, coin);
      seed.push(coin);
    }
  }

  const steps: HoldSpinStep[] = [];
  let respins = feature.respins;
  while (respins > 0 && held.size < cells) {
    const gained: HeldCoin[] = [];
    for (const [reel, rows] of heights.entries()) {
      for (let row = 0; row < rows; row++) {
        if (held.has(`${reel},${row}`)) continue;
        // One draw per empty cell per respin, always, whether or not it lands.
        // Sampling only until the first hit would make the stream position
        // depend on the outcome and break replay.
        if (rng.next() >= feature.coinChance) continue;
        const coin = { reel, row, value: drawValue() };
        held.set(`${reel},${row}`, coin);
        gained.push(coin);
      }
    }
    respins = gained.length > 0 ? feature.respins : respins - 1;
    steps.push({ gained, respinsLeft: respins });
  }

  const full = held.size >= cells;
  let multiplier = 0;
  for (const coin of held.values()) multiplier += coin.value;
  if (full) multiplier += feature.fullBonus * scale;

  return { kind: 'hold-spin', seed, steps, full, multiplier };
}

/** Spin the wheel. One draw, one number, nothing to read. */
export function resolveWheel(
  feature: Extract<SlotFeature, { kind: 'wheel' }>,
  math: SlotMath,
  rng: RngStream,
): WheelOutcome {
  const index = weightedPick(feature.weights, rng);
  // Scaled for the same reason the coins are — see `resolveHoldSpin`.
  const multiplier = (feature.segments[index] ?? 0) * (math.payoutScale ?? 1);
  return { kind: 'wheel', index, multiplier };
}

/* ------------------------------------------------------------------ round */

export interface RoundOutcome {
  base: SpinResult;
  freeSpins: SpinResult[];
  freeSpinsAwarded: number;
  /** Present only when this model has a feature round and it triggered. */
  feature?: FeatureOutcome;
  /** Everything the round pays, as a multiple of the stake. */
  totalMultiplier: number;
}

/**
 * One complete round: the spin, whatever it triggered, and what it all paid.
 *
 * THE single definition. `SlotsEngine.init` plays it and the RTP tool measures
 * it, so the published return is by construction the return of the game that is
 * actually dealt.
 *
 * A feature round REPLACES free spins rather than stacking on top of them. Two
 * bonuses from one trigger is not a richer game, it is a return nobody can
 * reason about — and a hold-and-spin inside a multiplied free spin multiplies
 * twice, which is the same unbounded-loop problem the cascade model already
 * refuses.
 */
export function resolveRound(
  strips: readonly (readonly SlotSymbol[])[],
  math: SlotMath,
  rng: RngStream,
): RoundOutcome {
  const base = resolveSpin(strips, math, rng, 1);
  let totalMultiplier = base.totalMultiplier;

  const feature = math.feature;
  if (feature?.kind === 'hold-spin' && base.scatterCount >= feature.trigger) {
    const outcome = resolveHoldSpin(feature, math, base.grid, rng);
    return {
      base,
      freeSpins: [],
      freeSpinsAwarded: 0,
      feature: outcome,
      totalMultiplier: totalMultiplier + outcome.multiplier,
    };
  }
  if (feature?.kind === 'wheel' && base.scatterCount >= feature.trigger) {
    const outcome = resolveWheel(feature, math, rng);
    return {
      base,
      freeSpins: [],
      freeSpinsAwarded: 0,
      feature: outcome,
      totalMultiplier: totalMultiplier + outcome.multiplier,
    };
  }

  const freeSpinsAwarded = math.freeSpinsAwarded[base.scatterCount] ?? 0;
  const freeSpins: SpinResult[] = [];
  for (let i = 0; i < freeSpinsAwarded; i++) {
    const spin = resolveSpin(strips, math, rng, math.freeSpinMultiplier);
    freeSpins.push(spin);
    totalMultiplier += spin.totalMultiplier;
  }

  return { base, freeSpins, freeSpinsAwarded, totalMultiplier };
}
