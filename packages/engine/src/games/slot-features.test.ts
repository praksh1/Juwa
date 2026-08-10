import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RngStream } from '../rng.js';
import {
  buildStrips,
  expandWilds,
  type SlotMath,
  type SlotSymbol,
  type SymbolSpec,
} from './slot-math.js';
import { resolveHoldSpin, resolveRound, resolveWheel } from './slot-features.js';
import { SLOT_MODELS } from './slot-catalogue.js';

/**
 * A tiny model to test features against.
 *
 * Deliberately not one of the catalogue's: a test that asserts against a shipped
 * model fails the day that model is retuned, which trains everyone to update
 * assertions without reading them.
 */
function testMath(overrides: Partial<SlotMath> = {}): SlotMath {
  const symbols: SymbolSpec[] = [
    { id: 'WILD', kind: 'wild', weights: [1, 1, 1], pays: { 3: 50, 4: 0, 5: 0 } },
    { id: 'SCATTER', kind: 'scatter', weights: [1, 1, 1], pays: { 3: 0, 4: 0, 5: 0 } },
    { id: 'BELL', kind: 'normal', weights: [8, 8, 8], pays: { 3: 10, 4: 0, 5: 0 } },
  ];
  return {
    reels: 3,
    rows: 3,
    paylines: [[1, 1, 1]],
    symbols,
    scatterPays: {},
    freeSpinsAwarded: {},
    freeSpinMultiplier: 1,
    stripLength: 20,
    ...overrides,
  };
}

/* ------------------------------------------------------------ expanding wild */

test('a wild on an expanding reel fills that reel and nothing else', () => {
  const math = testMath({ feature: { kind: 'expanding-wild', reels: [1] } });
  const grid: SlotSymbol[][] = [
    ['BELL', 'BELL', 'BELL'],
    ['BELL', 'WILD', 'BELL'],
    ['BELL', 'WILD', 'BELL'],
  ];

  const { grid: after, expanded } = expandWilds(grid, math);

  assert.deepEqual(expanded, [1]);
  assert.deepEqual(after[1], ['WILD', 'WILD', 'WILD']);
  // Reel 2 also holds a wild but is not an expanding reel.
  assert.deepEqual(after[2], ['BELL', 'WILD', 'BELL']);
  assert.deepEqual(after[0], ['BELL', 'BELL', 'BELL']);
});

test('a reel that spun all wilds has not expanded', () => {
  // It would otherwise be reported as a feature that fired, and the client
  // would animate an expansion the player never got.
  const math = testMath({ feature: { kind: 'expanding-wild', reels: [0] } });
  const grid: SlotSymbol[][] = [
    ['WILD', 'WILD', 'WILD'],
    ['BELL', 'BELL', 'BELL'],
    ['BELL', 'BELL', 'BELL'],
  ];
  assert.deepEqual(expandWilds(grid, math).expanded, []);
});

test('a model with no feature never expands', () => {
  const grid: SlotSymbol[][] = [
    ['WILD', 'BELL', 'BELL'],
    ['BELL', 'BELL', 'BELL'],
    ['BELL', 'BELL', 'BELL'],
  ];
  assert.deepEqual(expandWilds(grid, testMath()).expanded, []);
});

/* --------------------------------------------------------------- hold & spin */

const HOLD = {
  kind: 'hold-spin',
  trigger: 3,
  respins: 3,
  coinChance: 0.05,
  values: [1, 5],
  weights: [1, 1],
  fullBonus: 100,
} as const;

test('the triggering scatters are the coins the round starts with', () => {
  const math = testMath({ feature: HOLD });
  const grid: SlotSymbol[][] = [
    ['SCATTER', 'BELL', 'BELL'],
    ['BELL', 'SCATTER', 'BELL'],
    ['BELL', 'BELL', 'SCATTER'],
  ];

  const out = resolveHoldSpin(HOLD, math, grid, new RngStream('t', 'hold', 1));

  assert.equal(out.seed.length, 3);
  assert.deepEqual(
    out.seed.map((c) => [c.reel, c.row]),
    [
      [0, 0],
      [1, 1],
      [2, 2],
    ],
  );
  for (const coin of out.seed) assert.ok(coin.value > 0, 'every coin carries a value');
});

test('the round ends after three respins that stick nothing', () => {
  // coinChance 0 means nothing can ever land, so the round must run down the
  // respin counter and stop — not loop.
  const feature = { ...HOLD, coinChance: 0 } as const;
  const math = testMath({ feature });
  const grid: SlotSymbol[][] = [
    ['SCATTER', 'BELL', 'BELL'],
    ['BELL', 'BELL', 'BELL'],
    ['BELL', 'BELL', 'BELL'],
  ];
  const out = resolveHoldSpin(feature, math, grid, new RngStream('t', 'hold', 2));

  assert.equal(out.steps.length, 3);
  assert.deepEqual(
    out.steps.map((s) => s.respinsLeft),
    [2, 1, 0],
  );
  assert.equal(out.full, false);
});

