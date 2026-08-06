/**
 * The maths behind the "originals" — Crash, Limbo, Dice, Plinko, Mines.
 *
 * These are the games that make a modern casino site not look like a slots
 * app. They share one property that slots do not have: **the player chooses
 * their own odds**. A slot's paytable is fixed; here the player picks a target
 * multiplier, a number of mines, a risk level, and the house edge has to come
 * out the same no matter what they picked.
 *
 * That is the entire job of this file, and it is the reason it exists
 * separately from the five engines. Get it wrong in one place and one game
 * quietly pays out more than it takes.
 *
 * ## The rule every function here obeys
 *
 * For a bet that wins with probability `p` and pays `m` times the stake:
 *
 *     m = (1 - houseEdge) / p        so        EV = m × p = 1 - houseEdge
 *
 * Every multiplier below is derived from that identity. None of them is a
 * table copied off a competitor's site — a copied table cannot be audited, and
 * when someone eventually asks "why does this pay 5.6x?", "because Stake does"
 * is not an answer that survives a regulator, a buyer's technical due
 * diligence, or a player with a spreadsheet.
 *
 * ## Rounding always favours the house, never the player
 *
 * A multiplier must settle at exactly the precision it is displayed at. Paying
 * 1.0309x while the screen says 1.03x is a bug that shows up as a penny of
 * unexplained drift per bet and a support ticket per player.
 *
 * So multipliers are **truncated**, never rounded to nearest. Truncation can
 * only ever pay less than the exact value, which means:
 *
 *   - the player is never paid less than the number they were shown, and
 *   - the actual house edge is never *smaller* than the configured one.
 *
 * Both error directions are safe. Rounding to nearest would sometimes pay more
 * than displayed and sometimes make the edge negative on a given bet, and
 * neither is acceptable.
 *
 * ## Which precision, and why it is not the same everywhere
 *
 * Truncation costs a fixed amount, so its *relative* cost is worst where the
 * multipliers are smallest — which is where most bets actually settle. At two
 * decimals that is not a rounding detail, it is a second house edge: the mines
 * ladder came out at 98.28% on its most-played rungs against 99% elsewhere.
 *
 * So the grid is chosen per game rather than globally:
 *
 *   - **Crash and Limbo** — two decimals, and *exactly* right. The player's
 *     target is also two decimals, so truncation can never move a crash point
 *     across a boundary a target could sit on. The edge is 1% with no drift.
 *   - **Plinko** — two decimals, corrected. Truncation loss is measured and
 *     handed back by `plinkoTable`, which lands every table on 99.000%.
 *   - **Dice and Mines** — four decimals, because their multipliers are derived
 *     from the player's own choices and cannot be pre-corrected. Worst case
 *     98.990% against a 99% target.
 *
 * Every one of those figures is asserted in `instant-games.test.ts` by walking
 * the whole outcome space, not by sampling it.
 */

import type { RngStream } from '../rng.js';

/**
 * 1% — the industry-standard edge for this category, and notably thinner than
 * our slots (4%) or roulette (2.7%).
 *
 * That is deliberate and it is a marketing decision as much as a maths one:
 * these games are played by people who *check* the edge, publish it, and
 * compare sites on it. A 4% Dice game gets called out in public. The thin edge
 * buys credibility, and the volume these games generate more than covers it.
 */
export const DEFAULT_HOUSE_EDGE = 0.01;

/** Two decimals — the grid targets, crash points and plinko tables sit on. */
const SCALE = 100;

/**
 * Four decimals — the grid *derived* multipliers sit on.
 *
 * Two is not enough, and the difference is larger than it sounds. Truncating
 * costs a fixed 0.01 regardless of the multiplier's size, so the relative cost
 * is worst exactly where the multipliers are smallest — and small multipliers
 * are where most bets are settled, because most players cash out early.
 *
 * Measured on the mines ladder: at two decimals the worst pair (1.1786 exact,
 * shown and paid as 1.17) returns 98.28%. That is a 1.72% house edge on the
 * single most common way the game is played, against a 1% edge everywhere the
 * numbers happen to be larger. Dice had the same defect at its minimum payout.
 *
 * Four decimals drops the worst case to under 0.01% of the multiplier, so every
 * cash-out point holds the configured edge to three significant figures.
 *
 * The cost is that the client must display four decimals for these games rather
 * than two — a multiplier shown as "1.1786x". For an audience that checks
 * these numbers against the revealed seed, that is a feature.
 */
