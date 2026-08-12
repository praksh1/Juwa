/**
 * Recover the alpha channel from art that arrived with the transparency
 * checkerboard painted into the pixels.
 *
 *   node scripts/decheck-art.mjs art/incoming            report
 *   node scripts/decheck-art.mjs art/incoming --write    write *-keyed.png
 *
 * ## The fault
 *
 * Asked for a transparent PNG, the generator returns an OPAQUE one in which the
 * grey chequerboard a paint program draws *behind* transparency has been
 * rendered as actual pixels. It previews correctly on a white page and appears
 * as a grey checked box on a dark reel. This repo has taken four drops of
 * generated art and hit it in every one — 11 of 30, 4 of 9, 5 of 5, and now 20
 * of 25.
 *
 * ## Why this can be automated safely
 *
 * The checkerboard is two flat NEUTRAL greys in a regular grid, and the subject
 * matter here is gold, jade and ruby. Neutrality is the discriminator: a pixel
 * that is simultaneously (a) neutral within a few units, (b) at one of the two
 * measured levels, and (c) connected to the frame edge through other such
 * pixels is background with near-certainty. All three conditions are needed —
 * the coin has neutral grey shadow pixels, but they are enclosed by gold, so
 * connectivity excludes them.
 *
 * The two levels and the square size are MEASURED per file rather than assumed.
 * They vary a lot across this drop: the coins came back with a dark checker at
 * 51/100 and 10-pixel squares, the dragons with a light one at 205/255, and the
 * banners so heavily downscaled that the checker has averaged into a nearly
 * flat 148-152. A single hard-coded pair would have keyed one set and destroyed
 * another.
 *
 * ## The edge is the whole quality question
 *
 * A binary mask leaves a grey fringe one or two pixels wide, which reads as a
 * rendering fault rather than as art — worse than the checkerboard, because a
 * checkerboard is obviously wrong and a halo looks like the game is broken.
 *
 * So the boundary band is un-composited instead. Every pixel there is a mix:
 *
 *     observed = alpha * subject + (1 - alpha) * checker
 *
 * `checker` is known (measured above) and `alpha` is estimated from how far the
 * pixel has moved off neutral. Solving for `subject` recovers the original
 * colour, which is why the recovered edges are gold rather than grey-gold.
 *
 * Pixels that are pure checker get alpha 0 and are left black — fully
 * transparent black composites to nothing, and it keeps the file small.
 */

import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { basename, extname, join, resolve } from 'node:path';
import { PNG } from 'pngjs';

const WRITE = process.argv.includes('--write');
const target = process.argv.find((a) => !a.startsWith('-') && a.endsWith('incoming'))
  ?? process.argv[2]
  ?? 'art/incoming';

/** How far off neutral a pixel may be and still count as checker. */
const NEUTRAL_TOLERANCE = 12;
/** How far from a measured checker level a pixel may be and still match it. */
const LEVEL_TOLERANCE = 14;
/**
 * How far from a level a pixel may be and count as PARTIAL checker — the
 * anti-aliased band that has to be un-composited rather than cut.
 */
const FRINGE_TOLERANCE = 60;

/** Neutral means the three channels agree. Gold and jade do not. */
const spread = (r, g, b) => Math.max(r, g, b) - Math.min(r, g, b);

/**
 * The two checker levels, measured from a border ring.
 *
 * A six-pixel ring, because every asset in this brief is framed with the
 * subject at about 85% of the canvas — so the ring is background by
 * construction. Returns null when the border is not neutral at all, which is
 * how a correctly-delivered file (a glow on solid black, or one that already
 * has alpha) is recognised and skipped.
 */
