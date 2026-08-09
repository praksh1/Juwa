/**
 * Find the title plaque painted into each lobby tile.
 *
 * The tiles were generated with an ornate banner across the top, deliberately
 * left empty for the game's name. The banners are NOT in the same place on
 * every tile — some sit flush to the top edge, some a fifth of the way down,
 * some are gold and some blue — so a single hard-coded band puts the title off
 * the sign on most of the catalogue, which is exactly what happened.
 *
 * So the position is measured from the artwork instead, once, at build time,
 * and committed. Run after adding or replacing tiles:
 *
 *   node scripts/detect-tile-banners.mjs
 *
 * HOW IT FINDS THE BANNER. A plaque is a wide horizontal band that is (a)
 * brighter than the artwork around it and (b) horizontally smooth, because it
 * is a blank sign rather than a picture. Scoring rows on brightness × flatness
 * and taking the best run in the top 40% picks it out reliably; brightness
 * alone finds a lit chandelier, and flatness alone finds the sky.
 */

import { execFileSync } from 'node:child_process';
import { readdirSync, writeFileSync, mkdtempSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FFMPEG = process.env.FFMPEG || 'ffmpeg';
const W = 160, H = 174; // Small: the banner is a big feature, and this is fast.
const work = mkdtempSync(join(tmpdir(), 'banners-'));

function pixels(file) {
  const out = join(work, 'f.raw');
  execFileSync(FFMPEG, ['-y', '-loglevel', 'error', '-i', file,
    '-vf', `scale=${W}:${H}`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', out]);
  return readFileSync(out);
}

/** Mean luminance and horizontal roughness for one row, centre 70% only. */
function rowStats(buf, y) {
  const from = Math.floor(W * 0.15), to = Math.ceil(W * 0.85);
  let sum = 0, prev = null, rough = 0, n = 0;
  const lum = [];
  for (let x = from; x < to; x++) {
    const i = (y * W + x) * 3;
    const l = (0.2126 * buf[i] + 0.7152 * buf[i + 1] + 0.0722 * buf[i + 2]) / 255;
    lum.push(l);
    sum += l;
    if (prev !== null) rough += Math.abs(l - prev);
    prev = l;
    n++;
  }
  return { mean: sum / n, rough: rough / n, lum };
}

function detect(file) {
  const buf = pixels(file);
  const limit = Math.floor(H * 0.42);
  const rows = [];
  for (let y = 0; y < limit; y++) {
    const { mean, rough } = rowStats(buf, y);
    // Flat and bright scores high. Roughness is subtracted hard: an ornate
    // frame is bright too, and it is the flatness that says "blank sign".
    rows.push(Math.max(0, mean - rough * 4));
  }
  // Best contiguous run, at least 6% of the height tall.
  const minRun = Math.max(4, Math.round(H * 0.06));
  let best = { score: -1, from: 0, to: minRun };
  for (let from = 0; from < limit - minRun; from++) {
    let sum = 0;
    for (let to = from; to < limit; to++) {
      sum += rows[to];
      const len = to - from + 1;
      if (len < minRun) continue;
      const score = sum / len;
      if (score > best.score) best = { score, from, to };
    }
  }
  // Mean luminance of the band decides whether the name is dark or light.
  let bandLum = 0, count = 0;
  for (let y = best.from; y <= best.to; y++) {
    const { lum } = rowStats(buf, y);
    for (const l of lum) { bandLum += l; count++; }
  }
  const luminance = bandLum / count;
  return {
    top: +(best.from / H).toFixed(4),
    height: +((best.to - best.from + 1) / H).toFixed(4),
    luminance: +luminance.toFixed(3),
    confident: best.score > 0.12,
  };
}

const dir = join(root, 'art/tiles');
const files = readdirSync(dir).filter((f) => f.endsWith('.jpg'));
const banners = {};
for (const file of files.sort()) {
  const id = basename(file, '.jpg');
  const found = detect(join(dir, file));
  banners[id] = found;
  console.log(
    `${id.padEnd(26)} top=${(found.top * 100).toFixed(1)}% h=${(found.height * 100).toFixed(1)}% ` +
    `lum=${found.luminance} ${found.confident ? '' : '(low confidence)'}`,
  );
}

const body = Object.entries(banners)
  .map(([id, b]) =>
    `  '${id}': { top: ${b.top}, height: ${b.height}, luminance: ${b.luminance} },`)
  .join('\n');

writeFileSync(join(root, 'app/src/api/tile-banners.generated.ts'), `/**
 * GENERATED FILE — do not edit.
 *
 * Written by scripts/detect-tile-banners.mjs by measuring the artwork in
 * art/tiles. Re-run it after adding or replacing a tile.
 *
 * Each tile was drawn with an empty ornamental banner for the game's name, and
 * the banners are in different places on different tiles. These are the
 * measured positions, as fractions of the tile's height, plus the mean
 * luminance of the band — which is what decides whether the name is written in
 * dark or light type.
 */

export interface TileBanner {
  /** Distance from the top of the tile, as a fraction of its height. */
  top: number;
  /** Band height, as a fraction of the tile's height. */
  height: number;
  /** 0 is black, 1 is white. Above ~0.5 the name has to be dark to be read. */
  luminance: number;
}

export const TILE_BANNERS: Record<string, TileBanner> = {
${body}
};
`);
console.log(`\nWrote ${Object.keys(banners).length} banners.`);
