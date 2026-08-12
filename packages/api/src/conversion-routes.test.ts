/**
 * The conversion endpoints, over real HTTP against a real database.
 *
 * The money itself is tested in `@juwa/server`'s conversions.test.ts, which
 * runs the whole Step 1 to Step 9 scenario against the Postgres functions. What
 * is tested HERE is the layer above them, and it has exactly one job worth
 * testing: identity. Every route below is asserted to be scoped to the caller
 * resolved from a verified token, so that a player cannot approve their own
 * request, an agent cannot settle another agent's queue, and no route accepts
 * an id from the body that would widen what it touches.
 *
 *   JUWA_CONVERSION_API_TEST_DATABASE_URL=postgres://postgres@localhost:5432/juwa_conv_api \
 *     npm test -w @juwa/api
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
import { hashToken } from './admin.js';

const URL_ENV = process.env['JUWA_CONVERSION_API_TEST_DATABASE_URL'];
const here = dirname(fileURLToPath(import.meta.url));
const migrations = resolve(here, '../../../db/migrations');
const dbTest = resolve(here, '../../../db/test');

const SECRET = 'test-jwt-secret-not-a-real-one';
const ORIGIN = 'https://play.juwa.test';

describe(
  'conversion routes',
  { skip: URL_ENV ? false : 'JUWA_CONVERSION_API_TEST_DATABASE_URL not set' },
  () => {
    let pool: import('pg').Pool;
    let base: string;
    let stop: () => void;
    let operatorId: string;
    let adminToken: string;

    const AGENT_A = randomUUID();
    const AGENT_B = randomUUID();
    const PLAYER_A = randomUUID();
    /** Belongs to agent B, so every cross-tenant refusal has a real other side. */
    const PLAYER_B = randomUUID();
    /** Nobody's player. Conversions need an agent; this one has none. */
    const ORPHAN = randomUUID();

    const RATE = 10_000;

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

    /** Raise a request as a player and return its id. */
    async function raise(player: string, direction: string, amount: number) {
      const response = await call('/wallet/convert', {
        auth: token(player),
        body: { direction, amount },
      });
      assert.equal(response.status, 200, JSON.stringify(response.body));
      return (response.body['request'] as { id: string }).id;
    }

    before(async () => {
      const { Pool } = await import('pg');
      pool = new Pool({ connectionString: URL_ENV });

      await pool.query(readFileSync(resolve(dbTest, 'supabase_shim.sql'), 'utf8'));
      for (const file of readdirSync(migrations)
        .filter((f) => /^\d{4}_.*\.sql$/.test(f))
        .sort()) {
        await pool.query(readFileSync(resolve(migrations, file), 'utf8'));
      }

      for (const id of [AGENT_A, AGENT_B, PLAYER_A, PLAYER_B, ORPHAN]) {
        await pool.query(`insert into auth.users (id) values ($1)`, [id]);
        await pool.query(`insert into profiles (id, username) values ($1, $2)`, [
          id,
          `u${id.slice(0, 8)}`,
        ]);
      }

      operatorId = (
        await pool.query<{ id: string }>(
          `insert into operators (email, password_hash, totp_secret, role)
           values ($1, 'scrypt$x$y', '\\x00', 'admin') returning id`,
          [`conv-api-${randomUUID()}@juwa.test`],
        )
      ).rows[0]!.id;

      adminToken = randomUUID();
      await pool.query(
        `insert into operator_sessions (token_hash, operator_id, expires_at)
         values ($1, $2, now() + interval '1 hour')`,
        [hashToken(adminToken), operatorId],
      );

      await pool.query(
        `insert into agents (profile_id, display_name, status, created_by, activated_at)
         values ($1, 'Alice', 'active', $3, now()), ($2, 'Bob', 'active', $3, now())`,
        [AGENT_A, AGENT_B, operatorId],
      );
      await pool.query(
        `insert into player_agents (player_id, agent_id) values ($1, $2), ($3, $4)`,
        [PLAYER_A, AGENT_A, PLAYER_B, AGENT_B],
      );

      await pool.query(`select set_exchange_rate('player_agent', $1, $2)`, [RATE, operatorId]);
      await pool.query(`select set_exchange_rate('agent_operator', 15000, $1)`, [operatorId]);

      for (const agent of [AGENT_A, AGENT_B]) {
        await pool.query(`select * from grant_agent_inventory($1, 5000000, $2, $3)`, [
          agent,
          operatorId,
          `gc-${randomUUID()}`,
        ]);
        await pool.query(`select * from grant_agent_cc($1, 500, $2, $3)`, [
          agent,
          operatorId,
          `cc-${randomUUID()}`,
        ]);
      }
      for (const player of [PLAYER_A, PLAYER_B]) {
        await pool.query(
          `select post_transfer('payout', system_account('house','GC'),
                                player_account($1,'GC'), 2000000, 'GC', $2)`,
          [player, `fund-${randomUUID()}`],
        );
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

    // ------------------------------------------------------------ player

    it('shows a player both balances and their own rate', async () => {
      const response = await call('/wallet', { auth: token(PLAYER_A) });
      assert.equal(response.status, 200);
      const wallet = response.body['wallet'] as { gc: number; cc: number };
      assert.equal(wallet.gc, 2_000_000);
      assert.equal(wallet.cc, 0);
      assert.equal(response.body['rate'], RATE);
      assert.equal((response.body['agent'] as { displayName: string }).displayName, 'Alice');
    });

    it('does not tell a player the operator rate', async () => {
      // The agent's commercial terms are not the player's business, and showing
      // them invites the reading that the difference is owed to the player.
      const response = await call('/wallet', { auth: token(PLAYER_A) });
      assert.equal(JSON.stringify(response.body).includes('agentOperator'), false);
    });

    it('raises a request without moving anything', async () => {
      const before = (await call('/wallet', { auth: token(PLAYER_A) })).body['wallet'] as {
        gc: number;
      };
      const id = await raise(PLAYER_A, 'gc_to_cc', 100_000);

      const after = (await call('/wallet', { auth: token(PLAYER_A) })).body;
      assert.equal((after['wallet'] as { gc: number }).gc, before.gc);
      const requests = after['requests'] as { id: string; status: string; ccAmount: number }[];
      const mine = requests.find((r) => r.id === id);
      assert.equal(mine?.status, 'pending');
      assert.equal(mine?.ccAmount, 10);
    });

    it('refuses an amount that is not a whole number of CC', async () => {
      const response = await call('/wallet/convert', {
        auth: token(PLAYER_A),
        body: { direction: 'gc_to_cc', amount: 15_000 },
      });
      assert.equal(response.status, 400);
      assert.equal(response.body['code'], 'not_a_whole_amount');
    });

    it('refuses a second open request in the same direction', async () => {
      const response = await call('/wallet/convert', {
        auth: token(PLAYER_A),
        body: { direction: 'gc_to_cc', amount: 20_000 },
      });
      assert.equal(response.status, 409);
      assert.equal(response.body['code'], 'request_already_open');
    });

    it('refuses a player with no agent', async () => {
      const response = await call('/wallet/convert', {
        auth: token(ORPHAN),
        body: { direction: 'gc_to_cc', amount: 10_000 },
      });
      assert.equal(response.status, 403);
      assert.equal(response.body['code'], 'no_agent');
    });

    it('refuses a nonsense direction or amount', async () => {
      for (const body of [
        { direction: 'sideways', amount: 10_000 },
        { direction: 'gc_to_cc', amount: -5 },
        { direction: 'gc_to_cc', amount: 1.5 },
        { direction: 'gc_to_cc', amount: '10000' },
      ]) {
        const response = await call('/wallet/convert', { auth: token(PLAYER_A), body });
        assert.equal(response.status, 400, JSON.stringify(body));
      }
    });

    it('lets a player see only their own requests', async () => {
      await raise(PLAYER_B, 'gc_to_cc', 50_000);
      const response = await call('/wallet', { auth: token(PLAYER_A) });
      const requests = response.body['requests'] as { playerId: string }[];
      assert.ok(requests.length > 0);
      assert.equal(
        requests.every((r) => r.playerId === PLAYER_A),
        true,
      );
    });

    // ------------------------------------------------------------- agent

    it("shows an agent only the requests addressed to them", async () => {
      const response = await call('/agent/conversions', { auth: token(AGENT_A) });
      assert.equal(response.status, 200);
      const requests = response.body['requests'] as { agentId: string; username: string }[];
      assert.ok(requests.length > 0);
      assert.equal(
        requests.every((r) => r.agentId === AGENT_A),
        true,
      );
      // And it resolves the username, because an agent cannot act on a UUID.
      assert.ok(requests[0]!.username);
    });

    it('shows an agent both of their own balances and both rates', async () => {
      const response = await call('/agent/conversions', { auth: token(AGENT_A) });
      const wallet = response.body['wallet'] as { gc: number; cc: number };
      const rates = response.body['rates'] as { playerAgent: number; agentOperator: number };
      assert.equal(wallet.gc, 5_000_000);
      assert.equal(wallet.cc, 500);
      assert.equal(rates.playerAgent, RATE);
      assert.equal(rates.agentOperator, 15_000);
    });

    it('refuses an agent settling another agent\'s request', async () => {
      const requests = (
        await call('/agent/conversions', { auth: token(AGENT_A) })
      ).body['requests'] as { id: string }[];
      const target = requests[0]!.id;

      const response = await call('/agent/conversions/approve', {
        auth: token(AGENT_B),
        body: { requestId: target },
      });
      assert.equal(response.status, 409);
      assert.equal(response.body['code'], 'not_pending');
    });

    it('refuses a player approving anything at all', async () => {
      const requests = (
        await call('/agent/conversions', { auth: token(AGENT_A) })
      ).body['requests'] as { id: string }[];

      // Not an agent, so there is no agent record to scope a query to and the
      // route cannot resolve the caller at all.
      const response = await call('/agent/conversions/approve', {
        auth: token(PLAYER_A),
        body: { requestId: requests[0]!.id },
      });
      assert.equal(response.status, 404);
    });

    it('approves, and moves both currencies at once', async () => {
      const requests = (
        await call('/agent/conversions', { auth: token(AGENT_A) })
      ).body['requests'] as { id: string; gcAmount: number; ccAmount: number }[];
      const target = requests.find((r) => r.gcAmount === 100_000)!;

      const before = (await call('/wallet', { auth: token(PLAYER_A) })).body['wallet'] as {
        gc: number;
        cc: number;
      };
      const response = await call('/agent/conversions/approve', {
        auth: token(AGENT_A),
        body: { requestId: target.id },
      });
      assert.equal(response.status, 200, JSON.stringify(response.body));

      const after = (await call('/wallet', { auth: token(PLAYER_A) })).body['wallet'] as {
        gc: number;
        cc: number;
      };
      assert.equal(before.gc - after.gc, 100_000);
      assert.equal(after.cc - before.cc, 10);
    });

    it('refuses a second approval of the same request', async () => {
      const settled = (
        await call('/agent/conversions?status=approved', { auth: token(AGENT_A) })
      ).body['requests'] as { id: string }[];

      const wallet = (await call('/wallet', { auth: token(PLAYER_A) })).body['wallet'] as {
        cc: number;
      };
      const response = await call('/agent/conversions/approve', {
        auth: token(AGENT_A),
        body: { requestId: settled[0]!.id },
      });
      assert.equal(response.status, 409);

      const after = (await call('/wallet', { auth: token(PLAYER_A) })).body['wallet'] as {
        cc: number;
      };
      assert.equal(after.cc, wallet.cc);
    });

    it('rejects with a reason, and moves nothing', async () => {
      const id = await raise(PLAYER_A, 'gc_to_cc', 30_000);
      const before = (await call('/wallet', { auth: token(PLAYER_A) })).body['wallet'] as {
        gc: number;
        cc: number;
      };

      const response = await call('/agent/conversions/reject', {
        auth: token(AGENT_A),
        body: { requestId: id, reason: 'not this week' },
      });
      assert.equal(response.status, 200);

      const after = (await call('/wallet', { auth: token(PLAYER_A) })).body;
      assert.deepEqual(after['wallet'], before);
      const mine = (after['requests'] as { id: string; status: string; reason: string }[]).find(
        (r) => r.id === id,
      );
      assert.equal(mine?.status, 'rejected');
      assert.equal(mine?.reason, 'not this week');
    });

    it('lets a player cancel their own request and nobody else\'s', async () => {
      const id = await raise(PLAYER_A, 'gc_to_cc', 40_000);

      const theirs = await call('/wallet/convert/cancel', {
        auth: token(PLAYER_B),
        body: { requestId: id },
      });
      assert.equal(theirs.status, 409);

      const mine = await call('/wallet/convert/cancel', {
        auth: token(PLAYER_A),
        body: { requestId: id },
      });
      assert.equal(mine.status, 200);
    });

    it('buys inventory with CC at the operator rate', async () => {
      const before = (await call('/agent/conversions', { auth: token(AGENT_A) })).body[
        'wallet'
      ] as { gc: number; cc: number };

      const response = await call('/agent/conversions/redeem', {
        auth: token(AGENT_A),
        body: { ccAmount: 10, idempotencyKey: `redeem-${randomUUID()}` },
      });
      assert.equal(response.status, 200, JSON.stringify(response.body));
      assert.equal(response.body['gcAmount'], 150_000);

      const after = (await call('/agent/conversions', { auth: token(AGENT_A) })).body[
        'wallet'
      ] as { gc: number; cc: number };
      assert.equal(after.gc - before.gc, 150_000);
      assert.equal(before.cc - after.cc, 10);
    });

    it('redeems once when the same idempotency key is retried', async () => {
      const key = `retry-${randomUUID()}`;
      const before = (await call('/agent/conversions', { auth: token(AGENT_A) })).body[
        'wallet'
      ] as { gc: number };

      await call('/agent/conversions/redeem', {
        auth: token(AGENT_A),
        body: { ccAmount: 5, idempotencyKey: key },
      });
      await call('/agent/conversions/redeem', {
        auth: token(AGENT_A),
        body: { ccAmount: 5, idempotencyKey: key },
      });

      const after = (await call('/agent/conversions', { auth: token(AGENT_A) })).body[
        'wallet'
      ] as { gc: number };
      assert.equal(after.gc - before.gc, 75_000);
    });

    it('refuses a player redeeming agent CC', async () => {
      const response = await call('/agent/conversions/redeem', {
        auth: token(PLAYER_A),
        body: { ccAmount: 1 },
      });
      assert.equal(response.status, 404);
    });

    // ---------------------------------------------------------- operator

    it('sets a rate from the console and records the history', async () => {
      const response = await call('/admin/rates', {
        auth: adminToken,
        body: { tier: 'player_agent', gcPerCc: 11_000, note: 'test raise' },
      });
      assert.equal(response.status, 200, JSON.stringify(response.body));
      assert.equal((response.body['current'] as { playerAgent: number }).playerAgent, 11_000);

      const listing = await call('/admin/rates', { auth: adminToken });
      const history = listing.body['history'] as { gcPerCc: number; note: string | null }[];
      assert.ok(history.some((r) => r.gcPerCc === 11_000 && r.note === 'test raise'));
      // The superseded rate is still there. That is the point of the table.
      assert.ok(history.some((r) => r.gcPerCc === RATE));

      await call('/admin/rates', {
        auth: adminToken,
        body: { tier: 'player_agent', gcPerCc: RATE, note: 'restored' },
      });
    });

    it('refuses the console to anyone without an operator session', async () => {
      for (const auth of [token(AGENT_A), token(PLAYER_A), null]) {
        const response = await call('/admin/rates', {
          auth,
          body: { tier: 'player_agent', gcPerCc: 1 },
        });
        assert.notEqual(response.status, 200);
      }
    });

    it('requires a reason on a manual adjustment', async () => {
      const response = await call('/admin/adjust', {
        auth: adminToken,
        body: { ownerId: PLAYER_A, kind: 'player', currency: 'CC', delta: 5 },
      });
      assert.equal(response.status, 400);
    });

    it('adjusts a balance and writes an audit row', async () => {
      const before = (await call('/wallet', { auth: token(PLAYER_A) })).body['wallet'] as {
        cc: number;
      };
      const response = await call('/admin/adjust', {
        auth: adminToken,
        body: {
          ownerId: PLAYER_A,
          kind: 'player',
          currency: 'CC',
          delta: 5,
          reason: 'goodwill after a support call',
        },
      });
      assert.equal(response.status, 200, JSON.stringify(response.body));

      const after = (await call('/wallet', { auth: token(PLAYER_A) })).body['wallet'] as {
        cc: number;
      };
      assert.equal(after.cc - before.cc, 5);

      const { rows } = await pool.query(
        `select 1 from audit_log where target = $1 and field = 'balance_adjusted_CC'`,
        [`player:${PLAYER_A}`],
      );
      assert.equal(rows.length >= 1, true);
    });

    it('hands an agent CC from the console', async () => {
      const before = (await call('/agent/conversions', { auth: token(AGENT_B) })).body[
        'wallet'
      ] as { cc: number };
      const response = await call('/admin/agents/cc', {
        auth: adminToken,
        body: { agentId: AGENT_B, amount: 25, idempotencyKey: `grant-${randomUUID()}` },
      });
      assert.equal(response.status, 200, JSON.stringify(response.body));

      const after = (await call('/agent/conversions', { auth: token(AGENT_B) })).body[
        'wallet'
      ] as { cc: number };
      assert.equal(after.cc - before.cc, 25);
    });

    // --------------------------------------------------------- the books

    it('leaves the ledger balanced in every currency', async () => {
      const { rows } = await pool.query(
        `select currency, sum(amount) as total from ledger_entries
         group by currency having sum(amount) <> 0`,
      );
      assert.deepEqual(rows, []);
    });

    it('leaves the balance cache reconciled', async () => {
      const { rows } = await pool.query(`select * from reconcile_balances()`);
      assert.deepEqual(rows, []);
    });

    /**
     * The boundary 0009 drew, restated for the currency that crosses it.
     *
     * `agents.test.ts` asserts there is no route for a player to send GC back
     * to an agent, with a comment saying a future "convenience" endpoint has to
     * delete that test on purpose. This is that deletion, done on purpose and
     * narrowed rather than removed: a player still cannot hand coins to an
     * agent at will. The ONLY path is a request the agent has to approve, it is
     * priced at a published rate, and every step of it is on the ledger.
     */
    it('still has no way for a player to move coins without an approval', async () => {
      for (const path of ['/agent/redeem', '/agent/withdraw', '/agent/transfer']) {
        assert.equal((await call(path, { auth: token(PLAYER_A), body: {} })).status, 404);
      }
      // And the conversion route itself creates a request, never a transfer:
      // the player's balance is identical before and after.
      const before = (await call('/wallet', { auth: token(PLAYER_A) })).body['wallet'];
      const id = await raise(PLAYER_A, 'gc_to_cc', 10_000);
      const after = (await call('/wallet', { auth: token(PLAYER_A) })).body['wallet'];
      assert.deepEqual(after, before);
      await call('/wallet/convert/cancel', { auth: token(PLAYER_A), body: { requestId: id } });
    });
  },
);
