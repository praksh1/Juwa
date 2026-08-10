/**
 * Strip leftover chroma-key magenta out of symbol art.
 *
 *   node scripts/dechroma-art.mjs            report what would change
 *   node scripts/dechroma-art.mjs --write    rewrite the files in place
 *
 * ## What this is fixing
 *
 * Several of the generated symbols shipped with a bright magenta fill where a
 * HOLE should be. The Chinese coin has a square hole through the middle and it
 * arrived filled with #FF00FF; the folding fan's ribs have gaps between them
 * and the gaps arrived magenta too. On a dark reel that reads as a bright pink
 * block sitting in the middle of a gold coin — which is exactly how a player
 * photographed it.
 *
 * Magenta is the traditional chroma key precisely because almost nothing real
 * is that colour, which is what makes this safe to automate: no gold coin, no
 * lemon and no tiger contains a saturated fuchsia pixel by accident. The
 * catalogue's own numbers bear that out — the asian set is 1.5-3.4% magenta by
 * area and the egypt, fruit, pirate and jungle sets are 0.00%.
 *
 * ## Why the edge needs two thresholds
 *
 * A key that has been through a resize has an anti-aliased fringe: pixels that
 * are part subject and part key. Deleting only the pure ones leaves a pink halo
 * a pixel or two wide, which is more obviously wrong than the block was,
 * because a halo looks like a rendering fault rather than like art. So the
 * strong core is removed outright and the fringe is de-magenta'd — its green
 * channel is pulled back up to match its neighbours, and its alpha is reduced
 * in proportion to how much key was in it.
 */

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dir = join(root, 'art/symbols');
const WRITE = process.argv.includes('--write');

/**
 * How much of this pixel is the key, from 0 to 1.
 *
 * ## The threshold is narrow ON PURPOSE
 *
 * The first version of this asked "is the pixel magenta-ish", and the answer
 * for `fruit_plum.png` — a purple plum — was yes, 20,000 pixels of yes. An
 * automated fix that eats a legitimate symbol is far worse than the bug it is
 * fixing, so this was measured before it was written rather than after.
 *
 * The key in these files is PURE #FF00FF: sampled across the affected art, the
 * dominant colour is (248, 0, 248) and its anti-aliased fringe runs up the
 * green channel while red and blue stay pinned near 255. Nothing legitimate in
 * the catalogue looks like that — the plum is (136, 56, 168), the candy is
 * (232, 104, 168), and both fail the red-AND-blue test outright.
 *
 * So: both red and blue must be nearly saturated, and the score is how far
 * green has been pulled down from them. A subject that is merely purple, pink
 * or violet cannot reach it.
 */
function keyness(r, g, b) {
  if (r < 220 || b < 220) return 0;
  const gap = Math.min(r, b) - g;
  if (gap < 100) return 0;
  // g = 0 is the pure key; by g = 140 there is nothing of it left.
  return Math.max(0, Math.min(1, 1 - g / 140));
}

/**
 * The softer halo, for files already proven to carry the key.
 *
 * Removing only near-pure magenta leaves a pink glow wherever the key was
 * blended over the subject — the scarab kept a fuchsia ring around its sun
 * disc. This catches that, and it is only ever run on a file whose pure key was
 * already found, so it cannot invent a problem in art that never had one.
 *
 * Blue is what makes it safe. Gold, the colour most of this art is made of,
 * runs red > green > blue — (240, 190, 90) — so a rule that demands a HIGH blue
 * channel alongside a low green cannot touch it. Nor can the green scarab, the
 * red tassel or the cherries.
 */
function fringeness(r, g, b) {
  if (r < 200 || b < 160) return 0;
  const gap = Math.min(r, b) - g;
  if (gap < 60) return 0;
  return Math.max(0, Math.min(1, (gap - 60) / 110));
}

let touched = 0;
const report = [];

for (const file of readdirSync(dir).filter((f) => f.toLowerCase().endsWith('.png'))) {
  const path = join(dir, file);
  const png = PNG.sync.read(readFileSync(path));

  /*
   * A file with no PURE key has no key at all.
   *
   * The fringe rule alone flags bright pink highlights on things that are meant
   * to be pink — the orchid, the eye of Horus — and correcting those would dull
   * real art to fix a problem it does not have. A chroma key always leaves a
   * solid core behind; if there is no core, every pinkish pixel in the file is
   * somebody's paint. So the file is only touched when the key is provably
   * present.
   */
  let hasKey = false;
  for (let i = 0; i < png.data.length && !hasKey; i += 4) {
    if (png.data[i + 3] < 8) continue;
    if (keyness(png.data[i], png.data[i + 1], png.data[i + 2]) >= 0.8) hasKey = true;
  }
  if (!hasKey) continue;

  let core = 0;
  let fringe = 0;

  for (let i = 0; i < png.data.length; i += 4) {
    const r = png.data[i];
    const g = png.data[i + 1];
    const b = png.data[i + 2];
    const a = png.data[i + 3];
    if (a < 8) continue;

    const k = keyness(r, g, b);
    if (k >= 0.8) {
      // Pure key. Gone, and the colour is neutralised too so no fringe of it
      // survives a later resize with premultiplied alpha.
      png.data[i] = 0;
      png.data[i + 1] = 0;
      png.data[i + 2] = 0;
      png.data[i + 3] = 0;
      core++;
    } else if (fringeness(r, g, b) > 0.12) {
      const fk = fringeness(r, g, b);
      png.data[i + 1] = Math.round(g + (Math.min(r, b) - g) * fk);
      png.data[i + 3] = Math.round(a * (1 - fk * 0.85));
      fringe++;
    } else if (k > 0.15) {
      // Part key, part subject. Lift green back towards its neighbours so the
      // pixel stops being pink, and take the alpha down by the same fraction.
      png.data[i + 1] = Math.round(g + (Math.min(r, b) - g) * k);
      png.data[i + 3] = Math.round(a * (1 - k));
      fringe++;
    }
  }

  if (core + fringe === 0) continue;
  touched++;
  report.push({ file, core, fringe });
  if (WRITE) writeFileSync(path, PNG.sync.write(png));
}

report.sort((a, b) => b.core - a.core);
for (const r of report) {
  console.log(`${r.file.padEnd(30)} ${String(r.core).padStart(6)} keyed  ${String(r.fringe).padStart(6)} fringe`);
}
console.log(
  report.length === 0
    ? 'No chroma key found in any symbol.'
    : `${touched} file(s) ${WRITE ? 'rewritten' : 'would change — re-run with --write'}`,
);
