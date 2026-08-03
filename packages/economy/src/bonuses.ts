/**
 * Free coins — the retention engine.
 *
 * The counter-intuitive truth of a social casino: giving coins away is how you
 * make money. A player with zero coins does not buy, they uninstall. A player
 * who logs in daily, builds a streak and feels invested is the one who buys a
 * pack when they bust out on a good session.
 *
 * So the free economy exists to keep people *in the loop*, and the paid economy
 * exists to catch them at the moment of frustration. The design goal for every
 * number here is: generous enough to return tomorrow, not so generous that
 * buying is pointless.
 */

import { minor, type Minor } from '@juwa/money';

// ------------------------------------------------------------- daily bonus

/**
 * Seven-day streak ladder. Day 7 is worth ten times day 1, which is what makes
 * missing day 6 feel expensive — that asymmetry is the entire mechanic.
 *
 * A missed day resets the streak to day 1. Harsh, and it works; softening it
 * ("keep your streak with one skip") measurably reduces daily returns.
 */
const DAILY_STREAK_LADDER: number[] = [
  5_000,
  8_000,
  12_000,
  20_000,
  30_000,
  40_000,
  50_000,
];

export const MAX_STREAK_DAY = DAILY_STREAK_LADDER.length;

/**
 * Coins for a given streak day. Day 8 onward stays at the day-7 amount rather
 * than growing forever — an unbounded ladder eventually pays more than a player
 * could ever spend, and the store stops mattering.
 */
export function dailyBonus(streakDay: number, vipMultiplier = 1): Minor {
  if (!Number.isInteger(streakDay) || streakDay < 1) {
    throw new RangeError(`Streak day must be a positive integer, got ${streakDay}`);
  }
  const index = Math.min(streakDay, MAX_STREAK_DAY) - 1;
  return minor(Math.floor(DAILY_STREAK_LADDER[index]! * vipMultiplier));
}

/**
 * Whether a claim is allowed, and what it does to the streak.
 *
 * Uses calendar days in the player's timezone, not a rolling 24 hours. A rolling
 * timer drifts later every day until it lands at 3am and the player drops out.
 */
export function evaluateClaim(
  lastClaimDay: number | null,
  todayDay: number,
  currentStreak: number,
): { canClaim: boolean; newStreak: number } {
  if (lastClaimDay === null) return { canClaim: true, newStreak: 1 };
  if (lastClaimDay === todayDay) return { canClaim: false, newStreak: currentStreak };
  if (todayDay === lastClaimDay + 1) {
    return { canClaim: true, newStreak: Math.min(currentStreak + 1, MAX_STREAK_DAY) };
  }
  // Gap of two or more days — streak is broken.
  return { canClaim: true, newStreak: 1 };
}

// --------------------------------------------------------------- top-up

/**
 * The safety net: a small grant when a player is nearly broke, on a short timer.
 *
 * Without this, busting out means closing the app and possibly never returning.
 * With it, the player waits a few minutes and keeps playing — and stays present
 * for the moment when buying a pack feels worth it.
 *
 * Deliberately small. It should relieve the dead end, not remove the reason to
 * ever buy anything.
 */
/**
 * These four numbers are load-bearing and were originally set wrong.
 *
 * At 5,000 coins x 6 claims a player could farm 30,000 free coins a day — more
 * than the $1.99 starter pack grants. That makes the cheapest purchase strictly
 * worse than waiting, and the bottom of the store stops converting. The daily
 * ceiling here must stay comfortably below the smallest pack; `index.test.ts`
 * asserts it so a future "let's be more generous" tweak can't quietly break the
 * store.
 */
export const TOP_UP = {
  /** Only offered below this balance. */
  thresholdCoins: minor(2_000),
  amountCoins: minor(2_500),
  cooldownMinutes: 30,
  maxPerDay: 4,
} as const;

export function canTopUp(
  balance: Minor,
  minutesSinceLast: number | null,
  claimsToday: number,
): boolean {
  if (balance >= TOP_UP.thresholdCoins) return false;
  if (claimsToday >= TOP_UP.maxPerDay) return false;
  if (minutesSinceLast !== null && minutesSinceLast < TOP_UP.cooldownMinutes) return false;
  return true;
}

// ----------------------------------------------------------------- welcome

/** New players start with enough to have a genuinely good first session. */
export const WELCOME_BONUS = minor(100_000);
