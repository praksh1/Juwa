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
import { readFileSync, writeFileSync, existsSync, rmSync, cpSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { readdirSync } from 'node:fs';
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

// ---------------------------------------------------------------- portability

/**
 * Emit `_headers` into the build itself.
 *
 * These rules already exist in `netlify.toml`, which means they exist only on
 * Netlify. Moving the site — because build minutes ran out, or a free tier
 * changed — silently drops them, and the failures are quiet and awful: the
 * service worker gets cached so a deploy can never replace it, and the
 * clickjacking and MIME-sniffing headers vanish without a single error
 * anywhere. Written into `dist/`, they travel with the artefact instead.
 *
 * NO `_redirects` IS WRITTEN, and that is deliberate.
 *
 * The obvious single-page-app rule — `/*  /index.html  200` — is REJECTED by
 * Cloudflare, and correctly: its asset server already strips `/index` and
 * `.html` from incoming paths, so the rewritten path re-enters the same rule
 * and loops. The deploy fails outright rather than shipping it.
 *
 * SPA fallback is therefore left to each host's own setting, and all three
 * committed here already do it:
 *
 *   wrangler.jsonc   assets.not_found_handling = "single-page-application"
 *   netlify.toml     [[redirects]] /* -> /index.html 200
 *   vercel.json      rewrites /(.*) -> /index.html
 *
 * A fourth host would need the same one-line setting. That is a smaller risk
 * than a file which deploys everywhere and breaks one of them.
 */

const HEADERS = [
  '# The service worker must never be cached, or a deploy cannot replace it and',
  '# players stay on an old build indefinitely.',
  '/sw.js',
  '  Cache-Control: no-cache, no-store, must-revalidate',
  '',
  '/manifest.json',
  '  Cache-Control: public, max-age=3600',
  '',
  '# Bundler output is content-hashed, so it can be cached hard and forever.',
  '/_expo/*',
  '  Cache-Control: public, max-age=31536000, immutable',
  '',
  '/*',
  '  X-Content-Type-Options: nosniff',
  '  X-Frame-Options: DENY',
  '  Referrer-Policy: strict-origin-when-cross-origin',
  '',
].join('\n');

writeFileSync(resolve(dist, '_headers'), HEADERS);

// A stale _redirects from an earlier build would still be deployed, and
// Cloudflare would still reject it. Incremental builds reuse the output
// directory, so removing the writer is not the same as removing the file.
const staleRedirects = resolve(dist, '_redirects');
if (existsSync(staleRedirects)) {
  rmSync(staleRedirects);
  console.log('removed a stale _redirects — Cloudflare rejects its SPA rule as a loop');
}

console.log('wrote _headers so cache and security rules are not tied to one host');

// -------------------------------------------------------------------- art

/**
 * Copy the art into the build.
 *
 * It lives at the repository root rather than in `app/public/` so there is ONE
 * copy in version control. Committing it twice would put 14MB of binaries in
 * the history twice over, and the two copies would drift the first time
 * somebody replaced a symbol in the wrong place.
 *
 * Absent is not an error: a clone without art still builds and runs, falling
 * back to the vector symbols. That is what keeps the game working while art is
 * arriving family by family.
 */
/** Files under a directory, recursively. Shared by both copies below. */
const count = (dir) =>
  readdirSync(dir, { withFileTypes: true }).reduce(
    (n, e) => n + (e.isDirectory() ? count(resolve(dir, e.name)) : 1),
    0,
  );

const artSource = resolve(appRoot, '..', 'art');
if (existsSync(artSource)) {
  cpSync(artSource, resolve(dist, 'art'), { recursive: true });
  console.log(`copied ${count(artSource)} art files into the build`);
} else {
  console.log('no art/ directory — the build will use vector symbols');
}

/*
 * The sound library, copied on the same terms as the art.
 *
 * Absent is not an error: `sound.ts` falls back to its synthesised effects for
 * every recording it cannot load, so a clone without audio still plays and
 * still makes noise.
 */
const audioSource = resolve(appRoot, '..', 'audio');
if (existsSync(audioSource)) {
  cpSync(audioSource, resolve(dist, 'audio'), { recursive: true });
  console.log(`copied ${count(audioSource)} audio files into the build`);
} else {
  console.log('no audio/ directory — the build will use synthesised sound');
}

// ------------------------------------------------------- configuration check

/**
 * Reject a build whose public configuration cannot possibly work.
 *
 * These values are baked into the bundle, so a wrong one is not a setting that
 * can be corrected later — it is a property of the artefact, and the only
 * symptom is "Failed to fetch" on a sign-up form, on a phone, with no console.
 * The build environment is the last place this is cheap to catch.
 *
 * Absent is fine and stays fine: no API URL means demo mode, and no Supabase
 * project means local development. Only a value that is present AND malformed
 * fails, because that is never intentional.
 */
const URL_VARS = ['EXPO_PUBLIC_API_URL', 'EXPO_PUBLIC_SUPABASE_URL'];
const configProblems = [];

for (const name of URL_VARS) {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') continue;

  const value = raw.trim();
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    configProblems.push(
      `${name} is not a URL: ${JSON.stringify(value)}\n` +
        `    It must start with https:// — a bare hostname will not work.`,
    );
    continue;
  }

  // http is fine for loopback and only for loopback. Browsers exempt localhost
  // from mixed-content blocking, and a local development build genuinely does
  // talk to http://localhost — rejecting it outright made this check impossible
  // to work with, which is how a check gets deleted rather than fixed.
  const loopback = ['localhost', '127.0.0.1', '[::1]', '::1'].includes(parsed.hostname);
  if (parsed.protocol !== 'https:' && !loopback) {
    configProblems.push(
      `${name} uses ${parsed.protocol}// on ${parsed.hostname} — must be https://. ` +
        `A browser on an https page refuses to load it, and the request never leaves.`,
    );
  }
  if (raw !== value) {
    configProblems.push(`${name} has leading or trailing whitespace. Remove it.`);
  }
}