const FINE_SCALE = 10_000;

/**
 * Truncate toward zero at two decimals.
 *
 * `Math.floor(x * 100) / 100` is wrong often enough to matter: 1.83 in binary
 * floating point is 1.8299999999999998, so `1.83 * 100` is 182.99999999999997
 * and the floor is 1.82 — a multiplier one tick lower than it should be, for
 * no reason, on an arbitrary-looking subset of values.
 *
 * Nudging by an epsilon first absorbs that representation error without ever
 * moving a value across a genuine two-decimal boundary.
 */
export function truncate2(value: number): number {
  return Math.floor(value * SCALE + 1e-9) / SCALE;
}

/** Truncate toward zero at four decimals. See `FINE_SCALE`. */
export function truncate4(value: number): number {
  return Math.floor(value * FINE_SCALE + 1e-9) / FINE_SCALE;
}

/** The multiplier a bet must pay for the house to hold exactly `houseEdge`. */
export function fairMultiplier(winProbability: number, houseEdge: number): number {
  if (!(winProbability > 0) || winProbability > 1) {
    throw new RangeError(`Win probability must be in (0, 1], got ${winProbability}`);
  }
  return (1 - houseEdge) / winProbability;
}

// ---------------------------------------------------------------------------
// Crash and Limbo
// ---------------------------------------------------------------------------

/**
 * The largest multiplier the game will ever produce.
 *
 * The generator below is unbounded — it is a 1/(1-r) tail, so there is always
 * a bigger number. Left uncapped, a single bet could in principle owe more
 * than the operator holds, and "in principle" is doing no work here: at 1%
 * edge, one bet in a million pays a million times the stake, and a site taking
 * a few million bets a month will see it.
 *
 * A cap is therefore a solvency control, not a stinginess control. It is set
 * high enough that essentially no real bet reaches it, and it is public.
 */
export const MAX_MULTIPLIER = 1_000_000;

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

/**
 * The lowest target a player may take.
 *
 * 1.00x would be a guaranteed win — the crash point is clamped to a minimum of
 * 1.00, so "cash out at 1.00x" never loses and would return the stake forever.
 * One tick above is the first target the edge actually applies to.
 */
export const MIN_TARGET = 1.01;

export function assertValidTarget(target: number): void {
  if (!Number.isFinite(target)) throw new RangeError('Target must be a number');
  if (target < MIN_TARGET) throw new RangeError(`Target must be at least ${MIN_TARGET}x`);
  if (target > MAX_MULTIPLIER) throw new RangeError(`Target may not exceed ${MAX_MULTIPLIER}x`);
  // Reject targets finer than the display grid: a 1.005x target would be shown
  // as 1.01x and settle differently from what the player read.
  if (Math.abs(target * SCALE - Math.round(target * SCALE)) > 1e-9) {
    throw new RangeError('Target may have at most two decimal places');
  }
}

// ---------------------------------------------------------------------------
// Dice
// ---------------------------------------------------------------------------

/** Dice rolls 0.00–99.99: ten thousand equally likely outcomes. */
export const DICE_OUTCOMES = 10_000;

/**
 * The bounds on a dice target.
 *
 * At least one outcome must win and at least one must lose. A bet that cannot
 * lose is free money; a bet that cannot win is fraud. Both are rejected rather
 * than clamped, because a clamped bet is a bet the player did not place.
 */
export const DICE_MIN_WINNING_OUTCOMES = 1;

export function diceRoll(rng: RngStream): number {
  return rng.nextInt(DICE_OUTCOMES) / SCALE;
}

/**
 * How many of the ten thousand outcomes win, for a target and a direction.
 *
 * Counting discrete outcomes rather than working with the probability directly
 * is what keeps this exact. `roll > 49.5` sounds like "half", but the roll is a
 * grid of ten thousand points, and the honest answer is 5049 of them — not
 * 5000. Deriving the multiplier from a rounded "half" would leak that
 * difference into the house edge in whichever direction the rounding fell.
 */
