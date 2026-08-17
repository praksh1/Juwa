/**
 * Does every game pay what its paytable says it pays?
 *
 * ## Why this exists and why it is not the other slot tests
 *
 * The existing suites check that the engine agrees with itself: that a seed
 * replays, that the return to player sits in its published band, that a
 * catalogue entry is well-formed. All of those import `evaluateGrid` and are
 * therefore blind to the one question a player actually asks — *"the screen
 * says BELL pays 22, three bells landed, so why did I get that?"*
 *
 * A test that calls the engine to predict what the engine will do proves the
 * engine is deterministic. It cannot prove the engine is RIGHT.
 *
 * So nothing below imports the evaluator. `evaluateGrid`, `evaluateWays`,
 * `evaluateLine`, `resolveSpin` and `resolveRound` are all absent on purpose.
 * What this file imports is the DATA — the same paytable the app renders and
 * the player reads — and it recomputes every payout from that, declaratively,
 * the way the rules screen states them. Then it plays tens of thousands of real
 * rounds through the real engine and demands the two agree to the last
 * decimal.
 *
 * ## The declarative rule, in full
 *
 * For a LINE game, reading each payline from reel one inward:
 *
 *   - a symbol pays when it occupies an unbroken run from the leftmost reel;
 *   - WILD stands in for any symbol except SCATTER;
 *   - the line pays the BEST reading available on it, over every symbol on the
 *     paytable — not the first one found, not the one the code happened to
 *     consider (see `bestLineReading`, which is where those differ);
 *   - three in a row is the minimum;
 *   - the rate is `pays[min(count, 5)]`, quoted per LINE, so the sum across
 *     lines is divided by the line count to become a stake multiple.
 *
 * For a WAYS game there are no lines: a symbol pays when it appears at least
 * once on each of the first N reels, multiplied by the number of readings —
 * the product of its occurrences per reel. WILD substitutes and does not pay
 * for itself.
 *
 * SCATTER pays from anywhere against the TOTAL stake, so it is never divided.
 * `payoutScale` multiplies everything (it is folded into the figures the app
 * displays — see the generator).
 *
 * ## What is also checked, because a right total can still be a wrong machine
 *
 *   - every cell the server says it lit really holds that symbol or a wild;
 *   - every reel really is a window onto its own strip, so nothing was paid
 *     for a symbol the reels could not have stopped on;
 *   - free spins are awarded by the scatter table and multiplied by the stated
 *     multiplier;
 *   - a feature round fires exactly on its trigger and pays its own table;
 *   - the MONEY equals the multiplier: `floor(stake x total)`, at stakes from
 *     one unit to the game's own maximum.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { minor, type Minor } from '@juwa/money';
import { RngStream } from '../rng.js';
import { SLOT_CATALOGUE, slotModel } from './slot-catalogue.js';
import { SlotsEngine } from './slots.js';
import {
  buildStrips,
  reelHeights,
  type SlotMath,
  type SlotSymbol,
  type SymbolSpec,
} from './slot-math.js';

/**
 * Rounds per game.
 *
 * `npm test` runs a few hundred so the ordinary build stays quick; the
 * dedicated `npm run test:payouts` raises it into the thousands the founder
 * asked for. Both use the same code and the same assertions — only the sample
 * size moves.
 */
const ROUNDS = Number(process.env['PAYOUT_AUDIT_ROUNDS'] ?? 400);

/** Stakes to settle at, so rounding is exercised and not assumed. */
function stakesFor(min: number, max: number): Minor[] {
  return [minor(min), minor(min + 1), minor(Math.floor((min + max) / 2)), minor(max)];
}

// ---------------------------------------------------------------- the rules

function payFor(spec: SymbolSpec, count: number): number {
  return spec.pays[Math.min(count, 5) as 3 | 4 | 5] ?? 0;
}

