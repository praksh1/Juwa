/**
 * API tests: real HTTP, real JWTs, real Postgres.
 *
 * Nothing is mocked. The things being tested — signature verification, the age
 * gate, rate limiting, and that a rejected bet moves no money — are exactly the
 * things a mock would paper over.
 *
 *   JUWA_TEST_DATABASE_URL=postgres://postgres@localhost:5432/juwa_api npm test
 */

import { strict as assert } from 'node:assert';
import { after, before, describe, it } from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import { PostgresDb } from '@juwa/server';
import { RESTRICTED_STATES, WELCOME_BONUS } from '@juwa/economy';
import { createServer } from './server.js';
import { signJwt, verifyJwt, AuthError } from './jwt.js';
import { RateLimiter } from './ratelimit.js';

const URL_ENV = process.env['JUWA_TEST_DATABASE_URL'];
const here = dirname(fileURLToPath(import.meta.url));
const migrations = resolve(here, '../../../db/migrations');
const dbTest = resolve(here, '../../../db/test');

const SECRET = 'test-jwt-secret-not-a-real-one';
const ORIGIN = 'https://play.juwa.test';

// ---------------------------------------------------------------- unit: jwt

describe('jwt', () => {
  const claims = { sub: 'user-1', exp: Math.floor(Date.now() / 1000) + 3600 };

  it('round-trips a valid token', () => {
    assert.equal(verifyJwt(signJwt(claims, SECRET), SECRET).sub, 'user-1');
  });

  it('rejects a token signed with a different secret', () => {
    assert.throws(() => verifyJwt(signJwt(claims, 'wrong'), SECRET), AuthError);
  });

  it('rejects a tampered payload', () => {
    const [header, , signature] = signJwt(claims, SECRET).split('.');
    const forged = Buffer.from(JSON.stringify({ ...claims, sub: 'someone-else' }))
      .toString('base64url');
    assert.throws(() => verifyJwt(`${header}.${forged}.${signature}`, SECRET), AuthError);
  });

  it('rejects the alg:none attack', () => {
    // The classic JWT vulnerability: claim there is no algorithm and hope the
    // server skips verification.
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
    assert.throws(() => verifyJwt(`${header}.${payload}.`, SECRET), /Unsupported token algorithm/);
  });

  it('rejects an expired token', () => {
    const expired = { sub: 'user-1', exp: Math.floor(Date.now() / 1000) - 10 };
    assert.throws(() => verifyJwt(signJwt(expired, SECRET), SECRET), /expired/);
  });

  it('rejects malformed tokens and a missing secret', () => {
    assert.throws(() => verifyJwt('not.a.token', SECRET), AuthError);
    assert.throws(() => verifyJwt('nonsense', SECRET), /Malformed token/);
    assert.throws(() => verifyJwt(signJwt(claims, SECRET), ''), /misconfigured/);
  });
});

// -------------------------------------------------------- unit: rate limit

describe('rate limiter', () => {
  it('allows a burst then throttles', () => {
    const limiter = new RateLimiter(3, 1);
    const now = Date.now();
    assert.equal(limiter.check('a', now).allowed, true);
    assert.equal(limiter.check('a', now).allowed, true);
    assert.equal(limiter.check('a', now).allowed, true);
    const blocked = limiter.check('a', now);
    assert.equal(blocked.allowed, false);
    assert.ok(blocked.retryAfter >= 1);
  });

  it('refills over time and keys are independent', () => {
    const limiter = new RateLimiter(1, 1);
    const now = Date.now();
    assert.equal(limiter.check('a', now).allowed, true);
    assert.equal(limiter.check('a', now).allowed, false);
    // A different player is unaffected.
    assert.equal(limiter.check('b', now).allowed, true);
    // One second later there is a token again.
    assert.equal(limiter.check('a', now + 1000).allowed, true);
  });

  it('sweeps idle buckets so memory does not grow forever', () => {
    const limiter = new RateLimiter(2, 1);
    const now = Date.now();
    limiter.check('a', now);
    assert.equal(limiter.size, 1);
    limiter.sweep(now + 60_000);
    assert.equal(limiter.size, 0);
  });
});

