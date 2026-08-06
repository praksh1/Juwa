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
    ...(game.tag ? { tag: game.tag } : {}),
    ...(game.art ? { art: game.art } : {}),
  };
});

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

import type { SlotGame } from './games';

export const SLOT_GAMES: SlotGame[] = [
${body}
];
`;

const target = resolve(root, 'app/src/api/slot-games.generated.ts');
writeFileSync(target, output);
console.log(`Wrote ${entries.length} games to app/src/api/slot-games.generated.ts`);
