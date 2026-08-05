/**
 * Validate generated art before it reaches the game.
 *
 *   node scripts/check-art.mjs <folder>
 *
 * Image generators are confidently wrong in a small number of ways, and every
 * one of them is invisible until the asset is on a moving reel on a phone:
 *
 *   - An opaque background that looks fine on a white canvas and appears as a
 *     grey box behind the symbol on a dark reel.
 *   - Wildly different subject sizes across a set, so symbols jump and rescale
 *     as the reel spins.
 *   - Off-centre subjects, which read as a wobble at speed.
 *   - Two symbols with near-identical silhouette and colour, which players
 *     genuinely cannot tell apart during a spin — and then dispute the result.
 *   - 4MB PNGs. A hundred of those is a minute of loading on mobile data.
 *
 * Catching these at delivery costs nothing. Catching them after fifty assets
 * are generated means generating fifty again.
 *
 * Deliberately dependency-free: a PNG's header is a documented format and
 * node:zlib decompresses the pixels, so this needs nothing installed and
 * cannot rot when an image library changes its API.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { inflateSync } from 'node:zlib';
import { basename, extname, join, resolve } from 'node:path';

// --------------------------------------------------------------- PNG reading

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** IHDR plus the concatenated IDAT payload. */
function readPng(buffer) {
  if (!buffer.subarray(0, 8).equals(PNG_MAGIC)) throw new Error('not a PNG');

  let offset = 8;
  let header = null;
  let palette = null;
  let transparency = null;
  const idat = [];

  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);

    if (type === 'IHDR') {
      header = {
        width: data.readUInt32BE(0),
        height: data.readUInt32BE(4),
        bitDepth: data[8],
        colourType: data[9],
        interlace: data[12],
      };
    } else if (type === 'PLTE') {
      palette = Buffer.from(data);
    } else if (type === 'tRNS') {
      transparency = Buffer.from(data);
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
    offset += 12 + length;
  }

  if (!header) throw new Error('no IHDR chunk');
  return { ...header, palette, transparency, idat: Buffer.concat(idat) };
}

const CHANNELS = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

/**
 * Undo PNG's per-scanline filters and return raw samples.
 *
 * Only 8-bit non-interlaced images are handled — which is what every generator
 * and every export dialogue produces. Anything else is reported rather than
 * guessed at, because a wrong guess here yields plausible nonsense.
 */
function decodePixels(png) {
  if (png.bitDepth !== 8) throw new Error(`bit depth ${png.bitDepth} unsupported (need 8)`);
  if (png.interlace !== 0) throw new Error('interlaced PNG unsupported');
  const channels = CHANNELS[png.colourType];
  if (!channels) throw new Error(`colour type ${png.colourType} unsupported`);

  const raw = inflateSync(png.idat);
  const stride = png.width * channels;
  const out = Buffer.alloc(stride * png.height);

  for (let y = 0; y < png.height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    const target = out.subarray(y * stride, (y + 1) * stride);
    const previous = y > 0 ? out.subarray((y - 1) * stride, y * stride) : Buffer.alloc(stride);

    for (let x = 0; x < stride; x++) {
      const left = x >= channels ? target[x - channels] : 0;
      const up = previous[x];
      const upLeft = x >= channels ? previous[x - channels] : 0;
      let value = line[x];

      switch (filter) {
        case 0: break;
        case 1: value += left; break;
        case 2: value += up; break;
        case 3: value += Math.floor((left + up) / 2); break;
        case 4: {
          // Paeth: pick whichever neighbour predicts best.
          const p = left + up - upLeft;
          const dl = Math.abs(p - left);
          const du = Math.abs(p - up);
          const dul = Math.abs(p - upLeft);
          value += dl <= du && dl <= dul ? left : du <= dul ? up : upLeft;
          break;
        }
        default: throw new Error(`unknown filter ${filter}`);
      }
      target[x] = value & 0xff;
    }
  }
  if (png.colourType === 3) {
    // Indexed colour keeps its alpha in a separate tRNS table, so a palette
    // image with full transparency reports one channel and would otherwise
    // look opaque. Expand to RGBA rather than special-casing every measurement
    // downstream — this is exactly how an optimised asset is stored, so getting
    // it wrong rejects the files the pipeline itself produces.
    if (!png.palette) throw new Error('indexed PNG with no palette');
    const rgba = Buffer.alloc(png.width * png.height * 4);
    for (let i = 0; i < png.width * png.height; i++) {
      const index = out[i];
      rgba[i * 4] = png.palette[index * 3] ?? 0;
      rgba[i * 4 + 1] = png.palette[index * 3 + 1] ?? 0;
      rgba[i * 4 + 2] = png.palette[index * 3 + 2] ?? 0;
      rgba[i * 4 + 3] = png.transparency && index < png.transparency.length
        ? png.transparency[index]
        : 255;
    }
    return { pixels: rgba, channels: 4, stride: png.width * 4 };
  }

  return { pixels: out, channels, stride };
}

