/**
 * The slot math model, as data.
 *
 * Every slot in the catalogue is an instance of this — reels, rows, paylines,
 * a symbol table and a paytable — so shipping a new game is a data entry rather
 * than a new file of logic. The evaluation code below is shared by all of them,
 * which means it is tested once and a themed reskin cannot introduce a payout
 * bug of its own.
 *
 * WHY WEIGHTS RATHER THAN HAND-WRITTEN STRIPS
 *
 * A physical reel is a strip of symbols. Writing those strips by hand for
 * twenty games is both tedious and error-prone: a single misplaced WILD moves
 * the return to player by a percentage point, and nothing about the array looks
 * wrong. Declaring a weight per reel instead states the intent — "WILD is rare,
 * and rarer still on reel one" — and `buildStrip` turns that into a strip
 * deterministically.
 *
 * The strips are still real strips. The window is three consecutive positions,
 * so symbols remain correlated down a reel exactly as they are on a machine.
 * That correlation is part of why a near-miss feels like one, and sampling each
 * cell independently would quietly throw it away.
 */

import type { RngStream } from '../rng.js';

/** The nine shapes the client can draw. A game may use any subset. */
export type SlotSymbol =
  | 'WILD'
  | 'SCATTER'
  | 'SEVEN'
  | 'DIAMOND'
  | 'BELL'
  | 'BAR'
  | 'CHERRY'
  | 'PLUM'
  | 'LEMON';

export interface SymbolSpec {
  id: SlotSymbol;
  kind: 'normal' | 'wild' | 'scatter';
  /**
   * Relative frequency, one entry per reel. Higher is more common. Varying a
   * symbol's weight across reels is the main lever on volatility: making the
   * top symbol scarce on reel five turns most five-of-a-kinds into four.
   */
  weights: readonly number[];
  /** Line payout by match count. Scatters pay from `scatterPays` instead. */
  pays: { 3: number; 4: number; 5: number };
}

export interface SlotMath {
  reels: number;
  /**
   * Visible rows. A single number means every reel is the same height; an array
   * gives a height per reel, which is how a diamond (3-4-5-4-3) is expressed.
   *
   * Not every slot is a rectangle, and while the first version of this type
   * said `rows: number` no amount of art direction could make one look like
   * anything else. Twenty-three games shared five maths models and four of
   * those five were 5x3 — the catalogue was one game with twenty-three
   * paint jobs, and this is the field that made it so.
   */
  rows: number | readonly number[];
  /**
   * How a win is found.
   *
   * An array of paylines is the classic reading: each entry gives a row index
   * per reel, `[1,1,1,1,1]` being the centre line, and a win is a run of
   * matching symbols along one of them starting at reel one.
   *
   * `'ways'` is the other family — an "all ways pay" or "243 ways" machine.
   * There are no lines at all: a symbol pays if it appears anywhere on each of
   * the first N reels, and the win is multiplied by how many ways that can be
   * read. It is the only mechanic that makes sense on a ragged grid, because a
   * fixed row pattern cannot cross a reel that does not have that row.
   */
  paylines: readonly (readonly number[])[] | 'ways';
  symbols: readonly SymbolSpec[];
  /** Total stake multiplier for N scatters anywhere on the grid. */
  scatterPays: Readonly<Record<number, number>>;
  /** Free spins awarded for N scatters. */
  freeSpinsAwarded: Readonly<Record<number, number>>;
  /** Every win during the bonus round is multiplied by this. */
  freeSpinMultiplier: number;
  /** Positions per reel. Longer strips give finer control over frequency. */
  stripLength: number;
  /**
   * Explicit reel strips, overriding generation from weights.
   *
   * Used by a model whose strips were hand-authored and whose return to player
   * has already been measured and published. Regenerating those from weights
   * would move the number, and a certified figure should not change because
   * the way it is expressed changed.
   */
  strips?: readonly (readonly SlotSymbol[])[];
  /**
   * Calibration multiplier applied to every payout.
   *
   * The paytable sets the SHAPE of the return — which symbols matter, how
   * steeply value concentrates in five-of-a-kind. This sets the LEVEL. Return
   * to player scales linearly with it, so tuning a model to a target is one
   * measurement and one division rather than an afternoon of nudging
   * individual paytable rows and re-running the simulator.
   *
   * Every value in the catalogue was derived that way. None was guessed.
   */
  payoutScale?: number;
  /**
   * Tumbling reels: winning symbols are removed, everything above them falls
   * into the gap, and new symbols drop in from the top. The refilled grid is
   * evaluated again, and again, for as long as it keeps paying.
   *
   * The multiplier ladder is what makes it a mechanic rather than a repeat.
   * Each successive drop pays at a higher rate, so a chain is worth
   * disproportionately more than the same symbols would have been in one hit —
   * which is the whole reason a player watches a cascade instead of looking
   * away once the first win has been counted.
   */
  cascade?: {
    /**
     * Multiplier for the win at each drop after the first. `[2, 3, 5]` means
     * the second grid pays double, the third triple, the fourth and anything
     * beyond it five times.
     */
    ladder: readonly number[];
    /** Hard stop, so a pathological strip cannot loop forever. */
    maxDrops: number;
  };
}

