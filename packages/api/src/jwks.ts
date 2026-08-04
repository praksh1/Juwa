/**
 * Public signing keys, fetched from the identity provider.
 *
 * Supabase now signs session tokens with an ASYMMETRIC key by default: the
 * project holds a private key, publishes the matching public key at a
 * `.well-known/jwks.json` endpoint, and tokens arrive with `alg: ES256`. The
 * old model — one shared secret both sides hold — still exists as "legacy JWT
 * secret", but new projects do not use it, so a server that only speaks HS256
 * rejects every real login with "Unsupported token algorithm: ES256".
 *
 * The asymmetric scheme is strictly better here: this service only ever needs
 * to VERIFY tokens, and with a public key that is all it can do. A stolen copy
 * of this deployment's configuration cannot mint a session for anybody, which
 * is not true of a shared secret.
 *
 * WHAT THIS MODULE MUST NEVER DO
 *
 * Trust the token. The `kid` and `alg` in a JWT header are attacker-chosen
 * input. `alg` selects which verification path runs, so it is checked against
 * an allow-list before any key is looked up, and a public key is never handed
 * to an HMAC routine — the classic JWT forgery is exactly that confusion.
 */

import { createPublicKey, type KeyObject } from 'node:crypto';

export interface Jwk {
  kty: string;
  kid?: string;
  alg?: string;
  use?: string;
  [key: string]: unknown;
}

/** Algorithms this service will verify. Anything else is refused outright. */
export const ASYMMETRIC_ALGORITHMS = new Set(['ES256', 'RS256']);

/**
 * Why key lookup failed, because the two cases are not the same failure.
 *
 * `unknown-key` is a property of the TOKEN: it names a key the provider does
 * not publish, which is what a forged or long-stale token looks like. That is
 * a 401 — the caller's problem, and cheap to produce, so it must not cost a
 * stack trace or an error-rate alert.
 *
 * `unavailable` is a property of THIS SERVICE: the provider could not be
 * reached. Nothing is wrong with the caller's token, and answering 401 would
 * tell every signed-in player their session was invalid during an outage —
 * and, worse, hide the outage behind a wall of apparently ordinary auth
 * failures.
 */
export type JwksFailure = 'unknown-key' | 'unavailable';

export class JwksError extends Error {
  constructor(message: string, readonly kind: JwksFailure) {
    super(message);
    this.name = 'JwksError';
  }
}

/**
 * Derive the JWKS endpoint from a Supabase project URL.
 *
 * Kept here rather than asking for the full endpoint in configuration: one
 * more URL to paste is one more URL to paste wrongly, and this deployment has
 * already lost hours to exactly that.
 */
export function jwksUrlForSupabase(projectUrl: string): string {
  const base = projectUrl.trim().replace(/\/+$/, '');
  return `${base}/auth/v1/.well-known/jwks.json`;
}

interface CacheEntry {
  keys: Map<string, KeyObject>;
  fetchedAt: number;
}

export interface JwksOptions {
  /** How long a successful fetch is reused. Keys rotate rarely. */
  ttlMs?: number;
  /**
   * Minimum gap between fetches triggered by an unknown `kid`.
   *
   * Without this, a forged token carrying a random `kid` forces a network
   * round trip per request — an unauthenticated attacker turning this service
   * into a load generator against its own identity provider, and stalling
   * every real request behind it.
   */
  minRefetchMs?: number;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

export class JwksCache {
  private cache: CacheEntry | null = null;
  private inFlight: Promise<CacheEntry> | null = null;
  private lastAttemptAt = 0;

  private readonly ttlMs: number;
  private readonly minRefetchMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;

  constructor(private readonly url: string, options: JwksOptions = {}) {
    this.ttlMs = options.ttlMs ?? 10 * 60_000;
    this.minRefetchMs = options.minRefetchMs ?? 30_000;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.now = options.now ?? Date.now;
  }

  /** The key for a `kid`, refetching once if it is not already known. */
  async keyFor(kid: string | undefined): Promise<KeyObject> {
    let entry = this.cache;

    if (!entry || this.now() - entry.fetchedAt > this.ttlMs) {
      entry = await this.refresh();
    }

    const found = this.select(entry, kid);
    if (found) return found;

    // An unknown kid usually means the provider rotated its key. Refetch, but
    // only if the rate limit allows — otherwise a stream of forged kids would
    // hammer the provider.
    if (this.now() - this.lastAttemptAt >= this.minRefetchMs) {
      entry = await this.refresh();
      const retried = this.select(entry, kid);
      if (retried) return retried;
    }

    throw new JwksError(
      kid
        ? `No public key published for key id ${JSON.stringify(kid)}.`
        : 'The token names no key id, and the provider publishes more than one key.',
      'unknown-key',
    );
  }

  private select(entry: CacheEntry, kid: string | undefined): KeyObject | undefined {
    if (kid) return entry.keys.get(kid);
    // No kid is only unambiguous when exactly one key exists. Guessing among
    // several would mean accepting a token the provider did not sign with the
    // key we checked.
    return entry.keys.size === 1 ? entry.keys.values().next().value : undefined;
  }

  private refresh(): Promise<CacheEntry> {
    // Concurrent misses share one request. Twenty simultaneous logins after a
    // key rotation should cost one fetch, not twenty.
    if (this.inFlight) return this.inFlight;

    this.lastAttemptAt = this.now();
    this.inFlight = this.load()
      .then((entry) => {
        this.cache = entry;
        return entry;
      })
      .finally(() => {
        this.inFlight = null;
      });
    return this.inFlight;
  }

  private async load(): Promise<CacheEntry> {
    let response: Response;
    try {
      response = await this.fetchImpl(this.url, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(10_000),
      });
    } catch (error) {
      throw new JwksError(`Could not fetch signing keys: ${(error as Error).message}`, 'unavailable');
    }
    if (!response.ok) {
      throw new JwksError(`Signing key endpoint returned HTTP ${response.status}.`, 'unavailable');
    }

    let body: { keys?: Jwk[] };
    try {
      body = (await response.json()) as { keys?: Jwk[] };
    } catch {
      throw new JwksError('Signing key endpoint did not return JSON.', 'unavailable');
    }
    if (!Array.isArray(body.keys)) {
      throw new JwksError('Signing key document has no "keys" array.', 'unavailable');
    }

    const keys = new Map<string, KeyObject>();
    for (const jwk of body.keys) {
      // Skip encryption keys and algorithms we refuse to verify, rather than
      // importing them and deciding later — a key that cannot be used for
      // signature verification has no business in this map.
      if (jwk.use && jwk.use !== 'sig') continue;
      if (jwk.alg && !ASYMMETRIC_ALGORITHMS.has(jwk.alg)) continue;
      if (jwk.kty !== 'EC' && jwk.kty !== 'RSA') continue;

      try {
        keys.set(jwk.kid ?? '', createPublicKey({ key: jwk as never, format: 'jwk' }));
      } catch {
        // One malformed entry must not deny service for every other key.
        continue;
      }
    }

    if (keys.size === 0) throw new JwksError('Signing key document contained no usable keys.', 'unavailable');
    return { keys, fetchedAt: this.now() };
  }
}