function wildIds(math: SlotMath): Set<SlotSymbol> {
  return new Set(math.symbols.filter((s) => s.kind === 'wild').map((s) => s.id));
}

function scatterIds(math: SlotMath): Set<SlotSymbol> {
  return new Set(math.symbols.filter((s) => s.kind === 'scatter').map((s) => s.id));
}

/**
 * The best reading of one payline, over EVERY symbol on the paytable.
 *
 * This is deliberately not how the engine does it. The engine narrows the
 * candidates to the line's first symbol and the first normal symbol appearing
 * anywhere along it, which is an optimisation that happens to be correct in
 * every case anyone had thought about. Trying all of them is what makes this a
 * check rather than a copy: if a line ever reads higher for a symbol the
 * engine did not consider, the machine paid a player less than its own
 * paytable promised, and that difference shows up here as a failure rather
 * than as a complaint.
 */
function bestLineReading(
  line: readonly SlotSymbol[],
  math: SlotMath,
): { symbol: SlotSymbol; count: number; rate: number } | null {
  const wild = wildIds(math);
  let best: { symbol: SlotSymbol; count: number; rate: number } | null = null;

  for (const spec of math.symbols) {
    // Scatters pay from anywhere and never along a line.
    if (spec.kind === 'scatter') continue;

    let count = 0;
    for (const symbol of line) {
      const substitutes = wild.has(symbol) && spec.kind !== 'wild';
      if (symbol === spec.id || substitutes) count += 1;
      else break;
    }
    if (count < 3) continue;

    const rate = payFor(spec, count);
    if (rate > 0 && (best === null || rate > best.rate)) {
      best = { symbol: spec.id, count, rate };
    }
  }
  return best;
}

/** Every ways win on a grid: symbol, run length, and the product of readings. */
function waysReadings(
  grid: readonly (readonly SlotSymbol[])[],
  math: SlotMath,
): { symbol: SlotSymbol; count: number; rate: number }[] {
  const wild = wildIds(math);
  const out: { symbol: SlotSymbol; count: number; rate: number }[] = [];

  for (const spec of math.symbols) {
    // WILD does not pay for itself on a ways game. If it did, a grid of wilds
    // would pay once as WILD and again as every symbol it substitutes for,
    // over the same cells.
    if (spec.kind !== 'normal') continue;

    let ways = 1;
    let run = 0;
    for (let reel = 0; reel < math.reels; reel += 1) {
      const hits = (grid[reel] ?? []).filter((s) => s === spec.id || wild.has(s)).length;
      if (hits === 0) break;
      ways *= hits;
      run += 1;
    }
    if (run < 3) continue;

    const rate = payFor(spec, run);
    if (rate > 0) out.push({ symbol: spec.id, count: run, rate: rate * ways });
  }
  return out;
}

/** What one grid is worth, as a stake multiple, at a given win multiplier. */
function gridValue(
  grid: readonly (readonly SlotSymbol[])[],
  math: SlotMath,
  winMultiplier: number,
): { lines: number; scatter: number; total: number; scatterCount: number } {
  const scale = math.payoutScale ?? 1;

  let rateSum = 0;
  if (math.paylines === 'ways') {
    for (const win of waysReadings(grid, math)) rateSum += win.rate;
  } else {
    for (const line of math.paylines) {
      const cells = line.map((row, reel) => grid[reel]?.[row] as SlotSymbol);
      const win = bestLineReading(cells, math);
      if (win) rateSum += win.rate;
    }
  }

  const scatters = scatterIds(math);
  let scatterCount = 0;
  for (const reel of grid) for (const symbol of reel) if (scatters.has(symbol)) scatterCount += 1;

  // Line pays are per LINE; scatter pays are against the TOTAL stake. Dividing
  // the wrong one of these is a factor-of-twenty error in someone's favour.
  const divisor = math.paylines === 'ways' ? 1 : math.paylines.length;
  const lines = (rateSum * winMultiplier * scale) / divisor;
  const scatter = (math.scatterPays[scatterCount] ?? 0) * winMultiplier * scale;

  return { lines, scatter, total: lines + scatter, scatterCount };
}

