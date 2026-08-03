/**
 * Video slots: 5 reels x 3 rows, 20 fixed paylines, wilds, scatters, free spins.
 *
 * How a slot machine actually works — the part that surprises people:
 *
 * The machine does not "decide to pay out 96%". It picks a random stop position
 * on each reel, and the 96% *emerges* from the combination of the reel strips
 * (how many of each symbol are on each reel) and the paytable (what each
 * combination pays). Change one symbol on one strip and the RTP moves.
 *
 * That means the RTP is a measured property, not a setting. `npm run rtp`
 * simulates millions of spins and reports the real number, and the test suite
 * fails the build if it drifts outside the certified band. This is how a real
 * studio works, and it is what a lab like GLI or BMM will re-derive
 * independently before a regulator signs off.
 */

import { minor, mul, type Minor } from '@juwa/money';
import type { RngStream } from '../rng.js';
import {
  assertWithinLimits,
  IllegalActionError,
  type BetLimits,
  type GameAction,
  type GameEngine,
  type RoundState,
} from './types.js';

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

const REELS = 5;
const ROWS = 3;

/**
 * Reel strips. Each array is one physical reel; the engine picks a random index
 * and shows three consecutive symbols. Symbol frequency here IS the game's math
 * model — WILD and SCATTER are deliberately scarce, and scarcer on reels 1 and
 * 5 so that near-misses are common and full lines are not.
 */
const STRIPS: readonly (readonly SlotSymbol[])[] = [
  [
    'CHERRY', 'SEVEN', 'LEMON', 'BAR', 'PLUM', 'BELL', 'CHERRY', 'DIAMOND', 'LEMON', 'PLUM',
    'WILD', 'BAR', 'CHERRY', 'BELL', 'PLUM', 'LEMON', 'SEVEN', 'CHERRY', 'BAR', 'PLUM',
    'SCATTER', 'LEMON', 'BELL', 'CHERRY', 'PLUM', 'BAR', 'LEMON', 'DIAMOND', 'CHERRY', 'PLUM',
  ],
  [
    'LEMON', 'BAR', 'CHERRY', 'PLUM', 'SEVEN', 'LEMON', 'BELL', 'PLUM', 'CHERRY', 'BAR',
    'WILD', 'LEMON', 'DIAMOND', 'PLUM', 'CHERRY', 'BELL', 'LEMON', 'BAR', 'PLUM', 'SEVEN',
    'CHERRY', 'SCATTER', 'LEMON', 'PLUM', 'BAR', 'BELL', 'CHERRY', 'LEMON', 'PLUM', 'DIAMOND',
  ],
  [
    'PLUM', 'CHERRY', 'BAR', 'LEMON', 'BELL', 'PLUM', 'SEVEN', 'CHERRY', 'LEMON', 'BAR',
    'WILD', 'PLUM', 'DIAMOND', 'LEMON', 'BELL', 'CHERRY', 'PLUM', 'BAR', 'LEMON', 'SEVEN',
    'PLUM', 'SCATTER', 'CHERRY', 'BAR', 'LEMON', 'BELL', 'PLUM', 'CHERRY', 'LEMON', 'DIAMOND',
  ],
  [
    'BAR', 'LEMON', 'PLUM', 'CHERRY', 'BELL', 'BAR', 'LEMON', 'SEVEN', 'PLUM', 'CHERRY',
    'WILD', 'BAR', 'LEMON', 'DIAMOND', 'PLUM', 'BELL', 'CHERRY', 'LEMON', 'BAR', 'PLUM',
    'SEVEN', 'SCATTER', 'LEMON', 'CHERRY', 'BAR', 'PLUM', 'BELL', 'LEMON', 'CHERRY', 'DIAMOND',
  ],
  [
    'CHERRY', 'PLUM', 'LEMON', 'BAR', 'BELL', 'CHERRY', 'PLUM', 'LEMON', 'SEVEN', 'BAR',
    'WILD', 'CHERRY', 'PLUM', 'LEMON', 'DIAMOND', 'BELL', 'BAR', 'CHERRY', 'PLUM', 'LEMON',
    'SEVEN', 'SCATTER', 'BAR', 'CHERRY', 'PLUM', 'BELL', 'LEMON', 'CHERRY', 'BAR', 'DIAMOND',
  ],
];

