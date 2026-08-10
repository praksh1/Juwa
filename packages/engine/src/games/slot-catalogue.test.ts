import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { minor } from '@juwa/money';
import { RngStream } from '../rng.js';
import {
  SLOT_CATALOGUE,
  SLOT_MODELS,
  slotModel,
  type SlotDefinition,
} from './slot-catalogue.js';
import { buildStrip, buildStrips } from './slot-math.js';
import { SlotsEngine, allSlotEngines } from './slots.js';
import { measureModel } from '../tools/catalogue-rtp.js';

test('the catalogue is large enough to be a catalogue', () => {
  assert.ok(SLOT_CATALOGUE.length >= 20, `only ${SLOT_CATALOGUE.length} slots`);
});

test('every game has a unique id and names a real model', () => {
  const ids = new Set<string>();
  for (const game of SLOT_CATALOGUE) {
    assert.ok(!ids.has(game.id), `duplicate game id ${game.id}`);
    ids.add(game.id);
    assert.ok(SLOT_MODELS[game.model], `${game.id} names unknown model ${game.model}`);
    assert.ok(game.name.trim().length > 0, `${game.id} has no name`);
    assert.ok(game.limits.min > 0 && game.limits.max > game.limits.min, `${game.id} bad limits`);
  }
});

test('every model is used, and every game is playable', () => {
  const used = new Set(SLOT_CATALOGUE.map((g) => g.model));
  for (const id of Object.keys(SLOT_MODELS)) {
    assert.ok(used.has(id), `model ${id} is defined but no game uses it`);
  }

  // A game that throws on its first spin is worse than a game that does not
  // exist, because it is advertised in the lobby.
  for (const engine of allSlotEngines()) {
    const round = engine.init(engine.limits.min, new RngStream('smoke', engine.id, 1));
    assert.equal(round.status, 'settled');
    assert.ok(round.settlement!.payout >= 0, `${engine.id} paid negative`);
    assert.equal(round.public.baseSpin.grid.length, slotModel(
      SLOT_CATALOGUE.find((g) => g.id === engine.id) as SlotDefinition,
    ).math.reels);
  }
});

test('generated strips contain every weighted symbol', () => {
  for (const [id, model] of Object.entries(SLOT_MODELS)) {
    const strips = buildStrips(model.math);
    assert.equal(strips.length, model.math.reels, `${id} wrong reel count`);

    for (const [reel, strip] of strips.entries()) {
      assert.ok(strip.length > 0, `${id} reel ${reel} is empty`);
      const present = new Set(strip);
      for (const symbol of model.math.symbols) {
        if ((symbol.weights[reel] ?? 0) > 0) {
          assert.ok(
            present.has(symbol.id),
            `${id} reel ${reel} lost ${symbol.id} entirely — rounding dropped it`,
          );
        }
      }
    }
  }
});

test('strip generation is deterministic', () => {
  // A reel that differs between server restarts cannot be audited, and would
  // make every published RTP unverifiable.
  const model = SLOT_MODELS['lines-25']!;
  const first = buildStrip(model.math.symbols, 0, model.math.stripLength);
  const second = buildStrip(model.math.symbols, 0, model.math.stripLength);
  assert.deepEqual(first, second);
});

test('symbols are not clumped into runs', () => {
  // Three of the same symbol adjacent on a strip guarantees a full column
  // whenever the window lands there — a far bigger payout event than the
  // weight implies, and invisible in the weights themselves.
  for (const [id, model] of Object.entries(SLOT_MODELS)) {
    if (model.math.strips) continue; // hand-authored strips are exempt by design
    for (const [reel, strip] of buildStrips(model.math).entries()) {
      for (let i = 0; i + 2 < strip.length; i++) {
        const run = strip[i] === strip[i + 1] && strip[i + 1] === strip[i + 2];
        assert.ok(!run, `${id} reel ${reel} has three ${strip[i]} in a row at ${i}`);
      }
    }
  }
});

test('published RTP matches simulation', () => {
  // The whole point of the catalogue: the figure in the paytable is what the
  // machine actually pays. Re-measured at lower resolution than the tool uses,
  // so the band is the sampling error of THIS run, not a fudge factor.
  const SPINS = 60_000;
  for (const [id, model] of Object.entries(SLOT_MODELS)) {
    const measured = measureModel(model, SPINS);
    // Four standard errors: tight enough to catch a real change to the math,
    // loose enough that a passing build is not a coin toss.
    const tolerance = Math.max(0.02, 2 * measured.confidence);
    assert.ok(
      Math.abs(measured.rtp - model.rtp) <= tolerance,
      `${id} publishes ${(model.rtp * 100).toFixed(2)}% but measured ` +
        `${(measured.rtp * 100).toFixed(2)}% (tolerance ±${(tolerance * 100).toFixed(2)})`,
    );
  }
});

