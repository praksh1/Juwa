/**
 * Provably-fair randomness.
 *
 * The problem: a player has no way to know the house didn't rig the deck after
 * seeing their bet. "Trust us" is not an answer, and in a licensed market it is
 * not a legal answer either.
 *
 * The solution is commit-reveal:
 *
 *   1. Before any bet, the server generates a secret `serverSeed` and publishes
 *      only its SHA-256 hash (the "commitment"). The player sees the hash.
 *   2. The player supplies (or is given, and may change) a `clientSeed`.
 *   3. Each bet uses an incrementing `nonce`. The outcome is derived
 *      deterministically from HMAC-SHA256(serverSeed, clientSeed:nonce:cursor).
 *   4. When the seed is rotated, the server reveals `serverSeed`. The player can
 *      hash it, check it matches the commitment they were shown *before* they
 *      played, and replay every bet themselves.
 *
 * The server cannot change the outcome after seeing the bet, because the seed
 * was locked in by a hash the player already holds. The player cannot predict
 * the outcome, because they never see the seed until after play.
 *
 * NOTE: this module is deliberately dependency-free and deterministic. Given
 * the same seeds it produces the same numbers on any machine, which is what
 * makes independent verification (by a player, or by a test lab like GLI)
 * possible.
 */

import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export interface SeedPair {
  serverSeed: string;
  serverSeedHash: string;
  clientSeed: string;
  nonce: number;
}

/** Generate a fresh server seed and its public commitment. */
export function createServerSeed(): { serverSeed: string; serverSeedHash: string } {
  const serverSeed = randomBytes(32).toString('hex');
  return { serverSeed, serverSeedHash: hashSeed(serverSeed) };
}

export function hashSeed(serverSeed: string): string {
  return createHash('sha256').update(serverSeed, 'utf8').digest('hex');
}

/**
 * Verify a revealed seed against the commitment the player was shown.
 * Constant-time so this can be exposed as a public endpoint without leaking
 * information through response timing.
 */
export function verifySeed(serverSeed: string, expectedHash: string): boolean {
  const actual = Buffer.from(hashSeed(serverSeed), 'hex');
  let expected: Buffer;
  try {
    expected = Buffer.from(expectedHash, 'hex');
  } catch {
    return false;
  }
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

/**
 * A deterministic stream of random values for a single bet.
 *
 * Games pull values from this rather than calling Math.random(). That is the
 * whole point: a game engine is a pure function of (bet, RngStream), so the
 * same bet with the same seeds always produces the same result — replayable in
 * a dispute, and testable in CI.
 */
export class RngStream {
  private cursor = 0;
  private buffer: Buffer = Buffer.alloc(0);
  private offset = 0;

  constructor(
    private readonly serverSeed: string,
    private readonly clientSeed: string,
    private readonly nonce: number,
  ) {}

  private refill(): void {
    this.buffer = createHmac('sha256', this.serverSeed)
      .update(`${this.clientSeed}:${this.nonce}:${this.cursor}`, 'utf8')
      .digest();
    this.cursor += 1;
    this.offset = 0;
  }

  private nextByte(): number {
    if (this.offset >= this.buffer.length) this.refill();
    return this.buffer[this.offset++]!;
  }

  /**
   * A float in [0, 1). Built from 4 bytes — 32 bits of entropy.
   *
   * Note the `+` rather than `|`. Bitwise OR in JavaScript coerces to a SIGNED
   * 32-bit integer, so any leading byte >= 128 produces a negative number and
   * therefore a negative "probability". Addition keeps the value unsigned.
   * `rng.test.ts` covers this.
   */
  next(): number {
    const b0 = this.nextByte();
    const b1 = this.nextByte();
    const b2 = this.nextByte();
    const b3 = this.nextByte();
    const value = ((b0 << 24) >>> 0) + (b1 << 16) + (b2 << 8) + b3;
    return value / 0x1_0000_0000;
  }

  /**
   * A uniform integer in [0, max). Uses rejection sampling rather than a modulo.
   *
   * `next() * max | 0` is *almost* right and is how slot machines get quietly
   * biased: the modulo of a 32-bit value by a non-power-of-two leaves some
   * outcomes very slightly more likely. Over a billion spins that bias is real
   * money, and it is exactly what a certification lab tests for.
   */
  nextInt(max: number): number {
    if (!Number.isInteger(max) || max <= 0) {
      throw new RangeError(`nextInt requires a positive integer bound, got ${max}`);
    }
    if (max === 1) return 0;
    const limit = Math.floor(0x1_0000_0000 / max) * max;
    for (;;) {
      const b0 = this.nextByte();
      const b1 = this.nextByte();
      const b2 = this.nextByte();
      const b3 = this.nextByte();
      const value = ((b0 << 24) >>> 0) + (b1 << 16) + (b2 << 8) + b3;
      if (value < limit) return value % max;
      // Value fell in the biased tail; discard and draw again.
    }
  }

  /** Fisher-Yates. Returns a new array; does not mutate the input. */
  shuffle<T>(items: readonly T[]): T[] {
    const out = items.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = this.nextInt(i + 1);
      const a = out[i]!;
      const b = out[j]!;
      out[i] = b;
      out[j] = a;
    }
    return out;
  }

  pick<T>(items: readonly T[]): T {
    if (items.length === 0) throw new RangeError('Cannot pick from an empty array');
    return items[this.nextInt(items.length)]!;
  }
}

export function streamFor(seed: SeedPair): RngStream {
  return new RngStream(seed.serverSeed, seed.clientSeed, seed.nonce);
}