export function diceWinningOutcomes(target: number, direction: 'over' | 'under'): number {
  if (!Number.isFinite(target)) throw new RangeError('Dice target must be a number');
  const ticks = Math.round(target * SCALE);
  if (Math.abs(target * SCALE - ticks) > 1e-9) {
    throw new RangeError('Dice target may have at most two decimal places');
  }
  if (ticks < 0 || ticks >= DICE_OUTCOMES) {
    throw new RangeError('Dice target must be between 0.00 and 99.99');
  }
  // 'over' wins on ticks+1 … 9999; 'under' wins on 0 … ticks-1. The target
  // itself is a push-free loss in both directions, which is what makes the two
  // sides symmetric.
  const winning = direction === 'over' ? DICE_OUTCOMES - 1 - ticks : ticks;
  if (winning < DICE_MIN_WINNING_OUTCOMES) {
    throw new RangeError(`A ${direction} bet on ${target} can never win`);
  }
  return winning;
}

/**
 * The floor on a dice payout.
 *
 * A target of 99.00 under wins 9900 times in 10000 and pays 1.00x — the player
 * risks their whole stake to win nothing, and one loss in a hundred takes it.
 * The bet is legal, the maths is correct, and it is a trap: it looks like a
 * near-certain win and has a strictly negative return with no upside at all.
 *
 * So the minimum payout is one tick of profit. This costs the house nothing
 * (those bets carry the same 1% edge as any other) and removes the only bet on
 * the table a player can be sorry they understood.
 */
export const DICE_MIN_MULTIPLIER = 1.01;

export function diceMultiplier(
  target: number,
  direction: 'over' | 'under',
  houseEdge = DEFAULT_HOUSE_EDGE,
): number {
  const winning = diceWinningOutcomes(target, direction);
  const multiplier = truncate4(fairMultiplier(winning / DICE_OUTCOMES, houseEdge));
  if (multiplier < DICE_MIN_MULTIPLIER) {
    throw new RangeError(
      `A ${direction} bet on ${target} pays ${multiplier}x, below the ${DICE_MIN_MULTIPLIER}x minimum`,
    );
  }
  return multiplier;
}

// ---------------------------------------------------------------------------
// Mines
// ---------------------------------------------------------------------------

export const MINES_TILES = 25;

/**
 * The multiplier after safely revealing `revealed` tiles on a grid with
 * `mines` mines.
 *
 * The chance of surviving that many picks in a row is `C(25-m, k) / C(25, k)`
 * — the fraction of all k-tile selections that avoid every mine. Inverting it
 * against the edge gives the multiplier.
 *
 * The consequence worth understanding: **the player cannot beat this by
 * choosing when to stop.** Every cash-out point carries the same 1% edge, so
 * there is no clever exit and no bad one. Players will look for one and publish
 * strategies, and the maths here is what makes them wrong rather than merely
 * unlucky.
 *
 * That claim survives only because the multipliers are on a four-decimal grid.
 * At two decimals it was false: truncation costs proportionally more on a small
 * multiplier, so cashing out after one tile returned 98.6% while going deep
 * returned 99%, and a patient player really was 0.6% better off. Small enough
 * to miss, large enough to be the first thing someone with a spreadsheet finds.
 * `instant-games.test.ts` now pins the spread under 0.02%.
 */
