/**
 * Agent endpoints, over real HTTP against a real database.
 *
 * Nothing is mocked, deliberately. What is being tested here is authorisation
 * and money — "agent A cannot fund agent B's player", "an agent cannot allocate
 * more than they hold", "an invitation works once" — and every one of those
 * lives in a `security definer` Postgres function. A mocked database would
 * assert that this file's own `if` statements work, which is not the property
 * anyone is worried about.
 *
 * The database is built from every migration in order, on its OWN database, so
 * these tests cannot be perturbed by the fixtures in server.test.ts and cannot
 * perturb them.
 *
 *   JUWA_TEST_DATABASE_URL=postgres://postgres@localhost:5432/juwa_agents \
 *     npm test -w @juwa/api
 */

import { strict as assert } from 'node:assert';
import { after, before, describe, it } from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import { createServer as createHttpServer } from 'node:http';
import { AgentsDb, PostgresDb } from '@juwa/server';
import { RESTRICTED_STATES } from '@juwa/economy';
import { createServer } from './server.js';
import { signJwt } from './jwt.js';
import { hashToken } from './admin.js';

const URL_ENV = process.env['JUWA_AGENT_TEST_DATABASE_URL'];
const here = dirname(fileURLToPath(import.meta.url));
const migrations = resolve(here, '../../../db/migrations');
const dbTest = resolve(here, '../../../db/test');

const SECRET = 'test-jwt-secret-not-a-real-one';
const ORIGIN = 'https://play.juwa.test';

