/**
 * Measure the return to player of every slot in the catalogue.
 *
 * Run with: npm run rtp:catalogue
 * Write the results back with: npm run rtp:catalogue -- --write
 *
 * The `rtp` field on every entry in `SLOT_CATALOGUE` is produced by this tool
 * and nothing else. Nobody types a return-to-player figure in by hand: the
 * number that appears in a paytable is a claim about what the machine actually
 * does, and the only honest way to make it is to run the machine.
 *
 * `--write` edits slot-catalogue.ts in place, so the committed figures and the
 * measured figures cannot drift apart through carelessness. The test suite
 * re-measures at lower resolution and fails if they have.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { minor } from '@juwa/money';
import { RngStream } from '../rng.js';
import { SLOT_CATALOGUE, SLOT_MODELS, type SlotModel } from '../games/slot-catalogue.js';
import { buildStrips, evaluateGrid, spinGrid } from '../games/slot-math.js';

const SPINS = Number(process.env['RTP_SPINS'] ?? 300_000);
const WRITE = process.argv.includes('--write');

export interface Measurement {
  id: string;
  rtp: number;
  hitFrequency: number;
  bonusFrequency: number;
  maxWinMultiplier: number;
  volatility: number;
  /** Two standard errors on the RTP estimate — the honest ± on the figure. */
  confidence: number;
}

/**
 * Simulate one MODEL, not one game.
 *
 * Twenty-three themes share five models, so there are five numbers to measure.
 * Measuring per game would report five slightly different figures for one piece
 * of math and invite someone to believe the difference meant something.
 */
export function measureModel(model: SlotModel, spins: number): Measurement {
  const math = model.math;
  const strips = buildStrips(math);
  const stake = minor(2_000);
  let returned = 0;
  let hits = 0;
  let bonuses = 0;
  let biggest = 0;
  let sumSquares = 0;

  for (let i = 0; i < spins; i++) {
    // Seeded per spin and per model, so a measurement is reproducible: the same
    // command on another machine returns the same number.
    const rng = new RngStream(`rtp-${model.id}`, 'measurement', i);

    const base = evaluateGrid(spinGrid(strips, math, rng), math, 1);
    let total = base.totalMultiplier;
    const awarded = math.freeSpinsAwarded[base.scatterCount] ?? 0;
    for (let n = 0; n < awarded; n++) {
      total += evaluateGrid(spinGrid(strips, math, rng), math, math.freeSpinMultiplier)
        .totalMultiplier;
    }

    returned += Math.floor(stake * total);
    if (total > 0) hits++;
    if (awarded > 0) bonuses++;
    if (total > biggest) biggest = total;
    sumSquares += total * total;
  }

  const rtp = returned / (stake * spins);
  // Standard deviation of the payout ratio: the usual proxy for how swingy a
  // game feels, and the number that separates "low" from "high" volatility.
  const volatility = Math.sqrt(Math.max(0, sumSquares / spins - rtp * rtp));
  return {
    id: model.id,
    rtp,
    hitFrequency: hits / spins,
    bonusFrequency: bonuses / spins,
    maxWinMultiplier: biggest,
    volatility,
    confidence: (2 * volatility) / Math.sqrt(spins),
  };
}

function main(): void {
  const models = Object.values(SLOT_MODELS);
  console.log(
    `Simulating ${SPINS.toLocaleString()} spins across ${models.length} models ` +
      `(${SLOT_CATALOGUE.length} games)\n`,
  );
  console.log('model            RTP           hit%    bonus%   max win   volatility  games');
  console.log('─'.repeat(80));

  const results: Measurement[] = [];
  for (const model of models) {
    const m = measureModel(model, SPINS);
    results.push(m);
    const games = SLOT_CATALOGUE.filter((d) => d.model === model.id).length;
    console.log(
      `${m.id.padEnd(14)} ${(m.rtp * 100).toFixed(2).padStart(6)}% ` +
        `±${(m.confidence * 100).toFixed(2).padEnd(5)} ` +
        `${(m.hitFrequency * 100).toFixed(1).padStart(6)}% ` +
        `${(m.bonusFrequency * 100).toFixed(2).padStart(7)}% ` +
        `${m.maxWinMultiplier.toFixed(0).padStart(8)}x ` +
        `${m.volatility.toFixed(2).padStart(10)} ` +
        `${String(games).padStart(6)}`,
    );
  }

  if (!WRITE) {
    console.log('\nRe-run with --write to record these figures in slot-catalogue.ts');
    return;
  }

  const file = resolve(
    dirname(fileURLToPath(import.meta.url)),
    '../../src/games/slot-catalogue.ts',
  );
  let source = readFileSync(file, 'utf8');
  for (const m of results) {
    // Match the rtp on the model with this id, and nothing else.
    const pattern = new RegExp(`(id: '${m.id}',[\\s\\S]{0,200}?rtp: )([0-9.]+)`);
    if (!pattern.test(source)) {
      console.error(`Could not find an rtp field for model ${m.id}`);
      process.exit(1);
    }
    source = source.replace(pattern, `$1${m.rtp.toFixed(4)}`);
  }
  writeFileSync(file, source);
  console.log(`\nWrote ${results.length} measured figures to slot-catalogue.ts`);
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop() ?? '')) {
  main();
}
