/**
 * Resize and recompress generated art to what the game can actually ship.
 *
 *   node scripts/optimise-art.mjs <source> <destination>
 *
 * Image generators export at whatever resolution they feel like — commonly
 * 1024 or 2048 square, several megabytes each. A hundred of those is half a
 * gigabyte, which GitHub's uploader refuses, a phone downloads slowly, and a
 * reel does not benefit from in the slightest: a slot symbol is drawn at about
 * 90 CSS pixels, so 512 is already twice what a retina screen resolves.
 *
 * Three things shrink a PNG, and this does all of them:
 *
 *   1. RESOLUTION. Box-averaged downscale, which for illustration content is
 *      indistinguishable from anything fancier and never rings the way a
 *      sharpening filter does.
 *   2. FILTERING. PNG allows a different filter per scanline, and choosing well
 *      typically halves the compressed size. Exporters usually write filter 0
 *      for every line, leaving that on the table.
 *   3. PALETTE. Flat illustration rarely holds more than a few hundred distinct
 *      colours, so median-cut quantisation to 256 with a transparency table is
 *      lossless to the eye and cuts size again by three or four.
 *
 * No dependencies, for the same reason as the checker: this must keep working
 * without a toolchain anyone has to install.
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { deflateSync, inflateSync, crc32 } from 'node:zlib';
import { dirname, extname, join, resolve } from 'node:path';

// ------------------------------------------------------------------- decoding

const MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const CHANNELS = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

function decode(buffer) {
  if (!buffer.subarray(0, 8).equals(MAGIC)) throw new Error('not a PNG');
  let offset = 8, header = null, palette = null, trns = null;
  const idat = [];

  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') {
      header = {
        width: data.readUInt32BE(0), height: data.readUInt32BE(4),
        bitDepth: data[8], colourType: data[9], interlace: data[12],
      };
    } else if (type === 'PLTE') palette = Buffer.from(data);
    else if (type === 'tRNS') trns = Buffer.from(data);
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    offset += 12 + length;
  }
  if (!header) throw new Error('no IHDR');
  if (header.bitDepth !== 8) throw new Error(`bit depth ${header.bitDepth} unsupported`);
  if (header.interlace !== 0) throw new Error('interlaced PNG unsupported');

  const channels = CHANNELS[header.colourType];
  if (!channels) throw new Error(`colour type ${header.colourType} unsupported`);

  const raw = inflateSync(Buffer.concat(idat));
  const stride = header.width * channels;
  const flat = Buffer.alloc(stride * header.height);

  for (let y = 0; y < header.height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    const cur = flat.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? flat.subarray((y - 1) * stride, y * stride) : Buffer.alloc(stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? cur[x - channels] : 0;
      const b = prev[x];
      const c = x >= channels ? prev[x - channels] : 0;
      let v = line[x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      cur[x] = v & 0xff;
    }
  }

  // Everything becomes RGBA so the rest of the pipeline has one shape.
  const rgba = Buffer.alloc(header.width * header.height * 4);
  for (let i = 0, p = 0; i < header.width * header.height; i++, p += 4) {
    const s = i * channels;
    if (header.colourType === 6) { rgba[p] = flat[s]; rgba[p+1] = flat[s+1]; rgba[p+2] = flat[s+2]; rgba[p+3] = flat[s+3]; }
    else if (header.colourType === 2) { rgba[p] = flat[s]; rgba[p+1] = flat[s+1]; rgba[p+2] = flat[s+2]; rgba[p+3] = 255; }
    else if (header.colourType === 0) { rgba[p] = rgba[p+1] = rgba[p+2] = flat[s]; rgba[p+3] = 255; }
    else if (header.colourType === 4) { rgba[p] = rgba[p+1] = rgba[p+2] = flat[s]; rgba[p+3] = flat[s+1]; }
    else if (header.colourType === 3) {
      const idx = flat[s];
      rgba[p] = palette[idx*3]; rgba[p+1] = palette[idx*3+1]; rgba[p+2] = palette[idx*3+2];
      rgba[p+3] = trns && idx < trns.length ? trns[idx] : 255;
    }
  }
  return { width: header.width, height: header.height, rgba };
}

// ------------------------------------------------------------------ resampling

/**
 * Box-average downscale.
 *
 * Averaging every source pixel that lands in a destination pixel, rather than
 * sampling one of them, is what stops a thin outline disappearing on some edges
 * and surviving on others — which on a set of symbols reads as inconsistent
 * line weight rather than as aliasing.
 *
 * Alpha-weighted, so fully transparent pixels do not drag colour toward black
 * along the edges and leave a dark halo.
 */