function measureChecker(png) {
  const { width, height, data } = png;
  const counts = new Map();
  let neutral = 0;
  let total = 0;

  const sample = (x, y) => {
    const i = (y * width + x) * 4;
    const [r, g, b] = [data[i], data[i + 1], data[i + 2]];
    total += 1;
    if (spread(r, g, b) > NEUTRAL_TOLERANCE) return;
    neutral += 1;
    const level = Math.round((r + g + b) / 3);
    counts.set(level, (counts.get(level) ?? 0) + 1);
  };

  for (let x = 0; x < width; x += 1) {
    for (const y of [0, 1, 2, 3, 4, 5, height - 6, height - 5, height - 4, height - 3, height - 2, height - 1]) {
      if (y >= 0 && y < height) sample(x, y);
    }
  }
  for (let y = 0; y < height; y += 1) {
    for (const x of [0, 1, 2, 3, 4, 5, width - 6, width - 5, width - 4, width - 3, width - 2, width - 1]) {
      if (x >= 0 && x < width) sample(x, y);
    }
  }

  // A border that is not overwhelmingly neutral is not a checkerboard.
  if (neutral / total < 0.9) return null;

  /*
   * A border that is essentially BLACK is not a checkerboard either — it is one
   * of the glow assets, deliberately delivered on solid black because a soft
   * glow cannot survive the checkerboard fault at all. Those are composited
   * additively, where black contributes nothing, so keying them would destroy
   * the falloff that is the entire asset.
   */
  const darkest = Math.min(...counts.keys());
  const brightest = Math.max(...counts.keys());
  if (brightest <= 12) return { black: true };

  /*
   * The two levels, taken as the two peaks of the border histogram rather than
   * simply the two most common values — adjacent values (204, 205, 206) are all
   * the same square with compression noise, and taking the top two would return
   * one level twice.
   */
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const first = sorted[0][0];
  const second = sorted.find(([level]) => Math.abs(level - first) > 20)?.[0];
  if (second === undefined) {
    // One flat level. That is a solid background, not a checkerboard — still
    // keyable, and safer, so it is treated as both levels being the same.
    return { levels: [first, first], flat: true };
  }
  return { levels: [first, second].sort((a, b) => a - b), flat: false };
}

/**
 * 0 = certainly checker, 1 = certainly subject, in between = the fringe.
 *
 * ## The band, not the two peaks
 *
 * The obvious test is "is this pixel close to one of the two measured levels",
 * and it fails in a way that is invisible until you count the result. The
 * checkerboard's own squares are anti-aliased against each other, so every
 * square boundary is a one-pixel line at the MIDPOINT of the two levels — 93,
 * for a checker of 69 and 118. Proximity-to-a-peak calls those pixels subject,
 * which lays a lattice of thin walls across the whole background, and a
 * four-connected flood fill cannot cross a wall. The fill then reaches only the
 * squares it started in: it cleared 14% of a coin image whose background is
 * measurably 44%.
 *
 * Treating the whole BAND between the levels as background costs nothing —
 * there is no subject matter in this brief that is simultaneously neutral and
 * sitting between the two greys — and it makes the background one connected
 * region again, which is what the fill needs.
 */
function subjectness(r, g, b, band) {
  const s = spread(r, g, b);
  if (s > FRINGE_TOLERANCE) return 1;
  const level = (r + g + b) / 3;
  const outside =
    level < band.lo ? band.lo - level : level > band.hi ? level - band.hi : 0;
  if (s <= NEUTRAL_TOLERANCE && outside === 0) return 0;
  // Blend on whichever measure is further from "background". Both are scaled to
  // the same 0..1 so the larger genuinely dominates.
  return Math.max(
    Math.min(1, s / FRINGE_TOLERANCE),
    Math.min(1, outside / (FRINGE_TOLERANCE / 2)),
  );
}

