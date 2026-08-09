/**
 * Cut the transparency checkerboard off the edges of a lobby tile.
 *
 * Several tiles came back from the image generator on a transparent canvas and
 * were flattened to JPEG with the editor's own checkerboard baked in — so the
 * artwork ships with a literal grey chessboard painted around it. On Triple Bar
 * it is a sixth of the width. It is invisible while you are looking at the art
 * and impossible to miss once you have seen it in a lobby.
 *
 *   node scripts/trim-tile-margins.mjs [--dry]
 *
 * Idempotent: a tile with nothing grey around it is left alone, so this can be
 * re-run after adding art without a second thought.
 *
 * A checkerboard is identified as a run of edge rows or columns that are both
 * exactly neutral and alternating (see the two constants below). The scan is
 * anchored at the EDGES and stops at the first line that fails, because a grey
 * stone border somewhere in the middle of a painting is artwork, not packaging.
 *
 * Cropping cannot finish the job on its own. On Supernova the checkerboard is
 * only in the CORNERS — the crown on top of the frame reaches the top edge
 * between them — and there is no rectangle that removes the corners and keeps
 * the crown. So a second pass floods inward from the border and paints out
 * every neutral pixel it can reach, which leaves the artwork sitting on the
 * card's own background as though the corners had been cut on purpose. Flooding
 * from the EDGE is what makes this safe: the silver in Vault Breaker and the
 * diamonds in City Lights are neutral too, and they are not reachable from
 * outside.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, mkdtempSync, renameSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const FFMPEG = process.env.FFMPEG || 'ffmpeg';
const dry = process.argv.includes('--dry');
const work = mkdtempSync(join(tmpdir(), 'trim-'));

/**
 * How neutral a pixel has to be to count as packaging.
 *
 * Strict on purpose. A checkerboard is drawn in exact greys — a sample taken
 * off one reads r = g = b to the byte — while a painting that merely looks grey
 * is never quite neutral. A loose "close enough to grey" threshold put three
 * innocent tiles on the crop list.
 *
 * It has to be paired with a high sampling resolution. Downscaling averages the
 * edge of the checkerboard together with the paint beside it, which tints the
 * result just enough to fail this test; at 160px wide the narrowest margins
 * vanished from the scan entirely.
 */
const GREY_CHROMA = 6;
/**
 * ...and how much the margin has to vary across the whole of it.
 *
 * This is the half that actually identifies a checkerboard, and getting here
 * took two wrong answers. The margins are not a colour — the affected tiles
 * carry theirs at wildly different exposures, 57-105, 110-154 and 195-255 — so
 * no brightness threshold separates them from artwork, and the one I tried
 * excluded the darkest checkerboard while still catching a black sky. What
 * they have in common is that they ALTERNATE. A flat dark edge of a painting
 * does not.
 *
 * Applied to the STRIP, not to each line. Applying it per line stops the scan
 * dead at any column that happens to land on the seam between a light square
 * and a dark one, because that column averages to a single flat grey: on Triple
 * Bar the scan halted eleven columns in, cropped, and then found the rest of
 * the same checkerboard on the next run.
 */
const GREY_SWING = 20;
/** A row or column counts as blank when this much of it is neutral. */
const BLANK_SHARE = 0.9;
/**
 * What painted-out packaging is replaced with: `colors.surface.raised`, the
 * card the tile is mounted on. Anything else would read as a grey halo.
 */
const CARD = [0x13, 0x11, 0x1c];
/** Below this the pixel is a shadow in the artwork, not the editor's canvas. */
const FLOOD_FLOOR = 40;