// -------------------------------------------------------------- measurements

/** Where the visible subject actually sits, and how much of the frame it fills. */
export function measure(png) {
  const { pixels, channels, stride } = decodePixels(png);
  const hasAlpha = channels === 4 || channels === 2;
  const alphaOffset = channels - 1;

  let minX = png.width, minY = png.height, maxX = -1, maxY = -1, opaque = 0;
  const cornerAlpha = [];

  for (let y = 0; y < png.height; y++) {
    for (let x = 0; x < png.width; x++) {
      const i = y * stride + x * channels;
      const a = hasAlpha ? pixels[i + alphaOffset] : 255;
      // 8 rather than 0: generators leave a faint halo of near-zero alpha that
      // is invisible but would make every bounding box the whole frame.
      if (a > 8) {
        opaque++;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  for (const [x, y] of [[0, 0], [png.width - 1, 0], [0, png.height - 1], [png.width - 1, png.height - 1]]) {
    const i = y * stride + x * channels;
    cornerAlpha.push(hasAlpha ? pixels[i + alphaOffset] : 255);
  }

  const boxWidth = maxX - minX + 1;
  const boxHeight = maxY - minY + 1;

  return {
    hasAlpha,
    // Share of the frame the subject covers. Consistency across a set matters
    // more than the absolute figure.
    fill: opaque / (png.width * png.height),
    // How far the subject's centre is from the frame's, as a fraction of size.
    offCentreX: Math.abs((minX + maxX) / 2 - (png.width - 1) / 2) / png.width,
    offCentreY: Math.abs((minY + maxY) / 2 - (png.height - 1) / 2) / png.height,
    boxWidth,
    boxHeight,
    /**
     * How much of the frame the subject's BOUNDING BOX spans.
     *
     * This, not the opaque-pixel fraction, is what determines whether two
     * symbols look the same size on a reel. A lightning bolt and a pyramid can
     * occupy identical boxes while the bolt covers a fifth of the pixels — by
     * area it looks like an outlier, and by eye it looks perfectly at home.
     */
    boxSpan: Math.max(boxWidth / png.width, boxHeight / png.height),
    cornersOpaque: cornerAlpha.every((a) => a > 200),
  };
}

// ------------------------------------------------------------------ the rules

/**
 * What each kind of asset must satisfy.
 *
 * Keyed by a prefix in the filename, so `symbol-gems-diamond.png` is checked
 * as a symbol. Naming is part of the deliverable.
 */
const RULES = {
  symbol: { size: 512, transparent: true, maxKB: 150, centred: true, minFill: 0.15, maxFill: 0.75 },
  background: { width: 1536, height: 1024, transparent: false, maxKB: 400, centred: false },
  tile: { size: 1024, transparent: false, maxKB: 300, centred: false },
  overlay: { size: 1024, transparent: true, maxKB: 300, centred: true, minFill: 0.1, maxFill: 0.8 },
  icon: { size: 512, transparent: true, maxKB: 120, centred: true, minFill: 0.1, maxFill: 0.8 },
};

/**
 * Folder names accepted for each category.
 *
 * Compared after stripping spaces, hyphens and underscores and lowercasing, so
 * "Lobby Game Tiles", "lobby-game-tiles" and "lobbygametiles" are one thing.
 * People name folders in whatever way made sense at the time, and refusing a
 * perfectly clear name is the sort of pedantry that gets a tool abandoned.
 */
const FOLDER_ALIASES = {
  symbol: ['symbol', 'symbols', 'slotsymbols', 'slotsymbol', 'reelsymbols'],
  background: ['background', 'backgrounds', 'bg', 'reelbackgrounds', 'reelbackground'],
  tile: ['tile', 'tiles', 'lobby', 'lobbytiles', 'lobbygametiles', 'gametiles', 'gametile', 'covers'],
  overlay: ['overlay', 'overlays', 'win', 'winoverlays', 'flourish', 'flourishes'],
  icon: ['icon', 'icons', 'ui', 'uiassets', 'uiasset', 'store'],
};

const normalise = (segment) => segment.toLowerCase().replace(/[\s\-_]/g, '');

/**
 * Work out what an asset is, from its FOLDER first and its filename second.
 *
 * Generators produce names like `Gemini_Generated_Image_8fj20a.png`, and
 * renaming a hundred of those by hand is the kind of chore that gets abandoned
 * halfway through, leaving a set that is half-named and wholly unusable. Sorting
 * files into `symbols/gems/`, `backgrounds/` and `tiles/` is a drag-and-drop
 * that survives being done on a phone.
 *
 * A filename prefix still wins where present, so an already-named set keeps
 * working.
 */
export function categoryFor(relativePath) {
  const parts = relativePath.split('/').filter(Boolean);
  const file = parts.pop() ?? '';

  const prefix = basename(file).split(/[-_.]/)[0].toLowerCase();
  if (RULES[prefix]) {
    // symbol-gems-cherry.png -> family "gems"
    return { category: prefix, family: basename(file).split(/[-_]/)[1] ?? 'unknown', source: 'filename' };
  }

  for (let i = parts.length - 1; i >= 0; i--) {
    const segment = normalise(parts[i]);
    for (const [category, aliases] of Object.entries(FOLDER_ALIASES)) {
      if (aliases.includes(segment)) {
        // symbols/gems/whatever.png -> family "gems"; symbols/whatever.png -> "unknown"
        const family = i + 1 < parts.length ? parts[i + 1].toLowerCase() : 'unknown';
        return { category, family, source: 'folder' };
      }
    }
  }

  return { category: null, family: 'unknown', source: 'none' };
}

export function checkFile(path, relativePath = basename(path)) {
  const name = relativePath;
  const problems = [];
  const { category, family } = categoryFor(relativePath);
  const rule = category ? RULES[category] : null;

  if (!rule) {
    return {
      name,
      family,
      problems: [
        'cannot tell what this is. Put it in a folder named ' +
          `${Object.keys(FOLDER_ALIASES).map((c) => `${c}s/`).join(', ')} ` +
          '(symbols may be split further, e.g. symbols/gems/), or name the file ' +
          `${Object.keys(RULES).map((r) => `${r}-...`).join(', ')}`,
      ],
    };
  }
  const prefix = category;

  const kb = Math.round(statSync(path).size / 1024);
  if (kb > rule.maxKB) problems.push(`${kb}KB exceeds the ${rule.maxKB}KB budget for a ${prefix}`);

  let png, m;
  try {
    png = readPng(readFileSync(path));
    m = measure(png);
  } catch (error) {
    return { name, family, problems: [`cannot be read: ${error.message}`] };
  }

  if (rule.size && (png.width !== rule.size || png.height !== rule.size)) {
    problems.push(`is ${png.width}×${png.height}, expected ${rule.size}×${rule.size}`);
  }
  if (rule.width && (png.width !== rule.width || png.height !== rule.height)) {
    problems.push(`is ${png.width}×${png.height}, expected ${rule.width}×${rule.height}`);
  }

  if (rule.transparent) {
    if (!m.hasAlpha) {
      problems.push('has no alpha channel — it will show as a solid box on the reel');
    } else if (m.cornersOpaque) {
      problems.push('has opaque corners — the background was not removed');
    }
    // Judged on the bounding box: a thin subject is not a small subject.
    if (m.boxSpan < 0.45) {
      problems.push(`subject spans only ${(m.boxSpan * 100).toFixed(0)}% of the frame — too small to read`);
    }
    if (m.boxSpan > 0.99 && m.fill > rule.maxFill) {
      problems.push(`subject reaches the frame edge with no margin — it will crop`);
    }
  }

  if (rule.centred && (m.offCentreX > 0.06 || m.offCentreY > 0.06)) {
    problems.push(
      `subject is off centre by ${(Math.max(m.offCentreX, m.offCentreY) * 100).toFixed(0)}% — ` +
        `it will visibly wobble as the reel moves`,
    );
  }

  return { name, prefix, family, problems, measurement: m, kb, width: png.width, height: png.height };
}

// ------------------------------------------------------------- set coherence

/**
 * Compare symbols within a family.
 *
 * A set where one symbol fills 60% of the frame and another 20% looks broken in
 * motion even though every file passes on its own. This is the check nobody does
 * by eye, because it only shows up side by side.
 */
export function checkSetCoherence(results) {
  const problems = [];
  const families = new Map();

  for (const r of results) {
    if (r.prefix !== 'symbol' || !r.measurement) continue;
    const family = r.family ?? 'unknown';
    if (!families.has(family)) families.set(family, []);
    families.get(family).push(r);
  }

  for (const [family, members] of families) {
    if (members.length < 2) continue;
    const fills = members.map((m) => m.measurement.boxSpan);

    if (family !== 'unknown') {
      // A named family is five symbols that appear on the same reel together,
      // so the comparison is direct.
      const min = Math.min(...fills);
      const max = Math.max(...fills);
      if (max / min > 2) {
        problems.push(
          `family "${family}": ${members[fills.indexOf(max)].name} is ` +
            `${(max / min).toFixed(1)}× the size of ${members[fills.indexOf(min)].name}. ` +
            `Symbols in one set must look the same size.`,
        );
      }
      continue;
    }

    // Unsorted symbols. These are probably several families mixed together, and
    // families legitimately differ — so comparing the largest against the
    // smallest would cry wolf. Flag distance from the MEDIAN instead: an
    // outlier is wrong whatever family it belongs to, and the middle of the
    // pack is not evidence of anything.
    const sorted = [...fills].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    const outliers = members.filter(
      (m) => m.measurement.boxSpan > median * 1.5 || m.measurement.boxSpan < median / 1.5,
    );
    if (outliers.length > 0) {
      problems.push(
        `${outliers.length} of ${members.length} symbols are more than 1.5x or less than two-thirds ` +
          `the typical size (median span ${(median * 100).toFixed(0)}% of frame). ` +
          `These will not sit together on a reel:\n` +
          outliers
            .map((m) => `      ${m.name} — spans ${(m.measurement.boxSpan * 100).toFixed(0)}%`)
            .join('\n'),
      );
    }
  }
  return problems;
}

// ------------------------------------------------------------------- reporting

/** Every PNG under a folder, as paths relative to it. */
function walk(root, prefix = '') {
  const found = [];
  for (const entry of readdirSync(join(root, prefix), { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) found.push(...walk(root, rel));
    else if (['.png', '.webp'].includes(extname(entry.name).toLowerCase())) found.push(rel);
  }
  return found;
}

function main() {
  const folder = resolve(process.argv[2] ?? 'art');
  let files;
  try {
    files = walk(folder).sort();
  } catch {
    console.error(`Cannot read ${folder}`);
    process.exit(1);
  }
  if (files.length === 0) {
    console.error(`No PNG or WebP files under ${folder}`);
    process.exit(1);
  }

  const results = files.map((f) => checkFile(join(folder, f), f));
  const failed = results.filter((r) => r.problems.length > 0);

  for (const r of failed) {
    console.log(`\n✗ ${r.name}`);
    for (const p of r.problems) console.log(`    ${p}`);
  }

  const coherence = checkSetCoherence(results);
  if (coherence.length > 0) {
    console.log('\nAcross a set:');
    for (const p of coherence) console.log(`  ✗ ${p}`);
  }

  const totalKB = results.reduce((sum, r) => sum + (r.kb ?? 0), 0);
  console.log(
    `\n${files.length} files, ${results.length - failed.length} clean, ` +
      `${failed.length} with problems, ${(totalKB / 1024).toFixed(1)}MB total.`,
  );
  if (totalKB > 8 * 1024) {
    console.log(`  ! over the 8MB budget — this is a first load on mobile data.`);
  }

  process.exit(failed.length + coherence.length > 0 ? 1 : 0);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
