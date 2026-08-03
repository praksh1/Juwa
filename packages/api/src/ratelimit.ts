/**
 * Rate limiting.
 *
 * A betting endpoint without one is an invitation. Two concrete abuses this
 * stops:
 *
 *  - A script spinning thousands of times a second to farm VIP progress, or to
 *    hunt for a bug in settlement by sheer volume.
 *  - Someone hammering the bonus endpoints hoping a race lets a claim through
 *    twice. The database already refuses that, but refusing it ten thousand
 *    times a second still costs real money in database load.
 *
 * A token bucket, in memory. In-memory means each server instance keeps its own
 * count, so with N instances the effective limit is N times what is configured
 * here — fine at one or two instances, and the point at which that stops being
 * fine is the point to move this into Redis. It is deliberately a small
 * interface so that swap is a single file.
 */

export interface RateLimitResult {
  allowed: boolean;
  /** Seconds until the next token, for the Retry-After header. */
  retryAfter: number;
  remaining: number;
}

interface Bucket {
  tokens: number;
  updatedAt: number;
}

export class RateLimiter {
  private readonly buckets = new Map<string, Bucket>();

  constructor(
    private readonly capacity: number,
    private readonly refillPerSecond: number,
  ) {}

  check(key: string, now = Date.now()): RateLimitResult {
    const bucket = this.buckets.get(key) ?? { tokens: this.capacity, updatedAt: now };

    // Refill for the time that has passed since the last request.
    const elapsedSeconds = Math.max(0, (now - bucket.updatedAt) / 1000);
    bucket.tokens = Math.min(this.capacity, bucket.tokens + elapsedSeconds * this.refillPerSecond);
    bucket.updatedAt = now;

    if (bucket.tokens < 1) {
      this.buckets.set(key, bucket);
      return {
        allowed: false,
        retryAfter: Math.ceil((1 - bucket.tokens) / this.refillPerSecond),
        remaining: 0,
      };
    }

    bucket.tokens -= 1;
    this.buckets.set(key, bucket);
    return { allowed: true, retryAfter: 0, remaining: Math.floor(bucket.tokens) };
  }

  /**
   * Drop buckets that have fully refilled, so a busy day does not leave one
   * entry per player in memory forever.
   */
  sweep(now = Date.now()): void {
    const fullAfterMs = (this.capacity / this.refillPerSecond) * 1000;
    for (const [key, bucket] of this.buckets) {
      if (now - bucket.updatedAt > fullAfterMs) this.buckets.delete(key);
    }
  }

  get size(): number {
    return this.buckets.size;
  }
}

/**
 * Limits per player.
 *
 * `bet` allows a burst of 10 then settles to 2/second. A human tapping SPIN
 * cannot exceed that — the reel animation alone is 2.5 seconds — so it is
 * invisible to real players and immediately obvious to a script.
 */
export const LIMITS = {
  bet: { capacity: 10, refillPerSecond: 2 },
  bonus: { capacity: 5, refillPerSecond: 0.1 },
  read: { capacity: 60, refillPerSecond: 5 },
  register: { capacity: 3, refillPerSecond: 0.05 },
} as const;
