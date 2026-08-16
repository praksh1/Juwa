/**
 * Tests for the instant games.
 *
 * The bias here is toward EXHAUSTIVE ANALYTIC checks over Monte Carlo. Every
 * one of these games has a closed-form return, so "simulate a million bets and
 * see if it looks about right" is the weaker instrument: it is slow, it is
 * flaky at the tails, and it passes when the edge is wrong by less than the
 * noise floor. Where the outcome space is small enough to enumerate — every
 * dice target, every mines cash-out point, every plinko bucket — the tests walk
 * all of it and assert the exact number.
 *
 * Monte Carlo is used for one thing only: confirming that the RNG actually
 * produces the distribution the closed form assumes.
 */

import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { minor } from '@juwa/money';
import { RngStream } from '../rng.js';
import { CrashEngine, LimboEngine } from './crash.js';
import { DiceEngine } from './dice.js';
import {
  DEFAULT_HOUSE_EDGE,
  DICE_OUTCOMES,
  MAX_MULTIPLIER,
  MINES_TILES,
  PLINKO_ROWS,
  crashPoint,
  minesMaxReveals,
  diceMultiplier,
  diceWinningOutcomes,
  minesMultiplier,
  plinkoBucketProbabilities,
  plinkoDrop,
  plinkoRtp,
  plinkoTable,
  truncate2,
  type PlinkoRisk,
  type PlinkoRows,
} from './instant-math.js';
import { MAX_MINES, MinesEngine, MIN_MINES } from './mines.js';
import { PlinkoEngine } from './plinko.js';
import { ScratchEngine, SCRATCH_OUTCOMES, scratchRtp } from './scratch.js';
import { toClientView, IllegalActionError, type GameEngine, type RoundState } from './types.js';

const RISKS: PlinkoRisk[] = ['low', 'medium', 'high'];
const TARGET_RTP = 1 - DEFAULT_HOUSE_EDGE;

function stream(nonce = 1, client = 'test-client'): RngStream {
  return new RngStream('a'.repeat(64), client, nonce);
}

// ---------------------------------------------------------------------------

describe('truncate2', () => {
  it('does not fall a tick short on values binary floating point cannot hold', () => {
    // 1.83 is stored as 1.8299999999999998, so a naive floor(x*100)/100 gives
    // 1.82. This is the whole reason the helper exists.
    for (const value of [1.83, 2.29, 4.56, 8.11, 1.07, 3.14, 100.03]) {
      assert.equal(truncate2(value), value, `truncate2(${value}) moved the value`);
    }
  });

  it('truncates toward zero rather than rounding to nearest', () => {
    assert.equal(truncate2(1.019), 1.01);
    assert.equal(truncate2(1.999), 1.99);
  });
});

// ---------------------------------------------------------------------------