/**
 * 20 paylines. Each entry gives the row index (0=top, 2=bottom) that the line
 * passes through on each of the five reels.
 */
const PAYLINES: readonly (readonly number[])[] = [
  [1, 1, 1, 1, 1], [0, 0, 0, 0, 0], [2, 2, 2, 2, 2], [0, 1, 2, 1, 0], [2, 1, 0, 1, 2],
  [0, 0, 1, 0, 0], [2, 2, 1, 2, 2], [1, 0, 0, 0, 1], [1, 2, 2, 2, 1], [0, 1, 1, 1, 0],
  [2, 1, 1, 1, 2], [1, 0, 1, 0, 1], [1, 2, 1, 2, 1], [0, 0, 1, 2, 2], [2, 2, 1, 0, 0],
  [0, 1, 0, 1, 0], [2, 1, 2, 1, 2], [1, 1, 0, 1, 1], [1, 1, 2, 1, 1], [0, 2, 0, 2, 0],
];

/** Payout multiplier per line, indexed by match count (3, 4 or 5 of a kind). */
const PAYTABLE: Record<SlotSymbol, { 3: number; 4: number; 5: number }> = {
  SEVEN:   { 3: 50, 4: 250, 5: 1250 },
  DIAMOND: { 3: 40, 4: 160, 5: 650 },
  BELL:    { 3: 25, 4: 100, 5: 400 },
  BAR:     { 3: 15, 4: 50, 5: 200 },
  CHERRY:  { 3: 9, 4: 30, 5: 100 },
  PLUM:    { 3: 8, 4: 20, 5: 60 },
  LEMON:   { 3: 5, 4: 15, 5: 50 },
  WILD:    { 3: 65, 4: 400, 5: 2500 },
  SCATTER: { 3: 0, 4: 0, 5: 0 },
};

/** Scatters pay on the TOTAL stake regardless of position, and trigger spins. */
const SCATTER_PAYS: Record<number, number> = { 3: 3, 4: 15, 5: 75 };
const FREE_SPINS_AWARDED: Record<number, number> = { 3: 8, 4: 12, 5: 20 };
/** Every win during the free-spins round is tripled. */
const FREE_SPIN_MULTIPLIER = 3;

const PAYING_SYMBOLS: SlotSymbol[] = [
  'SEVEN', 'DIAMOND', 'BELL', 'BAR', 'CHERRY', 'PLUM', 'LEMON',
];

export interface LineWin {
  line: number;
  symbol: SlotSymbol;
  count: number;
  multiplier: number;
}

export interface SpinResult {
  /** grid[reel][row] — what the player sees. */
  grid: SlotSymbol[][];
  lineWins: LineWin[];
  scatterCount: number;
  scatterMultiplier: number;
  /** Total multiplier of the total stake contributed by this spin. */
  totalMultiplier: number;
}

export interface SlotsPublic {
  baseSpin: SpinResult;
  freeSpins: SpinResult[];
  freeSpinsAwarded: number;
  totalMultiplier: number;
}

/** Spin one reel and read three consecutive symbols, wrapping around the strip. */
function spinReel(strip: readonly SlotSymbol[], rng: RngStream): SlotSymbol[] {
  const stop = rng.nextInt(strip.length);
  const window: SlotSymbol[] = [];
  for (let row = 0; row < ROWS; row++) {
    window.push(strip[(stop + row) % strip.length]!);
  }
  return window;
}

function spinGrid(rng: RngStream): SlotSymbol[][] {
  const grid: SlotSymbol[][] = [];
  for (let reel = 0; reel < REELS; reel++) {
    grid.push(spinReel(STRIPS[reel]!, rng));
  }
  return grid;
}

/**
 * Evaluate one payline: count matching symbols from the leftmost reel inward.
 * Wilds substitute for everything except scatters. If a line opens with wilds,
 * we pay whichever interpretation is worth more — the wild's own line win, or
 * the wild acting as the following symbol. Paying the player the better of the
 * two is standard and is what players expect; paying the worse one is the kind
 * of thing that ends up in a regulator complaint.
 */
