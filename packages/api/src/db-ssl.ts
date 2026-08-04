/**
 * Transport security for the database connection.
 *
 * node-postgres does not enable TLS unless it is asked to. Point it at a hosted
 * Postgres with a plain `postgres://user:password@host/db` and, if the server
 * happens to accept unencrypted connections — Supabase's pooler does — it will
 * connect in the clear and say nothing about it. The database password and
 * every row of every query then cross the public internet unencrypted, and the
 * only symptom is that everything works perfectly.
 *
 * That silence is the whole problem. A deploy that fails loudly gets fixed in
 * five minutes; one that succeeds insecurely gets fixed after a breach. So this
 * module refuses to produce a plaintext connection to a remote host, and it
 * refuses to quietly downgrade to unverified TLS either. Both of those remain
 * possible, but only when someone writes them down on purpose.
 */

import { rootCertificates } from 'node:tls';
import { SUPABASE_ROOT_CA_2021, isSupabaseHost } from './supabase-ca.js';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '', '0.0.0.0']);

/** Postgres URLs may carry an IPv6 literal in brackets; strip them to compare. */
function hostOf(connectionString: string): string {
  try {
    // The `postgres:` scheme is not special-cased by WHATWG URL, so hostname
    // parsing works, but a bare `host=` keyword string is not a URL at all.
    return new URL(connectionString).hostname.replace(/^\[|\]$/g, '').toLowerCase();
  } catch {
    return '';
  }
}

export type SslDecision =
  /** Hand nothing to `pg` — either it is local, or the URL already said what to do. */
  | { readonly kind: 'defer'; readonly reason: string }
  /** Verified TLS, optionally against an extra CA, named so it can be logged. */
  | { readonly kind: 'verify'; readonly ca?: string; readonly caSource?: string };

/**
 * Decide how a connection string should be secured.
 *
 * Split out from applying it so the reasoning is testable without opening a
 * socket, and so the reason can be logged. Deployments get debugged from logs.
 */
export function decideSsl(
  connectionString: string,
  env: Record<string, string | undefined> = process.env,
): SslDecision {
  // An explicit `sslmode` in the URL is the operator speaking. Respect it —
  // including `sslmode=no-verify`, which is how you deliberately accept a
  // certificate this process cannot check. `pg` already parses these.
  if (/[?&]sslmode=/i.test(connectionString)) {
    return { kind: 'defer', reason: 'sslmode is set in DATABASE_URL' };
  }

  const host = hostOf(connectionString);
  if (LOCAL_HOSTS.has(host)) {
    // A loopback connection never leaves the machine, and demanding a
    // certificate from a throwaway test database would make the tests
    // impossible to run.
    return { kind: 'defer', reason: `local host (${host || 'unparsed'})` };
  }

  // An explicitly supplied CA always wins: it is how a self-hosted Supabase,
  // a different provider, or a rotated root gets handled without a code change.
  const ca = env['DATABASE_CA_CERT'];
  if (ca) return { kind: 'verify', ca, caSource: 'DATABASE_CA_CERT' };

  // Supabase signs with its own root, which no platform trust store carries.
  // Shipping that root is what keeps verification on instead of pushing every
  // deployment towards sslmode=no-verify.
  if (isSupabaseHost(host)) {
    return { kind: 'verify', ca: SUPABASE_ROOT_CA_2021, caSource: 'bundled Supabase root' };
  }

  return { kind: 'verify' };
}

/**
 * The `ssl` option to pass to `pg`, or nothing.
 *
 * Deliberately never returns `{ rejectUnauthorized: false }`. Unverified TLS
 * encrypts the traffic while accepting whoever answers the socket, which
 * defeats the point in the presence of the attacker it is meant to stop. If it
 * is genuinely needed, `sslmode=no-verify` in the URL says so out loud.
 */
export function sslOptionFor(
  connectionString: string,
  env: Record<string, string | undefined> = process.env,
): { ssl: { rejectUnauthorized: true; ca?: string[] } } | Record<string, never> {
  const decision = decideSsl(connectionString, env);
  if (decision.kind === 'defer') return {};
  if (!decision.ca) return { ssl: { rejectUnauthorized: true } };

  // The extra root is ADDED to the platform's trust store, not substituted for
  // it. Passing `ca` to Node replaces the defaults outright, so omitting these
  // would break the moment a provider moved to a publicly trusted certificate —
  // a change nobody would announce and everybody would experience as an outage.
  return { ssl: { rejectUnauthorized: true, ca: [...rootCertificates, decision.ca] } };
}

/**
 * What to print when the first connection fails a certificate check.
 *
 * The raw Node error for this is `SELF_SIGNED_CERT_IN_CHAIN`, which tells
 * somebody deploying their first database exactly nothing. Both real fixes are
 * named here so the next step does not require a search engine.
 */
export const CERT_FAILURE_ADVICE = [
  'The database refused to prove who it was: its TLS certificate could not be verified.',
  '',
  'Two legitimate fixes, in order of preference:',
  '  1. Put the provider CA certificate in DATABASE_CA_CERT (paste the whole',
  '     PEM block, BEGIN and END lines included).',
  '  2. Append ?sslmode=no-verify to DATABASE_URL. This keeps the connection',
  '     encrypted but stops checking who is on the other end. Acceptable on a',
  '     private network, not over the public internet.',
  '',
  'Removing TLS entirely is not on this list. It would send the database',
  'password across the network in plain text.',
].join('\n');

/**
 * Does this error mean the certificate could not be verified?
 *
 * Matching on `CERT` alone is not enough: the single most common failure
 * against a provider with a private CA is `UNABLE_TO_VERIFY_LEAF_SIGNATURE`,
 * which contains neither `CERT` nor `TLS`. Missing it would swallow the advice
 * in exactly the case the advice was written for.
 */
export function isCertificateError(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code !== 'string') return false;
  return /CERT|_TLS_|^ERR_TLS|SSL|SIGNATURE|SELF_SIGNED/i.test(code);
}