// A JWT where a URL belongs is the single most common paste error here: the
// anon key and the project URL sit next to each other in the dashboard.
const supabaseUrl = process.env['EXPO_PUBLIC_SUPABASE_URL']?.trim();
if (supabaseUrl?.startsWith('eyJ')) {
  configProblems.push(
    'EXPO_PUBLIC_SUPABASE_URL looks like an anon key, not a URL.\n' +
      '    The URL looks like https://<project>.supabase.co; the key starts "eyJ".',
  );
}

const anonKey = process.env['EXPO_PUBLIC_SUPABASE_ANON_KEY']?.trim();
if (anonKey && !anonKey.startsWith('eyJ')) {
  configProblems.push(
    'EXPO_PUBLIC_SUPABASE_ANON_KEY does not look like a Supabase anon key.\n' +
      '    Anon keys are JWTs and begin "eyJ". If this is the JWT SECRET, remove it\n' +
      '    immediately — it must never be shipped to a browser.',
  );
}

// Supabase and the API are independent: one configured without the other is a
// half-deployed site that fails in a way neither log explains.
const hasSupabaseUrl = Boolean(supabaseUrl);
if (hasSupabaseUrl !== Boolean(anonKey)) {
  configProblems.push(
    'EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY must be set\n' +
      '    together. With only one, the app silently falls back to demo mode.',
  );
}

if (configProblems.length > 0) {
  console.error('\nThis build cannot work as configured:\n');
  for (const problem of configProblems) console.error(`  ✗ ${problem}`);
  console.error('\nFix the environment variables and build again.\n');
  process.exit(1);
}

console.log(
  hasSupabaseUrl
    ? `configured for accounts at ${new URL(supabaseUrl).host}`
    : 'no Supabase configured — this build runs in demo mode',
);
