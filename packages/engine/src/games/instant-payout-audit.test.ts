/**
 * The instant and table games, at volume.
 *
 * ## What this adds to `instant-games.test.ts`
 *
 * That suite already checks the payout rules properly — that Plinko pays the
 * bucket the ball landed in, that Dice settles at the multiplier it quoted,
 * that Mines pays the ladder it advertised, that a straight-up roulette number
 * returns 36x. It checks each of those on a handful of rounds, which is the
 * right shape for a rule and the wrong shape for a promise about money.
 *
 * A rule that holds for one round and fails for one in ten thousand is exactly
 * the kind of thing nobody finds by reading. So this plays every game
 * repeatedly, in every configuration it offers, and asserts on each settlement
 * that the coins paid are the coins the published table owes — to the unit,
 * with no tolerance, at stakes from the table minimum to its maximum.
 *
 * ## Where the numbers come from
 *
 * `@juwa/economy` holds every instant payout table, and it holds them because
 * the APP needs them: a Dice slider has to print "1.98x" while the player is
 * dragging it, and a Plinko board has to label its buckets before the first
 * ball drops. One table, read by the client that quotes the price and by the
 * server that settles it — so this audit reads the same one, and a drift
 * between quote and settlement is impossible by construction rather than by
 * convention. That is the design; this checks that the settlement code honours
 * it.
 *
 * Roulette is the exception worth stating: its odds live in the engine, and
 * each winning bet is floored SEPARATELY before the payouts are summed. Six
 * winning bets can therefore lose six fractions of a coin, and the round's
 * reported multiplier is a derived ratio rather than a promise. The audit
 * below recomputes the per-bet arithmetic rather than the ratio, because the
 * per-bet arithmetic is what the money is.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { minor, mul, type Minor } from '@juwa/money';
import {
  PLINKO_ROWS,
  diceMultiplier,
  minesMultiplier,
  plinkoTable,
  type PlinkoRows,
} from '@juwa/economy';
import { RngStream } from '../rng.js';
import { CrashEngine, LimboEngine } from './crash.js';
import { DiceEngine } from './dice.js';
import { PlinkoEngine } from './plinko.js';
import { MinesEngine } from './mines.js';
import { RouletteEngine, ROULETTE_ODDS } from './roulette.js';

/** Rounds per configuration. Raised by `npm run test:payouts`. */
const ROUNDS = Number(process.env['PAYOUT_AUDIT_ROUNDS'] ?? 400);

const stream = (n: number) => new RngStream('audit', 'instant', n);

/** Stakes that exercise the flooring rather than dividing evenly. */
function stakes(min: number, max: number): Minor[] {
  return [minor(min), minor(min + 1), minor(min + 333), minor(Math.floor(max / 3)), minor(max)];
}

const RISKS = ['low', 'medium', 'high'] as const;

test('Plinko pays the bucket, every drop', () => {
  const engine = new PlinkoEngine();
  const bets = stakes(engine.limits.min, engine.limits.max);
  let drops = 0;

  for (const rows of PLINKO_ROWS) {
    for (const risk of RISKS) {
      const table = plinkoTable(rows as PlinkoRows, risk);
      for (let n = 0; n < ROUNDS; n += 1) {
        const stake = bets[n % bets.length]!;
        const rng = stream(n);
        const state = engine.act(engine.init(stake, rng), { type: 'drop', rows, risk }, rng);
        const shown = state.public as { bucket: number; multiplier: number; path: string[] };
        drops += 1;

        // The ball's own path decides the bucket — this is what makes a drop
        // replayable from the seed rather than merely reported.
        assert.equal(
          shown.path.filter((d) => d === 'R').length,
          shown.bucket,
          `${rows}/${risk}: the path does not end in the bucket that was paid`,
        );
        assert.equal(shown.path.length, rows, `${rows}/${risk}: wrong number of pegs`);
        assert.equal(
          shown.multiplier,
          table[shown.bucket],
          `${rows}/${risk}: bucket ${shown.bucket} paid ${shown.multiplier}, table says ${table[shown.bucket]}`,
        );
        assert.equal(
          state.settlement!.payout,
          mul(stake, shown.multiplier),
          `${rows}/${risk}: ${stake} at ${shown.multiplier}x`,
        );
      }
    }
  }
  assert.ok(drops >= ROUNDS * PLINKO_ROWS.length * RISKS.length);
});