/** Rows per reel, whether the model declared one number or a shape. */
export function reelHeights(math: SlotMath): number[] {
  if (typeof math.rows === 'number') return Array.from({ length: math.reels }, () => math.rows as number);
  if (math.rows.length !== math.reels) {
    throw new Error(`Shape has ${math.rows.length} reels, expected ${math.reels}`);
  }
  return [...math.rows];
}

/** True when the model pays by adjacency rather than along fixed lines. */
export function isWays(math: SlotMath): boolean {
  return math.paylines === 'ways';
}

/**
 * What a per-line multiplier is divided by to become a stake multiplier.
 *
 * A line game quotes each win per line, so a 20x win on a 20-line game returns
 * the stake. A ways game quotes against the whole stake already — the player is
 * buying all 243 ways at once, not one of them — so there is nothing to divide
 * by and the divisor is 1. Getting this backwards is a factor-of-243 error in
 * the payout, in the player's favour, which is the kind of bug that is only
 * discovered from the wrong side of a balance sheet.
 */
export function payDivisor(math: SlotMath): number {
  return math.paylines === 'ways' ? 1 : math.paylines.length;
}

export interface LineWin {
  line: number;
  symbol: SlotSymbol;
  count: number;
  multiplier: number;
  /**
   * The winning cells as `[reel, row]`, leftmost reel first.
   *
   * Derived here rather than left for the client to work out, and that is a
   * deliberate boundary rather than a convenience. The client has no payline
   * table — it deliberately does not import this package — so the alternative
   * is shipping a second copy of every payline shape into the app. Two copies
   * of the same table drift, and when they drift the machine draws a winning
   * line through cells the server did not pay for. A player screenshots that,
   * and they are right to.
   *
   * `count` alone is not enough either: it says how many reels matched, not
   * which rows they matched on, and a zig-zag line visits a different row on
   * every reel.
   */
  cells: readonly (readonly [number, number])[];
}

/**
 * One tumble after the first.
 *
 * Sent to the client as its own step rather than folded into a final grid,
 * because the drops ARE the presentation: a cascade the player is shown only
 * the end of is indistinguishable from a single large win, and the escalating
 * ladder that makes chains worth chasing becomes invisible.
 */
export interface CascadeStep {
  grid: SlotSymbol[][];
  lineWins: LineWin[];
  /** Where on the ladder this drop paid. */
  stepMultiplier: number;
  totalMultiplier: number;
}

export interface SpinResult {
  grid: SlotSymbol[][];
  lineWins: LineWin[];
  scatterCount: number;
  scatterMultiplier: number;
  /** Includes every cascade below. */
  totalMultiplier: number;
  /** Empty unless the model tumbles. */
  cascades: CascadeStep[];
}