export function downscale(image, targetWidth, targetHeight) {
  const { width: sw, height: sh, rgba: src } = image;
  if (sw === targetWidth && sh === targetHeight) return image;

  const out = Buffer.alloc(targetWidth * targetHeight * 4);
  const xRatio = sw / targetWidth;
  const yRatio = sh / targetHeight;

  for (let y = 0; y < targetHeight; y++) {
    const y0 = Math.floor(y * yRatio), y1 = Math.max(y0 + 1, Math.floor((y + 1) * yRatio));
    for (let x = 0; x < targetWidth; x++) {
      const x0 = Math.floor(x * xRatio), x1 = Math.max(x0 + 1, Math.floor((x + 1) * xRatio));
      let r = 0, g = 0, b = 0, a = 0, weight = 0, count = 0;
      for (let sy = y0; sy < Math.min(y1, sh); sy++) {
        for (let sx = x0; sx < Math.min(x1, sw); sx++) {
          const i = (sy * sw + sx) * 4;
          const alpha = src[i + 3];
          r += src[i] * alpha; g += src[i+1] * alpha; b += src[i+2] * alpha;
          a += alpha; weight += alpha; count++;
        }
      }
      const o = (y * targetWidth + x) * 4;
      if (weight === 0) { out[o] = out[o+1] = out[o+2] = out[o+3] = 0; }
      else {
        out[o] = Math.round(r / weight);
        out[o+1] = Math.round(g / weight);
        out[o+2] = Math.round(b / weight);
        out[o+3] = Math.round(a / count);
      }
    }
  }
  return { width: targetWidth, height: targetHeight, rgba: out };
}

// ---------------------------------------------------------------- quantisation

/**
 * Median-cut to at most `maxColours`.
 *
 * Repeatedly split the box of colours along its widest axis at the median. For
 * flat illustration this is visually lossless and shrinks the file three to
 * four times, because a palette image stores one byte per pixel instead of four.
 *
 * Returns null when the image genuinely needs more colours than the palette
 * holds — a photographic background, say — so the caller can keep it truecolour
 * rather than band it.
 */
