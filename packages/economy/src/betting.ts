/**
 * Default bet sizing.
 *
 * This module exists because of a finding from `npm run economy`. Holding the
 * default bet at a fixed number produces wildly different experiences depending
 * on balance:
 *
 *   100,000 GC balance, 2,000 GC bet  ->  median session ~31 minutes
 *     5,000 GC balance, 1,000 GC bet  ->  median session ~1 minute
 *
 * A player who returns for their daily bonus and is wiped out in sixty seconds
 * does not come back. The default bet therefore has to be a fraction of the
 * balance, not a constant.
 *
 * Session length is far more sensitive to bet size than to RTP, and unlike RTP
 * it costs nothing to change and needs no re-certification. It is the first
 * lever to reach for.
 */

import { minor, type Minor } from '@juwa/money';

/**
 * Target stake as a share of balance.
 *
 * Simulation says ~2.5% gives a median session in the 20–30 minute range at
 * 96.25% RTP: long enough to feel worth opening the app, short enough that a
 * player who wants more has a reason to visit the store.
 */
export const TARGET_BET_FRACTION = 0.025;

/**
 * Bets snap to these denominations. Arbitrary amounts like 137 GC feel like a
 * spreadsheet; round numbers feel like chips.
 */
const DENOMINATIONS: number[] = [
  100, 200, 500, 1_000, 2_000, 5_000, 10_000, 20_000, 50_000, 100_000,
];

/**
 * The default stake to preselect for a player, and the ladder of bets to offer
 * around it.
 *
 * Always clamped to the game's own limits, and never more than the balance —
 * offering a bet a player cannot afford is how you get a confusing error
 * instead of a spin.
 */
export function suggestedBet(balance: Minor, minBet: Minor, maxBet: Minor): Minor {
  if (balance < minBet) return minBet;

  const target = balance * TARGET_BET_FRACTION;

  // Largest denomination at or below target; fall back to the smallest.
  let chosen = DENOMINATIONS[0]!;
  for (const denomination of DENOMINATIONS) {
    if (denomination <= target) chosen = denomination;
    else break;
  }

  const ceiling = Math.min(maxBet, balance);
  return minor(Math.max(minBet, Math.min(chosen, ceiling)));
}

/**
 * The bet ladder shown in the game UI: the suggested bet plus neighbours, so a
 * player can step up or down without typing a number.
 */
export function betOptions(balance: Minor, minBet: Minor, maxBet: Minor, count = 5): Minor[] {
  const suggested = suggestedBet(balance, minBet, maxBet);
  const ceiling = Math.min(maxBet, Math.max(balance, minBet));

  const candidates = DENOMINATIONS.filter((d) => d >= minBet && d <= ceiling);
  if (candidates.length === 0) return [minor(minBet)];

  // Centre the window on the suggested bet.
  const centre = candidates.indexOf(suggested);
  const half = Math.floor(count / 2);
  let start = Math.max(0, (centre === -1 ? 0 : centre) - half);
  start = Math.min(start, Math.max(0, candidates.length - count));

  return candidates.slice(start, start + count).map((d) => minor(d));
}