describe('plinko tables', () => {
  it('every one of the fifteen holds exactly the target RTP', () => {
    for (const rows of PLINKO_ROWS) {
      for (const risk of RISKS) {
        const table = plinkoTable(rows, risk);
        const rtp = plinkoRtp(rows, table);
        assert.ok(
          Math.abs(rtp - TARGET_RTP) < 1e-9,
          `${rows} rows / ${risk}: RTP ${rtp}, expected ${TARGET_RTP}`,
        );
      }
    }
  });

  it('never pays more than the target in expectation', () => {
    // The rounding correction walks upward toward the target. If it ever
    // stepped past it the house edge would be negative on that table.
    for (const rows of PLINKO_ROWS) {
      for (const risk of RISKS) {
        assert.ok(plinkoRtp(rows, plinkoTable(rows, risk)) <= TARGET_RTP + 1e-12);
      }
    }
  });

  it('is left-right symmetric', () => {
    // A board paying 1.12x on the left and 1.11x on its mirror has the right
    // expected value and looks rigged. This is the regression guard for it.
    for (const rows of PLINKO_ROWS) {
      for (const risk of RISKS) {
        const table = plinkoTable(rows, risk);
        for (let i = 0; i < table.length; i++) {
          assert.equal(
            table[i],
            table[table.length - 1 - i],
            `${rows} rows / ${risk}: bucket ${i} and its mirror disagree`,
          );
        }
      }
    }
  });

  it('pays most at the edges and least in the middle', () => {
    for (const rows of PLINKO_ROWS) {
      for (const risk of RISKS) {
        const table = plinkoTable(rows, risk);
        const middle = Math.floor(table.length / 2);
        for (let i = 1; i <= middle; i++) {
          assert.ok(
            table[i]! <= table[i - 1]!,
            `${rows}/${risk}: bucket ${i} (${table[i]}) pays more than ${i - 1} (${table[i - 1]})`,
          );
        }
        assert.ok(table[0]! > 1, `${rows}/${risk}: the edge bucket should be a win`);
        assert.ok(table[middle]! < 1, `${rows}/${risk}: the centre bucket should be a loss`);
      }
    }
  });

  it('gets more extreme as risk rises', () => {
    for (const rows of PLINKO_ROWS) {
      const low = plinkoTable(rows, 'low');
      const medium = plinkoTable(rows, 'medium');
      const high = plinkoTable(rows, 'high');
      const middle = Math.floor(low.length / 2);
      assert.ok(low[0]! < medium[0]! && medium[0]! < high[0]!, `${rows}: edges should climb`);
      assert.ok(
        low[middle]! > medium[middle]! && medium[middle]! > high[middle]!,
        `${rows}: the centre should deepen`,
      );
    }
  });

  it('has one more bucket than it has rows', () => {
    for (const rows of PLINKO_ROWS) {
      assert.equal(plinkoTable(rows, 'medium').length, rows + 1);
    }
  });

  it('drops balls in the binomial distribution the tables assume', () => {
    // The one place Monte Carlo earns its keep: the tables are derived from
    // C(n,i)/2^n, and this checks the RNG actually delivers that.
    const rows: PlinkoRows = 8;
    const counts = new Array(rows + 1).fill(0);
    const trials = 200_000;
    for (let n = 0; n < trials; n++) {
      counts[plinkoDrop(stream(n), rows).bucket]++;
    }
    const expected = plinkoBucketProbabilities(rows);
    for (let i = 0; i <= rows; i++) {
      const observed = counts[i]! / trials;
      // Three standard errors, with a floor for the rare outer buckets.
      const se = Math.sqrt((expected[i]! * (1 - expected[i]!)) / trials);
      assert.ok(
        Math.abs(observed - expected[i]!) < 4 * se + 1e-4,
        `bucket ${i}: observed ${observed}, expected ${expected[i]}`,
      );
    }
  });

  it('returns a path whose right-steps equal the bucket index', () => {
    for (let n = 0; n < 500; n++) {
      const { path, bucket } = plinkoDrop(stream(n), 16);
      assert.equal(path.length, 16);
      assert.equal(path.filter((d) => d === 'R').length, bucket);
    }
  });
});

// ---------------------------------------------------------------------------

