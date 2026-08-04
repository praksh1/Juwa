import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { decideSsl, isCertificateError, sslOptionFor } from './db-ssl.js';

const REMOTE = 'postgresql://postgres.abc:pw@aws-0-us-east-1.pooler.supabase.com:6543/postgres';

test('a remote database gets verified TLS even when the URL asks for nothing', () => {
  // This is the case that matters. Supabase hands out a connection string with
  // no sslmode, its pooler accepts unencrypted connections, and node-postgres
  // does not add TLS on its own — so the default path sends the database
  // password across the internet in clear text and nothing complains.
  assert.deepEqual(sslOptionFor(REMOTE, {}), { ssl: { rejectUnauthorized: true } });
});

test('verification is never silently disabled', () => {
  // Unverified TLS encrypts against an eavesdropper and accepts whoever answers
  // the socket, which is precisely the attacker it is supposed to stop. If it
  // is ever needed it has to be written down in the URL, not inferred here.
  for (const env of [{}, { DATABASE_CA_CERT: '-----BEGIN CERTIFICATE-----\nx\n-----END CERTIFICATE-----' }]) {
    const option = sslOptionFor(REMOTE, env) as { ssl?: { rejectUnauthorized: boolean } };
    assert.equal(option.ssl?.rejectUnauthorized, true);
  }
});

test('an operator-supplied CA is passed through', () => {
  const ca = '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----';
  assert.deepEqual(sslOptionFor(REMOTE, { DATABASE_CA_CERT: ca }), {
    ssl: { rejectUnauthorized: true, ca },
  });
});

test('an explicit sslmode in the URL wins', () => {
  // Overriding what the operator wrote down would make `sslmode=no-verify`
  // impossible to use, leaving no escape hatch for a provider whose CA this
  // process cannot obtain.
  for (const mode of ['require', 'no-verify', 'verify-full', 'disable']) {
    const url = `${REMOTE}?sslmode=${mode}`;
    assert.deepEqual(sslOptionFor(url, {}), {}, `sslmode=${mode} was overridden`);
    assert.equal(decideSsl(url, {}).kind, 'defer');
  }
  // Also when it is not the first parameter.
  assert.deepEqual(sslOptionFor(`${REMOTE}?pgbouncer=true&sslmode=no-verify`, {}), {});
});

test('local databases are left alone', () => {
  // Loopback traffic never reaches a network, and demanding a certificate from
  // a throwaway test database would make the test suite unrunnable.
  for (const host of ['localhost', '127.0.0.1', '[::1]']) {
    assert.deepEqual(sslOptionFor(`postgres://u:p@${host}:5432/juwa_test`, {}), {}, host);
  }
});

test('a unix socket or keyword connection string is left to pg', () => {
  // These are not URLs. Guessing at a hostname we failed to parse and then
  // demanding TLS for it would break local sockets, which carry no network
  // traffic to protect.
  assert.deepEqual(sslOptionFor('host=/var/run/postgresql dbname=juwa', {}), {});
});

test('a remote host that merely looks local is still secured', () => {
  // `localhost.evil.example` is not localhost, and a suffix match would be a
  // silent downgrade triggered by an attacker-chosen hostname.
  const option = sslOptionFor('postgres://u:p@localhost.evil.example:5432/db', {}) as {
    ssl?: { rejectUnauthorized: boolean };
  };
  assert.equal(option.ssl?.rejectUnauthorized, true);
});

test('certificate failures are recognised so the advice can be printed', () => {
  for (const code of ['SELF_SIGNED_CERT_IN_CHAIN', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'ERR_TLS_CERT_ALTNAME_INVALID']) {
    assert.ok(isCertificateError({ code }), code);
  }
  assert.equal(isCertificateError({ code: 'ECONNREFUSED' }), false);
  assert.equal(isCertificateError({ code: '28P01' }), false, 'wrong password is not a cert problem');
  assert.equal(isCertificateError(null), false);
  assert.equal(isCertificateError(new Error('boom')), false);
});
