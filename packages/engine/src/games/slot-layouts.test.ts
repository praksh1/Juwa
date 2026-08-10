/**
 * The three mechanics that stopped every game being a 5x3.
 *
 * These are tested against hand-built grids rather than against the catalogue,
 * because the catalogue tests ask "does any model contradict itself" and these
 * ask "does the mechanic do the specific thing it claims". A ways win being
 * worth six times its rate because the symbol appears in six readable
 * combinations is not something a fuzz test will ever assert for you — it will
 * happily agree that a wrong number is self-consistent.
 */

import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { RngStream } from '../rng.js';
import {
  buildStrips,
  evaluateGrid,
  payDivisor,
  reelHeights,
  resolveSpin,
  type SlotMath,
  type SlotSymbol,
  type SymbolSpec,
} from './slot-math.js';

const SYMBOLS: SymbolSpec[] = [
  { id: 'WILD', kind: 'wild', weights: [1, 1, 1, 1, 1], pays: { 3: 10, 4: 20, 5: 40 } },
  { id: 'SCATTER', kind: 'scatter', weights: [1, 1, 1, 1, 1], pays: { 3: 0, 4: 0, 5: 0 } },
  { id: 'SEVEN', kind: 'normal', weights: [2, 2, 2, 2, 2], pays: { 3: 5, 4: 15, 5: 50 } },
  { id: 'BAR', kind: 'normal', weights: [4, 4, 4, 4, 4], pays: { 3: 2, 4: 6, 5: 20 } },
  { id: 'LEMON', kind: 'normal', weights: [8, 8, 8, 8, 8], pays: { 3: 1, 4: 3, 5: 10 } },
];

const DIAMOND: SlotMath = {
  reels: 5,
  rows: [3, 4, 5, 4, 3],
  paylines: 'ways',
  symbols: SYMBOLS,
  scatterPays: {},
  freeSpinsAwarded: {},
  freeSpinMultiplier: 1,
  stripLength: 30,
};

/**
 * Build a full ragged grid from a partial description.
 *
 * Missing reels and missing cells are filled with SCATTER, which pays nothing
 * here and substitutes for nothing, so anything a test does not state cannot
 * quietly contribute to what it measures.
 */
function grid(columns: SlotSymbol[][], fill: SlotSymbol = 'SCATTER'): SlotSymbol[][] {
  const heights = reelHeights(DIAMOND);
  return heights.map((height, reel) => {
    const out = [...(columns[reel] ?? [])];
    while (out.length < height) out.push(fill);
    return out;
  });
}

// ------------------------------------------------------------------- shape

test('a shape gives every reel its own height, a number gives them all one', () => {
  assert.deepEqual(reelHeights(DIAMOND), [3, 4, 5, 4, 3]);
  assert.deepEqual(reelHeights({ ...DIAMOND, rows: 3 }), [3, 3, 3, 3, 3]);
});

test('a shape that does not match the reel count is refused, not padded', () => {
  // Silently padding would produce a grid the paytable was never measured
  // against, and the return would move without anything looking wrong.
  assert.throws(() => reelHeights({ ...DIAMOND, rows: [3, 4, 5] }), /3 reels, expected 5/);
});

test('a spun ragged grid has the height its shape asked for on every reel', () => {
  const strips = buildStrips(DIAMOND);
  for (let n = 0; n < 50; n++) {
    const spun = resolveSpin(strips, DIAMOND, new RngStream('shape', 'diamond', n), 1);
    assert.deepEqual(spun.grid.map((reel) => reel.length), [3, 4, 5, 4, 3]);
  }
});

// -------------------------------------------------------------------- ways

test('a ways win multiplies by how many ways it can be read', () => {
  // BAR on two cells of reel one, three of reel two, one of reel three.
  // 2 x 3 x 1 = 6 ways at the three-of-a-kind rate of 2.
  const result = evaluateGrid(
    grid([
      ['BAR', 'BAR', 'LEMON'],
      ['BAR', 'BAR', 'BAR', 'LEMON'],
      ['BAR', 'LEMON', 'LEMON', 'LEMON', 'LEMON'],
    ]),
    DIAMOND,
    1,
  );
  const bar = result.lineWins.find((w) => w.symbol === 'BAR');
  assert.ok(bar, 'BAR should have paid');
  assert.equal(bar.count, 3);
  assert.equal(bar.multiplier, 2 * 6);
  // Every contributing cell is reported, not one per reel: the client dims
  // everything it is not given, and a ways win lights all of them.
  assert.equal(bar.cells.length, 6);
});

test('a ways run stops at the first reel without the symbol', () => {
  const result = evaluateGrid(
    grid([
      ['SEVEN', 'LEMON', 'LEMON'],
      ['SEVEN', 'LEMON', 'LEMON', 'LEMON'],
      ['SEVEN', 'LEMON', 'LEMON', 'LEMON', 'LEMON'],
      ['LEMON', 'LEMON', 'LEMON', 'LEMON'],
      // A fourth SEVEN beyond the gap must not be counted — the run already
      // ended, and counting it would pay a four-of-a-kind that is not there.
      ['SEVEN', 'SEVEN', 'SEVEN'],
    ]),
    DIAMOND,
    1,
  );
  const seven = result.lineWins.find((w) => w.symbol === 'SEVEN');
  assert.ok(seven);
  assert.equal(seven.count, 3);
  assert.equal(seven.multiplier, 5);
});