test('Dice pays the multiplier the slider quoted', () => {
  const engine = new DiceEngine();
  const bets = stakes(engine.limits.min, engine.limits.max);
  // A spread across the whole slider, including the extremes a player can pick.
  const targets = [1.01, 2, 10, 25, 49.5, 50, 75.25, 90, 98, 98.99];
  let wins = 0;
  let losses = 0;

  for (const direction of ['over', 'under'] as const) {
    for (const target of targets) {
      let quoted: number;
      try {
        quoted = diceMultiplier(target, direction);
      } catch {
        // A bet that cannot win, or cannot lose, is refused by the table
        // itself — see assertValidTarget. Nothing to settle.
        continue;
      }
      for (let n = 0; n < ROUNDS; n += 1) {
        const stake = bets[n % bets.length]!;
        const rng = stream(n);
        const state = engine.act(engine.init(stake, rng), { type: 'roll', target, direction }, rng);
        const shown = state.public as { roll: number; won: boolean; multiplier: number };

        const shouldWin = direction === 'over' ? shown.roll > target : shown.roll < target;
        assert.equal(shown.won, shouldWin, `roll ${shown.roll} ${direction} ${target}`);
        assert.equal(shown.multiplier, quoted, `${direction} ${target}: quoted ${quoted}`);
        assert.equal(
          state.settlement!.payout,
          shouldWin ? mul(stake, quoted) : 0,
          `${direction} ${target}: ${stake} at ${quoted}x`,
        );
        if (shouldWin) wins += 1;
        else losses += 1;
      }
    }
  }
  // A run of nothing but losses would satisfy every assertion above.
  assert.ok(wins > 0 && losses > 0, `saw ${wins} wins and ${losses} losses`);
});

test('Mines pays the rung of the ladder it stopped on', () => {
  const engine = new MinesEngine();
  const bets = stakes(engine.limits.min, engine.limits.max);
  let cashOuts = 0;
  let blown = 0;

  for (const mines of [1, 3, 5, 10, 24]) {
    for (let n = 0; n < ROUNDS; n += 1) {
      const stake = bets[n % bets.length]!;
      const rng = stream(n * 31 + mines);
      let state = engine.act(engine.init(stake, rng), { type: 'configure', mines }, rng);

      // Reveal tiles in a fixed order until the round ends or three are safe,
      // then take the money. A deterministic strategy keeps the audit about
      // the payout rather than about the choice.
      let revealed = 0;
      for (let tile = 0; tile < 25 && state.status !== 'settled' && revealed < 3; tile += 1) {
        state = engine.act(state, { type: 'reveal', tile }, rng);
        revealed += 1;
      }
      if (state.status !== 'settled') {
        // 'cashout', not 'cash-out'. The engine names its own actions and this
        // audit does not get to rename them.
        state = engine.act(state, { type: 'cashout' }, rng);
      }

      const shown = state.public as { revealed: number[]; bust: boolean; multiplier: number };
      const settlement = state.settlement!;

      if (settlement.payout === 0) {
        blown += 1;
        continue;
      }
      cashOuts += 1;
      const safe = shown.revealed.length;
      const owed = minesMultiplier(mines, safe);
      assert.equal(
        settlement.payout,
        mul(stake, owed),
        `${mines} mines, ${safe} safe: paid ${settlement.payout}, ladder says ${owed}x of ${stake}`,
      );
    }
  }
  assert.ok(cashOuts > 0 && blown > 0, `saw ${cashOuts} cash-outs and ${blown} mines`);
});

/*
 * Crash and Limbo are the same random variable in different clothes — one
 * animates it as a rising curve that stops, the other prints it as a number —
 * so they are audited by the same function. Typed loosely on purpose: the
 * point is that the CONTRACT holds whichever engine is behind it, and pinning
 * the two public shapes together would only make the test depend on them
 * being identical, which is not what is being claimed.
 */
for (const [name, engine] of [
  ['Crash', new CrashEngine()],
  ['Limbo', new LimboEngine()],
] as [string, { limits: { min: number; max: number }; init: Function; act: Function }][]) {
  test(`${name} pays the target when the curve reaches it, and nothing when it does not`, () => {
    const bets = stakes(engine.limits.min, engine.limits.max);
    const targets = [1.01, 1.5, 2, 5, 20, 100];
    let hits = 0;
    let misses = 0;

    for (const target of targets) {
      for (let n = 0; n < ROUNDS; n += 1) {
        const stake = bets[n % bets.length]!;
        const rng = stream(n);
        const state = engine.act(engine.init(stake, rng), { type: 'set-target', target }, rng) as {
          public: Record<string, unknown>;
          settlement: { payout: number };
        };

        /*
         * The two games report the same fact under different names — Crash
         * calls it `crashPoint`/`cashedOut`, Limbo calls it `result`/`won` —
         * because one draws a curve that stops and the other prints a number.
         * Reading both here is the honest way to say they are one game: the
         * alternative is two copies of this loop that must be kept in step.
         */
        const rolled = (state.public['crashPoint'] ?? state.public['result']) as number;
        const paid = (state.public['cashedOut'] ?? state.public['won']) as boolean;

        // The whole game in one line: you are paid your target, or nothing.
        const reached = rolled >= target;
        assert.equal(state.public['target'], target, `${name} settled a target it was not given`);
        assert.equal(paid, reached, `${name} stopped at ${rolled} against a target of ${target}`);
        assert.equal(
          state.settlement.payout,
          reached ? mul(stake, target) : 0,
          `${name} ${target}x on ${stake}`,
        );
        if (reached) hits += 1;
        else misses += 1;
      }
    }
    assert.ok(hits > 0 && misses > 0, `${name}: ${hits} hits, ${misses} misses`);
  });
}

