import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { rootCertificates } from 'node:tls';
import { decideSsl, isCertificateError, sslOptionFor } from './db-ssl.js';
import {
  SUPABASE_ROOT_CA_2021,
  SUPABASE_ROOT_CA_2021_NOT_AFTER,
  isSupabaseHost,
} from './supabase-ca.js';

const REMOTE = 'postgresql://postgres.abc:pw@aws-0-us-east-1.pooler.supabase.com:6543/postgres';
/** A remote database that is nobody's known provider, so no root is bundled for it. */
const OTHER = 'postgresql://u:pw@db.somewhere.example:5432/postgres';

test('a remote database gets verified TLS even when the URL asks for nothing', () => {
  // This is the case that matters. Supabase hands out a connection string with
  // no sslmode, its pooler accepts unencrypted connections, and node-postgres
  // does not add TLS on its own — so the default path sends the database
  // password across the internet in clear text and nothing complains.
  assert.deepEqual(sslOptionFor(OTHER, {}), { ssl: { rejectUnauthorized: true } });
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
  const option = sslOptionFor(OTHER, { DATABASE_CA_CERT: ca }) as {
    ssl: { rejectUnauthorized: boolean; ca: string[] };
  };
  assert.equal(option.ssl.rejectUnauthorized, true);
  assert.ok(option.ssl.ca.includes(ca));
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

test('a Supabase host is verified against the bundled root', () => {
  // Supabase signs with a private CA that no platform trust store carries, so
  // without this every deployment lands on the same fork: turn verification
  // off, or go and find a certificate file on a phone.
  const option = sslOptionFor(REMOTE, {}) as { ssl: { ca: string[]; rejectUnauthorized: boolean } };
  assert.ok(Array.isArray(option.ssl.ca));
  assert.ok(
    option.ssl.ca.includes(SUPABASE_ROOT_CA_2021),
    'the bundled Supabase root was not offered',
  );
  assert.equal(option.ssl.rejectUnauthorized, true);
});

test('the platform trust store is added to, never replaced', () => {
  // Node swaps out its defaults the moment `ca` is set. Dropping them would
  // break the day a provider switched to a publicly trusted certificate —
  // unannounced, and experienced as an outage.
  const option = sslOptionFor(REMOTE, {}) as { ssl: { ca: string[] } };
  assert.ok(option.ssl.ca.length > 1, 'system roots were discarded');
  for (const root of rootCertificates) assert.ok(option.ssl.ca.includes(root));
});

test('DATABASE_CA_CERT still wins over the bundled root', () => {
  // The override is how a self-hosted Supabase, another provider, or a rotated
  // root gets handled without waiting for a code change.
  const ca = '-----BEGIN CERTIFICATE-----\nmine\n-----END CERTIFICATE-----';
  const option = sslOptionFor(REMOTE, { DATABASE_CA_CERT: ca }) as { ssl: { ca: string[] } };
  assert.ok(option.ssl.ca.includes(ca));
  assert.ok(!option.ssl.ca.includes(SUPABASE_ROOT_CA_2021));
  const decision = decideSsl(REMOTE, { DATABASE_CA_CERT: ca });
  assert.equal(decision.kind, 'verify');
  assert.equal(decision.kind === 'verify' && decision.caSource, 'DATABASE_CA_CERT');
});

test('lookalike domains do not borrow Supabase trust', () => {
  // `endsWith('supabase.com')` also matches `notsupabase.com`. Anyone who can
  // choose the connection string could then present a certificate from
  // Supabase's CA for a host they control.
  for (const host of ['notsupabase.com', 'supabase.com.evil.example', 'evilsupabase.co']) {
    assert.equal(isSupabaseHost(host), false, host);
    const option = sslOptionFor(`postgres://u:p@${host}:5432/db`, {}) as { ssl: { ca?: string[] } };
    assert.equal(option.ssl.ca, undefined, `${host} was given the bundled root`);
  }
  for (const host of ['supabase.com', 'db.abc.supabase.co', 'aws-0-eu-west-1.pooler.supabase.com']) {
    assert.equal(isSupabaseHost(host), true, host);
  }
});

test('the bundled root has not expired', () => {
  // A CA that quietly lapses takes the database with it. Failing here gives
  // whoever is maintaining this a build failure instead of an outage.
  assert.ok(
    Date.now() < SUPABASE_ROOT_CA_2021_NOT_AFTER,
    'the bundled Supabase root has expired — fetch the current one',
  );
});
