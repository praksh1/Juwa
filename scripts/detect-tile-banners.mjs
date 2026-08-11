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

/**
 * The tile's own colour, as a hue in degrees.
 *
 * Taken over the WHOLE tile, not the banner: the question this answers is "what
 * colour is this game", which is what the title is then set to complement. A
 * saturation-weighted histogram is what stops a mostly-navy tile with one
 * scarlet dragon on it reporting "blue" — the dragon is the thing a player sees
 * from across a lobby, and washed-out background pixels outnumber it ten to one
 * while carrying almost none of the tile's character.
 */
function dominantHue(buf) {
  const BUCKETS = 24;
  const weight = new Array(BUCKETS).fill(0);
  for (let i = 0; i < buf.length; i += 3) {
    const r = buf[i] / 255, g = buf[i + 1] / 255, b = buf[i + 2] / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const l = (max + min) / 2;
    if (l < 0.15 || l > 0.9) continue; // Near-black and near-white have no hue.
    const d = max - min;
    if (d < 0.18) continue; // Grey. Nothing to learn from it.
    const s = d / (1 - Math.abs(2 * l - 1));
    let h;
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h = (h * 60 + 360) % 360;
    weight[Math.floor(h / (360 / BUCKETS)) % BUCKETS] += s;
  }
  let best = 0;
  for (let i = 1; i < BUCKETS; i++) if (weight[i] > weight[best]) best = i;
  // Interpolate against the neighbouring buckets so a hue sitting on a bucket
  // boundary doesn't snap 15 degrees away from where it actually is.
  const prev = weight[(best + BUCKETS - 1) % BUCKETS];
  const next = weight[(best + 1) % BUCKETS];
  const shift = (next - prev) / (2 * (weight[best] || 1));
  const step = 360 / BUCKETS;
  return Math.round((((best + 0.5 + shift) * step) % 360 + 360) % 360);
}

/**
 * Measure a tile.
 *
 * `forced` is a hand-measured band as `{ top, height }` fractions. When given,
 * the search is skipped but everything else — the band's brightness, how busy
 * it is, the tile's hue — is still measured from the artwork. Hand-writing
 * those numbers as well is how a corrected tile ends up with the right position
 * and the wrong ink colour.
 */
function detect(file, forced) {
  const buf = pixels(file);
  const hue = dominantHue(buf);
  if (forced) {
    const from = Math.round(forced.top * H);
    const to = Math.min(H - 1, from + Math.round(forced.height * H) - 1);
    return { top: forced.top, height: forced.height, hue, ...bandStats(buf, from, to) };
  }
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

  return {
    top: +(best.from / H).toFixed(4),
    height: +((best.to - best.from + 1) / H).toFixed(4),
    hue,
    ...bandStats(buf, best.from, best.to),
  };
}

/**
 * How bright the band is, and how busy.
 *
 * Roughness is the half that matters most for the look: a tile whose "banner"
 * is really just the least-cluttered strip of a painting needs a plate drawn
 * under its name, and a tile with an actual blank sign must not have one — a
 * dark slab over a painted plaque hides the exact thing the artist left room
 * for. That decision cannot be made from brightness alone, which is why the
 * first version of this file put bare text over a burning fireplace.
 */
function bandStats(buf, from, to) {
  let lumSum = 0, lumN = 0, roughSum = 0, rows = 0;
  for (let y = from; y <= to; y++) {
    const { rough, lum } = rowStats(buf, y);
    for (const l of lum) { lumSum += l; lumN++; }
    roughSum += rough;
    rows++;
  }
  return {
    luminance: +(lumSum / lumN).toFixed(3),
    rough: +(roughSum / rows).toFixed(4),
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
  'slot-royal-flush': { top: 0.02, height: 0.17 },
  // Detector put this at 21.8%, well below the blue banner.
  'slot-ocean-drift': { top: 0.08, height: 0.12 },
  // Big blank jade plaque across the top; the detector chose the sky under it.
  'slot-jade-temple': { top: 0.03, height: 0.08 },
  // These four share one motif: a gold flourish a tenth of the way down with
  // clear ground above it. The flourish is the brightest flattest thing in the
  // window, so the detector centred on the flourish itself every time.
  //
  // The band above it is shallow, so these are the tiles where a title that is
  // a few percent high stops looking high and starts looking like it is resting
  // on the frame around the tile.
  'slot-city-lights': { top: 0.035, height: 0.09 },
  'slot-carnival-row': { top: 0.035, height: 0.09 },
  'slot-storm-chaser': { top: 0.03, height: 0.08 },
  // No sign, but a wide band of dark night sky above the moon, which carries
  // gold lettering better than any plate would.
  'slot-aurora-borealis': { top: 0.04, height: 0.07 },

  /*
   * Two more of the same failure, measured off the artwork rather than a
   * screenshot.
   *
   * Both tiles carry a genuinely blank sign across the very top — a deep red
   * field on Sunset Strip, a dark olive panel on Royal Fortune — and in both
   * cases the detector walked past it and locked onto a smooth region BELOW:
   * the night sky between the searchlights, and the wall between the pillars.
   * The result was a title sitting under its own banner, over a pair of
   * crossing searchlights in one case and half on the frame in the other.
   *
   * Both signs are dark, so the light metal these get is the right one.
   */
  'slot-sunset-strip': { top: 0.023, height: 0.088 },
  'slot-royal-flush': { top: 0.012, height: 0.133 },

  // ---- tiles with nowhere to write ----
  // On these four the top of the artwork is the subject: a carved frieze and a
  // panther's headdress, a Vegas skyline, a temple in full sun, a fireplace.
  // There is no blank sign anywhere on them, and forcing a name into the least
  // busy strip of a painting is how the title ended up looking dropped on by
  // accident. They get their own plate along the bottom instead.
  'slot-lucky-sevens': { placement: 'plate' },
  'slot-neon-alley': { placement: 'plate' },
  'slot-desert-mirage': { placement: 'plate' },
  'slot-jungle-run': { placement: 'plate' },
};

const dir = join(root, 'art/tiles');
const files = readdirSync(dir).filter((f) => f.endsWith('.jpg'));
const banners = {};
for (const file of files.sort()) {
  const id = basename(file, '.jpg');
  const override = OVERRIDES[id];
  const band = override && override.top !== undefined ? override : undefined;
  const found = detect(join(dir, file), band);
  found.placement = override?.placement ?? 'banner';
  banners[id] = found;
  console.log(
    `${id.padEnd(26)} top=${(found.top * 100).toFixed(1)}% h=${(found.height * 100).toFixed(1)}% ` +
    `lum=${found.luminance} rough=${found.rough} hue=${found.hue}° ${found.placement}` +
    `${override ? ' (hand-corrected)' : ''}`,
  );
}

const body = Object.entries(banners)
  .map(([id, b]) =>
    `  '${id}': { top: ${b.top}, height: ${b.height}, luminance: ${b.luminance}, ` +
    `rough: ${b.rough}, hue: ${b.hue}, placement: '${b.placement}' },`)
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
  /** How busy the band is horizontally. Near 0 is a blank sign. */
  rough: number;
  /** The tile's own dominant colour, in degrees. Drives the title's metal. */
  hue: number;
  /**
   * 'banner' writes the name into the painted sign at \`top\`.
   * 'plate' means the artwork has no sign, so the name gets its own bar along
   * the bottom of the tile.
   */
  placement: 'banner' | 'plate';
}

export const TILE_BANNERS: Record<string, TileBanner> = {
${body}
};
`);
console.log(`\nWrote ${Object.keys(banners).length} banners.`);