test('a wild substitutes in ways scoring but never pays for itself', () => {
  const all: SlotSymbol[][] = [
    ['WILD', 'WILD', 'WILD'],
    ['WILD', 'WILD', 'WILD', 'WILD'],
    ['WILD', 'WILD', 'WILD', 'WILD', 'WILD'],
    ['WILD', 'WILD', 'WILD', 'WILD'],
    ['WILD', 'WILD', 'WILD'],
  ];
  const wins = evaluateGrid(all, DIAMOND, 1).lineWins;
  assert.equal(
    wins.some((w) => w.symbol === 'WILD'),
    false,
    'WILD must not pay as itself, or a full grid of wilds settles twice over',
  );
  // It does still stand in for everything else, once each.
  assert.deepEqual(wins.map((w) => w.symbol).sort(), ['BAR', 'LEMON', 'SEVEN']);
  for (const win of wins) assert.equal(win.count, 5);
});

test('a ways game divides by one, a line game by its line count', () => {
  assert.equal(payDivisor(DIAMOND), 1);
  assert.equal(payDivisor({ ...DIAMOND, paylines: [[0, 0, 0], [1, 1, 1]] }), 2);
});

test('the ways divisor is what keeps the payout the right size', () => {
  /*
   * Guards a factor-of-720 error in the player's favour.
   *
   * A ways paytable is quoted against the whole stake, so the sum of the wins
   * IS the stake multiplier. Dividing it by a line count — which is what the
   * line-game path does, and what a careless merge would reinstate — would
   * make it look correct on a 20-line game and catastrophically wrong here.
   */
  const result = evaluateGrid(
    grid([['BAR', 'BAR', 'BAR'], ['BAR', 'BAR', 'BAR', 'BAR'], ['BAR', 'BAR', 'BAR', 'BAR', 'BAR']]),
    DIAMOND,
    1,
  );
  const ways = 3 * 4 * 5;
  assert.equal(result.totalMultiplier, 2 * ways);
});

// ---------------------------------------------------------------- cascades

const TUMBLE: SlotMath = {
  reels: 3,
  rows: 3,
  paylines: [[0, 0, 0], [1, 1, 1], [2, 2, 2]],
  symbols: SYMBOLS.filter((s) => s.kind !== 'wild'),
  scatterPays: {},
  freeSpinsAwarded: {},
  freeSpinMultiplier: 1,
  stripLength: 24,
  cascade: { ladder: [2, 3], maxDrops: 4 },
};

test('a model without a cascade block never produces one', () => {
  const strips = buildStrips(DIAMOND);
  for (let n = 0; n < 30; n++) {
    const spun = resolveSpin(strips, DIAMOND, new RngStream('nocascade', 'd', n), 1);
    assert.deepEqual(spun.cascades, []);
  }
});

test('a cascade fires, climbs the ladder and respects its cap', () => {
  const strips = buildStrips(TUMBLE);
  let sawCascade = false;
  for (let n = 0; n < 400; n++) {
    const spun = resolveSpin(strips, TUMBLE, new RngStream('cascade', 'tumble', n), 1);
    assert.ok(spun.cascades.length <= TUMBLE.cascade!.maxDrops, 'cascade ran past its cap');

    for (const [i, step] of spun.cascades.entries()) {
      sawCascade = true;
      // Past the end of the ladder every further drop pays at the top rate.
      const expected = TUMBLE.cascade!.ladder[Math.min(i, TUMBLE.cascade!.ladder.length - 1)];
      assert.equal(step.stepMultiplier, expected);
      // A step is only recorded when it paid; a dry drop ends the chain.
      assert.ok(step.lineWins.length > 0, 'a recorded cascade step paid nothing');
      assert.ok(step.totalMultiplier > 0);
      assert.deepEqual(step.grid.map((reel) => reel.length), [3, 3, 3]);
    }
  }
  assert.ok(sawCascade, 'no cascade occurred in 400 spins — the test proves nothing');
});

test('the total includes the cascades rather than only the first grid', () => {
  const strips = buildStrips(TUMBLE);
  for (let n = 0; n < 400; n++) {
    const spun = resolveSpin(strips, TUMBLE, new RngStream('cascade', 'tumble', n), 1);
    if (spun.cascades.length === 0) continue;

    const first = evaluateGrid(spun.grid, TUMBLE, 1).totalMultiplier;
    const drops = spun.cascades.reduce((sum, step) => sum + step.totalMultiplier, 0);
    assert.ok(
      Math.abs(spun.totalMultiplier - (first + drops)) < 1e-9,
      `total ${spun.totalMultiplier} is not the first grid plus its drops`,
    );
    // The whole point of the mechanic: a chain is worth more than the same
    // wins would have been without one.
    assert.ok(spun.totalMultiplier > first);
    return;
  }
  assert.fail('no cascade occurred in 400 spins');
});

test('symbols that paid are gone from the next grid, and survivors fall', () => {
  const strips = buildStrips(TUMBLE);
  for (let n = 0; n < 400; n++) {
    const spun = resolveSpin(strips, TUMBLE, new RngStream('cascade', 'tumble', n), 1);
    if (spun.cascades.length === 0) continue;

    const cleared = new Set<string>();
    for (const win of spun.lineWins) for (const [r, row] of win.cells) cleared.add(`${r},${row}`);

    const before = spun.grid;
    const after = spun.cascades[0]!.grid;
    for (let reel = 0; reel < TUMBLE.reels; reel++) {
      // Survivors keep their order and sit at the BOTTOM. Anything else and
      // the animation would have symbols passing through each other.
      const survivors = before[reel]!.filter((_, row) => !cleared.has(`${reel},${row}`));
      const landed = after[reel]!.slice(after[reel]!.length - survivors.length);
      assert.deepEqual(landed, survivors, `reel ${reel} did not drop its survivors intact`);
    }
    return;
  }
  assert.fail('no cascade occurred in 400 spins');
});