describe('dice', () => {
  it('holds the edge on every legal target, in both directions', () => {
    // All 10,000 targets × 2 directions, checked exactly rather than sampled.
    let worst = 1;
    let checked = 0;
    for (let ticks = 0; ticks < DICE_OUTCOMES; ticks++) {
      const target = ticks / 100;
      for (const direction of ['over', 'under'] as const) {
        let multiplier: number;
        try {
          multiplier = diceMultiplier(target, direction);
        } catch {
          continue; // Below the minimum payout, or unwinnable. Both rejected.
        }
        const rtp = (multiplier * diceWinningOutcomes(target, direction)) / DICE_OUTCOMES;
        assert.ok(
          rtp <= TARGET_RTP + 1e-12,
          `${direction} ${target}: RTP ${rtp} exceeds the target — negative house edge`,
        );
        worst = Math.min(worst, rtp);
        checked++;
      }
    }
    assert.ok(checked > 19_000, `only ${checked} targets were checked`);
    // The bound is a measurement, not a guess: 0.98990 is what four-decimal
    // truncation actually costs at its worst across all 20,000 bets. At two
    // decimals this was 0.979 — a 2.1% edge on the cheapest bets on the table,
    // which is what drove the switch to a finer grid.
    assert.ok(worst > 0.9899, `worst-case RTP was ${worst}`);
  });

  it('rejects bets that cannot lose or cannot win', () => {
    assert.throws(() => diceWinningOutcomes(0, 'under'), RangeError);
    assert.throws(() => diceWinningOutcomes(99.99, 'over'), RangeError);
    assert.throws(() => diceWinningOutcomes(100, 'over'), RangeError);
    assert.throws(() => diceWinningOutcomes(-1, 'under'), RangeError);
  });

  it('rejects the near-certain bets that pay nothing', () => {
    // 'under 99' wins 99% of the time and pays 1.00x: the player risks the
    // whole stake for no profit at all.
    assert.throws(() => diceMultiplier(99, 'under'), RangeError);
    assert.throws(() => diceMultiplier(1, 'over'), RangeError);
  });

  it('rejects targets finer than the two decimals it displays', () => {
    assert.throws(() => diceWinningOutcomes(50.005, 'over'), RangeError);
  });

  it('is symmetric: over t and under t pay the same when they cover the same count', () => {
    // over 50.00 wins on 5049 of 10000; under 50.00 wins on 5000. They are
    // deliberately different — the target itself loses both ways — and this
    // pins that behaviour down rather than letting it drift.
    assert.equal(diceWinningOutcomes(50, 'over'), 4999);
    assert.equal(diceWinningOutcomes(50, 'under'), 5000);
    assert.equal(diceWinningOutcomes(50, 'over') + diceWinningOutcomes(50, 'under') + 1, DICE_OUTCOMES);
  });

  it('settles a round consistently with the multiplier it quoted', () => {
    const engine = new DiceEngine();
    let wins = 0;
    const trials = 20_000;
    let returned = 0;
    for (let n = 0; n < trials; n++) {
      const rng = stream(n);
      const state = engine.act(engine.init(minor(100), rng), {
        type: 'roll', target: 50, direction: 'over',
      }, rng);
      const { roll, won, multiplier } = state.public;
      assert.equal(won, roll > 50, `roll ${roll} judged ${won}`);
      assert.equal(state.settlement!.payout, won ? Math.floor(100 * multiplier) : 0);
      if (won) wins++;
      returned += state.settlement!.payout;
    }
    const observed = wins / trials;
    const expected = diceWinningOutcomes(50, 'over') / DICE_OUTCOMES;
    assert.ok(Math.abs(observed - expected) < 0.015, `win rate ${observed} vs ${expected}`);
    const rtp = returned / (trials * 100);
    assert.ok(Math.abs(rtp - TARGET_RTP) < 0.03, `simulated RTP ${rtp}`);
  });
});

// ---------------------------------------------------------------------------

