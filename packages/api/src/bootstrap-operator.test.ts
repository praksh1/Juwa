/**
 * The first-operator bootstrap.
 *
 * The property that matters is the one a mock cannot fake: that the `where not
 * exists` really does refuse a second account, including when two instances
 * race — which is what a rolling deploy is. So this runs against Postgres.
 *
 *   JUWA_BOOTSTRAP_TEST_DATABASE_URL=postgres://... npm test -w @juwa/api
 */

import { strict as assert } from 'node:assert';
import { after, before, describe, it } from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { bootstrapOperator } from './bootstrap-operator.js';
import { verifyPassword } from './admin.js';
import { verifyTotp, base32Decode } from './totp.js';

const URL_ENV = process.env['JUWA_BOOTSTRAP_TEST_DATABASE_URL'];
const here = dirname(fileURLToPath(import.meta.url));
const migrations = resolve(here, '../../../db/migrations');
const dbTest = resolve(here, '../../../db/test');

const GOOD = {
  BOOTSTRAP_OPERATOR_EMAIL: 'first@juwa.test',
  BOOTSTRAP_OPERATOR_PASSWORD: 'a-long-enough-passphrase',
} as NodeJS.ProcessEnv;

describe(
  'bootstrap operator',
  { skip: URL_ENV ? false : 'JUWA_BOOTSTRAP_TEST_DATABASE_URL not set' },
  () => {
    let pool: import('pg').Pool;
    const lines: string[] = [];
    const log = (message: string) => lines.push(message);

    before(async () => {
      const { Pool } = await import('pg');
      pool = new Pool({ connectionString: URL_ENV });
      await pool.query(readFileSync(resolve(dbTest, 'supabase_shim.sql'), 'utf8'));
      for (const file of readdirSync(migrations).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort()) {
        await pool.query(readFileSync(resolve(migrations, file), 'utf8'));
      }
    });

    after(async () => {
      await pool?.end();
    });

    it('does nothing at all when the variables are absent', async () => {
      assert.equal(await bootstrapOperator(pool, {}, log), 'skipped');
      const { rows } = await pool.query(`select count(*)::int as n from operators`);
      assert.equal((rows[0] as { n: number }).n, 0);
    });

    it('refuses half a configuration rather than guessing', async () => {
      assert.equal(
        await bootstrapOperator(pool, { BOOTSTRAP_OPERATOR_EMAIL: 'a@b.test' }, log),
        'failed',
      );
      assert.equal(
        await bootstrapOperator(pool, { BOOTSTRAP_OPERATOR_PASSWORD: 'x'.repeat(20) }, log),
        'failed',
      );
      const { rows } = await pool.query(`select count(*)::int as n from operators`);
      assert.equal((rows[0] as { n: number }).n, 0);
    });

    it('refuses a short password', async () => {
      assert.equal(
        await bootstrapOperator(
          pool,
          { ...GOOD, BOOTSTRAP_OPERATOR_PASSWORD: 'short' },
          log,
        ),
        'failed',
      );
      const { rows } = await pool.query(`select count(*)::int as n from operators`);
      assert.equal((rows[0] as { n: number }).n, 0, 'a weak admin password was accepted');
    });

    it('creates the first operator with a working password and authenticator code', async () => {
      lines.length = 0;
      assert.equal(await bootstrapOperator(pool, GOOD, log), 'created');

      const { rows } = await pool.query<{
        email: string;
        role: string;
        password_hash: string;
        totp_secret: Buffer;
      }>(`select email, role, password_hash, totp_secret from operators`);
      assert.equal(rows.length, 1);
      assert.equal(rows[0]!.email, 'first@juwa.test');
      assert.equal(rows[0]!.role, 'admin');

      // The password in the variable is the password that works.
      assert.equal(
        await verifyPassword(GOOD['BOOTSTRAP_OPERATOR_PASSWORD']!, rows[0]!.password_hash),
        true,
      );

      // And the printed URI carries the secret that is actually stored, so a
      // code from the authenticator will verify. This is the part that would
      // be silently wrong if the secret were re-generated for the log.
      const printed = lines.join('\n');
      const uri = /otpauth:\/\/\S+/.exec(printed)?.[0];
      assert.ok(uri, 'no otpauth URI was printed');
      const secret = base32Decode(new URL(uri!).searchParams.get('secret')!);
      assert.deepEqual(secret, Buffer.from(rows[0]!.totp_secret));

      const now = Math.floor(Date.now() / 1000);
      const { totp } = await import('./totp.js');
      assert.equal(verifyTotp(secret, totp(secret, now), now), true);

      // The password is never printed. A deploy log outlives the deploy.
      assert.ok(
        !printed.includes(GOOD['BOOTSTRAP_OPERATOR_PASSWORD']!),
        'the admin password was written to the log',
      );
    });

    it('never creates a second operator, however it is called', async () => {
      // The whole point. Once one account exists this is inert — it cannot add
      // a back door later, cannot overwrite the first, and cannot re-enable a
      // disabled one.
      assert.equal(await bootstrapOperator(pool, GOOD, log), 'skipped');
      assert.equal(
        await bootstrapOperator(
          pool,
          { BOOTSTRAP_OPERATOR_EMAIL: 'attacker@evil.test', BOOTSTRAP_OPERATOR_PASSWORD: 'y'.repeat(20) },
          log,
        ),
        'skipped',
      );

      const { rows } = await pool.query<{ email: string }>(`select email from operators`);
      assert.deepEqual(rows.map((r) => r.email), ['first@juwa.test']);
    });

    it('survives two instances starting at the same moment', async () => {
      // A rolling deploy starts the new container before stopping the old one.
      await pool.query(`delete from operators`);
      const results = await Promise.all(
        Array.from({ length: 5 }, () => bootstrapOperator(pool, GOOD, log)),
      );
      assert.equal(results.filter((r) => r === 'created').length, 1, results.join(','));

      const { rows } = await pool.query(`select count(*)::int as n from operators`);
      assert.equal((rows[0] as { n: number }).n, 1);
    });

    it('does not take the API down when it cannot work', async () => {
      const broken = {
        query: async () => {
          throw new Error('database on fire');
        },
      };
      assert.equal(await bootstrapOperator(broken, GOOD, log), 'failed');
    });
  },
);