function key(png) {
  const checker = measureChecker(png);
  if (!checker || checker.black) return checker?.black ? { black: true } : null;

  const { width, height, data } = png;
  const { levels } = checker;
  const mean = (levels[0] + levels[1]) / 2;
  const band = { lo: levels[0] - LEVEL_TOLERANCE, hi: levels[1] + LEVEL_TOLERANCE };

  // Pass 1: how much of each pixel is subject.
  const alpha = new Float32Array(width * height);
  for (let i = 0, p = 0; p < width * height; p += 1, i += 4) {
    alpha[p] = subjectness(data[i], data[i + 1], data[i + 2], band);
  }

  /*
   * Pass 2: flood fill from the border through fully-background pixels.
   *
   * This is what stops the key eating neutral greys INSIDE the artwork — the
   * coin's shadowed rim, the dragon's teeth. They are enclosed by saturated
   * colour, so the fill never reaches them and they keep their alpha.
   */
  const outside = new Uint8Array(width * height);
  const stack = [];
  const push = (x, y) => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const p = y * width + x;
    if (outside[p] || alpha[p] > 0) return;
    outside[p] = 1;
    stack.push(x, y);
  };
  for (let x = 0; x < width; x += 1) {
    push(x, 0);
    push(x, height - 1);
  }
  for (let y = 0; y < height; y += 1) {
    push(0, y);
    push(width - 1, y);
  }
  while (stack.length) {
    const y = stack.pop();
    const x = stack.pop();
    push(x + 1, y);
    push(x - 1, y);
    push(x, y + 1);
    push(x, y - 1);
  }

  /*
   * Pass 2a: absorb the neutral halo.
   *
   * The confetti ribbon has a soft bloom painted around it. Where that bloom is
   * semi-transparent, the checkerboard shows THROUGH it — so those pixels are
   * neutral grey but sit outside the two measured levels, which the band test
   * calls subject. The result was a ring of surviving checker squares hanging
   * in the air around the ribbon.
   *
   * The test here is neutrality alone, applied only to pixels the fill can
   * already reach. It stops dead at gold, jade or ruby, because those are not
   * neutral at any brightness — so it eats a grey halo and cannot eat the
   * artwork. It is a second fill rather than a global rule for the same reason
   * the first one is a fill: an enclosed white highlight must be unreachable.
   */
  {
    const stack2 = [];
    const consider = (x, y) => {
      if (x < 0 || y < 0 || x >= width || y >= height) return;
      const p = y * width + x;
      if (outside[p]) return;
      const i = p * 4;
      if (spread(data[i], data[i + 1], data[i + 2]) > NEUTRAL_TOLERANCE * 2) return;
      outside[p] = 1;
      stack2.push(x, y);
    };
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        if (outside[y * width + x]) stack2.push(x, y);
      }
    }
    while (stack2.length) {
      const y = stack2.pop();
      const x = stack2.pop();
      consider(x + 1, y);
      consider(x - 1, y);
      consider(x, y + 1);
      consider(x, y - 1);
    }
  }

  /*
   * Pass 2b: enclosed background.
   *
   * The confetti ribbon curls into a loop and the dragon's tail coils over the
   * hoard, and the checkerboard shows through both. Those regions are genuinely
   * background but the fill cannot reach them from the frame edge, so they
   * survived as grey checked patches inside the artwork.
   *
   * Clearing every background-coloured pixel regardless of connectivity would
   * fix it and break something worse: the dragon's teeth are white, and white
   * sits inside a 205/255 checker's band. They would be punched out.
   *
   * The discriminator is the PATTERN, not the colour. A checkerboard alternates
   * between two levels on a grid; a tooth, a highlight or a pearl is uniformly
   * one level. So each enclosed candidate region is measured, and it is cleared
   * only if it actually contains both levels in quantity — which a checker
   * always does and a piece of artwork essentially never does.
   */
  if (!checker.flat) {
    const seen = new Uint8Array(width * height);
    for (let y0 = 0; y0 < height; y0 += 1) {
      for (let x0 = 0; x0 < width; x0 += 1) {
        const start = y0 * width + x0;
        if (seen[start] || outside[start] || alpha[start] > 0) continue;

        // Collect the connected region of background-coloured pixels.
        const region = [];
        const queue = [x0, y0];
        seen[start] = 1;
        let low = 0;
        let high = 0;
        while (queue.length) {
          const y = queue.pop();
          const x = queue.pop();
          const p = y * width + x;
          region.push(p);
          const level = (data[p * 4] + data[p * 4 + 1] + data[p * 4 + 2]) / 3;
          if (level < (levels[0] + levels[1]) / 2) low += 1;
          else high += 1;
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
            const np = ny * width + nx;
            if (seen[np] || outside[np] || alpha[np] > 0) continue;
            seen[np] = 1;
            queue.push(nx, ny);
          }
        }

        /*
         * Both levels present, and neither a rounding artefact. A checker
         * region is close to half and half; a white highlight that happens to
         * be neutral is ~100% one level. A third either way is a wide margin
         * that no uniform region reaches.
         */
        const minor = Math.min(low, high) / region.length;
        if (minor < 0.2 || region.length < 64) continue;
        for (const p of region) outside[p] = 1;
      }
    }
  }

  /*
   * Pass 3: the fringe. A partial pixel counts as background only if it touches
   * the outside — an anti-aliased edge does, a grey highlight in the middle of
   * the coin does not.
   */
  const touchesOutside = (x, y) => {
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        if (outside[ny * width + nx]) return true;
      }
    }
    return false;
  };

  let cleared = 0;
  let feathered = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const p = y * width + x;
      const i = p * 4;

      if (outside[p]) {
        data[i] = 0;
        data[i + 1] = 0;
        data[i + 2] = 0;
        data[i + 3] = 0;
        cleared += 1;
        continue;
      }

      const a = alpha[p];
      if (a >= 1 || !touchesOutside(x, y)) {
        data[i + 3] = 255;
        continue;
      }

      /*
       * Un-composite. observed = a*subject + (1-a)*checker, so
       * subject = (observed - (1-a)*checker) / a.
       *
       * Clamped, because the estimate of `a` is approximate and a slightly low
       * one sends the division past 255 — which would show as a bright speckle
       * along every edge.
       */
      const un = (v) => Math.max(0, Math.min(255, Math.round((v - (1 - a) * mean) / Math.max(a, 0.06))));
      data[i] = un(data[i]);
      data[i + 1] = un(data[i + 1]);
      data[i + 2] = un(data[i + 2]);
      data[i + 3] = Math.round(a * 255);
      feathered += 1;
    }
  }

  return { checker, cleared, feathered, pixels: width * height };
}