/**
 * Turn per-reel weights into one reel strip.
 *
 * Symbols are spread as evenly as their count allows rather than placed in
 * runs. Each instance is given a fractional position `(i + 0.5) / count` and
 * the strip is the sort of those positions — the standard way to interleave
 * several sequences at different rates without clumping.
 *
 * Clumping matters: three CHERRY in a row on a strip guarantees a full column
 * of cherries whenever the window lands there, which is a far bigger payout
 * event than the weight alone implies, and it is invisible in the weights.
 */
export function buildStrip(
  symbols: readonly SymbolSpec[],
  reel: number,
  length: number,
): SlotSymbol[] {
  const weights = symbols.map((s) => Math.max(0, s.weights[reel] ?? 0));
  const total = weights.reduce((a, b) => a + b, 0);
  if (total <= 0) throw new Error(`Reel ${reel} has no symbols with weight`);

  // At least one of every symbol that has any weight at all, so a symbol never
  // silently vanishes from a reel because of rounding.
  const counts = weights.map((w) => (w > 0 ? Math.max(1, Math.round((w / total) * length)) : 0));

  const placed: { symbol: SlotSymbol; key: number }[] = [];
  for (const [i, count] of counts.entries()) {
    const spec = symbols[i]!;
    for (let n = 0; n < count; n++) {
      placed.push({ symbol: spec.id, key: (n + 0.5) / count });
    }
  }
  // Ties broken by symbol id so the strip is identical on every machine and on
  // every run — a reel that differs between server restarts is unauditable.
  placed.sort((a, b) => a.key - b.key || a.symbol.localeCompare(b.symbol));
  return placed.map((p) => p.symbol);
}

export function buildStrips(math: SlotMath): readonly (readonly SlotSymbol[])[] {
  if (math.strips) {
    if (math.strips.length !== math.reels) {
      throw new Error(`Explicit strips have ${math.strips.length} reels, expected ${math.reels}`);
    }
    return math.strips;
  }
  return Array.from({ length: math.reels }, (_, reel) =>
    buildStrip(math.symbols, reel, math.stripLength),
  );
}

function spinReel(strip: readonly SlotSymbol[], rows: number, rng: RngStream): SlotSymbol[] {
  const stop = rng.nextInt(strip.length);
  const window: SlotSymbol[] = [];
  for (let row = 0; row < rows; row++) {
    window.push(strip[(stop + row) % strip.length]!);
  }
  return window;
}

export function spinGrid(
  strips: readonly (readonly SlotSymbol[])[],
  math: SlotMath,
  rng: RngStream,
): SlotSymbol[][] {
  const heights = reelHeights(math);
  const grid: SlotSymbol[][] = [];
  for (let reel = 0; reel < math.reels; reel++) {
    grid.push(spinReel(strips[reel]!, heights[reel]!, rng));
  }
  return grid;
}

/**
 * Evaluate one payline: count matching symbols from the leftmost reel inward.
 *
 * Wilds substitute for everything except scatters. If a line opens with wilds
 * we pay whichever reading is worth more — the wild's own line win, or the wild
 * standing in for the symbol that follows. Paying the better of the two is what
 * players expect; paying the worse one is the kind of thing that ends up in a
 * regulator's complaint file.
 */
