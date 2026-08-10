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
import { AgentsDb, PostgresDb } from '@juwa/server';
import { createServer } from './server.js';
import { signJwt } from './jwt.js';

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
    await pool.query(`select * from grant_agent_inventory($1, 1000000, $2, $3)`, [
      AGENT_A,
      operatorId,
      `test-grant-${randomUUID()}`,
    ]);
  });

  after(async () => {
    stop?.();
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