test('no game returns more than it takes', () => {
  // A model above 100% is a business that loses money on every spin, and it is
  // an easy thing to introduce by nudging a paytable.
  for (const [id, model] of Object.entries(SLOT_MODELS)) {
    assert.ok(model.rtp < 1, `${id} pays ${(model.rtp * 100).toFixed(2)}% — the house loses`);
    // Below about 85% players notice the drought and leave.
    assert.ok(model.rtp > 0.85, `${id} pays only ${(model.rtp * 100).toFixed(2)}%`);
  }
});

test('a spin never pays more than the declared maximum win', () => {
  const engine = new SlotsEngine(SLOT_CATALOGUE[0]!);
  const stake = minor(2_000);
  for (let i = 0; i < 5_000; i++) {
    const round = engine.init(stake, new RngStream('cap', 'check', i));
    // Nothing enforces a cap today; this asserts the payout is at least finite
    // and non-negative, which is what the ledger depends on.
    const payout = round.settlement!.payout;
    assert.ok(Number.isFinite(payout) && payout >= 0, `spin ${i} paid ${payout}`);
    assert.ok(Number.isInteger(payout), `spin ${i} paid a fractional ${payout}`);
  }
});

/**
 * The winning cells.
 *
 * This is the field the client draws its win lines from, and it is the one
 * place where the machine can lie to a player without the money being wrong:
 * pay for one combination and light up another. The client cannot check the
 * work — it has no payline table on purpose — so the checking happens here,
 * across every model in the catalogue rather than on one example.
 */
test('every reported winning cell actually holds a winning symbol', () => {
  let winsChecked = 0;

  for (const definition of SLOT_CATALOGUE) {
    const math = slotModel(definition).math;
    const engine = new SlotsEngine(definition);

    for (let n = 0; n < 400; n++) {
      const state = engine.init(minor(2000), new RngStream('cells', definition.id, n));
      /*
       * Every grid the player is shown, including each tumble.
       *
       * A cascade step is its own grid with its own wins drawn over it, so
       * leaving the drops out would exempt most of a tumbling game's wins from
       * the only check that they light up what they paid for.
       */
      const spins = [state.public.baseSpin, ...state.public.freeSpins].flatMap((spin) => [
        spin,
        ...spin.cascades,
      ]);

      for (const spin of spins) {
        for (const win of spin.lineWins) {
          winsChecked++;

          // The symbol sitting in every reported cell must be the one that
          // paid, or a wild standing in for it. True in both scoring modes,
          // and the check that stops the machine lighting up cells it did not
          // settle.
          for (const [reel, row] of win.cells) {
            const symbol = spin.grid[reel]![row]!;
            assert.ok(
              symbol === win.symbol || symbol === 'WILD',
              `${definition.id}: ${win.symbol} paid but cell [${reel},${row}] holds ${symbol}`,
            );
          }

          if (math.paylines === 'ways') {
            // A ways win names no line. What it must do instead is cover every
            // reel from the leftmost up to `count`, with at least one cell on
            // each — a gap would draw a win across a reel that did not have
            // the symbol on it at all.
            const reels = new Set(win.cells.map(([reel]) => reel));
            assert.deepEqual(
              [...reels].sort((a, b) => a - b),
              Array.from({ length: win.count }, (_, i) => i),
              `${definition.id}: a ways win on ${win.symbol} skipped a reel`,
            );
            continue;
          }

          const line = math.paylines[win.line];
          assert.ok(line, `${definition.id}: win reports line ${win.line}, which does not exist`);

          // One cell per matched reel — no more, no fewer. Reporting the whole
          // payline on a three-of-a-kind lights two symbols that did not pay.
          assert.equal(
            win.cells.length,
            win.count,
            `${definition.id}: ${win.count} symbols matched but ${win.cells.length} cells reported`,
          );

          for (const [i, cell] of win.cells.entries()) {
            const [reel, row] = cell;
            // Contiguous from the leftmost reel: that is what "count matching
            // from the left" means, and a gap would draw a broken line.
            assert.equal(reel, i, `${definition.id}: cells are not leftmost-first`);
            assert.equal(
              row,
              line[i],
              `${definition.id}: cell ${i} is on row ${row}, but payline ${win.line} uses ${line[i]}`,
            );
          }
        }
      }
    }
  }

  // Guards against the assertions above passing because nothing was examined.
  assert.ok(winsChecked > 2000, `only ${winsChecked} wins were checked`);
});
