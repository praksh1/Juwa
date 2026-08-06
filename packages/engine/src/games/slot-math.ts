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
  rows: number;
  /** Row index per reel. `[1,1,1,1,1]` is the centre line. */
  paylines: readonly (readonly number[])[];
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

export interface SpinResult {
  grid: SlotSymbol[][];
  lineWins: LineWin[];
  scatterCount: number;
  scatterMultiplier: number;
  totalMultiplier: number;
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
  const grid: SlotSymbol[][] = [];
  for (let reel = 0; reel < math.reels; reel++) {
    grid.push(spinReel(strips[reel]!, math.rows, rng));
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

export function evaluateGrid(
  grid: SlotSymbol[][],
  math: SlotMath,
  winMultiplier: number,
): SpinResult {
  const pays = new Map(math.symbols.map((s) => [s.id, s]));
  const scale = math.payoutScale ?? 1;

  const lineWins: LineWin[] = [];
  let lineMultiplierSum = 0;
  for (const [i, line] of math.paylines.entries()) {
    const win = evaluateLine(grid, line, math, pays);
    if (win) {
      // Only the reels that actually matched, not the whole payline. A
      // three-of-a-kind on a five-reel line lights three cells; lighting all
      // five tells the player two symbols paid that did not.
      const cells: [number, number][] = [];
      for (let reel = 0; reel < win.count; reel++) cells.push([reel, line[reel]!]);
      const scaled = {
        ...win,
        line: i,
        cells,
        multiplier: win.multiplier * winMultiplier * scale,
      };
      lineWins.push(scaled);
      lineMultiplierSum += scaled.multiplier;
    }
  }

  let scatterCount = 0;
  for (const reel of grid) {
    for (const symbol of reel) if (pays.get(symbol)?.kind === 'scatter') scatterCount++;
  }
  const scatterMultiplier = (math.scatterPays[scatterCount] ?? 0) * winMultiplier * scale;

  /**
   * Line wins are quoted per line, so a 20x line win on a 20-line game returns
   * 1x the total stake. Dividing by the line count once, here, keeps
   * `totalMultiplier` directly comparable to the stake.
   */
  const totalMultiplier = lineMultiplierSum / math.paylines.length + scatterMultiplier;

  return { grid, lineWins, scatterCount, scatterMultiplier, totalMultiplier };
}