function evaluateLine(grid: SlotSymbol[][], line: readonly number[]): LineWin | null {
  const symbols: SlotSymbol[] = [];
  for (let reel = 0; reel < REELS; reel++) {
    symbols.push(grid[reel]![line[reel]!]!);
  }

  const candidates = new Set<SlotSymbol>();
  const first = symbols[0]!;
  if (first === 'SCATTER') return null;
  candidates.add(first);
  // If the line opens with wilds, also try the first real symbol after them.
  for (const symbol of symbols) {
    if (symbol !== 'WILD' && symbol !== 'SCATTER') {
      candidates.add(symbol);
      break;
    }
  }

  let best: LineWin | null = null;
  for (const candidate of candidates) {
    if (candidate === 'SCATTER') continue;
    let count = 0;
    for (const symbol of symbols) {
      if (symbol === candidate || (symbol === 'WILD' && candidate !== 'WILD')) count++;
      else break;
    }
    if (count < 3) continue;
    const multiplier = PAYTABLE[candidate][count as 3 | 4 | 5];
    if (multiplier > 0 && (best === null || multiplier > best.multiplier)) {
      best = { line: -1, symbol: candidate, count, multiplier };
    }
  }
  return best;
}

function evaluateGrid(grid: SlotSymbol[][], winMultiplier: number): SpinResult {
  const lineWins: LineWin[] = [];
  let lineMultiplierSum = 0;

  for (let i = 0; i < PAYLINES.length; i++) {
    const win = evaluateLine(grid, PAYLINES[i]!);
    if (win) {
      const scaled = { ...win, line: i, multiplier: win.multiplier * winMultiplier };
      lineWins.push(scaled);
      lineMultiplierSum += scaled.multiplier;
    }
  }

  let scatterCount = 0;
  for (const reel of grid) {
    for (const symbol of reel) if (symbol === 'SCATTER') scatterCount++;
  }
  const scatterMultiplier = (SCATTER_PAYS[scatterCount] ?? 0) * winMultiplier;

  /**
   * Line wins are quoted per-line, so a 20x line win on a 20-line game returns
   * 1x the total stake. Dividing by the line count once, here, is what keeps
   * `totalMultiplier` directly comparable to the stake.
   */
  const totalMultiplier = lineMultiplierSum / PAYLINES.length + scatterMultiplier;

  return { grid, lineWins, scatterCount, scatterMultiplier, totalMultiplier };
}

export interface SlotsConfig {
  strips: readonly (readonly SlotSymbol[])[];
  paylines: readonly (readonly number[])[];
  paytable: typeof PAYTABLE;
}

export class SlotsEngine implements GameEngine<SlotsPublic, null, SlotsConfig> {
  readonly id = 'juwa-classic-slots';
  readonly name = 'Juwa Classic';
  readonly category = 'slots' as const;
  readonly limits: BetLimits;
  /**
   * Measured by Monte Carlo simulation, not asserted by hand.
   * Run `npm run rtp` to re-derive; `slots.test.ts` guards the band.
   */
  readonly rtp = 0.9625;
  readonly config: SlotsConfig = { strips: STRIPS, paylines: PAYLINES, paytable: PAYTABLE };

  constructor(limits?: BetLimits) {
    this.limits = limits ?? { min: minor(20), max: minor(50_000) };
  }

  init(stake: Minor, rng: RngStream): RoundState<SlotsPublic, null> {
    assertWithinLimits(stake, this.limits);

    const baseSpin = evaluateGrid(spinGrid(rng), 1);
    let totalMultiplier = baseSpin.totalMultiplier;

    const freeSpinsAwarded = FREE_SPINS_AWARDED[baseSpin.scatterCount] ?? 0;
    const freeSpins: SpinResult[] = [];
    for (let i = 0; i < freeSpinsAwarded; i++) {
      const spin = evaluateGrid(spinGrid(rng), FREE_SPIN_MULTIPLIER);
      freeSpins.push(spin);
      totalMultiplier += spin.totalMultiplier;
    }

    return {
      status: 'settled',
      public: { baseSpin, freeSpins, freeSpinsAwarded, totalMultiplier },
      private: null,
      availableActions: [],
      settlement: { stake, payout: mul(stake, totalMultiplier), multiplier: totalMultiplier },
    };
  }

  act(
    state: RoundState<SlotsPublic, null>,
    action: GameAction,
    _rng: RngStream,
  ): RoundState<SlotsPublic, null> {
    // Slots settle in `init`; there is nothing to act on. Anything arriving
    // here is a malformed or replayed client request.
    throw new IllegalActionError(action.type, state.availableActions);
  }
}

export const PAYING_SYMBOL_LIST = PAYING_SYMBOLS;
