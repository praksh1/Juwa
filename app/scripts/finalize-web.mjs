/**
 * Post-process the exported web build.
 *
 * Expo's web export writes a theme-color meta tag but does not link a manifest,
 * so without this step the build ships a manifest.json no browser ever reads —
 * and an app that cannot be installed. Since installing is what unlocks push
 * notifications on iOS, and push is what makes the daily streak work, this is
 * load-bearing rather than cosmetic.
 *
 *   node app/scripts/finalize-web.mjs <dist-dir>
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** app/, regardless of the working directory the build ran from. */
const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const dist = resolve(process.argv[2] ?? 'dist');
const indexPath = resolve(dist, 'index.html');

if (!existsSync(indexPath)) {
  console.error(`No index.html in ${dist} — did the export succeed?`);
  process.exit(1);
}

const TAGS = [
  '<link rel="manifest" href="/manifest.json">',
  '<link rel="icon" href="/favicon.png" sizes="48x48">',
  '<link rel="apple-touch-icon" href="/icon-192.png">',
  // iOS reads the apple-prefixed name; the unprefixed one is the standard that
  // everything else uses. Both are needed for now.
  '<meta name="mobile-web-app-capable" content="yes">',
  '<meta name="apple-mobile-web-app-capable" content="yes">',
  '<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">',
  '<meta name="apple-mobile-web-app-title" content="Juwa">',
];

let html = readFileSync(indexPath, 'utf8');
const missing = TAGS.filter((tag) => {
  const key = /(?:rel|name)="([^"]+)"/.exec(tag)?.[1];
  return key ? !new RegExp(`(?:rel|name)="${key}"`).test(html) : true;
});

if (missing.length === 0) {
  console.log('index.html already complete');
} else {
  html = html.replace('</head>', `  ${missing.join('\n  ')}\n</head>`);
  writeFileSync(indexPath, html);
  console.log(`injected ${missing.length} tag(s) into index.html`);
}

// Fail loudly rather than shipping a manifest that references missing icons —
// browsers silently refuse to install those, which is a miserable thing to
// debug in production.
const manifest = JSON.parse(readFileSync(resolve(dist, 'manifest.json'), 'utf8'));
const absent = manifest.icons
  .map((icon) => icon.src.replace(/^\//, ''))
  .filter((src) => !existsSync(resolve(dist, src)));

if (absent.length > 0) {
  console.error(`Manifest references missing icons: ${absent.join(', ')}`);
  process.exit(1);
}
// The product name lives in src/brand.ts, but app.json and manifest.json are
// static files the bundler and the browser read directly and cannot import it.
// Three copies of a name is how an app ends up called two different things on
// the home screen and in the tab, so they are compared here and the build fails
// rather than shipping the disagreement.
const brandSource = readFileSync(resolve(appRoot, 'src/brand.ts'), 'utf8');
const declaredName = brandSource.match(/APP_NAME\s*=\s*'([^']+)'/)?.[1];
if (!declaredName) {
  console.error('Could not read APP_NAME from src/brand.ts');
  process.exit(1);
}

const expoName = JSON.parse(readFileSync(resolve(appRoot, 'app.json'), 'utf8')).expo?.name;
const names = { 'src/brand.ts': declaredName, 'app.json': expoName, 'manifest.json': manifest.name };
const disagreeing = Object.entries(names).filter(([, value]) => value !== declaredName);
if (disagreeing.length > 0) {
  console.error('Product name disagrees across files:');
  for (const [file, value] of Object.entries(names)) console.error(`  ${file}: ${value}`);
  process.exit(1);
}

console.log(`verified ${manifest.icons.length} icons, the service worker, and the name "${declaredName}"`);

if (!existsSync(resolve(dist, 'sw.js'))) {
  console.error('sw.js is missing from the build');
  process.exit(1);
}
