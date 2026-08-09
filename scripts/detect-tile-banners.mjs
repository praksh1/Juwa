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
  // Banners live near the top. A wider window is how the first version found a
  // bright patch of treasure 36% down and called it a sign.
  const limit = Math.floor(H * 0.3);

  const raw = [];
  for (let y = 0; y < limit; y++) {
    const { mean, rough } = rowStats(buf, y);
    // Flat AND bright. Roughness is subtracted hard: an ornate frame is bright
    // too, and flatness is what says "blank sign" rather than "picture".
    raw.push(mean - rough * 4);
  }

  // Subtract the median so only rows that stand out from this particular tile
  // count as positive. Without a baseline a uniformly bright tile scores every
  // row, and the band grows to fill the window.
  const median = [...raw].sort((a, b) => a - b)[Math.floor(raw.length / 2)];
  const scores = raw.map((v) => v - median);

  // Largest-sum contiguous run (Kadane). Maximising the SUM rather than the
  // MEAN is the fix for every band coming back at the minimum length: a mean is
  // highest over the single best row, so it always collapsed to the floor,
  // whereas a sum keeps extending while rows are still above baseline — which
  // is exactly the extent of the plaque.
  let best = { score: -Infinity, from: 0, to: 0 };
  let runStart = 0;
  let running = 0;
  for (let y = 0; y < scores.length; y++) {
    if (running <= 0) {
      running = scores[y];
      runStart = y;
    } else {
      running += scores[y];
    }
    if (running > best.score) best = { score: running, from: runStart, to: y };
  }

  // A sign is a band, not a line. Anything thinner is a highlight.
  const minRun = Math.max(3, Math.round(H * 0.045));
  if (best.to - best.from + 1 < minRun) {
    const centre = Math.round((best.from + best.to) / 2);
    best.from = Math.max(0, centre - Math.floor(minRun / 2));
    best.to = Math.min(limit - 1, best.from + minRun - 1);
  }

  let bandLum = 0;
  let count = 0;
  for (let y = best.from; y <= best.to; y++) {
    const { lum } = rowStats(buf, y);
    for (const l of lum) {
      bandLum += l;
      count++;
    }
  }
  const luminance = bandLum / count;
  return {
    top: +(best.from / H).toFixed(4),
    height: +((best.to - best.from + 1) / H).toFixed(4),
    luminance: +luminance.toFixed(3),
  };
}

/**
 * Hand-corrected banners.
 *
 * The detector is good but not perfect, and these entries beat it. Both tiles
 * below have a bright ornate frame running the full height, which gives the
 * scoring a second flat bright band to lock onto lower down — the title landed
 * under the sign rather than on it.
 *
 * Rather than keep tuning a heuristic against artwork I can only partly see,
 * anything visibly wrong on a phone belongs here. Add the game id and the band
 * as fractions of the tile height, measured off a screenshot; re-running the
 * detector keeps it.
 */
const OVERRIDES = {
  // Detector put this at 12.1%; the plaque is at the very top of the frame.
  'slot-royal-flush': { top: 0.02, height: 0.17, luminance: 0.72 },
  // Detector put this at 21.8%, well below the blue banner.
  'slot-ocean-drift': { top: 0.05, height: 0.14, luminance: 0.52 },
};

const dir = join(root, 'art/tiles');
const files = readdirSync(dir).filter((f) => f.endsWith('.jpg'));
const banners = {};
for (const file of files.sort()) {
  const id = basename(file, '.jpg');
  const found = OVERRIDES[id] ?? detect(join(dir, file));
  banners[id] = found;
  console.log(
    `${id.padEnd(26)} top=${(found.top * 100).toFixed(1)}% h=${(found.height * 100).toFixed(1)}% ` +
    `lum=${found.luminance}${OVERRIDES[id] ? ' (hand-corrected)' : ''}`,
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
