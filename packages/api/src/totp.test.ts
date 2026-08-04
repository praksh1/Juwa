import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { base32Decode, base32Encode, totp, totpUri, verifyTotp } from './totp.js';

/**
 * RFC 6238 Appendix B.
 *
 * The published vectors use an ASCII seed repeated to the hash's block size.
 * Checking against these rather than against codes this implementation happens
 * to produce is the entire point: a self-consistent wrong answer is exactly
 * what a hand-written crypto routine tends to give you.
 */
const SHA1_SEED = Buffer.from('12345678901234567890', 'ascii');
const SHA256_SEED = Buffer.from('12345678901234567890123456789012', 'ascii');

test('matches the RFC 6238 SHA-1 test vectors', () => {
  const vectors: [number, string][] = [
    [59, '287082'],
    [1_111_111_109, '081804'],
    [1_111_111_111, '050471'],
    [1_234_567_890, '005924'],
    [2_000_000_000, '279037'],
    [20_000_000_000, '353130'],
  ];
  for (const [time, expected] of vectors) {
    assert.equal(totp(SHA1_SEED, time, { digits: 6 }), expected, `t=${time}`);
  }
});

test('matches the RFC 6238 SHA-256 test vectors', () => {
  const vectors: [number, string][] = [
    [59, '119246'],
    [1_111_111_109, '084774'],
    [2_000_000_000, '698825'],
  ];
  for (const [time, expected] of vectors) {
    assert.equal(
      totp(SHA256_SEED, time, { digits: 8, algorithm: 'sha256' }).slice(-6),
      expected.slice(-6),
      `t=${time}`,
    );
  }
});

test('the 64-bit counter survives past 2038', () => {
  // t = 20,000,000,000 puts the counter well beyond 2^31. An implementation
  // that builds the counter with 32-bit shifts returns a different code here
  // and is correct everywhere else, so this is the case that catches it.
  assert.equal(totp(SHA1_SEED, 20_000_000_000, { digits: 6 }), '353130');
});

test('base32 round-trips and rejects rubbish', () => {
  const secret = Buffer.from([0xde, 0xad, 0xbe, 0xef, 0x01, 0x02, 0x03, 0x04]);
  assert.deepEqual(base32Decode(base32Encode(secret)), secret);
  // Authenticator apps print secrets in groups; whitespace must not break it.
  assert.deepEqual(base32Decode(base32Encode(secret).replace(/(.{4})/g, '$1 ')), secret);
  assert.throws(() => base32Decode('not-base32!'), /Not base32/);
});

test('verification accepts a drifting clock but not an old code', () => {
  const now = 1_700_000_000;
  const current = totp(SHA1_SEED, now);

  assert.ok(verifyTotp(SHA1_SEED, current, now));
  // One step either side: a phone up to 30s out still works.
  assert.ok(verifyTotp(SHA1_SEED, current, now + 30));
  assert.ok(verifyTotp(SHA1_SEED, current, now - 30));
  // Two steps is a minute, which is a replay rather than drift.
  assert.ok(!verifyTotp(SHA1_SEED, current, now + 90));
});

test('verification refuses malformed input rather than throwing', () => {
  const now = 1_700_000_000;
  for (const bad of ['', '12345', '1234567', 'abcdef', '12 34 56 78']) {
    assert.equal(verifyTotp(SHA1_SEED, bad, now), false, `accepted ${JSON.stringify(bad)}`);
  }
  // Spaces inside an otherwise valid code are stripped, since apps display them
  // as "123 456" and people copy what they see.
  const current = totp(SHA1_SEED, now);
  assert.ok(verifyTotp(SHA1_SEED, `${current.slice(0, 3)} ${current.slice(3)}`, now));
});

test('the enrolment URI is what an authenticator expects', () => {
  const uri = totpUri('Juwa 3.0', 'ops@example.com', SHA1_SEED);
  assert.ok(uri.startsWith('otpauth://totp/'));
  assert.ok(uri.includes('secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'));
  assert.ok(uri.includes('issuer=Juwa+3.0'));
  assert.ok(uri.includes('period=30'));
});

test('a non-second timestamp is refused rather than silently answered', () => {
  const secret = Buffer.alloc(20, 1);

  // Every one of these previously produced a well-formed six-digit code by way
  // of NaN collapsing to counter 0 — the code for the epoch, constant forever.
  // A second factor pinned to a constant is not a second factor.
  for (const bad of [undefined, null, NaN, Infinity, -1, 'now']) {
    assert.throws(
      () => totp(secret, bad as unknown as number),
      TypeError,
      `totp accepted ${String(bad)}`,
    );
  }

  // Milliseconds are the realistic mistake: Date.now() rather than
  // Date.now() / 1000. It is finite and positive, so it cannot be rejected —
  // but it must not agree with the correct call.
  const seconds = 1_700_000_000;
  assert.notEqual(totp(secret, seconds), totp(secret, seconds * 1000));
});

test('verification near the epoch does not step below zero', () => {
  // The window reaches one period backwards, which is negative for the first
  // 30 seconds of 1970. That must not throw out of a boolean function.
  const secret = Buffer.alloc(20, 1);
  const code = totp(secret, 5);
  assert.equal(verifyTotp(secret, code, 5), true);
  assert.equal(verifyTotp(secret, '000000', 0), false);
});