function evaluateLine(
  grid: SlotSymbol[][],
  line: readonly number[],
  math: SlotMath,
  pays: ReadonlyMap<SlotSymbol, SymbolSpec>,
): LineWin | null {
  const symbols: SlotSymbol[] = [];
  for (let reel = 0; reel < math.reels; reel++) {
    symbols.push(grid[reel]![line[reel]!]!);
  }

  const first = symbols[0]!;
  if (pays.get(first)?.kind === 'scatter') return null;

  const candidates = new Set<SlotSymbol>([first]);
  for (const symbol of symbols) {
    const kind = pays.get(symbol)?.kind;
    if (kind === 'normal') {
      candidates.add(symbol);
      break;
    }
  }

  let best: LineWin | null = null;
  for (const candidate of candidates) {
    const spec = pays.get(candidate);
    if (!spec || spec.kind === 'scatter') continue;

    let count = 0;
    for (const symbol of symbols) {
      const isWild = pays.get(symbol)?.kind === 'wild';
      if (symbol === candidate || (isWild && spec.kind !== 'wild')) count++;
      else break;
    }
    if (count < 3) continue;

    const multiplier = spec.pays[Math.min(count, 5) as 3 | 4 | 5] ?? 0;
    if (multiplier > 0 && (best === null || multiplier > best.multiplier)) {
      // `line` and `cells` are filled in by the caller, which is the only place
      // that knows which payline index this is.
      best = { line: -1, symbol: candidate, count, multiplier, cells: [] };
    }
  }
  return best;
}

/**
 * Evaluate an "all ways pay" grid.
 *
 * There are no lines. A symbol pays when it appears at least once on each of
 * the first N reels, and the win is multiplied by the number of ways it can be
 * read — the product of how many times it occurs on each of those reels. Three
 * cherries on reel one, two on reel two and one on reel three is six ways, and
 * pays six times the three-of-a-kind rate.
 *
 * WILD substitutes but does not pay for itself here. That is the standard
 * reading, and it is also the only one that stays honest: a grid full of wilds
 * would otherwise pay once as WILD and again as every other symbol on the
 * paytable, over the same cells, which multiplies the top of the return
 * distribution by roughly the size of the symbol set.
 */
function evaluateWays(
  grid: SlotSymbol[][],
  math: SlotMath,
  pays: ReadonlyMap<SlotSymbol, SymbolSpec>,
): LineWin[] {
  const wins: LineWin[] = [];

  for (const [index, spec] of math.symbols.entries()) {
    if (spec.kind !== 'normal') continue;

    // How many cells on each reel can read as this symbol, and which ones.
    const hits: [number, number][][] = [];
    for (let reel = 0; reel < math.reels; reel++) {
      const onReel: [number, number][] = [];
      for (const [row, symbol] of grid[reel]!.entries()) {
        const kind = pays.get(symbol)?.kind;
        if (symbol === spec.id || kind === 'wild') onReel.push([reel, row]);
      }
      if (onReel.length === 0) break; // The run ends at the first reel without one.
      hits.push(onReel);
    }
    if (hits.length < 3) continue;

    const rate = spec.pays[Math.min(hits.length, 5) as 3 | 4 | 5] ?? 0;
    if (rate <= 0) continue;

    const ways = hits.reduce((product, onReel) => product * onReel.length, 1);
    wins.push({
      // There is no payline to name, so the symbol's own index identifies the
      // win. The client only uses this as a stable key for the walk-through.
      line: index,
      symbol: spec.id,
      count: hits.length,
      multiplier: rate * ways,
      cells: hits.flat(),
    });
  }
  return wins;
}

export function evaluateGrid(
  grid: SlotSymbol[][],
  math: SlotMath,
  winMultiplier: number,
): SpinResult {
  const pays = new Map(math.symbols.map((s) => [s.id, s]));
  const scale = math.payoutScale ?? 1;

  const raw: LineWin[] =
    math.paylines === 'ways'
      ? evaluateWays(grid, math, pays)
      : math.paylines.flatMap((line, i) => {
          const win = evaluateLine(grid, line, math, pays);
          if (!win) return [];
          // Only the reels that actually matched, not the whole payline. A
          // three-of-a-kind on a five-reel line lights three cells; lighting
          // all five tells the player two symbols paid that did not.
          const cells: [number, number][] = [];
          for (let reel = 0; reel < win.count; reel++) cells.push([reel, line[reel]!]);
          return [{ ...win, line: i, cells }];
        });

  const lineWins = raw.map((win) => ({
    ...win,
    multiplier: win.multiplier * winMultiplier * scale,
  }));
  const lineMultiplierSum = lineWins.reduce((sum, win) => sum + win.multiplier, 0);

  let scatterCount = 0;
  for (const reel of grid) {
    for (const symbol of reel) if (pays.get(symbol)?.kind === 'scatter') scatterCount++;
  }
  const scatterMultiplier = (math.scatterPays[scatterCount] ?? 0) * winMultiplier * scale;

  /**
   * Line wins are quoted per line, so a 20x line win on a 20-line game returns
   * 1x the total stake. Dividing once, here, keeps `totalMultiplier` directly
   * comparable to the stake — see `payDivisor` for why a ways game divides by
   * one instead.
   */
  const totalMultiplier = lineMultiplierSum / payDivisor(math) + scatterMultiplier;

  return { grid, lineWins, scatterCount, scatterMultiplier, totalMultiplier, cascades: [] };
}