/** Floating point: multipliers are sums of products, so compare relatively. */
function close(actual: number, expected: number): boolean {
  return Math.abs(actual - expected) <= 1e-9 * Math.max(1, Math.abs(expected));
}

// -------------------------------------------------------------- the audit

interface Counters {
  rounds: number;
  grids: number;
  lineWins: number;
  featureRounds: number;
  freeSpinRounds: number;
  cascadeSteps: number;
}

/**
 * Check one spin — the grid, every win reported on it, and its cascades.
 *
 * `winMultiplier` is 1 in the base game and the free-spin multiplier during a
 * bonus round, which is the only thing that changes about how a spin is read.
 */
function auditSpin(
  where: string,
  spin: {
    grid: SlotSymbol[][];
    lineWins: readonly { line: number; symbol: SlotSymbol; count: number; multiplier: number; cells: readonly (readonly [number, number])[] }[];
    scatterCount: number;
    scatterMultiplier: number;
    totalMultiplier: number;
    cascades: readonly { grid: SlotSymbol[][]; lineWins: readonly unknown[]; stepMultiplier: number; totalMultiplier: number }[];
    expandedReels: readonly number[];
  },
  math: SlotMath,
  strips: readonly (readonly SlotSymbol[])[],
  winMultiplier: number,
  counters: Counters,
): void {
  const heights = reelHeights(math);
  const wild = wildIds(math);
  counters.grids += 1;

  // ---- the grid is a real stop on the real strips
  assert.equal(spin.grid.length, math.reels, `${where}: reel count`);
  for (const [reel, column] of spin.grid.entries()) {
    assert.equal(column.length, heights[reel], `${where}: reel ${reel} height`);

    // An expanded reel was overwritten with wilds after the stop, so it is not
    // a window any more — by design. See `expandWilds`.
    if (spin.expandedReels.includes(reel)) {
      assert.ok(
        column.every((s) => wild.has(s)),
        `${where}: reel ${reel} was reported as expanded but is not all wild`,
      );
      continue;
    }

    const strip = strips[reel]!;
    const stops: number[] = [];
    for (let stop = 0; stop < strip.length; stop += 1) {
      let matches = true;
      for (let row = 0; row < column.length; row += 1) {
        if (strip[(stop + row) % strip.length] !== column[row]) {
          matches = false;
          break;
        }
      }
      if (matches) stops.push(stop);
    }
    assert.ok(
      stops.length > 0,
      `${where}: reel ${reel} shows ${column.join('/')}, which is not a window on its strip`,
    );
  }

  // ---- every reported win is justified by the symbols on screen
  for (const win of spin.lineWins) {
    counters.lineWins += 1;
    for (const [reel, row] of win.cells) {
      const symbol = spin.grid[reel]?.[row];
      assert.ok(
        symbol === win.symbol || wild.has(symbol as SlotSymbol),
        `${where}: paid ${win.symbol} at [${reel},${row}] which holds ${symbol}`,
      );
    }
    if (math.paylines !== 'ways') {
      assert.equal(
        win.cells.length,
        win.count,
        `${where}: lit ${win.cells.length} cells for a ${win.count}-of-a-kind`,
      );
      const line = math.paylines[win.line];
      assert.ok(line, `${where}: win on payline ${win.line}, which does not exist`);
      for (const [i, [reel, row]] of win.cells.entries()) {
        assert.equal(reel, i, `${where}: win cells must run from reel one`);
        assert.equal(row, line![reel], `${where}: cell [${reel},${row}] is off payline ${win.line}`);
      }
    }
  }

  // ---- the arithmetic, from the paytable
  const expected = gridValue(spin.grid, math, winMultiplier);
  assert.equal(spin.scatterCount, expected.scatterCount, `${where}: scatter count`);
  assert.ok(
    close(spin.scatterMultiplier, expected.scatter),
    `${where}: scatter pay ${spin.scatterMultiplier} but the table says ${expected.scatter}`,
  );

  // What the engine actually credited for lines, back out of its own total.
  const paidLines = spin.totalMultiplier - spin.scatterMultiplier;
  const cascadeTotal = spin.cascades.reduce((sum, step) => sum + step.totalMultiplier, 0);
  assert.ok(
    close(paidLines - cascadeTotal, expected.lines),
    `${where}: line pays ${paidLines - cascadeTotal} but the paytable says ${expected.lines}`,
  );

  // ---- each tumble, at its own rung on the ladder
  for (const [drop, step] of spin.cascades.entries()) {
    counters.cascadeSteps += 1;
    const ladder = math.cascade?.ladder ?? [];
    const rung = ladder[Math.min(drop, ladder.length - 1)] ?? 1;
    assert.equal(step.stepMultiplier, rung, `${where}: drop ${drop} paid at the wrong rung`);

    const dropValue = gridValue(step.grid, math, winMultiplier * rung);
    // Scatters are counted and paid once, on the first grid.
    assert.ok(
      close(step.totalMultiplier, dropValue.lines),
      `${where}: drop ${drop} paid ${step.totalMultiplier}, table says ${dropValue.lines}`,
    );
    assert.ok(step.lineWins.length > 0, `${where}: drop ${drop} was recorded but paid nothing`);
  }
}