export function minesMultiplier(
  mines: number,
  revealed: number,
  houseEdge = DEFAULT_HOUSE_EDGE,
): number {
  if (!Number.isInteger(mines) || mines < 1 || mines > MINES_TILES - 1) {
    throw new RangeError(`Mines must be between 1 and ${MINES_TILES - 1}, got ${mines}`);
  }
  const safeTiles = MINES_TILES - mines;
  if (!Number.isInteger(revealed) || revealed < 0 || revealed > safeTiles) {
    throw new RangeError(`Cannot reveal ${revealed} of ${safeTiles} safe tiles`);
  }
  if (revealed === 0) return 0; // Nothing revealed, nothing to cash out.

  // Build the ratio term by term instead of computing two factorials. C(25,12)
  // is fine, but the intermediate factorials are not, and a ratio of two
  // rounded huge numbers loses precision exactly where the multipliers get
  // large enough to matter.
  let ratio = 1;
  for (let i = 0; i < revealed; i++) {
    ratio *= (MINES_TILES - i) / (safeTiles - i);
  }
  // Deliberately NOT clamped to MAX_MULTIPLIER. This function returns the
  // honest price of the bet, and ten of the ~300 (mines, revealed) pairs are
  // worth more than the cap — 13 mines with 12 tiles turned over is worth
  // 5,148,297x.
  //
  // Clamping here is what a first draft does, and it silently pays 19% RTP
  // instead of 99% on exactly the deepest, most dramatic runs in the game: the
  // player is shown a ladder, climbs it against 1-in-5-million odds, and is
  // quietly paid a fifth of what the odds were worth. A cap is a solvency
  // control, and a solvency control must be enforced by *not offering the bet*,
  // never by shortpaying one already won.
  //
  // `minesMaxReveals` below is how the engine enforces it instead.
  return truncate4(fairMultiplier(1 / ratio, houseEdge));
}

/**
 * The deepest run the cap allows, for a given mine count.
 *
 * The engine settles the round automatically on reaching this many safe tiles,
 * so the player is never offered a pick whose reward would have to be clipped.
 * They keep every coin the ladder advertised; they are simply not sold a rung
 * that cannot be paid for.
 */
export function minesMaxReveals(mines: number, houseEdge = DEFAULT_HOUSE_EDGE): number {
  const safeTiles = MINES_TILES - mines;
  for (let k = 1; k <= safeTiles; k++) {
    if (minesMultiplier(mines, k, houseEdge) > MAX_MULTIPLIER) return k - 1;
  }
  return safeTiles;
}

/** Every cash-out multiplier for a mine count, indexed by tiles revealed. */
export function minesPaytable(mines: number, houseEdge = DEFAULT_HOUSE_EDGE): number[] {
  const safeTiles = MINES_TILES - mines;
  const table: number[] = [];
  for (let k = 0; k <= safeTiles; k++) table.push(minesMultiplier(mines, k, houseEdge));
  return table;
}

// ---------------------------------------------------------------------------
// Plinko
// ---------------------------------------------------------------------------

export type PlinkoRisk = 'low' | 'medium' | 'high';

export const PLINKO_ROWS = [8, 10, 12, 14, 16] as const;
export type PlinkoRows = (typeof PLINKO_ROWS)[number];

/**
 * How aggressively payouts spread from centre to edge.
 *
 * A ball dropped through `n` rows lands in bucket `i` with binomial
 * probability `C(n,i) / 2^n`. Setting each bucket's raw multiplier to
 * `(1 / p_i) ^ alpha` interpolates between the two degenerate extremes:
 *
 *   alpha = 0 → every bucket pays the same. No game.
 *   alpha = 1 → every bucket has identical EV. Also no game: the edges pay
 *               enormously but the centre pays out too, so nothing is at risk
 *               and the tension the game is built on disappears.
 *
 * In between, the centre pays less than it costs and the edges pay more, which
 * is the whole shape of Plinko. Higher alpha means a deeper centre trough and a
 * taller edge spike — literally the risk dial the player is setting.
 */
const RISK_ALPHA: Record<PlinkoRisk, number> = {
  low: 0.32,
  medium: 0.62,
  high: 0.88,
};

function binomialProbabilities(rows: number): number[] {
  // Pascal's triangle, normalised. Built additively so the terms stay exact
  // integers up to 2^16 rather than going through factorials.
  let row = [1];
  for (let r = 0; r < rows; r++) {
    const next = [1];
    for (let i = 0; i < row.length - 1; i++) next.push(row[i]! + row[i + 1]!);
    next.push(1);
    row = next;
  }
  const total = 2 ** rows;
  return row.map((c) => c / total);
}

/**
 * The multiplier for every bucket, derived so the table's RTP is the target.
 *
 * This is the one place where "derive, don't copy" does real work. Published
 * Plinko tables are just lists of numbers; their edge is whatever it happens to
 * be, and it is not the same across rows and risk levels. Deriving means the
 * fifteen tables this produces all hold the same 1%, and adding a sixteenth is
 * a line of configuration rather than an actuarial exercise.
 *
 * Three steps:
 *
 *   1. Shape — raw weights from the risk curve above.
 *   2. Scale — multiply so the expected value is exactly `1 - houseEdge`.
 *   3. Truncate, then give back what truncation took (see below).
 */