describe('mines', () => {
  it('holds the edge at every cash-out point of every mine count', () => {
    // Every (mines, revealed) pair — around 300 of them — checked exactly.
    let worst = 1;
    for (let mines = MIN_MINES; mines <= MAX_MINES; mines++) {
      const safeTiles = MINES_TILES - mines;
      for (let k = 1; k <= safeTiles; k++) {
        // Probability of surviving k picks: each pick draws from the tiles
        // still face down, of which the mines are always `mines`.
        let survive = 1;
        for (let i = 0; i < k; i++) survive *= (safeTiles - i) / (MINES_TILES - i);
        const rtp = minesMultiplier(mines, k) * survive;
        assert.ok(
          rtp <= TARGET_RTP + 1e-9,
          `${mines} mines, ${k} revealed: RTP ${rtp} exceeds target`,
        );
        worst = Math.min(worst, rtp);
      }
    }
    // Measured, and within 0.01% of the target at every one of the ~300 rungs.
    assert.ok(worst > 0.9899, `worst-case RTP was ${worst}`);
  });

  it('never offers a rung of the ladder it is not allowed to pay for', () => {
    // The regression guard for the worst bug this file found. Ten of the ~300
    // (mines, revealed) pairs are worth more than MAX_MULTIPLIER. Clamping the
    // payout there pays 19% RTP instead of 99% on the rarest run in the game;
    // the engine must decline to offer the pick instead.
    for (let mines = MIN_MINES; mines <= MAX_MINES; mines++) {
      const cap = minesMaxReveals(mines);
      assert.ok(cap >= 1, `${mines} mines: no playable depth at all`);
      assert.ok(
        minesMultiplier(mines, cap) <= MAX_MULTIPLIER,
        `${mines} mines: the deepest offered rung exceeds the cap`,
      );
      if (cap < MINES_TILES - mines) {
        assert.ok(
          minesMultiplier(mines, cap + 1) > MAX_MULTIPLIER,
          `${mines} mines: stopped at ${cap} but the next rung was payable`,
        );
      }
    }
  });

  it('settles itself rather than shortpaying when the ladder hits the cap', () => {
    const engine = new MinesEngine();
    const mines = 13; // The pair that exposed the bug: 12 reveals is worth 5.1M.
    const cap = minesMaxReveals(mines);
    assert.ok(cap < MINES_TILES - mines, 'this mine count should be cap-limited');

    const rng = stream(41);
    let state: RoundState<any, any> = engine.init(minor(100), rng);
    state = engine.act(state, { type: 'configure', mines }, rng);
    assert.equal(state.public.maxReveals, cap);

    const layout = state.private.order.slice(0, mines) as number[];
    const safe = Array.from({ length: MINES_TILES }, (_, i) => i).filter((t) => !layout.includes(t));
    for (let i = 0; i < cap; i++) {
      state = engine.act(state, { type: 'reveal', tile: safe[i]! }, rng);
    }
    assert.equal(state.status, 'settled', 'the round should end at the cap');
    assert.equal(state.settlement!.multiplier, minesMultiplier(mines, cap));
    assert.ok(
      state.settlement!.multiplier <= MAX_MULTIPLIER,
      'settled above the cap it exists to enforce',
    );
    // And the player got every coin the ladder advertised, not a clipped share.
    assert.equal(state.settlement!.payout, Math.floor(100 * minesMultiplier(mines, cap)));
  });

  it('cannot be beaten by choosing when to stop', () => {
    // The property players will look hardest for a hole in. At two decimals
    // there was one — cashing out early cost 0.6% more than going deep — which
    // is why the multipliers are on a four-decimal grid. The spread is now
    // under 0.02%, and it always favours the house.
    const mines = 3;
    const safeTiles = MINES_TILES - mines;
    const rtps: number[] = [];
    for (let k = 1; k <= safeTiles; k++) {
      let survive = 1;
      for (let i = 0; i < k; i++) survive *= (safeTiles - i) / (MINES_TILES - i);
      rtps.push(minesMultiplier(mines, k) * survive);
    }
    const spread = Math.max(...rtps) - Math.min(...rtps);
    assert.ok(spread < 0.0002, `cash-out point changes RTP by ${spread}`);
    assert.ok(Math.max(...rtps) <= TARGET_RTP + 1e-9, 'some cash-out point beats the house');
  });

  it('rejects impossible boards', () => {
    assert.throws(() => minesMultiplier(0, 1), RangeError);
    assert.throws(() => minesMultiplier(25, 1), RangeError);
    assert.throws(() => minesMultiplier(3, 23), RangeError);
  });

  it('plays a full round and pays the ladder it advertised', () => {
    const engine = new MinesEngine();
    const rng = stream(7);
    let state: RoundState<any, any> = engine.init(minor(100), rng);
    state = engine.act(state, { type: 'configure', mines: 3 }, rng);

    const layout = state.private.order.slice(0, 3) as number[];
    const safe = Array.from({ length: MINES_TILES }, (_, i) => i).filter((t) => !layout.includes(t));

    let expectedNext = state.public.nextMultiplier;
    for (let i = 0; i < 3; i++) {
      state = engine.act(state, { type: 'reveal', tile: safe[i]! }, rng);
      assert.equal(state.status, 'awaiting-action');
      assert.equal(state.public.multiplier, expectedNext, `pick ${i + 1} paid off the ladder`);
      expectedNext = state.public.nextMultiplier;
    }

    const quoted = state.public.multiplier;
    state = engine.act(state, { type: 'cashout' }, rng);
    assert.equal(state.status, 'settled');
    assert.equal(state.settlement!.multiplier, quoted);
    assert.equal(state.settlement!.payout, Math.floor(100 * quoted));
  });

  it('pays nothing on a mine and opens the board', () => {
    const engine = new MinesEngine();
    const rng = stream(11);
    let state: RoundState<any, any> = engine.init(minor(100), rng);
    state = engine.act(state, { type: 'configure', mines: 5 }, rng);
    const mine = state.private.order[0] as number;

    state = engine.act(state, { type: 'reveal', tile: mine }, rng);
    assert.equal(state.status, 'settled');
    assert.equal(state.public.bust, true);
    assert.equal(state.settlement!.payout, 0);
    assert.equal(state.public.minePositions.length, 5);
    assert.ok(state.public.minePositions.includes(mine));
  });

  it('never shows the mines before the round ends', () => {
    // The single most damaging thing this game could leak.
    const engine = new MinesEngine();
    const rng = stream(13);
    let state: RoundState<any, any> = engine.init(minor(100), rng);
    state = engine.act(state, { type: 'configure', mines: 5 }, rng);
    const layout = state.private.order.slice(0, 5) as number[];
    const safe = Array.from({ length: MINES_TILES }, (_, i) => i).filter((t) => !layout.includes(t));

    state = engine.act(state, { type: 'reveal', tile: safe[0]! }, rng);
    const view = toClientView(state) as Record<string, unknown>;
    assert.equal('private' in view, false, 'private state reached the client view');
    assert.deepEqual((view['public'] as any).minePositions, [], 'mines exposed mid-round');
    assert.equal(
      JSON.stringify(view).includes(`"order"`),
      false,
      'the shuffled order reached the client',
    );
  });

  it('settles itself once every safe tile is found', () => {
    const engine = new MinesEngine();
    const rng = stream(17);
    let state: RoundState<any, any> = engine.init(minor(100), rng);
    state = engine.act(state, { type: 'configure', mines: MAX_MINES }, rng);
    const safe = Array.from({ length: MINES_TILES }, (_, i) => i).find(
      (t) => !(state.private.order.slice(0, MAX_MINES) as number[]).includes(t),
    )!;
    state = engine.act(state, { type: 'reveal', tile: safe }, rng);
    assert.equal(state.status, 'settled');
    assert.equal(state.settlement!.multiplier, minesMultiplier(MAX_MINES, 1));
  });

  it('refuses to cash out before anything is revealed', () => {
    const engine = new MinesEngine();
    const rng = stream(19);
    let state: RoundState<any, any> = engine.init(minor(100), rng);
    state = engine.act(state, { type: 'configure', mines: 3 }, rng);
    assert.equal(state.availableActions.includes('cashout'), false);
    assert.throws(() => engine.act(state, { type: 'cashout' }, rng), IllegalActionError);
  });

  it('refuses to reveal the same tile twice', () => {
    const engine = new MinesEngine();
    const rng = stream(23);
    let state: RoundState<any, any> = engine.init(minor(100), rng);
    state = engine.act(state, { type: 'configure', mines: 1 }, rng);
    const safe = Array.from({ length: MINES_TILES }, (_, i) => i).filter(
      (t) => t !== state.private.order[0],
    );
    state = engine.act(state, { type: 'reveal', tile: safe[0]! }, rng);
    assert.throws(() => engine.act(state, { type: 'reveal', tile: safe[0]! }, rng), IllegalActionError);
  });

  it('rejects out-of-range mine counts and tiles', () => {
    const engine = new MinesEngine();
    const rng = stream(29);
    const opened = engine.init(minor(100), rng);
    assert.throws(() => engine.act(opened, { type: 'configure', mines: 0 }, rng), IllegalActionError);
    assert.throws(() => engine.act(opened, { type: 'configure', mines: 25 }, rng), IllegalActionError);
    assert.throws(() => engine.act(opened, { type: 'configure', mines: 2.5 }, rng), IllegalActionError);
    const ready = engine.act(opened, { type: 'configure', mines: 3 }, rng);
    assert.throws(() => engine.act(ready, { type: 'reveal', tile: 25 }, rng), IllegalActionError);
    assert.throws(() => engine.act(ready, { type: 'reveal', tile: -1 }, rng), IllegalActionError);
  });

  it('draws the board in init, so a replayed stream rebuilds the same one', () => {
    // `act` runs on a FRESH stream at the same nonce when it arrives as a
    // separate HTTP request. If the board were drawn in `act` it would be
    // redrawn from the same bytes — plausible-looking and completely wrong.
    const engine = new MinesEngine();
    const first = engine.init(minor(100), stream(31));
    const replayed = engine.init(minor(100), stream(31));
    assert.deepEqual(first.private.order, replayed.private.order);

    // And the layout must not depend on the mine count, which arrives later.
    const three = engine.act(engine.init(minor(100), stream(31)), { type: 'configure', mines: 3 }, stream(31));
    const five = engine.act(engine.init(minor(100), stream(31)), { type: 'configure', mines: 5 }, stream(31));
    assert.deepEqual(three.private.order, five.private.order);
  });

  it('places the mines uniformly', () => {
    const counts = new Array(MINES_TILES).fill(0);
    const engine = new MinesEngine();
    const trials = 100_000;
    const mines = 5;
    for (let n = 0; n < trials; n++) {
      const state = engine.init(minor(100), stream(n));
      for (const tile of state.private.order.slice(0, mines)) counts[tile]++;
    }
    const expected = (trials * mines) / MINES_TILES;
    for (let t = 0; t < MINES_TILES; t++) {
      assert.ok(
        Math.abs(counts[t]! - expected) / expected < 0.05,
        `tile ${t} held a mine ${counts[t]} times, expected about ${expected}`,
      );
    }
  });
});