for (const definition of SLOT_CATALOGUE) {
  test(`${definition.name} pays exactly what its paytable says`, (t) => {
    const model = slotModel(definition);
    const math = model.math;
    const strips = buildStrips(math);
    const engine = new SlotsEngine(definition);
    const stakes = stakesFor(definition.limits.min, definition.limits.max);

    const counters: Counters = {
      rounds: 0,
      grids: 0,
      lineWins: 0,
      featureRounds: 0,
      freeSpinRounds: 0,
      cascadeSteps: 0,
    };

    for (let i = 0; i < ROUNDS; i += 1) {
      const stake = stakes[i % stakes.length]!;
      const state = engine.init(stake, new RngStream('audit', definition.id, i));
      const round = state.public;
      counters.rounds += 1;
      const where = `${definition.id} round ${i}`;

      auditSpin(`${where} base`, round.baseSpin, math, strips, 1, counters);

      // ---- the bonus: one or the other, never both, and only on its trigger
      const scatters = round.baseSpin.scatterCount;
      const feature = math.feature;
      const featureTriggered =
        (feature?.kind === 'hold-spin' || feature?.kind === 'wheel') &&
        scatters >= feature.trigger;

      let featureValue = 0;
      if (round.feature) {
        counters.featureRounds += 1;
        assert.ok(featureTriggered, `${where}: a feature fired without its trigger`);
        assert.equal(round.freeSpinsAwarded, 0, `${where}: a feature round also awarded free spins`);

        if (round.feature.kind === 'wheel') {
          assert.equal(feature?.kind, 'wheel', `${where}: wheel outcome on a non-wheel model`);
          const segments = feature.kind === 'wheel' ? feature.segments : [];
          const segment = segments[round.feature.index];
          assert.ok(segment !== undefined, `${where}: wheel stopped on segment ${round.feature.index}, which does not exist`);
          assert.equal(
            round.feature.multiplier,
            segment,
            `${where}: wheel paid ${round.feature.multiplier} for a segment marked ${segment}`,
          );
        } else {
          assert.equal(feature?.kind, 'hold-spin', `${where}: hold-spin outcome on another model`);
          const held = new Map<string, number>();
          for (const coin of round.feature.seed) held.set(`${coin.reel},${coin.row}`, coin.value);
          for (const step of round.feature.steps) {
            for (const coin of step.gained) {
              assert.ok(
                !held.has(`${coin.reel},${coin.row}`),
                `${where}: a coin landed on a cell that was already held`,
              );
              held.set(`${coin.reel},${coin.row}`, coin.value);
            }
          }
          // Every coin's value must be one the model can actually award, and
          // every seed coin must sit on a scatter in the triggering grid.
          const values = feature.kind === 'hold-spin' ? feature.values : [];
          const scatterSet = scatterIds(math);
          for (const coin of round.feature.seed) {
            assert.ok(
              scatterSet.has(round.baseSpin.grid[coin.reel]?.[coin.row] as SlotSymbol),
              `${where}: a seed coin sits at [${coin.reel},${coin.row}] which is not a scatter`,
            );
          }
          for (const value of held.values()) {
            assert.ok(values.includes(value), `${where}: awarded a coin worth ${value}, which is not on the model`);
          }

          const cells = reelHeights(math).reduce((sum, rows) => sum + rows, 0);
          assert.equal(round.feature.full, held.size >= cells, `${where}: "full grid" disagrees with the coins held`);

          let expected = 0;
          for (const value of held.values()) expected += value;
          if (round.feature.full) expected += feature.kind === 'hold-spin' ? feature.fullBonus : 0;
          assert.ok(
            close(round.feature.multiplier, expected),
            `${where}: hold-and-spin paid ${round.feature.multiplier}, coins add to ${expected}`,
          );
        }
        featureValue = round.feature.multiplier;
      } else {
        assert.ok(!featureTriggered, `${where}: the trigger landed and no feature was played`);
      }

      // ---- free spins, awarded by the scatter table and multiplied as stated
      const owed = round.feature ? 0 : math.freeSpinsAwarded[scatters] ?? 0;
      assert.equal(round.freeSpinsAwarded, owed, `${where}: free spins awarded`);
      assert.equal(round.freeSpins.length, owed, `${where}: free spins played`);
      if (owed > 0) counters.freeSpinRounds += 1;

      for (const [n, spin] of round.freeSpins.entries()) {
        auditSpin(`${where} free spin ${n}`, spin, math, strips, math.freeSpinMultiplier, counters);
      }

      // ---- the round, and then the money
      const expectedTotal =
        round.baseSpin.totalMultiplier +
        round.freeSpins.reduce((sum, spin) => sum + spin.totalMultiplier, 0) +
        featureValue;
      assert.ok(
        close(round.totalMultiplier, expectedTotal),
        `${where}: round paid ${round.totalMultiplier}, its parts add to ${expectedTotal}`,
      );

      const settlement = state.settlement!;
      assert.equal(settlement.stake, stake, `${where}: settled a different stake`);
      assert.equal(
        settlement.payout,
        Math.floor(stake * round.totalMultiplier),
        `${where}: paid ${settlement.payout} for ${round.totalMultiplier}x of ${stake}`,
      );
      assert.ok(
        settlement.payout >= 0 && Number.isSafeInteger(settlement.payout),
        `${where}: payout ${settlement.payout} is not a whole number of coins`,
      );
    }

    // A game whose audit never saw a win has not been audited. This has caught
    // nothing yet and exists so that a future change which quietly stops the
    // engine paying cannot pass as "no failures".
    assert.ok(
      counters.lineWins > 0,
      `${definition.id}: ${counters.rounds} rounds produced no wins at all`,
    );

    // Printed so a passing run says how much it actually looked at. "All
    // green" over four rounds and over four hundred thousand are different
    // statements and should not read the same in a log.
    t.diagnostic(
      `${counters.rounds} rounds, ${counters.grids} grids, ${counters.lineWins} wins, ` +
        `${counters.freeSpinRounds} bonus rounds, ${counters.featureRounds} feature rounds, ` +
        `${counters.cascadeSteps} tumbles`,
    );
  });
}