export function quantise(image, maxColours = 256) {
  const { rgba } = image;
  const pixels = [];
  for (let i = 0; i < rgba.length; i += 4) {
    pixels.push([rgba[i], rgba[i+1], rgba[i+2], rgba[i+3]]);
  }

  const unique = new Set(pixels.map((p) => (p[0]<<24 | p[1]<<16 | p[2]<<8 | p[3]) >>> 0));
  if (unique.size > 20000) return null; // too varied; palette would band it

  let boxes = [pixels];
  while (boxes.length < maxColours) {
    // Split whichever box spans the most range — that is where error is worst.
    let bestIndex = -1, bestSpan = 0, bestAxis = 0;
    boxes.forEach((box, index) => {
      if (box.length < 2) return;
      for (let axis = 0; axis < 4; axis++) {
        let min = 255, max = 0;
        for (const p of box) { if (p[axis] < min) min = p[axis]; if (p[axis] > max) max = p[axis]; }
        if (max - min > bestSpan) { bestSpan = max - min; bestIndex = index; bestAxis = axis; }
      }
    });
    if (bestIndex < 0 || bestSpan === 0) break;

    const box = boxes[bestIndex];
    box.sort((a, b) => a[bestAxis] - b[bestAxis]);
    const middle = box.length >> 1;
    boxes.splice(bestIndex, 1, box.slice(0, middle), box.slice(middle));
  }

  const palette = boxes.filter((b) => b.length > 0).map((box) => {
    const sum = box.reduce((acc, p) => [acc[0]+p[0], acc[1]+p[1], acc[2]+p[2], acc[3]+p[3]], [0,0,0,0]);
    return sum.map((v) => Math.round(v / box.length));
  });

  const indices = Buffer.alloc(image.width * image.height);
  for (let i = 0, n = 0; i < rgba.length; i += 4, n++) {
    let best = 0, bestDistance = Infinity;
    for (let c = 0; c < palette.length; c++) {
      const dr = rgba[i] - palette[c][0], dg = rgba[i+1] - palette[c][1];
      const db = rgba[i+2] - palette[c][2], da = rgba[i+3] - palette[c][3];
      // Alpha weighted heavily: a wrong alpha shows as a hard edge artefact,
      // a slightly wrong colour does not show at all.
      const d = dr*dr + dg*dg + db*db + da*da*4;
      if (d < bestDistance) { bestDistance = d; best = c; }
    }
    indices[n] = best;
  }
  return { palette, indices };
}

// ------------------------------------------------------------------- encoding

function chunk(type, data) {
  const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body) >>> 0);
  return Buffer.concat([length, body, crc]);
}

/**
 * Choose a filter per scanline by the standard minimum-sum-of-absolute-values
 * heuristic, then deflate.
 *
 * Exporters commonly write filter 0 everywhere. Picking per line typically
 * halves the result for no loss whatsoever, which is the cheapest saving
 * available.
 */
function filterAndDeflate(data, width, height, bytesPerPixel) {
  const stride = width * bytesPerPixel;
  const out = Buffer.alloc((stride + 1) * height);

  for (let y = 0; y < height; y++) {
    const line = data.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? data.subarray((y - 1) * stride, y * stride) : Buffer.alloc(stride);
    let bestFilter = 0, bestScore = Infinity, bestLine = null;

    for (let filter = 0; filter < 5; filter++) {
      const candidate = Buffer.alloc(stride);
      let score = 0;
      for (let x = 0; x < stride; x++) {
        const a = x >= bytesPerPixel ? line[x - bytesPerPixel] : 0;
        const b = prev[x];
        const c = x >= bytesPerPixel ? prev[x - bytesPerPixel] : 0;
        let v;
        if (filter === 0) v = line[x];
        else if (filter === 1) v = line[x] - a;
        else if (filter === 2) v = line[x] - b;
        else if (filter === 3) v = line[x] - ((a + b) >> 1);
        else {
          const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
          v = line[x] - (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
        }
        candidate[x] = v & 0xff;
        score += Math.min(candidate[x], 256 - candidate[x]);
      }
      if (score < bestScore) { bestScore = score; bestFilter = filter; bestLine = candidate; }
    }
    out[y * (stride + 1)] = bestFilter;
    bestLine.copy(out, y * (stride + 1) + 1);
  }
  return deflateSync(out, { level: 9 });
}

export function encode(image, quantised) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(image.width, 0);
  ihdr.writeUInt32BE(image.height, 4);
  ihdr[8] = 8;

  const chunks = [];
  if (quantised) {
    ihdr[9] = 3; // indexed
    chunks.push(chunk('IHDR', ihdr));
    const plte = Buffer.alloc(quantised.palette.length * 3);
    const trns = Buffer.alloc(quantised.palette.length);
    quantised.palette.forEach((c, i) => {
      plte[i*3] = c[0]; plte[i*3+1] = c[1]; plte[i*3+2] = c[2];
      trns[i] = c[3];
    });
    chunks.push(chunk('PLTE', plte));
    // Only needed if anything is not fully opaque.
    if (trns.some((a) => a < 255)) chunks.push(chunk('tRNS', trns));
    chunks.push(chunk('IDAT', filterAndDeflate(quantised.indices, image.width, image.height, 1)));
  } else {
    ihdr[9] = 6; // RGBA
    chunks.push(chunk('IHDR', ihdr));
    chunks.push(chunk('IDAT', filterAndDeflate(image.rgba, image.width, image.height, 4)));
  }
  chunks.push(chunk('IEND', Buffer.alloc(0)));
  return Buffer.concat([MAGIC, ...chunks]);
}

