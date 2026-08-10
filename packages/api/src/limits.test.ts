/**
 * Responsible-gaming limits, over HTTP against real Postgres.
 *
 * These are the controls a player reaches for when they are trying to stop, so
 * the tests are about REFUSAL: that a cap actually blocks a bet, that raising it
 * does not take effect immediately, and that a break cannot be undone. A mocked
 * database would assert that this file's own arithmetic works, which is not the
 * property anybody is worried about — the property is that `assert_can_play`
 * refuses, and that lives in Postgres.
 *
 *   JUWA_LIMITS_TEST_DATABASE_URL=postgres://... npm test -w @juwa/api
 */

import { strict as assert } from 'node:assert';
import { after, before, describe, it } from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import { PostgresDb } from '@juwa/server';
import { createServer } from './server.js';
import { signJwt } from './jwt.js';

const URL_ENV = process.env['JUWA_LIMITS_TEST_DATABASE_URL'];
const here = dirname(fileURLToPath(import.meta.url));
const migrations = resolve(here, '../../../db/migrations');
const dbTest = resolve(here, '../../../db/test');

const SECRET = 'limits-test-secret';
const ORIGIN = 'https://play.juwa.test';
const GAME = 'juwa-classic-slots';

describe('limits', { skip: URL_ENV ? false : 'JUWA_LIMITS_TEST_DATABASE_URL not set' }, () => {
  let pool: import('pg').Pool;
  let base: string;
  let stop: () => void;
  const PLAYER = randomUUID();

  const token = (sub: string) =>
    signJwt({ sub, exp: Math.floor(Date.now() / 1000) + 3600 }, SECRET);

  async function call(path: string, body?: unknown, auth = PLAYER) {
    const response = await fetch(`${base}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: ORIGIN,
        Authorization: `Bearer ${token(auth)}`,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    return { status: response.status, body: text ? (JSON.parse(text) as Record<string, unknown>) : {} };
  }

  const bet = (stake: number) =>
    call('/bet', { gameId: GAME, stake, idempotencyKey: randomUUID() });

  before(async () => {
    const { Pool } = await import('pg');
    pool = new Pool({ connectionString: URL_ENV });
    await pool.query(readFileSync(resolve(dbTest, 'supabase_shim.sql'), 'utf8'));
    for (const file of readdirSync(migrations).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort()) {
      await pool.query(readFileSync(resolve(migrations, file), 'utf8'));
    }
    await pool.query(`insert into auth.users (id) values ($1)`, [PLAYER]);

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

    await call('/register', {
      username: 'limiter',
      dateOfBirth: '1990-01-01',
      country: 'US',
      region: 'NJ',
    });
  });

  after(async () => {
    stop?.();
    await pool?.end();
  });

  it('reports no limits on a fresh account', async () => {
    const me = await call('/me');
    const limits = me.body['limits'] as Record<string, unknown>;
    assert.equal(limits['dailyWagerLimit'], null);
    assert.equal(limits['selfExcludedUntil'], null);
  });

  it('refuses a bet that would cross the daily cap', async () => {
    const set = await call('/me/limits', { dailyWagerLimit: 5_000 });
    assert.equal(set.status, 200, JSON.stringify(set.body));
    assert.equal(set.body['dailyWagerLimit'], 5_000);

    // Under the cap: fine.
    assert.equal((await bet(2_000)).status, 200);

    // The bet that would CROSS it is refused — not merely the one after. A cap
    // that only checked what was already staked would let the last bet of the
    // day be any size at all.
    const over = await bet(4_000);
    assert.equal(over.status, 403);
    assert.match(String(over.body['message']), /Daily limit reached/);

    // And nothing moved.
    const { rows } = await pool.query<{ n: string }>(
      `select coalesce(sum(stake),0)::text as n from game_rounds where player_id = $1`,
      [PLAYER],
    );
    assert.equal(rows[0]!.n, '2000');
  });

  it('applies a tightening at once and a loosening only after a day', async () => {
    // Tighter: immediate.
    const tighter = await call('/me/limits', { dailyWagerLimit: 3_000 });
    assert.equal(tighter.body['dailyWagerLimit'], 3_000);
    assert.equal(tighter.body['pendingWagerLimit'], null);

    // Looser: pending, and the old cap still bites.
    const looser = await call('/me/limits', { dailyWagerLimit: 900_000 });
    assert.equal(looser.body['dailyWagerLimit'], 3_000, 'a loosening took effect immediately');
    assert.equal(looser.body['pendingWagerLimit'], 900_000);
    assert.ok(new Date(String(looser.body['pendingAt'])) > new Date());

    assert.equal((await bet(50_000)).status, 403, 'a pending loosening was already in force');

    // Once matured, the next play attempt applies it. Moving the clock back is
    // how a 24-hour wait is tested in under a second.
    await pool.query(
      `update profiles set pending_limit_at = now() - interval '1 minute' where id = $1`,
      [PLAYER],
    );
    assert.equal((await bet(50_000)).status, 200, 'a matured loosening never applied');
    const me = await call('/me');
    assert.equal((me.body['limits'] as Record<string, unknown>)['dailyWagerLimit'], 900_000);
  });

  it('refuses a limit that is not a positive whole number', async () => {
    for (const value of [0, -100, 12.5]) {
      assert.equal((await call('/me/limits', { dailyWagerLimit: value })).status, 400);
    }
  });

  it('stops play during a break, and will not shorten one', async () => {
    const week = await call('/me/limits', { breakDays: 7 });
    assert.equal(week.status, 200);
    const until = new Date(String(week.body['selfExcludedUntil']));
    assert.ok(until > new Date(Date.now() + 6 * 86_400_000));

    const blocked = await bet(100);
    assert.equal(blocked.status, 403);
    assert.match(String(blocked.body['message']), /self-excluded/i);

    // A shorter break must not replace a longer one.
    const shorter = await call('/me/limits', { breakDays: 1 });
    assert.ok(
      new Date(String(shorter.body['selfExcludedUntil'])) > new Date(Date.now() + 6 * 86_400_000),
      'a break was shortened',
    );

    // Longer is allowed — it only ever extends.
    const longer = await call('/me/limits', { breakDays: 30 });
    assert.ok(new Date(String(longer.body['selfExcludedUntil'])) > until);
  });

  it('refuses an absurd break length', async () => {
    for (const days of [0, -1, 5_000, 1.5]) {
      assert.equal((await call('/me/limits', { breakDays: days })).status, 400, `days=${days}`);
    }
  });

  it('sets and clears the session reminder immediately, both ways', async () => {
    const on = await call('/me/limits', { sessionReminderMinutes: 60 });
    assert.equal(on.body['sessionReminderMinutes'], 60);
    const off = await call('/me/limits', { sessionReminderMinutes: 0 });
    assert.equal(off.body['sessionReminderMinutes'], null);
    assert.equal((await call('/me/limits', { sessionReminderMinutes: 5_000 })).status, 400);
  });
});