test('Roulette pays each winning bet at its own odds', () => {
  const engine = new RouletteEngine();
  const unit = minor(Math.max(engine.limits.min, 100));

  /*
   * A layout that covers every kind of bet at once, so one spin exercises the
   * whole odds table and the summing of several winners.
   *
   * The amounts are deliberately not round multiples of anything: each winning
   * bet is floored on its own before the payouts are added, so a stake that
   * divides evenly would hide a flooring error rather than expose it.
   */
  const layout = [
    { type: 'straight' as const, selection: [17], amount: unit },
    { type: 'split' as const, selection: [17, 20], amount: minor(unit + 3) },
    { type: 'street' as const, selection: [16, 17, 18], amount: minor(unit + 7) },
    { type: 'corner' as const, selection: [16, 17, 19, 20], amount: minor(unit + 11) },
    { type: 'line' as const, selection: [16, 17, 18, 19, 20, 21], amount: minor(unit + 13) },
    { type: 'column' as const, selection: [1], amount: minor(unit + 17) },
    { type: 'dozen' as const, selection: [1], amount: minor(unit + 19) },
    { type: 'red' as const, selection: [], amount: minor(unit + 23) },
    { type: 'black' as const, selection: [], amount: minor(unit + 29) },
    { type: 'odd' as const, selection: [], amount: minor(unit + 31) },
    { type: 'even' as const, selection: [], amount: minor(unit + 37) },
    { type: 'low' as const, selection: [], amount: minor(unit + 41) },
    { type: 'high' as const, selection: [], amount: minor(unit + 43) },
  ];

  const seen = new Set<number>();
  for (let n = 0; n < ROUNDS * 10; n += 1) {
    const rng = stream(n);
    const stake = minor(layout.reduce((sum, bet) => sum + bet.amount, 0));
    const state = engine.act(engine.init(stake, rng), { type: 'place-bets', bets: layout }, rng);
    const shown = state.public as { winningNumber: number; winningBets: number[] };
    seen.add(shown.winningNumber);

    /*
     * Recomputed from the layout rather than from the reported multiplier.
     *
     * `settlement.multiplier` is `payout / stake` — a description of what
     * happened, derived after the fact. The money is the sum of per-bet
     * payouts, each floored on its own, and that is what has to be right.
     */
    let owed = 0;
    const winners: number[] = [];
    for (const [i, bet] of layout.entries()) {
      if (!covers(bet.type, bet.selection, shown.winningNumber)) continue;
      winners.push(i);
      owed += mul(bet.amount, ROULETTE_ODDS[bet.type] + 1);
    }

    assert.deepEqual(
      [...shown.winningBets].sort((a, b) => a - b),
      winners,
      `spin ${shown.winningNumber}: the wrong bets were called winners`,
    );
    assert.equal(
      state.settlement!.payout,
      owed,
      `spin ${shown.winningNumber}: paid ${state.settlement!.payout}, the layout is owed ${owed}`,
    );
  }

  // Zero is the house's edge and the one number every even-money bet loses on.
  // An audit that never span it has not tested the thing that matters most.
  assert.ok(seen.has(0), 'zero never came up, so the losing case was never checked');
  assert.ok(seen.size > 30, `only ${seen.size} of 37 pockets were spun`);
});

/**
 * Does this bet cover this number?
 *
 * Written out here rather than imported, for the same reason the slot audit
 * writes out the paytable rules: a checker that asks the engine which bets won
 * is asking the thing under test to mark its own paper. Column and dozen take
 * an INDEX rather than a list of numbers, which is the fiddly part and the one
 * most likely to be got wrong in either direction.
 */
function covers(type: string, selection: readonly number[], n: number): boolean {
  const RED = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
  switch (type) {
    case 'straight':
    case 'split':
    case 'street':
    case 'corner':
    case 'line':
      return selection.includes(n);
    case 'column':
      // Columns run 1,4,7,... / 2,5,8,... / 3,6,9,...
      return n !== 0 && (n - 1) % 3 === selection[0];
    case 'dozen':
      return n !== 0 && Math.floor((n - 1) / 12) === selection[0];
    case 'red':
      return RED.has(n);
    case 'black':
      return n !== 0 && !RED.has(n);
    case 'odd':
      return n !== 0 && n % 2 === 1;
    case 'even':
      return n !== 0 && n % 2 === 0;
    case 'low':
      return n >= 1 && n <= 18;
    case 'high':
      return n >= 19 && n <= 36;
    default:
      return false;
  }
}