// ---------------------------------------------------------------------------

describe('crash and limbo', () => {
  it('exceeds any target with probability (1 - edge) / target', () => {
    const trials = 300_000;
    const points: number[] = [];
    for (let n = 0; n < trials; n++) points.push(crashPoint(stream(n)));

    for (const target of [1.01, 1.5, 2, 5, 10]) {
      const observed = points.filter((p) => p >= target).length / trials;
      const expected = TARGET_RTP / target;
      const se = Math.sqrt((expected * (1 - expected)) / trials);
      assert.ok(
        Math.abs(observed - expected) < 4 * se,
        `target ${target}: P(win) ${observed}, expected ${expected}`,
      );
      // Which is the same statement as: the RTP is the same at every target.
      const rtp = observed * target;
      assert.ok(Math.abs(rtp - TARGET_RTP) < 0.02, `target ${target}: RTP ${rtp}`);
    }
  });

  it('fails to clear the minimum target at the rate the formula predicts', () => {
    // NOT the house edge, though it is tempting to assert that and it is what
    // this test originally claimed. The edge is the expected *loss* (1%); the
    // rate at which a round fails to reach even the lowest legal target of
    // 1.01x is 1 - 0.99/1.01, which is nearly twice as large. Both numbers are
    // correct and they describe different things.
    const expected = 1 - TARGET_RTP / 1.01;
    const trials = 200_000;
    let busts = 0;
    for (let n = 0; n < trials; n++) if (crashPoint(stream(n)) < 1.01) busts++;
    const rate = busts / trials;
    const se = Math.sqrt((expected * (1 - expected)) / trials);
    assert.ok(Math.abs(rate - expected) < 4 * se, `bust rate ${rate}, expected ${expected}`);
    // And the edge still comes out at 1% once the 1.01x payout is counted.
    assert.ok(Math.abs((1 - rate) * 1.01 - TARGET_RTP) < 0.005, 'the edge at minimum target');
  });

  it('never returns less than 1.00x or more than the cap', () => {
    for (let n = 0; n < 50_000; n++) {
      const p = crashPoint(stream(n));
      assert.ok(p >= 1 && p <= MAX_MULTIPLIER, `crash point ${p} out of range`);
      assert.equal(p, truncate2(p), `crash point ${p} is not on the two-decimal grid`);
    }
  });

  it('gives crash and limbo the same number for the same seed', () => {
    const crash = new CrashEngine();
    const limbo = new LimboEngine();
    for (let n = 0; n < 200; n++) {
      const a = crash.act(crash.init(minor(100), stream(n)), { type: 'set-target', target: 2 }, stream(n));
      const b = limbo.act(limbo.init(minor(100), stream(n)), { type: 'set-target', target: 2 }, stream(n));
      assert.equal(a.public.crashPoint, b.public.result);
      assert.equal(a.settlement!.payout, b.settlement!.payout);
    }
  });

  it('pays exactly the target on a win and nothing on a loss', () => {
    const engine = new CrashEngine();
    for (let n = 0; n < 2_000; n++) {
      const rng = stream(n);
      const state = engine.act(engine.init(minor(100), rng), { type: 'set-target', target: 2.5 }, rng);
      const { crashPoint: point, cashedOut } = state.public;
      assert.equal(cashedOut, point >= 2.5);
      assert.equal(state.settlement!.payout, cashedOut ? 250 : 0);
    }
  });

  it('rejects a target of 1.00x, which could never lose', () => {
    const engine = new LimboEngine();
    const rng = stream(1);
    const opened = engine.init(minor(100), rng);
    assert.throws(() => engine.act(opened, { type: 'set-target', target: 1 }, rng), IllegalActionError);
    assert.throws(() => engine.act(opened, { type: 'set-target', target: 0.5 }, rng), IllegalActionError);
  });

  it('rejects targets finer than the two decimals it displays', () => {
    const engine = new LimboEngine();
    const rng = stream(1);
    const opened = engine.init(minor(100), rng);
    assert.throws(() => engine.act(opened, { type: 'set-target', target: 1.005 }, rng), IllegalActionError);
  });

  it('rejects a missing or non-numeric target', () => {
    const engine = new CrashEngine();
    const rng = stream(1);
    const opened = engine.init(minor(100), rng);
    for (const target of [undefined, '2', null, NaN, Infinity]) {
      assert.throws(
        () => engine.act(opened, { type: 'set-target', target } as any, rng),
        IllegalActionError,
        `target ${String(target)} was accepted`,
      );
    }
  });
});