// ------------------------------------------------------------------- driver

const dir = resolve(process.cwd(), target);
if (!existsSync(dir)) {
  console.error(`No such folder: ${dir}`);
  process.exit(1);
}

const files = readdirSync(dir)
  .filter((f) => extname(f).toLowerCase() === '.png')
  // Never re-process our own output. A keyed file is transparent black in the
  // border, which the black-glow guard reads as "correct as delivered" — so a
  // second run looks like it worked and silently did nothing.
  .filter((f) => !f.endsWith('-keyed.png'));
let keyed = 0;
let skipped = 0;

for (const file of files.sort()) {
  const png = PNG.sync.read(readFileSync(join(dir, file)));
  const result = key(png);

  if (!result || result.black) {
    console.log(
      `· ${file.padEnd(28)} ${result?.black ? 'glow on solid black — correct as delivered' : 'no neutral border — left alone'}`,
    );
    skipped += 1;
    continue;
  }

  const { checker, cleared, feathered, pixels } = result;
  const pct = ((100 * cleared) / pixels).toFixed(1);
  console.log(
    `✓ ${file.padEnd(28)} checker ${checker.levels.join('/')}${checker.flat ? ' (flat)' : ''}` +
      ` → ${pct}% transparent, ${feathered} edge pixels recovered`,
  );
  keyed += 1;

  if (WRITE) {
    writeFileSync(join(dir, `${basename(file, '.png')}-keyed.png`), PNG.sync.write(png));
  }
}

console.log(
  `\n${files.length} files: ${keyed} keyed, ${skipped} already clean.` +
    (WRITE ? ' Written as *-keyed.png.' : ' Nothing written — pass --write.'),
);
