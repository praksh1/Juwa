/**
 * Generate the app's game list from the engine catalogue.
 *
 * The app deliberately does not depend on `@juwa/engine` — the engine computes
 * outcomes, and shipping it to a device the player controls would let a
 * modified client compute favourable ones. But the lobby still has to know what
 * games exist, and a hand-maintained second list drifts: a game gets added to
 * the server and never appears, or appears and cannot be played.
 *
 * So the list is generated at build time from the engine and committed. Engine
 * code never enters the bundle; only names, ids and theme colours do.
 *
 * Run: node scripts/generate-game-catalogue.mjs
 */

import { writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { SLOT_CATALOGUE, SLOT_MODELS } = await import(
  resolve(root, 'packages/engine/dist/games/slot-catalogue.js')
);

const entries = SLOT_CATALOGUE.map((game) => {
  const model = SLOT_MODELS[game.model];
  return {
    id: game.id,
    name: game.name,
    category: 'slots',
    rtp: model.rtp,
    volatility: model.volatility,
    reels: model.math.reels,
    rows: model.math.rows,
    lines: model.math.paylines.length,
    minBet: game.limits.min,
    maxBet: game.limits.max,
    theme: game.theme,
    model: game.model,
    ...(game.tag ? { tag: game.tag } : {}),
    ...(game.art ? { art: game.art } : {}),
  };
});

/**
 * The paytables, one per MODEL rather than one per game.
 *
 * Twenty-three themes share five pieces of maths. Emitting a paytable per game
 * would put five facts into twenty-three places, and the first thing to go
 * wrong would be a reskin showing a paytable its own model does not pay.
 *
 * Two different units are in play and the labels below are not decoration:
 *
 *   Line pays are quoted PER LINE. `evaluateGrid` divides the sum of line wins
 *   by the payline count, so a 12x line win on a 20-line game returns 0.6x the
 *   total stake. Quoting these against the total bet would understate every
 *   row by the line count.
 *
 *   Scatter pays are quoted against the TOTAL bet — they pay from anywhere on
 *   the grid and are not attached to a line at all.
 *
 * `payoutScale` is folded in here rather than shown separately. It is a
 * calibration knob on the model, not a fact about the game, and a paytable
 * that needs the player to multiply by 0.7384 is not a paytable.
 */
const models = {};
for (const [id, model] of Object.entries(SLOT_MODELS)) {
  const scale = model.math.payoutScale ?? 1;
  const round = (n) => Math.round(n * 100) / 100;
  models[id] = {
    id,
    lines: model.math.paylines.length,
    symbols: model.math.symbols
      .filter((s) => s.kind !== 'scatter')
      .map((s) => ({
        id: s.id,
        kind: s.kind,
        pays: { 3: round(s.pays[3] * scale), 4: round(s.pays[4] * scale), 5: round(s.pays[5] * scale) },
      })),
    scatterPays: Object.fromEntries(
      Object.entries(model.math.scatterPays).map(([n, v]) => [n, round(v * scale)]),
    ),
    freeSpinsAwarded: { ...model.math.freeSpinsAwarded },
    freeSpinMultiplier: model.math.freeSpinMultiplier,
  };
}

const field = (k, v) =>
  `${k}: ${typeof v === 'string' ? `'${v.replace(/'/g, "\\'")}'` : v}`;

const body = entries
  .map((e) => {
    const parts = Object.entries(e).map(([k, v]) =>
      k === 'theme'
        ? `theme: { ${Object.entries(v).map(([tk, tv]) => field(tk, tv)).join(', ')} }`
        : field(k, v),
    );
    return `  { ${parts.join(', ')} },`;
  })
  .join('\n');

const output = `/**
 * GENERATED FILE — do not edit.
 *
 * Written by scripts/generate-game-catalogue.mjs from the engine's
 * SLOT_CATALOGUE. Re-run it after changing the catalogue; the build checks
 * that this file is current.
 *
 * The app cannot import @juwa/engine (see api/games.ts), so this is the
 * lobby's copy of what the server can actually deal.
 */

import type { SlotGame, SlotModelInfo } from './games';

export const SLOT_GAMES: SlotGame[] = [
${body}
];

/** Paytables by model id. See the note in the generator about the two units. */
export const SLOT_MODEL_INFO: Record<string, SlotModelInfo> = ${JSON.stringify(models, null, 2)
  .replace(/^/gm, '')};
`;

const target = resolve(root, 'app/src/api/slot-games.generated.ts');
writeFileSync(target, output);
console.log(`Wrote ${entries.length} games to app/src/api/slot-games.generated.ts`);
