/**
 * Time-based one-time passwords (RFC 6238), for operator sign-in.
 *
 * WHY THIS IS HAND-WRITTEN
 *
 * TOTP is a HMAC, a counter and a modulo. The whole algorithm is forty lines,
 * and RFC 6238 publishes test vectors, so it can be proved correct rather than
 * trusted. Pulling a dependency into the process that guards the payout
 * configuration — to save forty lines — buys a supply-chain risk in exchange
 * for nothing.
 *
 * WHAT IT PROTECTS
 *
 * The operator panel can disable games and change what they pay. A stolen
 * password should not be enough to reach it. Two-factor is not optional here
 * and there is deliberately no "remember this device".
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

/** RFC 4648 base32, which is what every authenticator app speaks. */
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/=+$/, '').replace(/\s+/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];

  for (const char of clean) {
    const index = ALPHABET.indexOf(char);
    if (index === -1) throw new Error(`Not base32: ${char}`);
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function base32Encode(buffer: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export interface TotpOptions {
  /** Seconds per code. 30 is universal; changing it breaks every app. */
  period?: number;
  digits?: number;
  algorithm?: 'sha1' | 'sha256' | 'sha512';
}

/**
 * The code for a given moment.
 *
 * `secret` is the raw key, not base32 — decoding is the caller's job so that a
 * malformed secret fails at configuration time rather than at sign-in.
 */
export function totp(
  secret: Buffer,
  atSeconds: number,
  { period = 30, digits = 6, algorithm = 'sha1' }: TotpOptions = {},
): string {
  const counter = Math.floor(atSeconds / period);

  // The counter is a 64-bit big-endian integer. JavaScript bit operations are
  // 32-bit, so the halves are written separately — doing this with `<<` gives
  // wrong codes for any counter past 2^31, which arrives in 2038 and would be
  // an extremely confusing bug to meet then.
  const message = Buffer.alloc(8);
  message.writeUInt32BE(Math.floor(counter / 0x1_0000_0000), 0);
  message.writeUInt32BE(counter >>> 0, 4);

  const digest = createHmac(algorithm, secret).update(message).digest();

  // Dynamic truncation, RFC 4226 section 5.3.
  const offset = digest[digest.length - 1]! & 0x0f;
  const binary =
    ((digest[offset]! & 0x7f) << 24) |
    ((digest[offset + 1]! & 0xff) << 16) |
    ((digest[offset + 2]! & 0xff) << 8) |
    (digest[offset + 3]! & 0xff);

  return String(binary % 10 ** digits).padStart(digits, '0');
}

/**
 * Check a code, allowing for clock drift.
 *
 * `window` of 1 accepts the previous and next code as well as the current one,
 * which covers a phone whose clock is up to thirty seconds out — common enough
 * that rejecting it generates support tickets, small enough that it does not
 * meaningfully widen the guessing window.
 *
 * The comparison is constant-time. A timing side channel on a six-digit code is
 * not the most likely way in, but it costs one function call to remove.
 */
export function verifyTotp(
  secret: Buffer,
  code: string,
  atSeconds: number,
  { window = 1, ...options }: TotpOptions & { window?: number } = {},
): boolean {
  const candidate = code.replace(/\s+/g, '');
  const digits = options.digits ?? 6;
  if (!new RegExp(`^\\d{${digits}}$`).test(candidate)) return false;

  const period = options.period ?? 30;
  let matched = false;
  for (let step = -window; step <= window; step++) {
    const expected = totp(secret, atSeconds + step * period, options);
    // No early exit: checking every step regardless keeps the work constant
    // whether the match is the first candidate or the last.
    const a = Buffer.from(expected);
    const b = Buffer.from(candidate);
    if (a.length === b.length && timingSafeEqual(a, b)) matched = true;
  }
  return matched;
}

/** An `otpauth://` URI, which is what a QR code for an authenticator contains. */
export function totpUri(issuer: string, account: string, secret: Buffer): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({
    secret: base32Encode(secret),
    issuer,
    algorithm: 'SHA1',
    digits: '6',
    period: '30',
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}
