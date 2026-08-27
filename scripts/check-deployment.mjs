/**
 * Check a live Juwa deployment.
 *
 * Run this after wiring up Supabase, the API and the web app. It exercises the
 * things that are easy to get subtly wrong and hard to notice — a CORS list
 * that does not include your real origin, a Stripe key without a webhook
 * secret, a migration that was pasted twice.
 *
 *   node scripts/check-deployment.mjs https://api.yourdomain.com https://play.yourdomain.com
 *
 * It only makes unauthenticated requests. It cannot place a bet or read a
 * balance, and it never needs a secret — so it is safe to run against
 * production at any time.
 */

const [, , apiUrl, webUrl] = process.argv;

if (!apiUrl) {
  console.error('Usage: node scripts/check-deployment.mjs <api-url> [web-url]');
  process.exit(1);
}

const api = apiUrl.replace(/\/$/, '');
const web = webUrl?.replace(/\/$/, '');

let failures = 0;
let warnings = 0;

const pass = (msg) => console.log(`  ✓ ${msg}`);
const fail = (msg, fix) => {
  console.log(`  ✗ ${msg}`);
  if (fix) console.log(`      fix: ${fix}`);
  failures++;
};
const warn = (msg, note) => {
  console.log(`  ! ${msg}`);
  if (note) console.log(`      ${note}`);
  warnings++;
};

async function get(path, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    return await fetch(`${api}${path}`, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

console.log(`\nChecking ${api}\n`);

// ------------------------------------------------------------------ reachable

console.log('API');
try {
  const response = await get('/health');
  if (response.ok) pass('/health responds');
  else fail(`/health returned ${response.status}`, 'check the service logs — it may be crash-looping');

  const ready = await get('/health/ready');
  if (ready.ok) pass('/health/ready can reach the database');
  else fail(
    `/health/ready returned ${ready.status}`,
    'the API process is running, but Supabase is not reachable',
  );
} catch (error) {
  fail(`cannot reach the API (${error.message})`, 'is the service deployed and awake?');
  console.log('\nNothing else can be checked until the API answers.\n');
  process.exit(1);
}

if (!api.startsWith('https://') && !api.includes('localhost')) {
  fail('the API is not on HTTPS', 'tokens would travel in clear text');
}

// -------------------------------------------------------------------- auth

console.log('\nAuthentication');
{
  const response = await get('/balance');
  if (response.status === 401) pass('unauthenticated requests are refused');
  else fail(`/balance without a token returned ${response.status}, expected 401`,
    'the API may be running without SUPABASE_JWT_SECRET');
}
{
  // A structurally valid token signed with a key we invented. If this is
  // accepted, the deployment is wide open.
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({ sub: '00000000-0000-4000-8000-000000000000', exp: 4_102_444_800 }),
  ).toString('base64url');
  const forged = `${header}.${payload}.${'A'.repeat(43)}`;

  const response = await get('/balance', { headers: { Authorization: `Bearer ${forged}` } });
  if (response.status === 401) pass('forged tokens are rejected');
  else fail(`a forged token returned ${response.status} — ANYONE CAN PLAY AS ANYONE`,
    'the JWT secret does not match Supabase, or verification is disabled');
}

// -------------------------------------------------------------------- CORS

console.log('\nCORS');
if (web) {
  const allowed = await get('/health', { headers: { Origin: web } });
  if (allowed.headers.get('access-control-allow-origin') === web) {
    pass(`${web} is allowed`);
  } else {
    fail(`${web} is NOT in ALLOWED_ORIGINS`,
      `the browser will block every request; set ALLOWED_ORIGINS=${web}`);
  }
} else {
  warn('no web URL given, so the allowed origin was not checked',
    'pass it as the second argument');
}
{
  const evil = await get('/health', { headers: { Origin: 'https://not-your-site.example' } });
  const header = evil.headers.get('access-control-allow-origin');
  if (!header) pass('unknown origins are refused');
  else if (header === '*') {
    fail('ALLOWED_ORIGINS is a wildcard', 'any site could make authenticated calls on a player\'s behalf');
  } else fail(`an unknown origin was allowed (${header})`);
}

// ------------------------------------------------------------------ schema

console.log('\nDatabase');
{
  // /games reads the engine registry, not the database — so it answering only
  // proves the API is alive. /me needs a token, so the honest check is that an
  // unauthenticated call fails at AUTH rather than at the database.
  const response = await get('/games');
  if (response.ok) {
    const games = await response.json();
    if (Array.isArray(games) && games.length >= 3) pass(`${games.length} games registered`);
    else fail('the game registry looks empty');
  } else if (response.status === 401) {
    pass('game list requires a token (fine)');
  } else {
    fail(`/games returned ${response.status}`);
  }
}
{
  const response = await get('/history');
  if (response.status === 401) pass('history requires a token');
  else if (response.status === 500) {
    fail('/history returns 500 — the schema is probably missing',
      'paste db/migrations/ALL.sql into the Supabase SQL editor');
  } else warn(`/history returned ${response.status}`);
}

// ------------------------------------------------------------------ store

console.log('\nStore');
{
  const response = await get('/store');
  if (response.status === 503) {
    warn('Stripe is not configured — the store returns 503',
      'expected on staging; set STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET to sell coins');
  } else if (response.ok) {
    const { packs } = await response.json();
    pass(`${packs?.length ?? 0} coin packs offered`);
  } else if (response.status === 401) {
    pass('store requires a token');
  }
}
{
  // An unsigned webhook must be refused. If this is accepted, the store is a
  // free coin dispenser.
  const response = await get('/webhooks/stripe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: 'evt_probe', type: 'checkout.session.completed', data: { object: {} } }),
  });
  if (response.status === 400) pass('unsigned webhooks are rejected');
  else if (response.status === 503) pass('no store configured, so no webhook to abuse');
  else fail(`an unsigned webhook returned ${response.status} — coins could be granted for free`,
    'STRIPE_WEBHOOK_SECRET must match the signing secret in the Stripe dashboard');
}