test('a coin that sticks puts the respins back to full', () => {
  // coinChance 1 fills every empty cell on the first respin, which both proves
  // the reset and lands on the full-grid path.
  const feature = { ...HOLD, coinChance: 1 } as const;
  const math = testMath({ feature });
  const grid: SlotSymbol[][] = [
    ['SCATTER', 'BELL', 'BELL'],
    ['BELL', 'BELL', 'BELL'],
    ['BELL', 'BELL', 'BELL'],
  ];
  const out = resolveHoldSpin(feature, math, grid, new RngStream('t', 'hold', 3));

  assert.equal(out.steps.length, 1);
  assert.equal(out.steps[0]?.gained.length, 8, 'the other eight cells all landed');
  assert.equal(out.steps[0]?.respinsLeft, 3, 'reset rather than decremented');
  assert.equal(out.full, true);
  // Nine coins worth at least 1 each, plus the 100 full-grid bonus.
  assert.ok(out.multiplier >= 109, `expected the full bonus, got ${out.multiplier}`);
});

test('coin values and the full bonus obey payoutScale', () => {
  const feature = { ...HOLD, coinChance: 1 } as const;
  const grid: SlotSymbol[][] = [
    ['SCATTER', 'BELL', 'BELL'],
    ['BELL', 'BELL', 'BELL'],
    ['BELL', 'BELL', 'BELL'],
  ];
  const plain = resolveHoldSpin(feature, testMath({ feature }), grid, new RngStream('t', 'h', 4));
  const scaled = resolveHoldSpin(
    feature,
    testMath({ feature, payoutScale: 0.5 }),
    grid,
    new RngStream('t', 'h', 4),
  );
  // Same seed, same coins, half the money — which is what keeps a model's
  // return linear in its scale and calibration a single division.
  assert.equal(scaled.multiplier, plain.multiplier * 0.5);
});

test('a hold-and-spin round is reproducible from its seed', () => {
  const math = testMath({ feature: HOLD });
  const grid: SlotSymbol[][] = [
    ['SCATTER', 'BELL', 'BELL'],
    ['BELL', 'SCATTER', 'BELL'],
    ['BELL', 'BELL', 'SCATTER'],
  ];
  const a = resolveHoldSpin(HOLD, math, grid, new RngStream('s', 'hold', 9));
  const b = resolveHoldSpin(HOLD, math, grid, new RngStream('s', 'hold', 9));
  assert.deepEqual(a, b);
});

/* --------------------------------------------------------------------- wheel */

const WHEEL = {
  kind: 'wheel',
  trigger: 3,
  segments: [2, 5, 50],
  weights: [90, 9, 1],
} as const;

test('the wheel always lands on a real segment', () => {
  const math = testMath({ feature: WHEEL });
  for (let i = 0; i < 200; i++) {
    const out = resolveWheel(WHEEL, math, new RngStream('t', 'wheel', i));
    assert.ok(out.index >= 0 && out.index < WHEEL.segments.length);
    assert.equal(out.multiplier, WHEEL.segments[out.index]);
  }
});

test('the wheel respects its weights', () => {
  const math = testMath({ feature: WHEEL });
  const counts = [0, 0, 0];
  for (let i = 0; i < 4_000; i++) {
    counts[resolveWheel(WHEEL, math, new RngStream('t', 'w', i)).index]!++;
  }
  // 90/9/1. Wide bands, because this is asserting that the weights are read at
  // all, not that 4,000 samples reproduce them precisely.
  assert.ok(counts[0]! > counts[1]!, 'the common segment is the most common');
  assert.ok(counts[1]! > counts[2]!, 'the jackpot segment is the rarest');
});

/* --------------------------------------------------------------------- round */

test('a feature round replaces free spins rather than stacking on them', () => {
  // Both are configured. Only one may ever pay, or the return becomes a number
  // nobody can reason about.
  const math = testMath({
    feature: WHEEL,
    scatterPays: { 3: 2 },
    freeSpinsAwarded: { 3: 10 },
    symbols: [
      { id: 'SCATTER', kind: 'scatter', weights: [1, 1, 1], pays: { 3: 0, 4: 0, 5: 0 } },
      { id: 'BELL', kind: 'normal', weights: [1, 1, 1], pays: { 3: 10, 4: 0, 5: 0 } },
    ],
  });
  const strips = buildStrips(math);

  let sawFeature = false;
  for (let i = 0; i < 400 && !sawFeature; i++) {
    const round = resolveRound(strips, math, new RngStream('t', 'round', i));
    if (!round.feature) continue;
    sawFeature = true;
    assert.equal(round.freeSpinsAwarded, 0);
    assert.deepEqual(round.freeSpins, []);
  }
  assert.ok(sawFeature, 'the feature never triggered — the test proved nothing');
});

test('every model the catalogue ships resolves a round without throwing', () => {
  for (const model of Object.values(SLOT_MODELS)) {
    const strips = buildStrips(model.math);
    for (let i = 0; i < 300; i++) {
      const round = resolveRound(strips, model.math, new RngStream('t', model.id, i));
      assert.ok(Number.isFinite(round.totalMultiplier), `${model.id} paid a non-number`);
      assert.ok(round.totalMultiplier >= 0, `${model.id} paid a negative amount`);
    }
  }
});

test('the models that declare a feature are the ones expected to have one', () => {
  // A guard on the DISTRIBUTION rather than on any one model: the complaint
  // this whole layer answers is that every game did the same thing when
  // something good happened, and that is a property of the catalogue as a
  // whole, not of any single entry.
  const kinds = new Map<string, string>();
  for (const model of Object.values(SLOT_MODELS)) {
    if (model.math.feature) kinds.set(model.id, model.math.feature.kind);
  }
  assert.deepEqual(
    Object.fromEntries(kinds),
    {
      'lines-10': 'expanding-wild',
      'high-vol': 'hold-spin',
      'classic-3x3': 'wheel',
    },
  );
});
