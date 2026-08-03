/**
 * Generate the PWA icons from an SVG.
 *
 * A manifest that lists icons which do not exist is a manifest browsers refuse
 * to install, so these are generated rather than hand-waved. Rendered with the
 * Chromium that Playwright already provides — no image library, no binary
 * assets checked into git that nobody can regenerate.
 *
 *   node app/scripts/make-icons.mjs
 */
import { chromium } from 'playwright';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const out = resolve(dirname(fileURLToPath(import.meta.url)), '../public');
mkdirSync(out, { recursive: true });

/**
 * `safe` insets the artwork for the maskable icon. Android crops maskable icons
 * to whatever shape the launcher uses — circle, squircle, teardrop — so the mark
 * has to sit inside the middle 80% or it gets its edges shaved off.
 */
const svg = (size, safe) => {
  const pad = safe ? size * 0.1 : 0;
  const inner = size - pad * 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#F0D97D"/>
      <stop offset="55%" stop-color="#D4AF37"/>
      <stop offset="100%" stop-color="#8C6D1F"/>
    </linearGradient>
  </defs>
  <rect width="${size}" height="${size}" fill="#0A0710"/>
  <circle cx="${size / 2}" cy="${size / 2}" r="${inner * 0.42}" fill="none"
          stroke="url(#g)" stroke-width="${inner * 0.055}"/>
  <text x="50%" y="50%" text-anchor="middle" dominant-baseline="central"
        font-family="Georgia, 'Times New Roman', serif" font-weight="700"
        font-size="${inner * 0.52}" fill="url(#g)">J</text>
</svg>`;
};

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
});
const page = await browser.newPage();

for (const [name, size, safe] of [
  ['icon-192.png', 192, false],
  ['icon-512.png', 512, false],
  ['icon-maskable-512.png', 512, true],
  ['favicon.png', 48, false],
]) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<body style="margin:0">${svg(size, safe)}</body>`,
    { waitUntil: 'load' },
  );
  const buffer = await page.screenshot({ omitBackground: false });
  writeFileSync(resolve(out, name), buffer);
  console.log(`wrote ${name} (${size}x${size}${safe ? ', maskable' : ''})`);
}

await browser.close();
