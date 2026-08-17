/**
 * Does the paytable on the SCREEN match the machine behind it?
 *
 * ## The gap this closes
 *
 * `payout-audit.test.ts` proves the engine pays what its own model says. That
 * is half the promise. The other half is that the table the player reads —
 * rendered from `app/src/api/slot-games.generated.ts` — describes that same
 * model. The app deliberately cannot import the engine (an engine on a device
 * is an engine a player can patch), so the two are connected by a generated
 * file that is committed to the repository and re-run by hand.
 *
 * A committed generated file is a copy, and copies go stale. The header of
 * that file claims "the build checks that this file is current"; nothing did.
 * A change to a symbol's pays, a new game, a re-calibrated `payoutScale` — any
 * of those would leave the app quoting yesterday's prices, and the failure is
 * silent, because both halves are internally consistent. The player is simply
 * shown a number the machine has stopped honouring.
 *
 * ## Why this restates the relationship rather than diffing the file
 *
 * A test that regenerated the file and compared bytes would pass for the wrong
 * reason: it would prove the generator is deterministic, and it would go green
 * the moment someone re-ran the generator over a mistake. What is asserted
 * below instead is the RULE — a displayed pay is the model's raw pay times the
 * model's calibration scale, rounded to two decimals — so the test still fails
 * if the generator itself is wrong.
 *
 * ## The discrepancy this found
 *
 * The generator rounded every displayed pay to two decimals and `GameRules`
 * rounded the resulting coin figure, while the settlement floors. On the three
 * 720-ways games, whose calibration scale is 0.1186, that made a pay of 0.3558
 * print as 0.36 — a 1.18% overstatement, worth 210 coins on a single
 * three-of-a-kind at the maximum stake and multiplied again by every way the
 * symbol can be read. Across the catalogue, 347 rows disagreed with what the
 * machine pays and 190 of them promised more than it pays.
 *
 * The generator now carries the exact multiplier and the paytable floors like
 * `mul` does. The last test below is the one that holds that shut, in coins.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SLOT_CATALOGUE, SLOT_MODELS } from './slot-catalogue.js';
import { isWays, reelHeights, type SlotMath } from './slot-math.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const GENERATED = resolve(root, 'app/src/api/slot-games.generated.ts');

/**
 * Pull an exported object or array out of the generated module as data.
 *
 * The file is TypeScript, so it cannot simply be imported here — and running
 * it through a compiler to read two constants would make this test depend on a
 * toolchain to answer a question about a paytable. The model table is emitted
 * by `JSON.stringify`, so it parses directly; the game list is a JS array
 * literal with bare keys and single quotes, which is normalised below.
 */
