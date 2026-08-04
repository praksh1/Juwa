import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { generateKeyPairSync } from 'node:crypto';
import { JwksCache, JwksError, jwksUrlForSupabase } from './jwks.js';

function jwkFor(kid: string) {
  const { publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  return { ...publicKey.export({ format: 'jwk' }), kid, alg: 'ES256', use: 'sig' };
}

function fakeFetch(body: unknown, counter: { calls: number }, status = 200) {
  return (async () => {
    counter.calls++;
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as unknown as typeof fetch;
}

test('the Supabase JWKS URL is derived, trailing slash or not', () => {
  // One fewer URL to paste is one fewer URL to paste wrongly, which has cost
  // this deployment real hours.
  assert.equal(
    jwksUrlForSupabase('https://abc.supabase.co'),
    'https://abc.supabase.co/auth/v1/.well-known/jwks.json',
  );
  assert.equal(
    jwksUrlForSupabase('https://abc.supabase.co/'),
    'https://abc.supabase.co/auth/v1/.well-known/jwks.json',
  );
});

test('keys are cached rather than fetched per request', async () => {
  const counter = { calls: 0 };
  let now = 1_000_000;
  const cache = new JwksCache('https://x/jwks', {
    fetchImpl: fakeFetch({ keys: [jwkFor('k1')] }, counter),
    now: () => now,
  });

  await cache.keyFor('k1');
  await cache.keyFor('k1');
  await cache.keyFor('k1');
  assert.equal(counter.calls, 1, 'fetched more than once inside the TTL');

  now += 11 * 60_000;
  await cache.keyFor('k1');
  assert.equal(counter.calls, 2, 'did not refresh after the TTL');
});

test('concurrent misses share one fetch', async () => {
  // Twenty simultaneous logins after a key rotation should cost one request,
  // not twenty against the identity provider.
  const counter = { calls: 0 };
  const cache = new JwksCache('https://x/jwks', {
    fetchImpl: fakeFetch({ keys: [jwkFor('k1')] }, counter),
  });
  await Promise.all(Array.from({ length: 20 }, () => cache.keyFor('k1')));
  assert.equal(counter.calls, 1, `${counter.calls} fetches for one refresh`);
});

test('an unknown key id does not refetch on every attempt', async () => {
  // Otherwise a forged token with a random kid turns this service into a load
  // generator aimed at its own identity provider, with every real request
  // queued behind it.
  const counter = { calls: 0 };
  let now = 1_000_000;
  const cache = new JwksCache('https://x/jwks', {
    fetchImpl: fakeFetch({ keys: [jwkFor('k1')] }, counter),
    now: () => now,
    minRefetchMs: 30_000,
  });

  await cache.keyFor('k1');
  const before = counter.calls;
  for (let i = 0; i < 25; i++) {
    await assert.rejects(() => cache.keyFor(`forged-${i}`), JwksError);
  }
  assert.ok(counter.calls - before <= 1, `${counter.calls - before} extra fetches for forged kids`);
});

test('an unknown key id is reported as the token being wrong', async () => {
  const cache = new JwksCache('https://x/jwks', {
    fetchImpl: fakeFetch({ keys: [jwkFor('k1')] }, { calls: 0 }),
  });
  await assert.rejects(
    () => cache.keyFor('other'),
    (error: JwksError) => error.kind === 'unknown-key',
  );
});

test('an unreachable provider is reported as this service being wrong', async () => {
  // The distinction matters: answering 401 during a provider outage tells every
  // signed-in player their session died, and hides the outage behind a wall of
  // ordinary-looking auth failures.
  const cache = new JwksCache('https://x/jwks', {
    fetchImpl: (async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch,
  });
  await assert.rejects(
    () => cache.keyFor('k1'),
    (error: JwksError) => error.kind === 'unavailable',
  );
});

test('a missing key id resolves only when there is exactly one key', async () => {
  // Picking one of several would mean accepting a token the provider signed
  // with a key we never checked.
  const one = new JwksCache('https://x/jwks', {
    fetchImpl: fakeFetch({ keys: [jwkFor('only')] }, { calls: 0 }),
  });
  assert.ok(await one.keyFor(undefined));

  const many = new JwksCache('https://x/jwks', {
    fetchImpl: fakeFetch({ keys: [jwkFor('a'), jwkFor('b')] }, { calls: 0 }),
  });
  await assert.rejects(() => many.keyFor(undefined), JwksError);
});

test('unusable entries are skipped without denying the usable ones', async () => {
  const cache = new JwksCache('https://x/jwks', {
    fetchImpl: fakeFetch(
      {
        keys: [
          { kty: 'oct', kid: 'symmetric', k: 'AAAA' },
          { ...jwkFor('encryption'), use: 'enc' },
          { ...jwkFor('weak'), alg: 'HS256' },
          { kty: 'EC', kid: 'broken', crv: 'P-256' },
          jwkFor('good'),
        ],
      },
      { calls: 0 },
    ),
  });
  assert.ok(await cache.keyFor('good'));
  for (const kid of ['symmetric', 'encryption', 'weak', 'broken']) {
    await assert.rejects(() => cache.keyFor(kid), JwksError, kid);
  }
});

test('a failed document is reported, not cached as empty', async () => {
  for (const body of [{}, { keys: 'nope' }, { keys: [] }]) {
    const cache = new JwksCache('https://x/jwks', { fetchImpl: fakeFetch(body, { calls: 0 }) });
    await assert.rejects(() => cache.keyFor('k1'), JwksError, JSON.stringify(body));
  }
});