// ---------------------------------------------------------------------------

describe('golden scratch', () => {
  it('has the advertised exact 95% return', () => {
    assert.equal(scratchRtp(), 0.95);
    assert.deepEqual(
      SCRATCH_OUTCOMES.map(({ multiplier, weight }) => [multiplier, weight]),
      [[0, 59], [1, 21], [2, 12], [5, 6], [10, 2]],
    );
  });

  it('settles the paid prize during the server deal, before visual reveal', () => {
    const engine = new ScratchEngine();
    const stake = minor(500);
    const first = engine.init(stake, stream(71));
    const replayed = engine.init(stake, stream(71));

    assert.equal(first.status, 'settled');
    assert.equal(first.availableActions.length, 0);
    assert.deepEqual(first.public, replayed.public, 'same provably-fair stream must deal the same card');
    assert.equal(first.settlement!.stake, stake);
    assert.equal(first.settlement!.multiplier, first.public.multiplier);
    assert.equal(first.settlement!.payout, stake * first.public.multiplier);
    assert.equal(first.public.prizes.length, 3);
  });
});

// ---------------------------------------------------------------------------

describe('every action-based instant engine', () => {
  // Widened deliberately: the point of these tests is that the contract holds
  // regardless of which engine is behind it, so they must not depend on any
  // one engine's public shape.
  const engines: { engine: GameEngine<any, any, any>; action: Record<string, unknown> }[] = [
    { engine: new CrashEngine(), action: { type: 'set-target', target: 2 } },
    { engine: new LimboEngine(), action: { type: 'set-target', target: 2 } },
    { engine: new DiceEngine(), action: { type: 'roll', target: 50, direction: 'over' } },
    { engine: new PlinkoEngine(), action: { type: 'drop', rows: 16, risk: 'medium' } },
    { engine: new MinesEngine(), action: { type: 'configure', mines: 3 } },
  ];

  it('settles the stake it was opened with, never one named in the action', () => {
    // The API debits `settlement.stake`. An engine that believed a stake in the
    // action would let a client open a round for 50 coins and settle 500,000.
    for (const { engine, action } of engines) {
      const rng = stream(3);
      const opened = engine.init(minor(100), rng);
      const state = engine.act(opened, { ...action, stake: 500_000 } as any, rng);
      const stake = state.settlement?.stake ?? (state.private as any).stake;
      assert.equal(stake, 100, `${engine.id} took its stake from the action`);
    }
  });

  it('rejects an action it never offered', () => {
    for (const { engine } of engines) {
      const rng = stream(3);
      const opened = engine.init(minor(100), rng);
      assert.throws(
        () => engine.act(opened, { type: 'cash-all-out' }, rng),
        IllegalActionError,
        `${engine.id} accepted a made-up action`,
      );
    }
  });

  it('rejects a stake outside its limits', () => {
    for (const { engine } of engines) {
      assert.throws(() => engine.init(minor(1), stream(3)), /limits/i, `${engine.id} min`);
      assert.throws(() => engine.init(minor(50_000_000), stream(3)), /limits/i, `${engine.id} max`);
    }
  });

  it('is deterministic: same seed, same outcome', () => {
    for (const { engine, action } of engines) {
      const a = engine.act(engine.init(minor(100), stream(5)), action as any, stream(5));
      const b = engine.act(engine.init(minor(100), stream(5)), action as any, stream(5));
      assert.deepEqual(a.public, b.public, `${engine.id} is not reproducible`);
    }
  });

  it('produces different outcomes on different nonces', () => {
    // The complement of the test above: reproducible must not mean constant.
    const seen = new Set<string>();
    const engine = new LimboEngine();
    for (let n = 0; n < 100; n++) {
      const state = engine.act(engine.init(minor(100), stream(n)), { type: 'set-target', target: 2 }, stream(n));
      seen.add(String(state.public.result));
    }
    assert.ok(seen.size > 80, `only ${seen.size} distinct results in 100 nonces`);
  });

  it('declares the RTP it actually pays', () => {
    for (const { engine } of engines) {
      assert.ok(
        Math.abs(engine.rtp - TARGET_RTP) < 1e-9,
        `${engine.id} declares an RTP of ${engine.rtp}`,
      );
      assert.equal(engine.category, 'instant');
    }
  });

  it('never pays out on a settled round without a settlement', () => {
    for (const { engine, action } of engines) {
      const rng = stream(3);
      const state = engine.act(engine.init(minor(100), rng), action as any, rng);
      if (state.status === 'settled') {
        assert.ok(state.settlement, `${engine.id} settled without a settlement`);
        assert.ok(state.settlement!.payout >= 0, `${engine.id} paid a negative amount`);
        assert.ok(Number.isSafeInteger(state.settlement!.payout), `${engine.id} paid a fraction`);
      }
    }
  });
});