// ------------------------------------------------------------ integration

describe('api', { skip: URL_ENV ? false : 'JUWA_TEST_DATABASE_URL not set' }, () => {
  let pool: import('pg').Pool;
  let base: string;
  let stop: () => void;

  const PLAYER = randomUUID();
  const MINOR = randomUUID();
  // The flood test drains a rate-limit bucket, and buckets are keyed per
  // player. Giving it its own account keeps it from starving the tests that
  // run after it — tests must not depend on each other's leftover quota.
  const FLOODER = randomUUID();
  // Fresh identities for the input-validation cases, for the same reason:
  // registration is rate limited, so reusing one account would turn a
  // validation assertion into a 429.
  // One per validation case; each must be a fresh player, because a successful
  // registration is idempotent and would mask a later failure.
  const VALIDATORS = [randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID()];
  const RESTRICTED: Record<string, string> = Object.fromEntries(
    RESTRICTED_STATES.map((code) => [code, randomUUID()]),
  );
  const LOWERCASE_REGION = randomUUID();
  const token = (sub: string) =>
    signJwt({ sub, exp: Math.floor(Date.now() / 1000) + 3600 }, SECRET);

  async function call(
    path: string,
    options: { method?: string; body?: unknown; auth?: string | null; origin?: string } = {},
  ) {
    const response = await fetch(`${base}${path}`, {
      method: options.method ?? (options.body ? 'POST' : 'GET'),
      headers: {
        'Content-Type': 'application/json',
        Origin: options.origin ?? ORIGIN,
        ...(options.auth === null ? {} : { Authorization: `Bearer ${options.auth ?? token(PLAYER)}` }),
      },
      ...(options.body ? { body: JSON.stringify(options.body) } : {}),
    });
    const text = await response.text();
    return {
      status: response.status,
      headers: response.headers,
      body: text ? (JSON.parse(text) as Record<string, unknown>) : {},
    };
  }

  before(async () => {
    const { Pool } = await import('pg');
    pool = new Pool({ connectionString: URL_ENV });

    const sql = (path: string) => readFileSync(path, 'utf8');
    await pool.query(sql(resolve(dbTest, 'supabase_shim.sql')));
    /**
     * EVERY migration, discovered from the directory rather than listed here.
     *
     * This used to be a hand-written list ending at 0005, and it had quietly
     * gone stale: 0006 changed `complete_registration` to take a country and a
     * region, the API started passing them, and every registration test in this
     * file began failing with a 500 — a suite that is red for a reason nobody
     * reads is a suite that protects nothing. Reading the directory means a new
     * migration that breaks a route breaks this file on the day it lands.
     */
    for (const file of readdirSync(migrations).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort()) {
      await pool.query(sql(resolve(migrations, file)));
    }
    /*
     * LOWERCASE_REGION was missing from this list, so the one test that
     * actually reaches `complete_registration` with a lower-case state failed
     * on a foreign key to auth.users rather than on anything it was testing.
     * The RESTRICTED identities are refused in JavaScript before they touch the
     * database and so genuinely do not need rows — but they cost nothing, and a
     * fixture list that is complete cannot go subtly wrong again.
     */
    for (const id of [
      PLAYER,
      MINOR,
      FLOODER,
      LOWERCASE_REGION,
      ...VALIDATORS,
      ...Object.values(RESTRICTED),
    ]) {
      await pool.query(`insert into auth.users (id) values ($1)`, [id]);
    }

    const created = createServer({
      db: new PostgresDb(pool),
      query: (text, params) => pool.query(text, params as unknown[]) as never,
      jwtSecret: SECRET,
      allowedOrigins: [ORIGIN],
    });
    await new Promise<void>((done) => created.server.listen(0, done));
    base = `http://127.0.0.1:${(created.server.address() as AddressInfo).port}`;
    stop = () => {
      created.close();
      created.server.close();
    };
  });

  after(async () => {
    stop?.();
    await pool?.end();
  });

  it('serves health without a token', async () => {
    const response = await fetch(`${base}/health`);
    assert.equal(response.status, 200);
  });

  it('serves database-aware readiness without a token', async () => {
    const response = await fetch(`${base}/health/ready`);
    assert.equal(response.status, 200);
    const body = await response.json() as Record<string, unknown>;
    assert.equal(body['ok'], true);
    assert.equal(body['database'], 'reachable');
    assert.equal(typeof body['responseTimeMs'], 'number');
  });

  it('refuses every protected route without a valid token', async () => {
    assert.equal((await call('/balance', { auth: null })).status, 401);
    assert.equal((await call('/balance', { auth: 'garbage' })).status, 401);
    assert.equal(
      (await call('/balance', { auth: signJwt({ sub: PLAYER, exp: 1 }, SECRET) })).status,
      401,
    );
    // Signed with the wrong key — the crucial case.
    assert.equal(
      (await call('/balance', {
        auth: signJwt({ sub: PLAYER, exp: Math.floor(Date.now() / 1000) + 60 }, 'wrong-secret'),
      })).status,
      401,
    );
  });

  it('only sends CORS headers to allowed origins', async () => {
    const good = await call('/health', { origin: ORIGIN });
    assert.equal(good.headers.get('access-control-allow-origin'), ORIGIN);
    const bad = await call('/health', { origin: 'https://evil.example' });
    assert.equal(bad.headers.get('access-control-allow-origin'), null);
    // And a preflight from an unknown origin is refused outright.
    const preflight = await fetch(`${base}/bet`, {
      method: 'OPTIONS',
      headers: { Origin: 'https://evil.example' },
    });
    assert.equal(preflight.status, 403);
  });

  it('blocks play until registration is complete', async () => {
    const me = await call('/me');
    assert.equal(me.body['registered'], false);

    const bet = await call('/bet', { body: { gameId: 'juwa-classic-slots', stake: 1000 } });
    assert.equal(bet.status, 403);
    assert.equal(bet.body['code'], 'registration_incomplete');
  });

  it('refuses to register anyone under 18', async () => {
    const tooYoung = new Date();
    tooYoung.setFullYear(tooYoung.getFullYear() - 15);
    const response = await call('/register', {
      auth: token(MINOR),
      body: {
        username: 'kiddo',
        dateOfBirth: tooYoung.toISOString().slice(0, 10),
        country: 'US',
        region: 'CA',
      },
    });
    assert.equal(response.status, 403);
    assert.match(String(response.body['message']), /at least 18/);

    // And no account or coins were created for them.
    const { rows } = await pool.query(`select count(*)::int as n from profiles where id = $1`, [MINOR]);
    assert.equal((rows[0] as { n: number }).n, 0, 'a minor got a profile');
  });

  it('registers an adult and pays the welcome bonus once', async () => {
    const response = await call('/register', {
      body: { username: 'alex', dateOfBirth: '1990-04-01', country: 'US', region: 'CA' },
    });
    assert.equal(response.status, 200);
    assert.equal(response.body['ageVerified'], true);
    assert.equal(response.body['balance'], WELCOME_BONUS);

    // Registering again must not pay a second welcome bonus.
    const repeat = await call('/register', {
      body: { username: 'alex', dateOfBirth: '1990-04-01', country: 'US', region: 'CA' },
    });
    assert.equal(repeat.status, 200);
    assert.equal(repeat.body['balance'], WELCOME_BONUS, 'welcome bonus paid twice');
  });

  it('validates registration input', async () => {
    // Each case carries a valid region, so a 400 means the defect under test
    // rather than the jurisdiction check catching it first.
    const cases = [
      { username: 'ok', dateOfBirth: '1990-01-01', country: 'US', region: 'CA' },   // username too short
      { username: 'okname', dateOfBirth: '01/01/1990', country: 'US', region: 'CA' }, // wrong date format
      { username: 'okname', country: 'US', region: 'CA' },                           // no date at all
      { username: 'okname', dateOfBirth: '1990-01-01', country: 'US' },              // no state
      { username: 'okname', dateOfBirth: '1990-01-01', country: 'US', region: 'ZZ' },// not a state
    ];
    for (const [i, body] of cases.entries()) {
      const response = await call('/register', { auth: token(VALIDATORS[i]!), body });
      assert.equal(response.status, 400, `${JSON.stringify(body)} -> ${JSON.stringify(response.body)}`);
    }
  });

  it('refuses to register a player in a restricted state', async () => {
    for (const region of RESTRICTED_STATES) {
      const response = await call('/register', {
        auth: token(RESTRICTED[region]!),
        body: { username: `resident${region}`, dateOfBirth: '1990-01-01', country: 'US', region },
      });
      assert.equal(response.status, 403, `${region} was allowed to register`);
      // `code`, not `error` — every error this API returns is {message, code}.
      // Asserting a field that never existed made this half a test: the status
      // was checked, the reason was not, and `undefined === undefined` would
      // have passed just as happily if the refusal had been for the wrong one.
      assert.equal(response.body['code'], 'restricted_region');
    }
  });

  it('accepts a lower-case state code', async () => {
    // The dropdown sends upper case, but the endpoint is public and a hand
    // written request should not fail on capitalisation alone.
    const response = await call('/register', {
      auth: token(LOWERCASE_REGION),
      body: { username: 'lowercase', dateOfBirth: '1990-01-01', country: 'US', region: 'ca' },
    });
    assert.equal(response.status, 200);
  });

  it('plays a spin over HTTP and the balance follows the ledger', async () => {
    const before = (await call('/balance')).body['balance'] as number;
    const response = await call('/bet', {
      body: { gameId: 'juwa-classic-slots', stake: 2000, idempotencyKey: 'http-spin-1' },
    });
    assert.equal(response.status, 200);
    const settlement = response.body['settlement'] as { stake: number; payout: number };
    assert.equal(response.body['balance'], before - settlement.stake + settlement.payout);

    // Private state must never appear on the wire.
    assert.equal(JSON.stringify(response.body).includes('shoe'), false);
  });

  it('rejects a bad stake and an unknown game without moving money', async () => {
    const before = (await call('/balance')).body['balance'] as number;
    assert.equal((await call('/bet', { body: { gameId: 'juwa-classic-slots', stake: -5 } })).status, 400);
    assert.equal((await call('/bet', { body: { gameId: 'nope', stake: 1000 } })).status, 404);
    assert.equal((await call('/bet', { body: { stake: 1000 } })).status, 400);
    assert.equal((await call('/balance')).body['balance'], before);
  });

  it('rejects an oversized body', async () => {
    const response = await fetch(`${base}/bet`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: ORIGIN,
        Authorization: `Bearer ${token(PLAYER)}`,
      },
      body: JSON.stringify({ gameId: 'juwa-classic-slots', stake: 1000, junk: 'x'.repeat(20_000) }),
    });
    assert.equal(response.status, 413);
  });

  it('rate limits a spin flood', async () => {
    await call('/register', {
      auth: token(FLOODER),
      body: { username: 'flooder', dateOfBirth: '1985-06-15', country: 'US', region: 'CA' },
    });

    // Far faster than the reel animation allows, so only a script gets here.
    const results = await Promise.all(
      Array.from({ length: 25 }, () =>
        call('/bet', {
          auth: token(FLOODER),
          body: { gameId: 'juwa-classic-slots', stake: 20 },
        }),
      ),
    );
    const limited = results.filter((r) => r.status === 429);
    assert.ok(limited.length > 0, 'a 25-request burst was not rate limited');
    assert.ok(limited[0]!.headers.get('retry-after'), 'no Retry-After header');

    // The main test player, who did none of this, is unaffected.
    const innocent = await call('/bet', { body: { gameId: 'juwa-classic-slots', stake: 20 } });
    assert.notEqual(innocent.status, 429, 'one player\'s flood throttled another');
  });

  it('only lets a player verify their own rounds', async () => {
    const round = await call('/bet', {
      body: { gameId: 'juwa-classic-slots', stake: 20, idempotencyKey: 'verify-me' },
    });
    assert.equal(round.status, 200, `bet failed: ${JSON.stringify(round.body)}`);
    const roundId = round.body['roundId'] as string;

    const mine = await call(`/verify?roundId=${roundId}`);
    assert.equal(mine.status, 200);
    // The live seed stays hidden until rotation.
    assert.equal(mine.body['serverSeed'], null);

    const stranger = await call(`/verify?roundId=${roundId}`, { auth: token(randomUUID()) });
    assert.equal(stranger.status, 404, 'another player could read this round');
  });

  it('blocks a self-excluded player from betting', async () => {
    await pool.query(
      `update profiles set self_excluded_until = now() + interval '1 day' where id = $1`,
      [PLAYER],
    );
    const response = await call('/bet', { body: { gameId: 'juwa-classic-slots', stake: 20 } });
    assert.equal(response.status, 403);
    assert.equal(response.body['code'], 'self_excluded');

    await pool.query(`update profiles set self_excluded_until = null where id = $1`, [PLAYER]);
    // And betting works again once the exclusion lapses.
    const resumed = await call('/bet', { body: { gameId: 'juwa-classic-slots', stake: 20 } });
    assert.ok(resumed.status === 200 || resumed.status === 429);
  });

  it('serves the game list from the engine registry', async () => {
    const response = await call('/games');
    const games = response.body as unknown as { id: string; rtp: number }[];
    assert.ok(Array.isArray(games) && games.length >= 3);
    assert.ok(games.every((game) => game.rtp > 0.8 && game.rtp <= 1));
  });

  it('serves a coin history straight from the ledger', async () => {
    const response = await call('/history');
    assert.equal(response.status, 200);
    const entries = response.body['entries'] as {
      amount: number; type: string; meta: Record<string, unknown>;
    }[];
    assert.ok(entries.length > 0, 'no history for a player who has played');

    // Newest first, so the player sees what just happened.
    const ids = entries.map((e) => Number((e as unknown as { id: string }).id));
    assert.deepEqual(ids, [...ids].sort((a, b) => b - a), 'history is not newest-first');

    // A bet and its payout are separate rows, never one net figure — that is
    // what the player experienced, and it keeps handle separate from net win.
    assert.ok(entries.some((e) => e.type === 'bet' && e.amount < 0), 'no bet rows');
    assert.ok(entries.some((e) => e.type === 'bonus' && e.amount > 0), 'no bonus rows');

    // The welcome bonus is the oldest entry, and it is the full amount.
    const welcome = entries[entries.length - 1]!;
    assert.equal(welcome.type, 'bonus');
    assert.equal(welcome.amount, WELCOME_BONUS);

    // Every entry sums to the balance the API reports. If these ever disagree,
    // the history is lying to the player.
    const summed = entries.reduce((total, e) => total + e.amount, 0);
    assert.equal(summed, (await call('/balance')).body['balance']);
  });

  it('never shows one player another player\'s history', async () => {
    const stranger = await call('/history', { auth: token(randomUUID()) });
    assert.equal(stranger.status, 200);
    assert.deepEqual(stranger.body['entries'], []);
  });

  it('paginates history without drifting', async () => {
    const first = await call('/history?limit=2');
    const page = first.body['entries'] as { id: string }[];
    assert.equal(page.length, 2);
    assert.ok(first.body['nextBefore'], 'no cursor for a full page');

    const second = await call(`/history?limit=2&before=${first.body['nextBefore']}`);
    const nextPage = second.body['entries'] as { id: string }[];
    // Keyset pagination, so pages never overlap even as new rows land on top.
    const overlap = nextPage.filter((e) => page.some((p) => p.id === e.id));
    assert.equal(overlap.length, 0, 'pages overlap');
  });

  it('leaves the ledger balanced after everything above', async () => {
    const { rows } = await pool.query<{ currency: string; total: string }>(
      `select currency, sum(amount)::text as total from ledger_entries group by currency`,
    );
    for (const row of rows) assert.equal(Number(row.total), 0, `${row.currency} is off`);
    const drift = await pool.query(`select * from reconcile_balances()`);
    assert.equal(drift.rows.length, 0, 'cached balances drifted');
  });
});