// ---------------------------------------------------------------------- driver

const TARGETS = {
  symbol: [512, 512], background: [1536, 1024], tile: [1024, 1024],
  overlay: [1024, 1024], icon: [512, 512],
};

const FOLDER_ALIASES = {
  symbol: ['symbol', 'symbols', 'slotsymbols', 'slotsymbol', 'reelsymbols'],
  background: ['background', 'backgrounds', 'bg', 'reelbackgrounds', 'reelbackground'],
  tile: ['tile', 'tiles', 'lobby', 'lobbytiles', 'lobbygametiles', 'gametiles', 'gametile', 'covers'],
  overlay: ['overlay', 'overlays', 'win', 'winoverlays', 'flourish', 'flourishes'],
  icon: ['icon', 'icons', 'ui', 'uiassets', 'uiasset', 'store'],
};

function categoryOf(relativePath) {
  const parts = relativePath.split('/').filter(Boolean);
  parts.pop();
  for (let i = parts.length - 1; i >= 0; i--) {
    const segment = parts[i].toLowerCase().replace(/[\s\-_]/g, '');
    for (const [category, aliases] of Object.entries(FOLDER_ALIASES)) {
      if (aliases.includes(segment)) return category;
    }
  }
  return null;
}

function walk(root, prefix = '') {
  const found = [];
  for (const entry of readdirSync(join(root, prefix), { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) found.push(...walk(root, rel));
    else if (extname(entry.name).toLowerCase() === '.png') found.push(rel);
  }
  return found;
}

function main() {
  const source = resolve(process.argv[2] ?? 'art-source');
  const destination = resolve(process.argv[3] ?? 'art');
  const files = walk(source).sort();
  if (files.length === 0) {
    console.error(`No PNG files under ${source}`);
    process.exit(1);
  }

  let before = 0, after = 0, failures = 0;
  for (const relative of files) {
    const category = categoryOf(relative);
    if (!category) {
      console.log(`?  ${relative} — cannot tell what this is, skipped`);
      failures++;
      continue;
    }
    const [tw, th] = TARGETS[category];
    const inputPath = join(source, relative);
    const inputSize = statSync(inputPath).size;

    let output;
    try {
      const image = downscale(decode(readFileSync(inputPath)), tw, th);
      const quantised = quantise(image);
      const asPalette = quantised ? encode(image, quantised) : null;
      const asTruecolour = encode(image, null);
      // Whichever is actually smaller. Palette usually wins on illustration and
      // loses on a photographic background, and guessing wrong costs real bytes.
      output = asPalette && asPalette.length < asTruecolour.length ? asPalette : asTruecolour;
    } catch (error) {
      console.log(`✗  ${relative} — ${error.message}`);
      failures++;
      continue;
    }

    const target = join(destination, relative);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, output);

    before += inputSize;
    after += output.length;
    const saved = Math.round((1 - output.length / inputSize) * 100);
    console.log(
      `✓  ${relative}\n     ${Math.round(inputSize/1024)}KB → ${Math.round(output.length/1024)}KB ` +
        `(${saved > 0 ? '-' : '+'}${Math.abs(saved)}%)`,
    );
  }

  console.log(
    `\n${files.length - failures} written to ${destination}: ` +
      `${(before/1024/1024).toFixed(1)}MB → ${(after/1024/1024).toFixed(1)}MB ` +
      `(${Math.round((1 - after/before) * 100)}% smaller).`,
  );
  if (failures) console.log(`${failures} skipped.`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