function readExport(name: string): unknown {
  const source = readFileSync(GENERATED, 'utf8');
  const start = source.indexOf(`export const ${name}`);
  assert.notEqual(start, -1, `${name} is missing from the generated catalogue`);
  const open = source.indexOf('=', start) + 1;

  // Walk to the matching bracket, respecting strings so a brace inside a name
  // or a colour cannot end the scan early.
  let depth = 0;
  let quote: string | null = null;
  let end = -1;
  for (let i = open; i < source.length; i += 1) {
    const c = source[i]!;
    if (quote) {
      if (c === '\\') i += 1;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') quote = c;
    else if (c === '{' || c === '[') depth += 1;
    else if (c === '}' || c === ']') {
      depth -= 1;
      if (depth === 0) {
        end = i + 1;
        break;
      }
    }
  }
  assert.notEqual(end, -1, `${name} is not a closed literal`);

  const literal = source.slice(open, end);
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  return new Function(`return (${literal});`)() as unknown;
}

interface DisplaySymbol {
  id: string;
  kind: string;
  pays: Record<'3' | '4' | '5', number>;
}
interface DisplayModel {
  id: string;
  lines: number;
  pays: 'lines' | 'ways';
  cascade?: { ladder: number[]; maxDrops: number };
  symbols: DisplaySymbol[];
  scatterPays: Record<string, number>;
  freeSpinsAwarded: Record<string, number>;
  freeSpinMultiplier: number;
  tiers: { big: number; mega: number; jackpot: number };
  feature?: { kind: string; segments?: number[]; respins?: number; reels?: number[] };
}
interface DisplayGame {
  id: string;
  name: string;
  rtp: number;
  reels: number;
  rows: number[];
  lines: number;
  pays: 'lines' | 'ways';
  minBet: number;
  maxBet: number;
  model: string;
  feature?: string;
  cascades?: boolean;
}

const shownModels = readExport('SLOT_MODEL_INFO') as Record<string, DisplayModel>;
const shownGames = readExport('SLOT_GAMES') as DisplayGame[];

/**
 * The generator's transform, restated: there is not one.
 *
 * A displayed pay is the engine's own `pays x scale`, bit for bit. It used to
 * be rounded to two decimals, which put the ways models' paytables 1.18% above
 * what they paid; tidying it to twelve significant digits instead still left
 * one-coin disagreements, because 28.62 and 28.619999999999997 floor to
 * different integers once multiplied by a 50,000 stake.
 */
const show = (n: number) => n;

/** How many ways there are to win, which is what the lobby prints. */
function wayCount(math: SlotMath): number {
  return isWays(math)
    ? reelHeights(math).reduce((product, rows) => product * rows, 1)
    : (math.paylines as readonly unknown[]).length;
}

test('every game the engine can deal is in the app, and nothing else is', () => {
  const engineIds = SLOT_CATALOGUE.map((g) => g.id).sort();
  const shownIds = shownGames.map((g) => g.id).sort();
  assert.deepEqual(
    shownIds,
    engineIds,
    'the lobby and the server disagree about which games exist',
  );
});

for (const definition of SLOT_CATALOGUE) {
  test(`${definition.name}: the lobby entry matches the machine`, () => {
    const shown = shownGames.find((g) => g.id === definition.id)!;
    const model = SLOT_MODELS[definition.model]!;
    const math = model.math;

    assert.equal(shown.name, definition.name, 'name');
    assert.equal(shown.model, definition.model, 'model id');
    assert.equal(shown.rtp, model.rtp, 'published return to player');
    assert.equal(shown.reels, math.reels, 'reel count');
    assert.deepEqual(shown.rows, reelHeights(math), 'grid shape');
    assert.equal(shown.lines, wayCount(math), 'lines or ways');
    assert.equal(shown.pays, isWays(math) ? 'ways' : 'lines', 'how it pays');

    // Bet limits are what the console offers. Advertising a minimum the server
    // rejects is a game that cannot be played at the price on the tile.
    assert.equal(shown.minBet, definition.limits.min, 'minimum bet');
    assert.equal(shown.maxBet, definition.limits.max, 'maximum bet');

    assert.equal(shown.feature, math.feature?.kind, 'which bonus it plays');
    assert.equal(Boolean(shown.cascades), Boolean(math.cascade), 'whether it tumbles');
  });
}

for (const [id, model] of Object.entries(SLOT_MODELS)) {
  test(`${id}: the paytable on screen is the paytable that pays`, () => {
    const shown = shownModels[id];
    assert.ok(shown, `model ${id} has no paytable in the app`);

    const math = model.math;
    const scale = math.payoutScale ?? 1;

    assert.equal(shown.lines, wayCount(math), 'lines or ways');
    assert.equal(shown.pays, isWays(math) ? 'ways' : 'lines', 'how it pays');

    /*
     * Every paying row, at the value the player is quoted.
     *
     * `payoutScale` is a calibration constant on the model — the engine
     * multiplies every win by it — so a table printed from the raw figures
     * would overstate lines-10 by more than a factor of two. It is folded in
     * here, which is why this comparison multiplies rather than compares
     * directly.
     */
    const paying = math.symbols.filter((s) => s.kind !== 'scatter');
    assert.equal(shown.symbols.length, paying.length, 'number of rows on the paytable');

    for (const spec of paying) {
      const row: DisplaySymbol | undefined = shown.symbols.find((s) => s.id === spec.id);
      assert.ok(row, `${spec.id} pays on this model but is not on its paytable`);
      assert.equal(row!.kind, spec.kind, `${spec.id}: kind`);
      for (const count of [3, 4, 5] as const) {
        assert.equal(
          row!.pays[String(count) as '3' | '4' | '5'],
          show(spec.pays[count] * scale),
          `${spec.id} x${count}: screen says ${row!.pays[String(count) as '3' | '4' | '5']}, machine pays ${spec.pays[count] * scale}`,
        );
      }
    }

    // A symbol on the paytable that the reels do not carry is a promise the
    // machine cannot keep.
    for (const row of shown.symbols) {
      assert.ok(
        math.symbols.some((s) => s.id === row.id),
        `the paytable lists ${row.id}, which is not on this model`,
      );
    }

    for (const [count, value] of Object.entries(math.scatterPays)) {
      assert.equal(
        shown.scatterPays[count],
        show(value * scale),
        `${count} scatters: screen says ${shown.scatterPays[count]}, machine pays ${value * scale}`,
      );
    }
    assert.deepEqual(
      Object.keys(shown.scatterPays).sort(),
      Object.keys(math.scatterPays).sort(),
      'scatter table rows',
    );

    assert.deepEqual(shown.freeSpinsAwarded, { ...math.freeSpinsAwarded }, 'free spins awarded');
    assert.equal(shown.freeSpinMultiplier, math.freeSpinMultiplier, 'free spin multiplier');

    if (math.cascade) {
      assert.deepEqual(shown.cascade?.ladder, [...math.cascade.ladder], 'tumble ladder');
      assert.equal(shown.cascade?.maxDrops, math.cascade.maxDrops, 'tumble limit');
    } else {
      assert.equal(shown.cascade, undefined, 'a ladder is shown for a game that does not tumble');
    }

    /*
     * The wheel's face, unscaled and in order.
     *
     * The server sends the winning segment's INDEX. A client drawing a
     * different wheel — reordered, rescaled, one segment short — stops the
     * pointer on a number the player was not paid, which is the exact fault
     * the founder reported when a wheel awarded 2,000 GC with nothing on
     * screen to explain it.
     */
    if (math.feature?.kind === 'wheel') {
      assert.equal(shown.feature?.kind, 'wheel');
      assert.deepEqual(shown.feature?.segments, [...math.feature.segments], 'wheel segments');
    } else if (math.feature?.kind === 'hold-spin') {
      assert.equal(shown.feature?.kind, 'hold-spin');
      assert.equal(shown.feature?.respins, math.feature.respins, 'respins');
    } else if (math.feature?.kind === 'expanding-wild') {
      assert.equal(shown.feature?.kind, 'expanding-wild');
      assert.deepEqual(shown.feature?.reels, [...math.feature.reels], 'expanding reels');
    } else {
      assert.equal(shown.feature, undefined, 'a bonus is advertised that the model does not play');
    }
  });
}

test('the coins the paytable prints are the coins the machine pays', () => {
  /*
   * The end-to-end version of every assertion above, in the unit the player
   * reads.
   *
   * `GameRules` does not show multipliers. It shows COINS at the bet on
   * screen: `floor(pays / divisor * bet)` for a line or a way, and
   * `floor(pays * bet)` for a scatter. The engine settles with `mul`, which is
   * `floor(stake * multiplier)`. So for a single winning line those two
   * expressions must produce the same integer, at every stake — and if they do
   * not, the machine is quoting a price it will not honour.
   *
   * This is the test that failed before the fix: two-decimal rounding in the
   * generator plus `Math.round` in the paytable disagreed with the settlement
   * on 347 rows across the catalogue, 190 of them printing MORE than was paid,
   * worst case 210 coins on one three-of-a-kind at maximum stake — multiplied
   * again by every way that symbol can be read on a 720-ways machine.
   */
  const mismatches: string[] = [];

  for (const game of SLOT_CATALOGUE) {
    const model = SLOT_MODELS[game.model]!;
    const math = model.math;
    const scale = math.payoutScale ?? 1;
    const shown = shownModels[game.model]!;
    const divisor = isWays(math) ? 1 : (math.paylines as readonly unknown[]).length;

    // Min, max, and a couple in between, so a stake that happens to divide
    // evenly cannot hide a discrepancy.
    const stakes = [
      game.limits.min,
      game.limits.min + 1,
      Math.floor((game.limits.min + game.limits.max) / 2),
      game.limits.max,
    ];

    for (const spec of math.symbols) {
      const row = shown.symbols.find((s) => s.id === spec.id);
      if (!row) continue;
      for (const count of [3, 4, 5] as const) {
        if (spec.pays[count] <= 0) continue;
        const displayed = row.pays[String(count) as '3' | '4' | '5'];
        for (const stake of stakes) {
          const printed = Math.floor((displayed / divisor) * stake);
          const paid = Math.floor(((spec.pays[count] * scale) / divisor) * stake);
          if (printed !== paid) {
            mismatches.push(
              `${game.name} ${spec.id} x${count} at ${stake}: prints ${printed}, pays ${paid}`,
            );
          }
        }
      }
    }

    for (const [count, value] of Object.entries(math.scatterPays)) {
      if (value <= 0) continue;
      const displayed = shown.scatterPays[count]!;
      for (const stake of stakes) {
        const printed = Math.floor(displayed * stake);
        const paid = Math.floor(value * scale * stake);
        if (printed !== paid) {
          mismatches.push(
            `${game.name} ${count} scatters at ${stake}: prints ${printed}, pays ${paid}`,
          );
        }
      }
    }
  }

  assert.deepEqual(mismatches, [], `paytable rows that do not pay what they print:\n${mismatches.slice(0, 20).join('\n')}`);
});
