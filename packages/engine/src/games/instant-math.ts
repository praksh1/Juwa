/**
 * The RNG-driven half of the instant games.
 *
 * The payout maths — every multiplier, every table, every validation — lives
 * in `@juwa/economy` as `instant-odds.ts`, and is re-exported here so existing
 * imports keep working.
 *
 * THE SPLIT IS NOT TIDINESS. The app needs those payout figures: a Dice slider
 * has to show "1.98x" as the player drags it, before any bet exists and with
 * no time for a server round-trip, and a Plinko board has to label its buckets
 * before the first ball drops. The app cannot import this package — an engine
 * on the device is an engine a player can patch — so without a shared home the
 * only options are a second copy of every formula in the client, or a client
 * that cannot show a player the odds until after they have bet.
 *
 * A second copy is the worse one. It is the same fault that had the app
 * drawing win lines through cells the server never paid for, and it fails in
 * the same direction: the screen quotes a price the settlement does not honour.
 *
 * What stays here is everything that consumes randomness. That is the part
 * which must never reach the client, and it is a much smaller surface than the
 * payout tables: three functions.
 */

export * from '@juwa/economy';

import {
  DEFAULT_HOUSE_EDGE,
  DICE_OUTCOMES,
  DISPLAY_SCALE,
  MAX_MULTIPLIER,
  truncate2,
  type PlinkoRows,
} from '@juwa/economy';
import type { RngStream } from '../rng.js';

/**
 * The crash point for one round, shared by Crash and Limbo.
 *
 * Both games are the same random variable wearing different clothes: Crash
 * animates it as a rising curve that stops, Limbo prints it as a number. There
 * is one generator so they cannot drift apart.
 *
 * ## How it works
 *
 * With `r` uniform on [0, 1), the value `(1 - h) / (1 - r)` exceeds any target
 * `t ≥ 1` with probability exactly `(1 - h) / t`. So a player who cashes out at
 * `t` wins `t` with probability `(1 - h) / t`, and their expected return is
 * `1 - h` — *the same for every target they could pick*. A player chasing
 * 1000x and a player taking 1.01x face an identical edge, which is the property
 * that makes the game defensible.
 *
 * ## Why truncation costs nothing here
 *
 * Truncating to two decimals is normally a small loss to the player. Not here.
 * Targets are also two-decimal, and `trunc(x) ≥ t` is equivalent to `x ≥ t`
 * when `t` is already on the two-decimal grid — the truncation can never move a
 * value across a boundary a target could sit on. The 1% edge is exact.
 */
export function crashPoint(rng: RngStream, houseEdge = DEFAULT_HOUSE_EDGE): number {
  const r = rng.next();
  // r is at most 1 - 2^-32, so (1 - r) is never zero and this cannot divide by
  // zero — but it can still overflow the cap, which the clamp below handles.
  const raw = (1 - houseEdge) / (1 - r);
  if (raw >= MAX_MULTIPLIER) return MAX_MULTIPLIER;
  // Below 1.00 means the curve never got off the ground. The clamp matters less
  // than it looks: the lowest target a player may take is 1.01x, so every round
  // landing under that loses regardless of whether it is reported as 0.99 or
  // 1.00. That happens `1 - (1-h)/1.01` of the time — about 1.98%, not 1% —
  // and the 1% edge is the *expected* loss, not the loss rate at the minimum
  // target. Conflating the two is easy and makes the game look twice as harsh
  // as it is.
  return Math.max(1, truncate2(raw));
}

export function diceRoll(rng: RngStream): number {
  return rng.nextInt(DICE_OUTCOMES) / DISPLAY_SCALE;
}

/**
 * Drop one ball and return the bucket it lands in.
 *
 * Simulating each peg rather than sampling the binomial directly is not
 * wasteful — it is what lets the client animate the *same* path the server
 * settled, and what lets a player replay the drop from the revealed seed and
 * watch it land where the server said. A sampled bucket index is provable in
 * principle and unconvincing in practice.
 */
export function plinkoDrop(
  rng: RngStream,
  rows: PlinkoRows,
): { path: ('L' | 'R')[]; bucket: number } {
  const path: ('L' | 'R')[] = [];
  let bucket = 0;
  for (let r = 0; r < rows; r++) {
    const right = rng.nextInt(2) === 1;
    path.push(right ? 'R' : 'L');
    if (right) bucket++;
  }
  return { path, bucket };
}