// ---------------------------------------------------------------------------

describe('plinko engine', () => {
  it('pays the bucket the ball landed in', () => {
    const engine = new PlinkoEngine();
    for (const rows of PLINKO_ROWS) {
      for (const risk of RISKS) {
        const rng = stream(rows + risk.length);
        const state = engine.act(engine.init(minor(100), rng), { type: 'drop', rows, risk }, rng);
        const { bucket, table, multiplier, path } = state.public;
        assert.equal(multiplier, table[bucket]);
        assert.equal(path.filter((d: string) => d === 'R').length, bucket);
        assert.equal(state.settlement!.payout, Math.floor(100 * multiplier));
      }
    }
  });

  it('rejects row counts and risk levels it does not offer', () => {
    const engine = new PlinkoEngine();
    const rng = stream(3);
    const opened = engine.init(minor(100), rng);
    assert.throws(() => engine.act(opened, { type: 'drop', rows: 9, risk: 'medium' }, rng), IllegalActionError);
    assert.throws(() => engine.act(opened, { type: 'drop', rows: 16, risk: 'insane' }, rng), IllegalActionError);
    assert.throws(() => engine.act(opened, { type: 'drop', rows: '16', risk: 'low' } as any, rng), IllegalActionError);
  });

  it('simulates to the RTP its table promises', () => {
    const engine = new PlinkoEngine();
    const trials = 100_000;
    let returned = 0;
    for (let n = 0; n < trials; n++) {
      const rng = stream(n);
      const state = engine.act(engine.init(minor(1000), rng), { type: 'drop', rows: 8, risk: 'low' }, rng);
      returned += state.settlement!.payout;
    }
    const rtp = returned / (trials * 1000);
    assert.ok(Math.abs(rtp - TARGET_RTP) < 0.01, `simulated RTP ${rtp}`);
  });
});