/**
 * Drop the winning symbols out of a grid and refill from the top.
 *
 * Survivors keep their order and fall to the bottom of their own reel; the gap
 * at the top is filled with fresh symbols. The new symbols are drawn one at a
 * time rather than as a window onto the strip, which is a real difference from
 * a normal spin: a spun reel shows three CONSECUTIVE strip positions and so
 * carries the strip's own correlation down the column, while symbols dropping
 * into a hole arrive independently. That is how tumbling games work, and it is
 * worth knowing because it means a cascade model's return cannot be reasoned
 * about from its strips alone — it has to be measured.
 */
function tumble(
  grid: SlotSymbol[][],
  cleared: ReadonlySet<string>,
  strips: readonly (readonly SlotSymbol[])[],
  rng: RngStream,
): SlotSymbol[][] {
  return grid.map((reel, r) => {
    const survivors = reel.filter((_, row) => !cleared.has(`${r},${row}`));
    const strip = strips[r]!;
    const fresh = Array.from(
      { length: reel.length - survivors.length },
      () => strip[rng.nextInt(strip.length)]!,
    );
    return [...fresh, ...survivors];
  });
}

/**
 * Spin, and keep tumbling while it keeps paying.
 *
 * This is where a spin is actually resolved, because a cascade needs the RNG
 * and `evaluateGrid` is deliberately pure — being able to replay a grid and get
 * the same answer with no random source is what makes a past round auditable.
 * So the loop lives here and the evaluation stays pure.
 *
 * Scatters are counted on the FIRST grid only. Symbols that fall in afterwards
 * can retrigger a bonus in some real machines, but that turns free spins into a
 * feedback loop whose return is unbounded above without a hard cap, and an
 * unbounded loop is not something to introduce in the same change as the
 * mechanic itself.
 */
export function resolveSpin(
  strips: readonly (readonly SlotSymbol[])[],
  math: SlotMath,
  rng: RngStream,
  winMultiplier: number,
): SpinResult {
  const first = evaluateGrid(spinGrid(strips, math, rng), math, winMultiplier);
  if (!math.cascade) return first;

  const cascades: CascadeStep[] = [];
  let grid = first.grid;
  let previous: LineWin[] = first.lineWins;
  let total = first.totalMultiplier;

  for (let drop = 0; drop < math.cascade.maxDrops && previous.length > 0; drop++) {
    const cleared = new Set<string>();
    for (const win of previous) for (const [reel, row] of win.cells) cleared.add(`${reel},${row}`);

    grid = tumble(grid, cleared, strips, rng);
    // Past the end of the ladder every further drop pays at the top rate.
    const step = math.cascade.ladder[Math.min(drop, math.cascade.ladder.length - 1)] ?? 1;
    const result = evaluateGrid(grid, math, winMultiplier * step);

    previous = result.lineWins;
    if (previous.length === 0) break;

    // Scatters were already counted and paid on the first grid.
    const paid = result.totalMultiplier - result.scatterMultiplier;
    cascades.push({
      grid,
      lineWins: result.lineWins,
      stepMultiplier: step,
      totalMultiplier: paid,
    });
    total += paid;
  }

  return { ...first, cascades, totalMultiplier: total };
}