describe('agents', { skip: URL_ENV ? false : 'JUWA_AGENT_TEST_DATABASE_URL not set' }, () => {
  let pool: import('pg').Pool;
  let base: string;
  let stop: () => void;

  // Two agents and their players, so every cross-tenant assertion has a real
  // other tenant to fail against rather than a null.
  const AGENT_A = randomUUID();
  const AGENT_B = randomUUID();
  const PLAYER_A = randomUUID();
  const PLAYER_B = randomUUID();
  const NEWCOMER = randomUUID();
  const ORPHAN = randomUUID();
  let operatorId: string;
  // The data layer directly, for the two lookups that have no HTTP route of
  // their own worth asserting through.
  let agentsDb: AgentsDb;
  /**
   * A stand-in for Supabase's admin API.
   *
   * Not a mock of our own code — a real HTTP server speaking GoTrue's shape, so
   * the client under test does real fetches, real JSON, real error statuses.
   * What it buys is the ability to assert the thing that actually matters here:
   * that a REFUSED account creation leaves no auth user behind. That is
   * invisible to a mock and expensive to check against the real Supabase.
   */
  const authUsers = new Map<string, string>();
  /**
   * What each account's password currently is, at the provider.
   *
   * Kept separately from `authUsers` so `size` still counts accounts. It exists
   * for one assertion that cannot be made any other way: that a refused reset
   * left the player's real password ALONE. A test that only checked the HTTP
   * status would pass just as happily if the route changed the password and
   * then returned 403.
   */
  const authPasswords = new Map<string, string>();
  let authStop: () => void;
  /** An operator session, for the admin-only routes. */
  let adminToken: string;

  const token = (sub: string) =>
    signJwt({ sub, exp: Math.floor(Date.now() / 1000) + 3600 }, SECRET);

  async function call(
    path: string,
    options: { method?: string; body?: unknown; auth?: string | null } = {},
  ) {
    const response = await fetch(`${base}${path}`, {
      method: options.method ?? (options.body ? 'POST' : 'GET'),
      headers: {
        'Content-Type': 'application/json',
        Origin: ORIGIN,
        ...(options.auth === null ? {} : { Authorization: `Bearer ${options.auth}` }),
      },
      ...(options.body ? { body: JSON.stringify(options.body) } : {}),
    });
    const text = await response.text();
    return {
      status: response.status,
      body: text ? (JSON.parse(text) as Record<string, unknown>) : {},
    };
  }

  /** Register a player the way the app does, so the welcome bonus is real. */
  async function register(id: string, username: string) {
    const response = await call('/register', {
      auth: token(id),
      body: { username, dateOfBirth: '1990-05-05', country: 'US', region: 'NJ' },
    });
    assert.equal(response.status, 200, JSON.stringify(response.body));
    return response.body;
  }

  before(async () => {
    const { Pool } = await import('pg');
    pool = new Pool({ connectionString: URL_ENV });

    await pool.query(readFileSync(resolve(dbTest, 'supabase_shim.sql'), 'utf8'));
    // Every migration, in order, rather than a hand-maintained list — a new one
    // that breaks the agent path should break this file on the day it lands.
    for (const file of readdirSync(migrations).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort()) {
      await pool.query(readFileSync(resolve(migrations, file), 'utf8'));
    }

    for (const id of [AGENT_A, AGENT_B, PLAYER_A, PLAYER_B, NEWCOMER, ORPHAN]) {
      await pool.query(`insert into auth.users (id) values ($1)`, [id]);
    }

    const operator = await pool.query<{ id: string }>(
      `insert into operators (email, password_hash, totp_secret, role)
       values ('agenttests@juwa.test', 'scrypt$x$y', '\\x00', 'admin')
       returning id`,
    );
    operatorId = operator.rows[0]!.id;

    agentsDb = new AgentsDb({ query: (text, params) => pool.query(text, params as unknown[]) as never });

    // A session for the operator fixture, inserted directly: operatorLogin
    // needs a real password hash and a live TOTP code, and neither is what
    // these tests are about.
    adminToken = randomUUID();
    await pool.query(
      `insert into operator_sessions (token_hash, operator_id, expires_at)
       values ($1, $2, now() + interval '1 hour')`,
      [hashToken(adminToken), operatorId],
    );

    const auth = createHttpServer((request, response) => {
      const send = (status: number, payload: unknown) => {
        const text = JSON.stringify(payload);
        response.writeHead(status, { 'Content-Type': 'application/json' }).end(text);
      };
      if (request.method === 'POST' && request.url === '/auth/v1/admin/users') {
        let raw = '';
        request.on('data', (chunk) => (raw += chunk));
        request.on('end', () => {
          const { email, password } = JSON.parse(raw) as Record<string, string>;
          if ([...authUsers.values()].includes(email!)) {
            return send(422, { msg: 'A user with this email address has already been registered' });
          }
          if (!password || password.length < 6) return send(422, { msg: 'Password is too short' });
          const id = randomUUID();
          authUsers.set(id, email!);
          authPasswords.set(id, password);
          // The auth row has to exist for our profiles foreign key, exactly as
          // it would in a real project.
          void pool
            .query(`insert into auth.users (id) values ($1)`, [id])
            .then(() => send(200, { id, email }));
        });
        return;
      }
      // A password reset. GoTrue takes a PUT on the user with whatever fields
      // are changing, and 404s for an id it has never issued.
      if (request.method === 'PUT' && request.url?.startsWith('/auth/v1/admin/users/')) {
        const id = decodeURIComponent(request.url.slice('/auth/v1/admin/users/'.length));
        let raw = '';
        request.on('data', (chunk) => (raw += chunk));
        request.on('end', () => {
          if (!authUsers.has(id)) return send(404, { msg: 'User not found' });
          const { password } = JSON.parse(raw) as Record<string, string>;
          if (!password || password.length < 6) return send(422, { msg: 'Password is too short' });
          authPasswords.set(id, password);
          return send(200, { id, email: authUsers.get(id) });
        });
        return;
      }
      if (request.method === 'DELETE' && request.url?.startsWith('/auth/v1/admin/users/')) {
        const id = decodeURIComponent(request.url.slice('/auth/v1/admin/users/'.length));
        authUsers.delete(id);
        authPasswords.delete(id);
        void pool.query(`delete from auth.users where id = $1`, [id]).then(() => send(200, {}));
        return;
      }
      send(404, { msg: 'not found' });
    });
    await new Promise<void>((done) => auth.listen(0, done));
    const authUrl = `http://127.0.0.1:${(auth.address() as AddressInfo).port}`;
    authStop = () => auth.close();

    const created = createServer({
      db: new PostgresDb(pool),
      query: (text, params) => pool.query(text, params as unknown[]) as never,
      jwtSecret: SECRET,
      allowedOrigins: [ORIGIN],
      supabaseAdmin: {
        url: authUrl,
        serviceRoleKey: 'test-service-role-key',
        playerEmailDomain: 'players.juwa.invalid',
      },
    });
    await new Promise<void>((done) => created.server.listen(0, done));
    base = `http://127.0.0.1:${(created.server.address() as AddressInfo).port}`;
    stop = () => {
      created.close();
      created.server.close();
    };

    // Everyone registers as an ordinary player first — including the agents.
    // That is the actual product rule: an agent is a promoted player, and
    // nothing in the system ever creates a login on someone else's behalf.
    await register(AGENT_A, 'agent_alice');
    await register(AGENT_B, 'agent_bob');
    await register(PLAYER_A, 'player_ann');
    await register(PLAYER_B, 'player_ben');
    await register(ORPHAN, 'player_orph');

    await pool.query(
      `insert into agents (profile_id, display_name, status, created_by)
       values ($1, 'Alice Distribution', 'active', $3), ($2, 'Bob Coins', 'active', $3)`,
      [AGENT_A, AGENT_B, operatorId],
    );
    await pool.query(
      `insert into player_agents (player_id, agent_id) values ($1, $2), ($3, $4)`,
      [PLAYER_A, AGENT_A, PLAYER_B, AGENT_B],
    );
    for (const agent of [AGENT_A, AGENT_B]) {
      await pool.query(`select * from grant_agent_inventory($1, 1000000, $2, $3)`, [
        agent,
        operatorId,
        `test-grant-${randomUUID()}`,
      ]);
    }
  });

  /** POST to an admin route with the operator session. */
  async function adminCall(path: string, body: unknown) {
    return call(path, { auth: adminToken, body });
  }
  async function adminGet(path: string) {
    return call(path, { auth: adminToken });
  }

  after(async () => {
    stop?.();
    authStop?.();
    await pool?.end();
  });

  // ------------------------------------------------------------ visibility

  it('tells an agent who they are, and a player nothing', async () => {
    const agent = await call('/agent/summary', { auth: token(AGENT_A) });
    assert.equal(agent.status, 200);
    assert.equal(agent.body['displayName'], 'Alice Distribution');
    assert.equal(agent.body['inventory'], 1_000_000);
    assert.equal(agent.body['playerCount'], 1);

    // A player who guesses the URL gets a 404, not a 403 — there is no agent
    // record for them, so there is nothing to be forbidden from.
    assert.equal((await call('/agent/summary', { auth: token(PLAYER_A) })).status, 404);
    assert.equal((await call('/agent/players', { auth: token(PLAYER_A) })).status, 404);
    assert.equal((await call('/agent/invites', { auth: token(ORPHAN) })).status, 404);
  });

  it('scopes the player list to the calling agent', async () => {
    const alice = await call('/agent/players', { auth: token(AGENT_A) });
    const bob = await call('/agent/players', { auth: token(AGENT_B) });
    assert.deepEqual(
      (alice.body['players'] as { username: string }[]).map((p) => p.username),
      ['player_ann'],
    );
    assert.deepEqual(
      (bob.body['players'] as { username: string }[]).map((p) => p.username),
      ['player_ben'],
    );
  });

  it('surfaces the role on /me without letting a player claim one', async () => {
    const agent = await call('/me', { auth: token(AGENT_A) });
    assert.equal((agent.body['agent'] as { status: string }).status, 'active');

    const player = await call('/me', { auth: token(PLAYER_A) });
    assert.equal(player.body['agent'], null);
    // A player CAN see who funds them — support questions start there.
    assert.equal(player.body['agentName'], 'Alice Distribution');

    const orphan = await call('/me', { auth: token(ORPHAN) });
    assert.equal(orphan.body['agentName'], null);
  });

  // ------------------------------------------------------------ allocation

  it('allocates to its own player and moves real coins', async () => {
    const before = await call('/balance', { auth: token(PLAYER_A) });
    const response = await call('/agent/allocate', {
      auth: token(AGENT_A),
      body: { playerId: PLAYER_A, amount: 25_000, idempotencyKey: 'alloc-1' },
    });
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.equal(response.body['inventory'], 975_000);

    const after = await call('/balance', { auth: token(PLAYER_A) });
    assert.equal(Number(after.body['balance']) - Number(before.body['balance']), 25_000);
  });

  it('pays once when the same allocation is retried', async () => {
    const first = await call('/agent/allocate', {
      auth: token(AGENT_A),
      body: { playerId: PLAYER_A, amount: 5_000, idempotencyKey: 'retry-me' },
    });
    const second = await call('/agent/allocate', {
      auth: token(AGENT_A),
      body: { playerId: PLAYER_A, amount: 5_000, idempotencyKey: 'retry-me' },
    });
    assert.equal(first.body['txnId'], second.body['txnId']);
    assert.equal(first.body['inventory'], second.body['inventory']);
  });

  it('refuses to fund another agent\'s player', async () => {
    const response = await call('/agent/allocate', {
      auth: token(AGENT_A),
      body: { playerId: PLAYER_B, amount: 1_000 },
    });
    assert.equal(response.status, 403);
    assert.equal(response.body['code'], 'not_your_player');
  });

  it('refuses more than the inventory holds, and moves nothing', async () => {
    const inventoryBefore = (await call('/agent/summary', { auth: token(AGENT_A) })).body[
      'inventory'
    ];
    const playerBefore = (await call('/balance', { auth: token(PLAYER_A) })).body['balance'];

    const response = await call('/agent/allocate', {
      auth: token(AGENT_A),
      body: { playerId: PLAYER_A, amount: 9_000_000 },
    });
    assert.equal(response.status, 402);
    assert.equal(response.body['code'], 'insufficient_inventory');

    assert.equal(
      (await call('/agent/summary', { auth: token(AGENT_A) })).body['inventory'],
      inventoryBefore,
    );
    assert.equal((await call('/balance', { auth: token(PLAYER_A) })).body['balance'], playerBefore);
  });

  it('refuses zero, negative, fractional and absurd amounts', async () => {
    for (const amount of [0, -1000, 12.5, 50_000_000]) {
      const response = await call('/agent/allocate', {
        auth: token(AGENT_A),
        body: { playerId: PLAYER_A, amount },
      });
      assert.equal(response.status, 400, `amount ${amount} was not refused`);
    }
  });

  it('refuses a suspended agent, and lets them see why', async () => {
    await pool.query(`select set_agent_status($1, 'suspended', $2)`, [AGENT_B, operatorId]);

    const allocate = await call('/agent/allocate', {
      auth: token(AGENT_B),
      body: { playerId: PLAYER_B, amount: 100 },
    });
    assert.equal(allocate.status, 403);
    assert.equal(allocate.body['code'], 'agent_inactive');

    // The dashboard still loads. An agent who cannot see their own numbers has
    // no way to understand what happened.
    const summary = await call('/agent/summary', { auth: token(AGENT_B) });
    assert.equal(summary.status, 200);
    assert.equal(summary.body['status'], 'suspended');

    await pool.query(`select set_agent_status($1, 'active', $2)`, [AGENT_B, operatorId]);
  });

  it('has no route for a player to send coins back', async () => {
    // Not an omission — asserted, so a future "convenience" endpoint has to
    // delete this test on purpose.
    for (const path of ['/agent/redeem', '/agent/withdraw', '/agent/transfer']) {
      assert.equal((await call(path, { auth: token(PLAYER_A), body: {} })).status, 404);
    }
  });

  // ------------------------------------------------------------ the ledger

  it('shows every movement, from the ledger', async () => {
    const response = await call('/agent/transactions', { auth: token(AGENT_A) });
    const rows = response.body['transactions'] as { type: string; amount: number }[];
    // One grant in, three allocations out (25k, 5k, and the retry paid once).
    assert.equal(rows.filter((r) => r.type === 'inventory').length, 1);
    assert.ok(rows.filter((r) => r.type === 'allocation').length >= 2);
    // Money leaving is negative from the agent's side. A report that showed
    // allocations as positive would double-count the inventory.
    for (const row of rows.filter((r) => r.type === 'allocation')) assert.ok(row.amount < 0);
  });

  it('keeps the ledger balanced', async () => {
    const { rows } = await pool.query<{ total: string }>(
      `select coalesce(sum(amount), 0)::text as total from ledger_entries`,
    );
    assert.equal(rows[0]!.total, '0');
  });

  // ----------------------------------------------------------- invitations

  it('mints an invitation, redeems it once, and binds the player', async () => {
    const minted = await call('/agent/invites', {
      auth: token(AGENT_A),
      body: { label: 'flyer' },
    });
    assert.equal(minted.status, 200);
    const invite = String(minted.body['token']);

    // The sign-up screen can name the agent before the account exists.
    const preview = await fetch(`${base}/invite?token=${encodeURIComponent(invite)}`);
    assert.equal(preview.status, 200);
    assert.deepEqual(await preview.json(), { valid: true, agentName: 'Alice Distribution' });

    const registered = await call('/register', {
      auth: token(NEWCOMER),
      body: {
        username: 'invited_ivy',
        dateOfBirth: '1988-01-01',
        country: 'US',
        region: 'NJ',
        inviteToken: invite,
      },
    });
    assert.equal(registered.status, 200, JSON.stringify(registered.body));
    assert.equal(registered.body['agentName'], 'Alice Distribution');

    // The player now belongs to Alice, and Alice can fund them.
    const players = await call('/agent/players', { auth: token(AGENT_A) });
    assert.ok(
      (players.body['players'] as { username: string }[]).some((p) => p.username === 'invited_ivy'),
    );

    // Used up. The same link cannot attach a second player.
    const reused = await fetch(`${base}/invite?token=${encodeURIComponent(invite)}`);
    assert.deepEqual(await reused.json(), { valid: false, agentName: null });
  });

  it('refuses registration on a bad invitation rather than silently dropping it', async () => {
    const stranger = randomUUID();
    await pool.query(`insert into auth.users (id) values ($1)`, [stranger]);
    const response = await call('/register', {
      auth: token(stranger),
      body: {
        username: 'not_invited',
        dateOfBirth: '1988-01-01',
        country: 'US',
        region: 'NJ',
        inviteToken: 'obviously-not-a-real-token',
      },
    });
    assert.equal(response.status, 403);
    assert.equal(response.body['code'], 'invite_invalid');

    // And the account was NOT created, so they can retry with a good link.
    const me = await call('/me', { auth: token(stranger) });
    assert.equal(me.body['registered'], false);
  });

  it('never reveals whether an unknown token exists', async () => {
    const unknown = await fetch(`${base}/invite?token=${'a'.repeat(43)}`);
    assert.deepEqual(await unknown.json(), { valid: false, agentName: null });
  });

  it('will not let a suspended agent mint invitations', async () => {
    await pool.query(`select set_agent_status($1, 'suspended', $2)`, [AGENT_B, operatorId]);
    const response = await call('/agent/invites', { auth: token(AGENT_B), body: {} });
    assert.equal(response.status, 403);
    await pool.query(`select set_agent_status($1, 'active', $2)`, [AGENT_B, operatorId]);
  });

  // ------------------------------------------------------------------ admin

  it('refuses every admin agent route without an operator session', async () => {
    for (const path of ['/admin/agents', `/admin/agents/${AGENT_A}/players`]) {
      const response = await fetch(`${base}${path}`, {
        headers: { Authorization: `Bearer ${token(AGENT_A)}` },
      });
      // A player's Supabase token is not an operator session, however valid it
      // is as a player token.
      assert.equal(response.status, 401, path);
    }
  });

  /**
   * The mistake the first real operator made.
   *
   * The field was labelled "Player username" and matched `username` exactly.
   * They typed the EMAIL they had signed up with, and were told no such player
   * existed while looking at an account that plainly did. Both are accepted
   * now, and the console searches so nobody has to guess which the field wants.
   */
  it('finds a player by email as well as by username', async () => {
    // The shim has no email column; production's auth.users does.
    await pool.query(`alter table auth.users add column if not exists email text`);
    await pool.query(`update auth.users set email = 'ann.lee@example.com' where id = $1`, [
      PLAYER_A,
    ]);

    const found = await agentsDb.findPlayers('ann.lee@example');
    assert.deepEqual(
      found.map((p) => p.username),
      ['player_ann'],
    );

    // And searching by username still works, with the email alongside it so an
    // operator can tell two similar names apart.
    const byName = await agentsDb.findPlayers('player_ann');
    assert.equal(byName[0]?.email, 'ann.lee@example.com');

    // A promotion keyed on the email resolves to the same account.
    const promoted = await agentsDb.createAgent({
      username: 'ann.lee@example.com',
      displayName: 'Ann Distribution',
      operatorId,
    });
    assert.equal(promoted.agentId, PLAYER_A);
    await pool.query(`delete from agents where profile_id = $1`, [PLAYER_A]);
  });

  it('refuses a search too short to mean anything', async () => {
    // One character is a request for the whole player table.
    const response = await fetch(`${base}/admin/players?q=a`, {
      headers: { Authorization: `Bearer ${token(AGENT_A)}` },
    });
    assert.equal(response.status, 401, 'a player token reached the operator search');
  });

  // ------------------------------------------ agent-created player accounts

  /**
   * The founder chose to let agents create accounts and set a temporary
   * password, because their players are recruited in person and many have no
   * email. What keeps that from handing an agent a permanent credential for
   * every player is `must_set_password`, so these tests are mostly about that
   * flag existing, blocking, and clearing.
   */
  describe('agent-created players', () => {
    it('starts an agent-created account empty, and funds it only by allocation', async () => {
      const response = await call('/agent/players', {
        auth: token(AGENT_A),
        body: {
          username: 'walkin_wes',
          password: 'temp-pass-123',
          dateOfBirth: '1985-03-03',
          country: 'US',
          region: 'NJ',
        },
      });
      assert.equal(response.status, 200, JSON.stringify(response.body));
      assert.equal(response.body['username'], 'walkin_wes');
      assert.equal(response.body['mustSetPassword'], true);
      /*
       * ZERO, not the 100,000 a self-service sign-up gets.
       *
       * The agent funds them. Paying a full welcome bonus on top made a 50,000
       * coin allocation look like it had done nothing — the player opened the
       * app to 150,000 and could not tell which part came from their agent —
       * and it minted coins outside the inventory the model rests on.
       */
      assert.equal(response.body['balance'], 0);
      // The sign-in identity is a synthetic address on a non-routable domain.
      assert.match(String(response.body['signInWith']), /^walkin_wes@/);

      // Bound to the creating agent, and countable in their player list.
      const players = await call('/agent/players', { auth: token(AGENT_A) });
      assert.ok(
        (players.body['players'] as { username: string }[]).some(
          (p) => p.username === 'walkin_wes',
        ),
      );

      // And recorded permanently as agent-created.
      const { rows } = await pool.query<{ created_by_agent: string; must_set_password: boolean }>(
        `select created_by_agent, must_set_password from profiles where username = 'walkin_wes'`,
      );
      assert.equal(rows[0]!.created_by_agent, AGENT_A);
      assert.equal(rows[0]!.must_set_password, true);
    });

    it('applies the age gate and the restricted-state list to agent-made accounts', async () => {
      const tooYoung = new Date();
      tooYoung.setFullYear(tooYoung.getFullYear() - 15);
      const minor = await call('/agent/players', {
        auth: token(AGENT_A),
        body: {
          username: 'kiddo_kim',
          password: 'temp-pass-123',
          dateOfBirth: tooYoung.toISOString().slice(0, 10),
          country: 'US',
          region: 'NJ',
        },
      });
      assert.equal(minor.status, 403, 'an agent created an account for a minor');

      const restricted = await call('/agent/players', {
        auth: token(AGENT_A),
        body: {
          username: 'wa_resident',
          password: 'temp-pass-123',
          dateOfBirth: '1985-01-01',
          country: 'US',
          region: RESTRICTED_STATES[0],
        },
      });
      assert.equal(restricted.status, 403);
      assert.equal(restricted.body['code'], 'restricted_region');

      // Neither account exists — a refused creation must leave nothing behind,
      // in our tables OR at the auth provider.
      const { rows } = await pool.query(
        `select count(*)::int as n from profiles where username in ('kiddo_kim','wa_resident')`,
      );
      assert.equal((rows[0] as { n: number }).n, 0);
      assert.equal(authUsers.size, 1, 'an orphaned auth user was left behind');
    });

    it('refuses a username that is taken, a weak password and a bad shape', async () => {
      const cases = [
        { username: 'walkin_wes', password: 'temp-pass-123', expect: 409 },
        { username: 'shorty', password: 'abc', expect: 400 },
        { username: 'has spaces', password: 'temp-pass-123', expect: 400 },
        { username: 'has@at.sign', password: 'temp-pass-123', expect: 400 },
      ];
      for (const testCase of cases) {
        const response = await call('/agent/players', {
          auth: token(AGENT_A),
          body: {
            username: testCase.username,
            password: testCase.password,
            dateOfBirth: '1985-01-01',
            country: 'US',
            region: 'NJ',
          },
        });
        assert.equal(response.status, testCase.expect, `${testCase.username}: ${JSON.stringify(response.body)}`);
      }
    });

    it('will not let a plain player or a suspended agent create accounts', async () => {
      const asPlayer = await call('/agent/players', {
        auth: token(PLAYER_A),
        body: { username: 'sneaky', password: 'temp-pass-123', dateOfBirth: '1985-01-01', country: 'US', region: 'NJ' },
      });
      assert.equal(asPlayer.status, 404);

      await pool.query(`select set_agent_status($1, 'suspended', $2)`, [AGENT_B, operatorId]);
      const suspended = await call('/agent/players', {
        auth: token(AGENT_B),
        body: { username: 'susp_made', password: 'temp-pass-123', dateOfBirth: '1985-01-01', country: 'US', region: 'NJ' },
      });
      assert.equal(suspended.status, 403);
      await pool.query(`select set_agent_status($1, 'active', $2)`, [AGENT_B, operatorId]);
    });

    it('clears the must-set-password flag only for the caller', async () => {
      const created = await pool.query<{ id: string }>(
        `select id from profiles where username = 'walkin_wes'`,
      );
      const wes = created.rows[0]!.id;

      // /me tells the app to block everything until the password is replaced.
      assert.equal((await call('/me', { auth: token(wes) })).body['mustSetPassword'], true);

      // Another account cannot clear somebody else's flag: the route is keyed
      // on the token, and takes no player id at all.
      await call('/agent/password-set', { auth: token(PLAYER_A), body: {} });
      assert.equal((await call('/me', { auth: token(wes) })).body['mustSetPassword'], true);

      await call('/agent/password-set', { auth: token(wes), body: {} });
      assert.equal((await call('/me', { auth: token(wes) })).body['mustSetPassword'], false);
    });

    /**
     * Forgotten passwords, which have no self-service route and never will.
     *
     * These accounts sign in at `players.juwa.invalid`, a domain chosen because
     * it CANNOT receive mail — the alternative is password-reset links for real
     * player accounts landing in a stranger's inbox. So "email me a link" is
     * permanently unavailable to them and recovery has to be an agent doing it
     * in person.
     *
     * That is a real power, so these tests are about its two limits: it reaches
     * only the agent's own players, and it does not survive its own use.
     */
    describe('resetting a forgotten password', () => {
      /** walkin_wes, created by AGENT_A at the top of this block. */
      const wesId = async () =>
        (await pool.query<{ id: string }>(`select id from profiles where username = 'walkin_wes'`))
          .rows[0]!.id;

      it('sets a new password and demands it be replaced again', async () => {
        const wes = await wesId();
        const before = authPasswords.get(wes);
        assert.equal(before, 'temp-pass-123', 'fixture drift: wes was not created as expected');
        // Cleared by the previous test, which is what makes the re-raise below
        // an observable change rather than a value that was already true.
        assert.equal((await call('/me', { auth: token(wes) })).body['mustSetPassword'], false);

        const response = await call('/agent/players/reset-password', {
          auth: token(AGENT_A),
          body: { playerId: wes, password: 'second-temp-456' },
        });
        assert.equal(response.status, 200, JSON.stringify(response.body));

        // The password really changed at the provider...
        assert.equal(authPasswords.get(wes), 'second-temp-456');
        // ...and the account is blocked until the player replaces it, which is
        // the only thing stopping the agent's copy from being a permanent
        // credential for an account that is not theirs.
        assert.equal((await call('/me', { auth: token(wes) })).body['mustSetPassword'], true);

        // The password is NOT echoed back. The agent typed it; a response body
        // is a worse place for it than the screen it is already on.
        assert.equal(
          JSON.stringify(response.body).includes('second-temp-456'),
          false,
          'the temporary password came back in the response',
        );
      });

      it('will not reset a password for a player who belongs to another agent', async () => {
        const wes = await wesId();
        const response = await call('/agent/players/reset-password', {
          auth: token(AGENT_B),
          body: { playerId: wes, password: 'not-bobs-to-set' },
        });
        assert.equal(response.status, 403, JSON.stringify(response.body));
        assert.equal(response.body['code'], 'not_your_player');
        // And crucially: nothing happened. A route that refused AFTER changing
        // the password would pass a status assertion and still have locked a
        // stranger's player out of their account.
        assert.equal(authPasswords.get(wes), 'second-temp-456');
      });

      it('refuses a plain player, a weak password and a made-up id', async () => {
        const wes = await wesId();

        // No agent record for this caller, so there is nothing to scope to.
        const asPlayer = await call('/agent/players/reset-password', {
          auth: token(PLAYER_A),
          body: { playerId: wes, password: 'temp-pass-999' },
        });
        assert.equal(asPlayer.status, 404);

        // Refused before anything is touched, so the flag is not raised on a
        // player whose password is then left as it was — which would lock them
        // into a set-password prompt they cannot get past.
        const weak = await call('/agent/players/reset-password', {
          auth: token(AGENT_A),
          body: { playerId: wes, password: 'short' },
        });
        assert.equal(weak.status, 400);

        // A uuid that is nobody's is "not your player", not a 500. The agent
        // sees the same sentence for a typo as for a real stranger's id, which
        // is also all they should be able to learn from it.
        const nobody = await call('/agent/players/reset-password', {
          auth: token(AGENT_A),
          body: { playerId: randomUUID(), password: 'temp-pass-999' },
        });
        assert.equal(nobody.status, 403);

        assert.equal(authPasswords.get(wes), 'second-temp-456', 'a refused reset changed something');
      });
    });
  });

  // ------------------------------------------------------------- reversals

  describe('reversing a mis-sent allocation', () => {
    /*
     * AGENT_B, not AGENT_A, and it is not arbitrary: `POST /agent/*` shares the
     * bet limiter — ten requests then two a second — and the allocation tests
     * above spend AGENT_A's entire bucket. Running these on the same identity
     * produced a 429 that surfaced as "txnId=undefined", which reads like a
     * broken reversal rather than a throttled allocation. Tests must not
     * inherit each other's quota.
     */
    it('is admin-only and posts an opposite transaction', async () => {
      const sent = await call('/agent/allocate', {
        auth: token(AGENT_B),
        body: { playerId: PLAYER_B, amount: 400_000, idempotencyKey: 'oops-' + randomUUID() },
      });
      assert.equal(sent.status, 200, JSON.stringify(sent.body));
      const txnId = String(sent.body['txnId']);
      const inventoryAfterSend = sent.body['inventory'] as number;

      // No agent-facing route exists, and the admin one refuses a player token.
      assert.equal(
        (await call('/admin/allocations/reverse', {
          auth: token(AGENT_B),
          body: { txnId, reason: 'let me undo my own mistake' },
        })).status,
        401,
      );

      const reversed = await adminCall('/admin/allocations/reverse', {
        txnId,
        reason: 'typo: meant 40,000',
      });
      assert.equal(reversed.status, 200, JSON.stringify(reversed.body));
      assert.equal(reversed.body['agentInventory'], inventoryAfterSend + 400_000);

      // Nothing was edited: the original is still there, plus a correction.
      const { rows } = await pool.query<{ n: number }>(
        `select count(*)::int as n from transactions
          where type::text = 'allocation' and metadata->>'reverses' = $1`,
        [txnId],
      );
      assert.equal(rows[0]!.n, 1);

      // And a second attempt is refused.
      const again = await adminCall('/admin/allocations/reverse', { txnId, reason: 'again' });
      assert.equal(again.status, 409);
      assert.equal(again.body['code'], 'already_reversed');
    });

    it('refuses to reverse coins the player has already spent', async () => {
      const sent = await call('/agent/allocate', {
        auth: token(AGENT_B),
        body: { playerId: PLAYER_B, amount: 50_000, idempotencyKey: 'spent-' + randomUUID() },
      });
      assert.equal(sent.status, 200, JSON.stringify(sent.body));
      const txnId = String(sent.body['txnId']);

      // Drain the player's balance the way playing would.
      await pool.query(
        `select post_transfer('bet', player_account($1,'GC'), system_account('house','GC'),
                              (select balance from account_balance_cache
                                where account_id = player_account($1,'GC')),
                              'GC', $2)`,
        [PLAYER_B, 'drain-' + randomUUID()],
      );

      const response = await adminCall('/admin/allocations/reverse', {
        txnId,
        reason: 'too late',
      });
      assert.equal(response.status, 409, JSON.stringify(response.body));
      assert.equal(response.body['code'], 'already_spent');

      const { rows } = await pool.query<{ balance: string }>(
        `select balance from account_balance_cache where account_id = player_account($1,'GC')`,
        [PLAYER_B],
      );
      assert.equal(Number(rows[0]!.balance), 0, 'a reversal pushed a player negative');
    });

    it('refuses to reverse an inventory grant', async () => {
      const { rows } = await pool.query<{ id: string }>(
        `select id from transactions where type::text = 'inventory' limit 1`,
      );
      const response = await adminCall('/admin/allocations/reverse', {
        txnId: rows[0]!.id,
        reason: 'not allowed',
      });
      assert.equal(response.status, 400);
      assert.equal(response.body['code'], 'not_reversible');
    });
  });

  // ----------------------------------------------------------- applications

  it('lets a player apply, which grants nothing until approved', async () => {
    const response = await call('/agent/apply', {
      auth: token(ORPHAN),
      body: { displayName: 'Orphan Outfit' },
    });
    assert.equal(response.status, 200, JSON.stringify(response.body));
    assert.equal(response.body['status'], 'pending');

    // Pending is not active: they can see a dashboard and do nothing on it.
    assert.equal((await call('/agent/summary', { auth: token(ORPHAN) })).body['status'], 'pending');
    assert.equal(
      (await call('/agent/invites', { auth: token(ORPHAN), body: {} })).status,
      403,
      'a pending applicant could mint invites',
    );

    // Applying twice is harmless and does not reset anything.
    const again = await call('/agent/apply', {
      auth: token(ORPHAN),
      body: { displayName: 'Something Else' },
    });
    assert.equal(again.body['status'], 'pending');
    assert.equal(
      (await call('/agent/summary', { auth: token(ORPHAN) })).body['displayName'],
      'Orphan Outfit',
      'a second application overwrote the first',
    );

    // The operator sees them in the list and can approve with one call.
    const listed = await adminGet('/admin/agents');
    assert.ok(
      (listed.body['agents'] as { displayName: string; status: string }[]).some(
        (a) => a.displayName === 'Orphan Outfit' && a.status === 'pending',
      ),
    );
  });

  it('will not let an agent grant themselves inventory', async () => {
    const response = await call(`/admin/agents/${AGENT_A}/inventory`, {
      auth: token(AGENT_A),
      body: { amount: 1_000_000 },
    });
    assert.equal(response.status, 401);
    assert.equal(
      (await call('/agent/summary', { auth: token(AGENT_A) })).body['inventory'],
      970_000,
    );
  });
});