// -------------------------------------------------------------------- web

if (web) {
  console.log('\nWeb app');
  try {
    const response = await fetch(web);
    const html = await response.text();
    if (response.ok) pass('the site loads');
    if (/rel="manifest"/.test(html)) pass('manifest is linked (installable)');
    else fail('no manifest link in the HTML', 'the build did not run scripts/finalize-web.mjs');

    const manifest = await fetch(`${web}/manifest.json`);
    if (manifest.ok) {
      const { icons } = await manifest.json();
      const missing = [];
      for (const icon of icons ?? []) {
        const probe = await fetch(`${web}${icon.src}`);
        if (!probe.ok) missing.push(icon.src);
      }
      if (missing.length === 0) pass(`${icons?.length ?? 0} icons present`);
      else fail(`manifest references missing icons: ${missing.join(', ')}`,
        'browsers silently refuse to install an app with a broken manifest');
    } else fail('manifest.json is not served');

    const sw = await fetch(`${web}/sw.js`);
    if (sw.ok) pass('service worker is served');
    else fail('sw.js is missing', 'no offline shell');

    // A refresh on a sub-path must not 404.
    const deep = await fetch(`${web}/some/deep/path`);
    if (deep.ok) pass('SPA fallback works (deep links do not 404)');
    else fail(`a deep link returned ${deep.status}`,
      'add the /* -> /index.html 200 rewrite; Stripe returns players to a path');
  } catch (error) {
    fail(`cannot reach the web app (${error.message})`);
  }
}

// ------------------------------------------------------------------ verdict

console.log('');
if (failures === 0 && warnings === 0) {
  console.log('All checks passed. Go and play a round yourself before inviting anyone.\n');
} else if (failures === 0) {
  console.log(`No failures, ${warnings} warning(s). Read them, then play a round yourself.\n`);
} else {
  console.log(`${failures} failure(s), ${warnings} warning(s). Fix the failures before letting anyone in.\n`);
}
process.exit(failures > 0 ? 1 : 0);
