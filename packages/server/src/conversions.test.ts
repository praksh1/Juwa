/**
 * GC <-> CC conversions, against a REAL Postgres.
 *
 * Nothing here is mocked and nothing could usefully be. Every property under
 * test — a conversion is atomic across two currencies, an approval happens at
 * most once, an agent cannot approve what they cannot fund, a settled rate can
 * never move — is enforced by a `security definer` Postgres function or by a
 * constraint. A mocked database would assert that this file's own arithmetic
 * works, which is not the property anyone is worried about.
 *
 * The whole of the brief's Step 1 to Step 9 scenario is here, in order, with
 * every balance asserted at every step.
 *
 *   JUWA_CONVERSION_TEST_DATABASE_URL=postgres://postgres@localhost:5432/juwa_cc \
 *     npm test -w @juwa/server
 */

import { strict as assert } from 'node:assert';
import { after, before, describe, it } from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

const URL_ENV = process.env['JUWA_CONVERSION_TEST_DATABASE_URL'];
const here = dirname(fileURLToPath(import.meta.url));
const migrations = resolve(here, '../../../db/migrations');
const dbTest = resolve(here, '../../../db/test');

describe(
  'GC <-> CC conversions',
  { skip: URL_ENV ? false : 'JUWA_CONVERSION_TEST_DATABASE_URL not set' },
  () => {
    let pool: import('pg').Pool;

    const AGENT = randomUUID();
    const PLAYER = randomUUID();
    /** A second agent, so every cross-tenant refusal has a real other tenant. */
    const OTHER_AGENT = randomUUID();
    let operatorId: string;

    /** The player/agent rate this suite runs at. Set explicitly, not inherited. */
    const PLAYER_RATE = 10_000;
    /** The operator rate. Higher, which is the agent's incentive to distribute. */
    const OPERATOR_RATE = 15_000;

    const q = async <T extends Record<string, unknown> = Record<string, unknown>>(
      sql: string,
      params: unknown[] = [],
    ) => (await pool.query<T>(sql, params)).rows;

    /**
     * The single row a query is expected to return.
     *
     * `const [row] = await q(...)` types `row` as possibly-undefined under
     * `noUncheckedIndexedAccess`, and the honest way to discharge that in a
     * test is to assert it rather than to assert-non-null it: if a query that
     * should return a row returns none, that IS the failure, and it should be
     * reported as one rather than as a TypeError three lines later.
     */
    const one = async <T extends Record<string, unknown>>(sql: string, params: unknown[] = []) => {
      const rows = await q<T>(sql, params);
      const row = rows[0];
      assert.ok(row, `expected one row from: ${sql}`);
      return row;
    };

    /**
     * A balance, defaulting to zero for an account that does not exist yet —
     * which is a real state, since accounts are created on first use.
     */
    const balance = async (owner: string, kind: 'player' | 'agent', currency: string) =>
      Number(
        (
          await q<{ b: string }>(
            `select coalesce((select c.balance from account_balance_cache c
               join accounts a on a.id = c.account_id
               where a.owner_id = $1 and a.kind::text = $2 and a.currency = $3), 0) as b`,
            [owner, kind, currency],
          )
        )[0]!.b,
      );

    const playerGc = () => balance(PLAYER, 'player', 'GC');
    const playerCc = () => balance(PLAYER, 'player', 'CC');
    const agentGc = () => balance(AGENT, 'agent', 'GC');
    const agentCc = () => balance(AGENT, 'agent', 'CC');

    before(async () => {
      const { Pool } = await import('pg');
      pool = new Pool({ connectionString: URL_ENV, max: 12 });

      await pool.query(readFileSync(resolve(dbTest, 'supabase_shim.sql'), 'utf8'));
      for (const file of readdirSync(migrations)
        .filter((f) => /^\d{4}_.*\.sql$/.test(f))
        .sort()) {
        await pool.query(readFileSync(resolve(migrations, file), 'utf8'));
      }

      for (const id of [AGENT, OTHER_AGENT, PLAYER]) {
        await pool.query(`insert into auth.users (id) values ($1)`, [id]);
        await pool.query(`insert into profiles (id, username) values ($1, $2)`, [
          id,
          `u${id.slice(0, 8)}`,
        ]);
      }

      operatorId = (
        await q<{ id: string }>(
          `insert into operators (email, password_hash, totp_secret, role)
           values ($1, 'scrypt$x$y', '\\x00', 'admin') returning id`,
          [`conv-${randomUUID()}@juwa.test`],
        )
      )[0]!.id;

      for (const [id, name] of [
        [AGENT, 'Agent A'],
        [OTHER_AGENT, 'Agent Z'],
      ] as const) {
        await pool.query(
          `insert into agents (profile_id, display_name, status, created_by, activated_at)
           values ($1, $2, 'active', $3, now())`,
          [id, name, operatorId],
        );
      }
      await pool.query(`insert into player_agents (player_id, agent_id) values ($1, $2)`, [
        PLAYER,
        AGENT,
      ]);

      // Rates are set rather than assumed, so this suite does not depend on
      // whatever the migration seeded or on what another suite left behind.
      await pool.query(`select set_exchange_rate('player_agent', $1, $2)`, [
        PLAYER_RATE,
        operatorId,
      ]);
      await pool.query(`select set_exchange_rate('agent_operator', $1, $2)`, [
        OPERATOR_RATE,
        operatorId,
      ]);
    });

    after(async () => {
      await pool?.end();
    });

    // ------------------------------------------------------ the scenario

    it('Step 1 — the operator gives the agent 200 CC and no GC', async () => {
      await q(`select grant_agent_cc($1, 200, $2, 'seed-cc-1')`, [AGENT, operatorId]);
      assert.equal(await agentCc(), 200);
      assert.equal(await agentGc(), 0);
    });

    it('Step 2-3 — the agent funds the player from inventory', async () => {
      await q(`select grant_agent_inventory($1, 500000, $2, 'seed-gc-1')`, [AGENT, operatorId]);
      await q(`select allocate_to_player($1, $2, 100000, 'alloc-1')`, [AGENT, PLAYER]);

      assert.equal(await playerGc(), 100_000);
      assert.equal(await agentGc(), 400_000);
    });

    it('Step 4 — the player plays up to 200,000 GC', async () => {
      // Standing in for a winning session: coins arrive from the house exactly
      // as a payout does. What matters here is the balance, not the route.
      await q(
        `select post_transfer('payout', system_account('house','GC'),
                              player_account($1,'GC'), 100000, 'GC', 'win-1')`,
        [PLAYER],
      );
      assert.equal(await playerGc(), 200_000);
    });

    it('Step 5 — a redemption request moves nothing', async () => {
      const { request_conversion: id } = await one<{ request_conversion: string }>(
        `select request_conversion($1, 'gc_to_cc', 100000)`,
        [PLAYER],
      );
      const row = await one<{
        cc_amount: string;
        gc_amount: string;
        gc_per_cc: string;
        status: string;
      }>(`select cc_amount, gc_amount, gc_per_cc, status from conversion_requests where id = $1`, [
        id,
      ]);

      assert.equal(Number(row.cc_amount), 10);
      assert.equal(Number(row.gc_amount), 100_000);
      assert.equal(Number(row.gc_per_cc), PLAYER_RATE);
      assert.equal(row.status, 'pending');

      // THE POINT OF THE STEP: nothing has moved.
      assert.equal(await playerGc(), 200_000);
      assert.equal(await playerCc(), 0);
      assert.equal(await agentCc(), 200);
    });

    it('Step 6 — approval moves both currencies at once', async () => {
      const { id } = await one<{ id: string }>(
        `select id from conversion_requests where player_id = $1 and status = 'pending'`,
        [PLAYER],
      );
      await q(`select * from approve_conversion($1, $2)`, [id, AGENT]);

      assert.equal(await playerGc(), 100_000);
      assert.equal(await playerCc(), 10);
      // The player's GC went INTO the agent's inventory and the CC came OUT of
      // the agent's balance. Neither currency was created.
      assert.equal(await agentGc(), 500_000);
      assert.equal(await agentCc(), 190);
    });

    it('Step 7 — the player plays back down to 200 GC', async () => {
      await q(
        `select post_transfer('bet', player_account($1,'GC'),
                              system_account('house','GC'), 99800, 'GC', 'bet-1')`,
        [PLAYER],
      );
      assert.equal(await playerGc(), 200);
      assert.equal(await playerCc(), 10);
    });

    it('Step 8 — CC back to GC, funded from the agent inventory', async () => {
      const { request_conversion: id } = await one<{ request_conversion: string }>(
        `select request_conversion($1, 'cc_to_gc', 10)`,
        [PLAYER],
      );
      const row = await one<{ gc_amount: string }>(
        `select gc_amount from conversion_requests where id = $1`,
        [id],
      );
      assert.equal(Number(row.gc_amount), 100_000);

      await q(`select * from approve_conversion($1, $2)`, [id, AGENT]);

      assert.equal(await playerGc(), 100_200);
      assert.equal(await playerCc(), 0);
      assert.equal(await agentGc(), 400_000);
      assert.equal(await agentCc(), 200);
    });

    it('Step 9 — an agent short of inventory cannot approve, then restocks', async () => {
      // Drain the inventory to 100,000 so the next approval cannot be funded.
      await q(
        `select post_transfer('adjustment', agent_account($1,'GC'),
                              system_account('house','GC'), 300000, 'GC', 'drain-1')`,
        [AGENT],
      );
      assert.equal(await agentGc(), 100_000);

      // Put 20 CC in the player's hands, which needs 200,000 GC to convert.
      await q(`select grant_agent_cc($1, 20, $2, 'seed-cc-2')`, [AGENT, operatorId]);
      await q(
        `select post_transfer('conversion', agent_account($1,'CC'),
                              player_account($2,'CC'), 20, 'CC', 'seed-player-cc')`,
        [AGENT, PLAYER],
      );
      assert.equal(await playerCc(), 20);

      const { request_conversion: id } = await one<{ request_conversion: string }>(
        `select request_conversion($1, 'cc_to_gc', 20)`,
        [PLAYER],
      );

      await assert.rejects(
        () => q(`select * from approve_conversion($1, $2)`, [id, AGENT]),
        /Insufficient funds/,
      );

      // The refusal rolled the WHOLE approval back, including the claim on the
      // request. It is still pending and still approvable once funded.
      const after1 = await one<{ status: string }>(
        `select status from conversion_requests where id = $1`,
        [id],
      );
      assert.equal(after1.status, 'pending');
      assert.equal(await playerCc(), 20);
      assert.equal(await agentGc(), 100_000);

      // The agent restocks by redeeming CC with the operator, at the higher
      // operator rate. This is the step that closes the loop.
      const redeemed = await one<{ gc_amount: string }>(
        `select gc_amount from agent_redeem_cc($1, 10, 'restock-1')`,
        [AGENT],
      );
      assert.equal(Number(redeemed.gc_amount), 10 * OPERATOR_RATE);
      assert.equal(await agentGc(), 250_000);
      assert.equal(await agentCc(), 190);

      await q(`select * from approve_conversion($1, $2)`, [id, AGENT]);

      assert.equal(await playerGc(), 300_200);
      assert.equal(await playerCc(), 0);
      assert.equal(await agentGc(), 50_000);
      assert.equal(await agentCc(), 210);
    });

    // ------------------------------------------------------ the guarantees

    it('refuses a second approval, and pays once', async () => {
      const { request_conversion: id } = await one<{ request_conversion: string }>(
        `select request_conversion($1, 'gc_to_cc', 100000)`,
        [PLAYER],
      );
      await q(`select * from approve_conversion($1, $2)`, [id, AGENT]);

      const cc = await playerCc();
      await assert.rejects(() => q(`select * from approve_conversion($1, $2)`, [id, AGENT]));
      assert.equal(await playerCc(), cc);
    });

    it('pays exactly once when six approvals arrive together', async () => {
      /*
       * The sequential test above proves the second call is refused once the
       * first has COMMITTED, which is the easy half. This is the half that
       * matters: six sessions read the same pending row and all six try to
       * claim it, with no await between them so none has committed when the
       * others start.
       */
      const { request_conversion: id } = await one<{ request_conversion: string }>(
        `select request_conversion($1, 'gc_to_cc', 100000)`,
        [PLAYER],
      );

      const gcBefore = await playerGc();
      const ccBefore = await playerCc();
      const agentCcBefore = await agentCc();

      const results = await Promise.allSettled(
        Array.from({ length: 6 }, () =>
          pool.query(`select * from approve_conversion($1, $2)`, [id, AGENT]),
        ),
      );

      assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
      assert.equal(gcBefore - (await playerGc()), 100_000);
      assert.equal((await playerCc()) - ccBefore, 10);
      assert.equal(agentCcBefore - (await agentCc()), 10);

      // Four ledger entries: two for the GC leg, two for the CC leg. Not eight.
      const { count } = await one<{ count: string }>(
        `select count(*) as count from ledger_entries e
         join conversion_requests r on e.transaction_id in (r.gc_txn_id, r.cc_txn_id)
         where r.id = $1`,
        [id],
      );
      assert.equal(Number(count), 4);
    });

    it('refuses a GC amount that is not a whole number of CC', async () => {
      // Rounding down confiscates the remainder and rounding up mints CC, so
      // the request is refused and the player corrects it.
      await assert.rejects(
        () => q(`select request_conversion($1, 'gc_to_cc', 15000)`, [PLAYER]),
        /multiple of/,
      );
    });

    it('allows only one open request per direction', async () => {
      const { request_conversion: id } = await one<{ request_conversion: string }>(
        `select request_conversion($1, 'gc_to_cc', 20000)`,
        [PLAYER],
      );
      await assert.rejects(() => q(`select request_conversion($1, 'gc_to_cc', 30000)`, [PLAYER]));
      await q(`select cancel_conversion($1, $2)`, [id, PLAYER]);
      // Cancelled, so the slot is free again.
      const { request_conversion: next } = await one<{ request_conversion: string }>(
        `select request_conversion($1, 'gc_to_cc', 30000)`,
        [PLAYER],
      );
      await q(`select cancel_conversion($1, $2)`, [next, PLAYER]);
    });

    it("refuses an agent approving another agent's request", async () => {
      const { request_conversion: id } = await one<{ request_conversion: string }>(
        `select request_conversion($1, 'gc_to_cc', 20000)`,
        [PLAYER],
      );
      await assert.rejects(
        () => q(`select * from approve_conversion($1, $2)`, [id, OTHER_AGENT]),
        /not pending for this agent/,
      );
      const row = await one<{ status: string }>(
        `select status from conversion_requests where id = $1`,
        [id],
      );
      assert.equal(row.status, 'pending');
      await q(`select reject_conversion($1, $2, 'tidying up')`, [id, AGENT]);
    });

    it("refuses a player cancelling someone else's request", async () => {
      const { request_conversion: id } = await one<{ request_conversion: string }>(
        `select request_conversion($1, 'gc_to_cc', 20000)`,
        [PLAYER],
      );
      await assert.rejects(() => q(`select cancel_conversion($1, $2)`, [id, OTHER_AGENT]));
      await q(`select cancel_conversion($1, $2)`, [id, PLAYER]);
    });

    it('a rejection moves nothing', async () => {
      const gc = await playerGc();
      const cc = await playerCc();
      const { request_conversion: id } = await one<{ request_conversion: string }>(
        `select request_conversion($1, 'gc_to_cc', 20000)`,
        [PLAYER],
      );
      await q(`select reject_conversion($1, $2, 'not today')`, [id, AGENT]);

      assert.equal(await playerGc(), gc);
      assert.equal(await playerCc(), cc);
      const row = await one<{ status: string; reason: string; gc_txn_id: string | null }>(
        `select status, reason, gc_txn_id from conversion_requests where id = $1`,
        [id],
      );
      assert.equal(row.status, 'rejected');
      assert.equal(row.reason, 'not today');
      assert.equal(row.gc_txn_id, null);
    });

    // ---------------------------------------------------------- the rates

    it('never re-prices a settled conversion', async () => {
      const settled = await one<{ id: string; gc_per_cc: string }>(
        `select id, gc_per_cc from conversion_requests
         where status = 'approved' order by decided_at limit 1`,
      );
      assert.equal(Number(settled.gc_per_cc), PLAYER_RATE);

      await q(`select set_exchange_rate('player_agent', $1, $2, null, 'a raise')`, [
        PLAYER_RATE + 2_000,
        operatorId,
      ]);

      const { current_rate: now } = await one<{ current_rate: string }>(
        `select current_rate('player_agent', null)`,
      );
      assert.equal(Number(now), PLAYER_RATE + 2_000);

      const again = await one<{ gc_per_cc: string }>(
        `select gc_per_cc from conversion_requests where id = $1`,
        [settled.id],
      );
      assert.equal(Number(again.gc_per_cc), PLAYER_RATE);

      // Put it back, so the order of the tests below does not depend on this.
      await q(`select set_exchange_rate('player_agent', $1, $2, null, 'restored')`, [
        PLAYER_RATE,
        operatorId,
      ]);
    });

    it('refuses to edit a rate in place', async () => {
      await assert.rejects(
        () => q(`update exchange_rates set gc_per_cc = 1 where tier = 'player_agent'`),
        /append-only/,
      );
      await assert.rejects(() => q(`delete from exchange_rates`), /append-only/);
    });

    it('prefers an agent-specific rate over the default', async () => {
      await q(`select set_exchange_rate('player_agent', 8000, $1, $2, 'special terms')`, [
        operatorId,
        AGENT,
      ]);
      const mine = await one<{ current_rate: string }>(`select current_rate('player_agent', $1)`, [
        AGENT,
      ]);
      const theirs = await one<{ current_rate: string }>(
        `select current_rate('player_agent', $1)`,
        [OTHER_AGENT],
      );
      assert.equal(Number(mine.current_rate), 8_000);
      assert.equal(Number(theirs.current_rate), PLAYER_RATE);

      // And back to the shared rate for this agent, by overriding the override.
      await q(`select set_exchange_rate('player_agent', $1, $2, $3, 'back to standard')`, [
        PLAYER_RATE,
        operatorId,
        AGENT,
      ]);
    });

    // ----------------------------------------------------- the invariants

    it('keeps the ledger balanced in every currency', async () => {
      const rows = await q<{ currency: string; total: string }>(
        `select currency, sum(amount) as total from ledger_entries
         group by currency having sum(amount) <> 0`,
      );
      assert.deepEqual(rows, []);
    });

    it('keeps the balance cache reconciled with the ledger', async () => {
      assert.deepEqual(await q(`select * from reconcile_balances()`), []);
    });

    it('never lets an owned account go negative', async () => {
      const rows = await q(
        `select c.account_id from account_balance_cache c
         join accounts a on a.id = c.account_id
         where a.kind::text in ('player','agent') and c.balance < 0`,
      );
      assert.deepEqual(rows, []);
    });

    it('holds exactly as much CC as the house has issued', async () => {
      const issued = await one<{ n: string }>(
        `select -coalesce(sum(e.amount), 0) as n from ledger_entries e
         join accounts a on a.id = e.account_id
         where a.owner_id is null and a.kind::text = 'house' and e.currency = 'CC'`,
      );
      const held = await one<{ n: string }>(
        `select coalesce(sum(c.balance), 0) as n from account_balance_cache c
         join accounts a on a.id = c.account_id where a.currency = 'CC'`,
      );
      assert.equal(Number(issued.n), Number(held.n));
    });

    it('gives every approved request both of its ledger legs', async () => {
      const rows = await q(
        `select id from conversion_requests
         where status = 'approved' and (gc_txn_id is null or cc_txn_id is null)`,
      );
      assert.deepEqual(rows, []);
    });

    it('leaves the games untouched: no CC account is reachable as a stake', async () => {
      /*
       * The guarantee that CC never enters a game is structural rather than
       * defended: every game reaches money through `player_account(id, 'GC')`
       * and the currency is fixed at the call site. This asserts the shape that
       * makes it true — a player's CC lives in its own account, so there is no
       * balance a game could accidentally spend.
       */
      const rows = await q<{ currency: string }>(
        `select currency from accounts where owner_id = $1 and kind::text = 'player' order by 1`,
        [PLAYER],
      );
      assert.deepEqual(
        rows.map((r) => r.currency),
        ['CC', 'GC'],
      );
    });
  },
);