function sample(file, w, h) {
  const raw = join(work, 'f.raw');
  execFileSync(FFMPEG, ['-y', '-loglevel', 'error', '-i', file,
    '-vf', `scale=${w}:${h}`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', raw]);
  return readFileSync(raw);
}

/** Fractions of the image that are blank on each side. */
function margins(file) {
  const W = 640, H = 696;
  const buf = sample(file, W, H);
  const at = (x, y) => {
    const i = (y * W + x) * 3;
    const max = Math.max(buf[i], buf[i + 1], buf[i + 2]);
    const min = Math.min(buf[i], buf[i + 1], buf[i + 2]);
    return { neutral: max - min <= GREY_CHROMA, value: max };
  };
  const col = (x) => Array.from({ length: H }, (_, y) => at(x, y));
  const row = (y) => Array.from({ length: W }, (_, x) => at(x, y));
  const isNeutral = (pixels) =>
    pixels.filter((p) => p.neutral).length / pixels.length >= BLANK_SHARE;

  /**
   * March inward while every line is neutral, then ask whether what was
   * collected actually alternates. If it does not, the edge was flat paint and
   * nothing is cropped.
   */
  const margin = (limit, line) => {
    let n = 0, lo = 255, hi = 0;
    while (n < limit) {
      const pixels = line(n);
      if (!isNeutral(pixels)) break;
      for (const { value } of pixels) {
        lo = Math.min(lo, value);
        hi = Math.max(hi, value);
      }
      n++;
    }
    return hi - lo >= GREY_SWING ? n : 0;
  };

  return {
    left: margin(W, (n) => col(n)) / W,
    right: margin(W, (n) => col(W - 1 - n)) / W,
    top: margin(H, (n) => row(n)) / H,
    bottom: margin(H, (n) => row(H - 1 - n)) / H,
  };
}

/** Native pixel dimensions, read back off ffmpeg's own report. */
function dimensions(file) {
  let text = '';
  try {
    execFileSync(FFMPEG, ['-hide_banner', '-i', file], { stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (err) {
    // ffmpeg exits non-zero when given no output file, having already printed
    // everything we need.
    text = String(err.stderr ?? '');
  }
  const m = /,\s(\d{2,5})x(\d{2,5})[\s,]/.exec(text);
  if (!m) throw new Error(`could not read the size of ${basename(file)}`);
  return { width: Number(m[1]), height: Number(m[2]) };
}

/**
 * Paint out every neutral pixel reachable from the border.
 *
 * Returns the share of the image that was painted, or 0 if there was nothing
 * to do. Four-way flood rather than eight-way: the diagonal touch between two
 * squares of a checkerboard is not a leak worth chasing, and eight-way makes it
 * far easier for the flood to squeeze past a single soft pixel into artwork.
 */
function fillEdgeNeutral(file) {
  const { width: W, height: H } = dimensions(file);
  const buf = sample(file, W, H);
  const neutral = new Uint8Array(W * H);
  for (let p = 0; p < W * H; p++) {
    const i = p * 3;
    const max = Math.max(buf[i], buf[i + 1], buf[i + 2]);
    const min = Math.min(buf[i], buf[i + 1], buf[i + 2]);
    neutral[p] = max - min <= GREY_CHROMA && max > FLOOD_FLOOR ? 1 : 0;
  }

  const seen = new Uint8Array(W * H);
  const stack = [];
  const push = (x, y) => {
    const p = y * W + x;
    if (!seen[p] && neutral[p]) { seen[p] = 1; stack.push(p); }
  };
  for (let x = 0; x < W; x++) { push(x, 0); push(x, H - 1); }
  for (let y = 0; y < H; y++) { push(0, y); push(W - 1, y); }

  let painted = 0;
  while (stack.length) {
    const p = stack.pop();
    painted++;
    const x = p % W, y = (p - x) / W;
    if (x > 0) push(x - 1, y);
    if (x < W - 1) push(x + 1, y);
    if (y > 0) push(x, y - 1);
    if (y < H - 1) push(x, y + 1);
  }
  if (painted / (W * H) < 0.001) return 0;

  for (let p = 0; p < W * H; p++) {
    if (!seen[p]) continue;
    buf[p * 3] = CARD[0];
    buf[p * 3 + 1] = CARD[1];
    buf[p * 3 + 2] = CARD[2];
  }

  const raw = join(work, 'filled.raw');
  writeFileSync(raw, buf);
  const out = join(work, basename(file));
  execFileSync(FFMPEG, ['-y', '-loglevel', 'error',
    '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', `${W}x${H}`, '-i', raw,
    '-q:v', '3', out]);
  renameSync(out, file);
  return painted / (W * H);
}

const dir = join(root, 'art/tiles');
let trimmed = 0;
for (const file of readdirSync(dir).filter((f) => f.endsWith('.jpg')).sort()) {
  const path = join(dir, file);
  const m = margins(path);
  const notes = [];

  // A tenth of a percent either side is measurement noise, and re-cropping by a
  // pixel on every run is how a committed asset ends up with a different
  // checksum every time it is looked at.
  if (m.left + m.right + m.top + m.bottom >= 0.004) {
    notes.push(
      `trim L${(m.left * 100).toFixed(1)}% R${(m.right * 100).toFixed(1)}% ` +
      `T${(m.top * 100).toFixed(1)}% B${(m.bottom * 100).toFixed(1)}%`,
    );
    if (!dry) {
      const out = join(work, file);
      execFileSync(FFMPEG, ['-y', '-loglevel', 'error', '-i', path,
        '-vf',
        `crop=iw*${(1 - m.left - m.right).toFixed(4)}:ih*${(1 - m.top - m.bottom).toFixed(4)}:` +
        `iw*${m.left.toFixed(4)}:ih*${m.top.toFixed(4)}`,
        '-q:v', '3', out]);
      renameSync(out, path);
    }
  }

  // Corners and other shapes a rectangle cannot reach. Skipped on a dry run,
  // because with nothing cropped yet it would report the strips too.
  if (!dry) {
    const filled = fillEdgeNeutral(path);
    if (filled) notes.push(`painted out ${(filled * 100).toFixed(2)}%`);
  }

  if (notes.length) {
    console.log(`${basename(file).padEnd(28)} ${notes.join(', ')}`);
    trimmed++;
  }
}
console.log(`\n${trimmed} tile(s) trimmed.`);
if (trimmed && !dry) {
  console.log('Banner positions are fractions of the tile, so re-run:');
  console.log('  node scripts/detect-tile-banners.mjs');
}