export function plinkoTable(
  rows: PlinkoRows,
  risk: PlinkoRisk,
  houseEdge = DEFAULT_HOUSE_EDGE,
): number[] {
  const probs = binomialProbabilities(rows);
  const alpha = RISK_ALPHA[risk];
  const raw = probs.map((p) => (1 / p) ** alpha);

  const rawEv = raw.reduce((sum, m, i) => sum + m * probs[i]!, 0);
  const target = 1 - houseEdge;
  const scaled = raw.map((m) => (m * target) / rawEv);

  // Truncation removes up to 0.01 from every bucket. Weighted by the centre
  // buckets' large probabilities that is a real loss — for a 16-row high-risk
  // table the centre pays about 0.4x and carries a fifth of all balls, so
  // shaving a hundredth off it costs several times more edge than intended.
  // Left uncorrected the tables come out between 98.3% and 98.8%, which is both
  // wrong and, worse, *inconsistently* wrong across the fifteen of them.
  //
  // So put it back: walk the buckets from most to least likely and add one tick
  // wherever it still fits under the target. Most-likely-first converges
  // fastest, because those are the buckets where a tick buys the most EV.
  //
  // Note there is deliberately no cap holding a bucket at or below its exact
  // scaled value. Such a cap sounds prudent and is the reason for the 98.3%
  // above: once every bucket is pinned below its own exact value, the sum can
  // never climb back to the target. Letting a bucket sit one tick above its
  // exact value costs at most 0.01 of shape and is what makes the *total* — the
  // only figure that is actually the house edge — come out right.
  // Topping up happens to MIRROR PAIRS, never to single buckets, and that is
  // not a tidiness preference. Bucket i and bucket n-1-i are equally likely, so
  // a greedy walk that visits them separately gives a tick to whichever it
  // reached first and stops before the other — leaving a board that pays 1.12x
  // on the left and 1.11x on its mirror image on the right.
  //
  // The expected value of that board is still exactly right. It still looks
  // rigged, and "the right side pays less" is a screenshot that spreads faster
  // than any explanation of it. Pairs cost a slightly coarser step and buy
  // exact left-right symmetry, which is the only version a player will accept.
  const table = scaled.map(truncate2);
  const n = table.length;

  // Each entry is the indices to bump together, cheapest EV step first — that
  // is, outermost pair first, since those buckets are the least likely.
  const groups: number[][] = [];
  for (let i = 0; i < Math.floor(n / 2); i++) groups.push([i, n - 1 - i]);
  if (n % 2 === 1) groups.push([Math.floor(n / 2)]);
  // Most likely first: the biggest EV gain per tick, so it converges fastest.
  groups.sort((a, b) => probs[b[0]!]! * b.length - probs[a[0]!]! * a.length);

  let ev = table.reduce((sum, m, i) => sum + m * probs[i]!, 0);
  let improved = true;
  while (improved) {
    improved = false;
    for (const group of groups) {
      const gain = group.reduce((sum, i) => sum + probs[i]! / SCALE, 0);
      // Never step past the target: the realised edge may end up marginally
      // larger than configured, never smaller.
      if (ev + gain <= target + 1e-12) {
        for (const i of group) table[i] = truncate2(table[i]! + 1 / SCALE);
        ev += gain;
        improved = true;
      }
    }
  }

  return table;
}

/** The realised RTP of a table — measured, so tests assert rather than trust. */
export function plinkoRtp(rows: PlinkoRows, table: readonly number[]): number {
  const probs = binomialProbabilities(rows);
  return table.reduce((sum, m, i) => sum + m * probs[i]!, 0);
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
export function plinkoDrop(rng: RngStream, rows: PlinkoRows): { path: ('L' | 'R')[]; bucket: number } {
  const path: ('L' | 'R')[] = [];
  let bucket = 0;
  for (let r = 0; r < rows; r++) {
    const right = rng.nextInt(2) === 1;
    path.push(right ? 'R' : 'L');
    if (right) bucket++;
  }
  return { path, bucket };
}

export { binomialProbabilities as plinkoBucketProbabilities };
