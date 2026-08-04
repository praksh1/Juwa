/**
 * Create the first operator.
 *
 * Run once, on the server, with a real DATABASE_URL:
 *
 *   node packages/api/dist/create-operator.js ops@example.com
 *
 * It prints a password and an otpauth:// URI. The password is shown ONCE and
 * never stored in plain form; the URI goes into an authenticator app.
 *
 * There is deliberately no self-service sign-up and no web form for this. An
 * endpoint that mints operators is an endpoint that mints attackers, and this
 * account can disable every game in the catalogue.
 */

import { randomBytes } from 'node:crypto';
import { Pool } from 'pg';
import { hashPassword } from './admin.js';
import { sslOptionFor } from './db-ssl.js';
import { totpUri } from './totp.js';

async function main(): Promise<void> {
  const email = process.argv[2];
  if (!email || !email.includes('@')) {
    console.error('Usage: node create-operator.js <email>');
    process.exit(1);
  }

  const url = process.env['DATABASE_URL'];
  if (!url) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }

  // 18 random bytes -> 24 base64 characters. Generated here rather than chosen
  // by a person, because the first operator password is the one most likely to
  // be "juwa2026".
  const password = randomBytes(18).toString('base64url');
  const secret = randomBytes(20);

  // Same TLS rule as the server. This script is the one that carries a freshly
  // minted admin password and TOTP secret over the wire, so it is the last
  // place that should be allowed to fall back to an unencrypted connection.
  const pool = new Pool({ connectionString: url, ...sslOptionFor(url) });
  try {
    await pool.query(
      `insert into operators (email, password_hash, totp_secret, role)
       values ($1, $2, $3, 'admin')`,
      [email, await hashPassword(password), secret],
    );
  } finally {
    await pool.end();
  }

  console.log('\nOperator created. This is the only time the password is shown.\n');
  console.log(`  email    ${email}`);
  console.log(`  password ${password}`);
  console.log(`\n  Add to your authenticator:\n  ${totpUri('Juwa 3.0', email, secret)}\n`);
}

void main();
