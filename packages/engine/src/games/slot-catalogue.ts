/**
 * The slot catalogue.
 *
 * Twenty-plus games, each an entry in `SLOT_CATALOGUE`. Adding one is a data
 * edit — no new file, no new logic, and no way for a themed reskin to introduce
 * a payout bug of its own, because every game runs the same evaluator.
 *
 * A FEW MATH MODELS, MANY THEMES
 *
 * The catalogue does not contain twenty independently tuned mathematical
 * models. It contains five, reskinned. That is not a shortcut, it is how slot
 * studios actually ship: a model takes real work to tune and verify, a theme
 * takes an afternoon, and players choose games by theme and volatility rather
 * than by a bespoke paytable they will never read.
 *
 * It also means the return to player is controlled in five places instead of
 * twenty, which is the difference between a catalogue you can audit and one you
 * can only hope about.
 *
 * Every `rtp` below is MEASURED. `npm run rtp:catalogue -- --write` simulates
 * each model and records what it actually pays; `slot-catalogue.test.ts` fails
 * the build if any of them drifts. None of these numbers were typed in by hand,
 * and the calibration that produced them is a single `payoutScale` per model,
 * computed as target divided by measured.
 */

import { minor } from '@juwa/money';
import type { BetLimits } from './types.js';
import type { SlotMath, SlotSymbol, SymbolSpec } from './slot-math.js';

/** Row index per reel, for a 5x3 grid. */
const LINES_20: readonly (readonly number[])[] = [
  [1, 1, 1, 1, 1], [0, 0, 0, 0, 0], [2, 2, 2, 2, 2], [0, 1, 2, 1, 0], [2, 1, 0, 1, 2],
  [0, 0, 1, 0, 0], [2, 2, 1, 2, 2], [1, 0, 0, 0, 1], [1, 2, 2, 2, 1], [0, 1, 1, 1, 0],
  [2, 1, 1, 1, 2], [1, 0, 1, 0, 1], [1, 2, 1, 2, 1], [0, 0, 1, 2, 2], [2, 2, 1, 0, 0],
  [0, 1, 0, 1, 0], [2, 1, 2, 1, 2], [1, 1, 0, 1, 1], [1, 1, 2, 1, 1], [0, 2, 0, 2, 0],
];

const LINES_10 = LINES_20.slice(0, 10);
const LINES_25: readonly (readonly number[])[] = [
  ...LINES_20,
  [0, 1, 0, 1, 2], [2, 1, 2, 1, 0], [1, 0, 2, 0, 1], [1, 2, 0, 2, 1], [0, 2, 2, 2, 0],
];

/** A single-line, single-row classic. */
const LINES_1: readonly (readonly number[])[] = [[0, 0, 0]];

/**
 * Three reels, three rows, five lines: three straight and the two diagonals.
 *
 * The oldest layout there is, and it earns its place by being nothing like the
 * five-reel games — a player can see the whole grid at once and knows without
 * being told what the five lines are, which no 25-line machine can claim.
 */
const LINES_5: readonly (readonly number[])[] = [
  [1, 1, 1], [0, 0, 0], [2, 2, 2], [0, 1, 2], [2, 1, 0],
];

/**
 * The diamond: 3-4-5-4-3, widest in the middle.
 *
 * 3 x 4 x 5 x 4 x 3 = 720 ways, which is why this shape only works with ways
 * pays — there is no row 4 on reel one for a payline to cross.
 */
const DIAMOND: readonly number[] = [3, 4, 5, 4, 3];

/**
 * The original hand-authored strips for the flagship game.
 *
 * These are kept verbatim rather than regenerated from weights. Juwa Classic's
 * 96.25% return was measured over two million spins and published; a certified
 * figure should not move because the way the reels are expressed changed. Every
 * other model generates its strips.
 */
const CLASSIC_STRIPS: readonly (readonly SlotSymbol[])[] = [
  ['CHERRY','SEVEN','LEMON','BAR','PLUM','BELL','CHERRY','DIAMOND','LEMON','PLUM',
   'WILD','BAR','CHERRY','BELL','PLUM','LEMON','SEVEN','CHERRY','BAR','PLUM',
   'SCATTER','LEMON','BELL','CHERRY','PLUM','BAR','LEMON','DIAMOND','CHERRY','PLUM'],
  ['LEMON','BAR','CHERRY','PLUM','SEVEN','LEMON','BELL','PLUM','CHERRY','BAR',
   'WILD','LEMON','DIAMOND','PLUM','CHERRY','BELL','LEMON','BAR','PLUM','SEVEN',
   'CHERRY','SCATTER','LEMON','PLUM','BAR','BELL','CHERRY','LEMON','PLUM','DIAMOND'],
  ['PLUM','CHERRY','BAR','LEMON','BELL','PLUM','SEVEN','CHERRY','LEMON','BAR',
   'WILD','PLUM','DIAMOND','LEMON','BELL','CHERRY','PLUM','BAR','LEMON','SEVEN',
   'PLUM','SCATTER','CHERRY','BAR','LEMON','BELL','PLUM','CHERRY','LEMON','DIAMOND'],
  ['BAR','LEMON','PLUM','CHERRY','BELL','BAR','LEMON','SEVEN','PLUM','CHERRY',
   'WILD','BAR','LEMON','DIAMOND','PLUM','BELL','CHERRY','LEMON','BAR','PLUM',
   'SEVEN','SCATTER','LEMON','CHERRY','BAR','PLUM','BELL','LEMON','CHERRY','DIAMOND'],
  ['CHERRY','PLUM','LEMON','BAR','BELL','CHERRY','PLUM','LEMON','SEVEN','BAR',
   'WILD','CHERRY','PLUM','LEMON','DIAMOND','BELL','BAR','CHERRY','PLUM','LEMON',
   'SEVEN','SCATTER','BAR','CHERRY','PLUM','BELL','LEMON','CHERRY','BAR','DIAMOND'],
];

/** The flagship paytable, likewise unchanged. Weights are informational here. */
const CLASSIC_SYMBOLS: SymbolSpec[] = [
  { id: 'WILD',    kind: 'wild',    weights: [1, 1, 1, 1, 1], pays: { 3: 65, 4: 400, 5: 2500 } },
  { id: 'SCATTER', kind: 'scatter', weights: [1, 1, 1, 1, 1], pays: { 3: 0, 4: 0, 5: 0 } },
  { id: 'SEVEN',   kind: 'normal',  weights: [2, 2, 2, 2, 2], pays: { 3: 50, 4: 250, 5: 1250 } },
  { id: 'DIAMOND', kind: 'normal',  weights: [2, 2, 2, 2, 2], pays: { 3: 40, 4: 160, 5: 650 } },
  { id: 'BELL',    kind: 'normal',  weights: [3, 3, 3, 3, 3], pays: { 3: 25, 4: 100, 5: 400 } },
  { id: 'BAR',     kind: 'normal',  weights: [4, 4, 4, 4, 4], pays: { 3: 15, 4: 50, 5: 200 } },
  { id: 'CHERRY',  kind: 'normal',  weights: [6, 6, 6, 6, 6], pays: { 3: 9, 4: 30, 5: 100 } },
  { id: 'PLUM',    kind: 'normal',  weights: [6, 6, 6, 6, 6], pays: { 3: 8, 4: 20, 5: 60 } },
  { id: 'LEMON',   kind: 'normal',  weights: [6, 6, 6, 6, 6], pays: { 3: 5, 4: 15, 5: 50 } },
];

/**
 * The five-reel symbol set, parameterised by how steeply value is concentrated
 * in the top symbols. `spread` of 1 is flat and low-variance; higher values
 * push more of the return into rare five-of-a-kinds.
 */
function fiveReelSymbols(spread: number): SymbolSpec[] {
  const p = (three: number) => ({
    3: Math.round(three),
    4: Math.round(three * 4 * spread),
    5: Math.round(three * 18 * spread),
  });
  return [
    // Wild is scarce, and scarcest on the first and last reel — that is what
    // makes a near-miss common and a full line rare.
    { id: 'WILD',    kind: 'wild',    weights: [2, 4, 5, 4, 2], pays: p(60) },
    { id: 'SCATTER', kind: 'scatter', weights: [3, 3, 3, 3, 3], pays: { 3: 0, 4: 0, 5: 0 } },
    { id: 'SEVEN',   kind: 'normal',  weights: [6, 6, 6, 6, 5], pays: p(45) },
    { id: 'DIAMOND', kind: 'normal',  weights: [8, 8, 8, 8, 7], pays: p(35) },
    { id: 'BELL',    kind: 'normal',  weights: [11, 11, 11, 11, 11], pays: p(22) },
    { id: 'BAR',     kind: 'normal',  weights: [14, 14, 14, 14, 14], pays: p(14) },
    { id: 'CHERRY',  kind: 'normal',  weights: [17, 17, 17, 17, 17], pays: p(9) },
    { id: 'PLUM',    kind: 'normal',  weights: [19, 19, 19, 19, 19], pays: p(7) },
    { id: 'LEMON',   kind: 'normal',  weights: [20, 20, 20, 20, 20], pays: p(5) },
  ];
}

/**
 * The ways symbol set.
 *
 * Rates are far lower than the line games', and that is not a nerf — it is the
 * arithmetic of the mechanic. A 720-ways grid reads the same three-of-a-kind
 * dozens of times over, and a ways win is quoted against the whole stake rather
 * than per line, so a paytable copied across from a 20-line game would return
 * something close to fifty times the stake per spin.
 *
 * WILD carries no pay of its own here: in ways scoring it substitutes for every
 * symbol at once, and letting it also pay as itself would settle the same cells
 * twice over. `evaluateWays` ignores the field; it is zeroed so that nothing
 * suggests otherwise to whoever reads this next.
 */
function waysSymbols(): SymbolSpec[] {
  /** The top two symbols, which are rare enough to pay from three reels. */
  const top = (three: number) => ({ 3: three, 4: three * 3, 5: three * 10 });
  /**
   * Everything else pays from FOUR reels.
   *
   * Without this the model paid something on 93% of spins, and raising the
   * minimum on just the two commonest symbols only brought it to 88%. That is
   * not a generous machine, it is a dishonest one: nearly every spin lights up
   * and plays a win sound while returning less than the stake, so the player is
   * told they are winning while their balance goes down. Regulators call it a
   * "loss disguised as a win", and it is worth refusing on its own terms.
   *
   * It is also a shape problem specific to this layout, which is why the line
   * games do not need the same treatment. A diamond has nineteen cells against
   * a 5x3's fifteen, and the wide middle reels are exactly the ones a run has
   * to cross — so any given symbol turns up somewhere on the first three reels
   * far more often than the same weights would suggest on a rectangle.
   *
   * Requiring four reels puts the hit rate near 35%, and returns the same money
   * in wins large enough to be worth the noise they make.
   */
  const rest = (four: number) => ({ 3: 0, 4: four, 5: four * 4 });
  return [
    // One wild per strip, and none at all on the first or last reel.
    //
    // A wild reads as every symbol at once, so on a ways grid it does not
    // improve one combination — it puts EVERY symbol on that reel. At the
    // weight the line games use it made the four wide middle reels count for
    // everything, and no amount of adjusting the paytable could bring the hit
    // rate down while it was there.
    { id: 'WILD',    kind: 'wild',    weights: [0, 1, 1, 1, 0], pays: { 3: 0, 4: 0, 5: 0 } },
    { id: 'SCATTER', kind: 'scatter', weights: [3, 3, 3, 3, 3], pays: { 3: 0, 4: 0, 5: 0 } },
    // A mild spread rather than a steep one. On a grid this wide the strips do
    // most of the volatility work already, because the window on the middle
    // reel is five consecutive positions and an evenly spread strip puts a
    // common symbol in it nearly every time.
    { id: 'SEVEN',   kind: 'normal',  weights: [8, 8, 8, 8, 8], pays: top(3) },
    { id: 'DIAMOND', kind: 'normal',  weights: [9, 9, 9, 9, 9], pays: top(2.2) },
    { id: 'BELL',    kind: 'normal',  weights: [11, 11, 11, 11, 11], pays: rest(4.5) },
    { id: 'BAR',     kind: 'normal',  weights: [12, 12, 12, 12, 12], pays: rest(3) },
    { id: 'CHERRY',  kind: 'normal',  weights: [13, 13, 13, 13, 13], pays: rest(2) },
    { id: 'PLUM',    kind: 'normal',  weights: [14, 14, 14, 14, 14], pays: rest(1.5) },
    { id: 'LEMON',   kind: 'normal',  weights: [15, 15, 15, 15, 15], pays: rest(1.1) },
  ];
}

/**
 * The tumbling set.
 *
 * No WILD at all. A wild that survives a drop keeps paying on every subsequent
 * one, so it compounds down a chain in a way that is very hard to bound —
 * cascade games that do carry wilds usually pin them in place and cap the
 * chain, which is two more mechanics than this needs to be worth playing.
 */
function tumbleSymbols(): SymbolSpec[] {
  const p = (three: number) => ({ 3: three, 4: three * 5, 5: three * 20 });
  return [
    { id: 'SCATTER', kind: 'scatter', weights: [3, 3, 3, 3, 3], pays: { 3: 0, 4: 0, 5: 0 } },
    { id: 'SEVEN',   kind: 'normal',  weights: [7, 7, 7, 7, 7], pays: p(40) },
    { id: 'DIAMOND', kind: 'normal',  weights: [9, 9, 9, 9, 9], pays: p(30) },
    { id: 'BELL',    kind: 'normal',  weights: [12, 12, 12, 12, 12], pays: p(20) },
    { id: 'BAR',     kind: 'normal',  weights: [15, 15, 15, 15, 15], pays: p(13) },
    { id: 'CHERRY',  kind: 'normal',  weights: [18, 18, 18, 18, 18], pays: p(8) },
    { id: 'PLUM',    kind: 'normal',  weights: [20, 20, 20, 20, 20], pays: p(6) },
    { id: 'LEMON',   kind: 'normal',  weights: [22, 22, 22, 22, 22], pays: p(4) },
  ];
}

/** Three reels, one row, one line: the pub-machine model. */
const THREE_REEL_SYMBOLS: SymbolSpec[] = [
  { id: 'WILD',   kind: 'wild',   weights: [2, 2, 2], pays: { 3: 400, 4: 0, 5: 0 } },
  { id: 'SEVEN',  kind: 'normal', weights: [4, 4, 3], pays: { 3: 200, 4: 0, 5: 0 } },
  { id: 'BAR',    kind: 'normal', weights: [8, 8, 8], pays: { 3: 60, 4: 0, 5: 0 } },
  { id: 'BELL',   kind: 'normal', weights: [10, 10, 10], pays: { 3: 40, 4: 0, 5: 0 } },
  { id: 'CHERRY', kind: 'normal', weights: [14, 14, 14], pays: { 3: 20, 4: 0, 5: 0 } },
  { id: 'PLUM',   kind: 'normal', weights: [16, 16, 16], pays: { 3: 12, 4: 0, 5: 0 } },
  { id: 'LEMON',  kind: 'normal', weights: [18, 18, 18], pays: { 3: 8, 4: 0, 5: 0 } },
];

/**
 * The three-reel set, plus a scatter.
 *
 * `classic-3x3` had no bonus of any kind — empty `scatterPays`, empty
 * `freeSpinsAwarded` — because a classic three-reeler traditionally has none.
 * It now has a prize wheel, and a wheel needs something to trigger it, so this
 * set adds the one symbol the original lacks. Kept separate from
 * THREE_REEL_SYMBOLS so `classic-3`, which still has no bonus, is not diluted
 * by a symbol that can never do anything on a single-row grid.
 */
const THREE_REEL_BONUS_SYMBOLS: SymbolSpec[] = [
  ...THREE_REEL_SYMBOLS,
  /*
   * Weight 7, and this is the second time it has gone up.
   *
   * At 2 the wheel fired every 770 spins. At 4 it fired every 178, which is a
   * perfectly normal bonus frequency for a slot — and still wrong for THIS one,
   * because the founder played it again and asked, again, where the wheel was.
   *
   * The usual frequency assumes a game with other things going on. Triple Bar
   * and Fruit Stand have NO free spins, no cascades, no expanding wilds:
   * without the wheel they are three reels of fruit and nothing else, and their
   * lobby tile is a picture of a wheel. A promise on the tile that takes three
   * hundred spins to keep is a promise most players never see kept.
   */
  { id: 'SCATTER', kind: 'scatter', weights: [7, 7, 7], pays: { 3: 0, 4: 0, 5: 0 } },
];


export type Volatility = 'low' | 'medium' | 'high' | 'very-high';

export interface SlotModel {
  id: string;
  volatility: Volatility;
  /**
   * MEASURED return to player. Produced by `npm run rtp:catalogue -- --write`
   * and re-checked by slot-catalogue.test.ts.
   *
   * It lives on the MODEL, not on each game. Twenty-three themes share five
   * pieces of math, so there are five true values; storing a figure per game
   * would mean twenty-three numbers that can disagree about five facts, and
   * the first thing to go wrong would be a reskin quietly publishing a return
   * its own math does not produce.
   */
  rtp: number;
  math: SlotMath;
}

/** The five models the whole catalogue is built from. */
export const SLOT_MODELS: Record<string, SlotModel> = {
  /** The original, verified model. Frequent small wins. */
  'classic-20': {
    id: 'classic-20',
    volatility: 'low',
    rtp: 0.9608,
    math: {
      reels: 5, rows: 3, paylines: LINES_20, symbols: CLASSIC_SYMBOLS,
      strips: CLASSIC_STRIPS,
      scatterPays: { 3: 3, 4: 15, 5: 75 },
      freeSpinsAwarded: { 3: 8, 4: 12, 5: 20 },
      freeSpinMultiplier: 3,
      stripLength: 30,
    },
  },
  /** Fewer lines, so each one matters more. */
  'lines-10': {
    id: 'lines-10',
    volatility: 'medium',
    rtp: 0.9500,
    math: {
      reels: 5, rows: 3, paylines: LINES_10, symbols: fiveReelSymbols(1.15),
      payoutScale: 0.4770,
      /*
       * The centre reel goes wild.
       *
       * A BASE-GAME mechanic rather than a round, which is the point of putting
       * it here: it fires every few spins instead of once an hour, so it changes
       * what the machine feels like rather than what it occasionally does.
       *
       * ONE reel, and the number matters more than it looks. A fully wild reel
       * turns every payline crossing it into a guaranteed match, so on reels
       * 2-3-4 together it fired on roughly a third of all spins and took the
       * model to a measured 202% return — it was not a feature, it was the
       * game. On the centre reel alone it lands about one spin in seven, which
       * is often enough to be the thing players talk about and rare enough to
       * still be a gift.
       */
      feature: { kind: 'expanding-wild', reels: [2] },
      scatterPays: { 3: 4, 4: 18, 5: 90 },
      freeSpinsAwarded: { 3: 10, 4: 15, 5: 25 },
      freeSpinMultiplier: 3,
      stripLength: 32,
    },
  },
  /** More lines, more coverage, longer sessions. */
  'lines-25': {
    id: 'lines-25',
    volatility: 'medium',
    rtp: 0.9646,
    math: {
      reels: 5, rows: 3, paylines: LINES_25, symbols: fiveReelSymbols(1.05),
      payoutScale: 0.9048,
      scatterPays: { 3: 3, 4: 14, 5: 70 },
      freeSpinsAwarded: { 3: 8, 4: 14, 5: 22 },
      freeSpinMultiplier: 3,
      stripLength: 34,
    },
  },
  /** Long droughts, big spikes. Value concentrated in five-of-a-kind. */
  'high-vol': {
    id: 'high-vol',
    volatility: 'very-high',
    rtp: 0.9500,
    math: {
      reels: 5, rows: 3, paylines: LINES_20, symbols: fiveReelSymbols(1.6),
      payoutScale: 0.6882,
      scatterPays: { 3: 5, 4: 25, 5: 150 },
      // Kept for the scatter pay, but never awarded: the feature round below
      // replaces free spins, and `resolveRound` will not run both.
      freeSpinsAwarded: { 3: 12, 4: 18, 5: 30 },
      freeSpinMultiplier: 5,
      stripLength: 36,
      /*
       * Hold and spin, on the model that already lives on long droughts and
       * big spikes — the one shape of game this mechanic was made for.
       *
       * `coinChance` is the whole calibration. Too high and the grid fills
       * every time, which makes the full-grid bonus meaningless; too low and
       * the round is three respins of nothing. 0.055 across fourteen empty
       * cells gives a little under one stick per respin at the start, so the
       * round usually runs a while and rarely fills.
       */
      feature: {
        kind: 'hold-spin',
        trigger: 3,
        respins: 3,
        coinChance: 0.055,
        values: [1, 2, 3, 5, 10, 25],
        weights: [40, 26, 16, 10, 6, 2],
        fullBonus: 200,
      },
    },
  },
  /**
   * Three reels, three rows, five lines.
   *
   * The whole grid is visible at once and the five lines are the obvious ones,
   * so there is nothing to learn before the first spin. Higher variance than
   * the five-reel games despite looking simpler: nine cells give far fewer
   * chances to catch a partial win.
   */
  'classic-3x3': {
    id: 'classic-3x3',
    volatility: 'medium',
    rtp: 0.9479,
    math: {
      reels: 3, rows: 3, paylines: LINES_5, symbols: THREE_REEL_BONUS_SYMBOLS,
      payoutScale: 1.0423,
      scatterPays: {},
      freeSpinsAwarded: {},
      freeSpinMultiplier: 1,
      /*
       * 34, not 26.
       *
       * Strip length is the resolution of the frequency dial. A symbol's count
       * is `round(weight / total * length)`, so on a 26-position strip the
       * scatter can only be 1 or 2 — one gives a bonus every 770 spins and two
       * gives one every 80, with nothing in between. 34 puts a usable value
       * within reach.
       */
      stripLength: 34,
      /*
       * A prize wheel — the oldest bonus there is, and the right one for a
       * machine with three reels and nothing to read.
       *
       * Also a promise being kept: Triple Bar's lobby tile has always shown a
       * jewelled wheel, and players who tapped it got five reels of fruit and
       * no wheel anywhere.
       */
      feature: {
        kind: 'wheel',
        trigger: 3,
        segments: [2, 5, 10, 3, 20, 5, 50, 3],
        weights: [26, 20, 10, 24, 5, 20, 1, 24],
      },
    },
  },
  /**
   * The diamond. 3-4-5-4-3, 720 ways, no paylines at all.
   *
   * Wins are wide rather than deep — several reels contributing two or three
   * cells each is the normal case, not a jackpot — which gives it a completely
   * different rhythm from a line game even before the shape is noticed.
   */
  'ways-diamond': {
    id: 'ways-diamond',
    volatility: 'low',
    rtp: 0.9568,
    math: {
      reels: 5, rows: DIAMOND, paylines: 'ways', symbols: waysSymbols(),
      payoutScale: 0.1186,
      scatterPays: { 3: 3, 4: 15, 5: 75 },
      freeSpinsAwarded: { 3: 8, 4: 12, 5: 20 },
      freeSpinMultiplier: 2,
      stripLength: 36,
    },
  },
  /**
   * Tumbling reels with an escalating ladder.
   *
   * No free-spin round: the cascade IS the feature, and stacking a second one
   * on top of it makes the return almost impossible to reason about — a chain
   * inside a multiplied free spin multiplies twice.
   */
  'tumble-20': {
    id: 'tumble-20',
    volatility: 'high',
    rtp: 0.9408,
    math: {
      reels: 5, rows: 3, paylines: LINES_20, symbols: tumbleSymbols(),
      payoutScale: 1.0991,
      scatterPays: {},
      freeSpinsAwarded: {},
      freeSpinMultiplier: 1,
      stripLength: 32,
      cascade: { ladder: [2, 3, 5, 10], maxDrops: 8 },
    },
  },
  /** Three reels, one line. No bonus round, nothing to learn. */
  'classic-3': {
    id: 'classic-3',
    volatility: 'high',
    rtp: 0.9430,
    math: {
      reels: 3, rows: 1, paylines: LINES_1, symbols: THREE_REEL_SYMBOLS,
      payoutScale: 0.7409,
      scatterPays: {},
      freeSpinsAwarded: {},
      freeSpinMultiplier: 1,
      stripLength: 24,
    },
  },
};

export interface SlotTheme {
  /** Cabinet and reel-bay tint. */
  primary: string;
  secondary: string;
  /** Highlight for wins and trim. */
  accent: string;
}

export interface SlotDefinition {
  id: string;
  name: string;
  model: string;
  theme: SlotTheme;
  limits: BetLimits;
  tag?: 'new' | 'hot' | 'mega';
  /**
   * Which artwork family dresses this game's picture symbols.
   *
   * Purely presentational — the engine never reads it, and two games sharing a
   * family are still different maths models with different strips. It lives
   * here because this is the single place a game is defined; a separate mapping
   * file would drift the first time somebody added a game.
   *
   * Absent still means the vector symbols, which remains the correct answer
   * for anything with no family of its own.
   */
  art?: 'egypt' | 'pirate' | 'wildwest' | 'asian' | 'jungle' | 'myth' | 'orb' | 'fruit';
}

const DEFAULT_LIMITS: BetLimits = { min: minor(20), max: minor(50_000) };
const LOW_LIMITS: BetLimits = { min: minor(10), max: minor(10_000) };
const HIGH_LIMITS: BetLimits = { min: minor(100), max: minor(200_000) };

/**
 * The catalogue.
 *
 * `rtp` is filled from measurement, not judgement — every value here was
 * produced by `npm run rtp` and is re-checked by the test suite.
 */
export const SLOT_CATALOGUE: SlotDefinition[] = [
  // ------------------------------------------------------------- low volatility
  { id: 'juwa-classic-slots', name: 'Juwa Classic', model: 'classic-20', tag: 'hot',
    theme: { primary: '#7C3AED', secondary: '#C026D3', accent: '#FFC53D' }, limits: DEFAULT_LIMITS, art: 'fruit' },
  { id: 'slot-emerald-nights', name: 'Emerald Nights', model: 'classic-20',
    theme: { primary: '#065F46', secondary: '#10B981', accent: '#A7F3D0' }, limits: DEFAULT_LIMITS, art: 'jungle' },
  { id: 'slot-royal-flush', name: 'Royal Fortune', model: 'classic-20',
    theme: { primary: '#7F1D1D', secondary: '#DC2626', accent: '#FCA5A5' }, limits: DEFAULT_LIMITS, art: 'myth' },
  { id: 'slot-ocean-drift', name: 'Ocean Drift', model: 'ways-diamond',
    theme: { primary: '#0C4A6E', secondary: '#0EA5E9', accent: '#BAE6FD' }, limits: LOW_LIMITS, art: 'pirate' },
  { id: 'slot-sunset-strip', name: 'Sunset Strip', model: 'classic-20',
    theme: { primary: '#9A3412', secondary: '#FB923C', accent: '#FED7AA' }, limits: DEFAULT_LIMITS, art: 'wildwest' },

  // ---------------------------------------------------------------- ten lines
  { id: 'slot-midnight-gold', name: 'Midnight Gold', model: 'lines-10',
    theme: { primary: '#1C1917', secondary: '#78716C', accent: '#FFC53D' }, limits: DEFAULT_LIMITS, art: 'wildwest' },
  { id: 'slot-neon-alley', name: 'Neon Alley', model: 'lines-10', tag: 'new',
    theme: { primary: '#4C1D95', secondary: '#2FE3D6', accent: '#FF3D8A' }, limits: DEFAULT_LIMITS, art: 'orb' },
  { id: 'slot-desert-mirage', name: 'Desert Mirage', model: 'lines-10',
    theme: { primary: '#78350F', secondary: '#D97706', accent: '#FDE68A' }, limits: DEFAULT_LIMITS, art: 'egypt' },
  { id: 'slot-frost-peak', name: 'Frost Peak', model: 'lines-10',
    theme: { primary: '#1E3A8A', secondary: '#60A5FA', accent: '#DBEAFE' }, limits: LOW_LIMITS, art: 'orb' },
  { id: 'slot-jade-temple', name: 'Jade Temple', model: 'ways-diamond',
    theme: { primary: '#134E4A', secondary: '#14B8A6', accent: '#99F6E4' }, limits: DEFAULT_LIMITS, art: 'asian' },

  // -------------------------------------------------------------- twenty-five
  { id: 'slot-carnival-row', name: 'Carnival Row', model: 'lines-25',
    theme: { primary: '#831843', secondary: '#EC4899', accent: '#FBCFE8' }, limits: DEFAULT_LIMITS, art: 'orb' },
  { id: 'slot-jungle-run', name: 'Jungle Run', model: 'lines-25',
    theme: { primary: '#14532D', secondary: '#65A30D', accent: '#D9F99D' }, limits: DEFAULT_LIMITS, art: 'jungle' },
  { id: 'slot-city-lights', name: 'City Lights', model: 'tumble-20',
    theme: { primary: '#0F172A', secondary: '#38BDF8', accent: '#F1F5F9' }, limits: DEFAULT_LIMITS, art: 'orb' },
  { id: 'slot-spice-market', name: 'Spice Market', model: 'lines-25',
    theme: { primary: '#7C2D12', secondary: '#EA580C', accent: '#FFEDD5' }, limits: LOW_LIMITS, art: 'asian' },
  { id: 'slot-aurora-borealis', name: 'Aurora', model: 'ways-diamond',
    theme: { primary: '#312E81', secondary: '#818CF8', accent: '#C7D2FE' }, limits: DEFAULT_LIMITS, art: 'orb' },

  // ------------------------------------------------------------ high volatility
  { id: 'slot-dragons-hoard', name: "Dragon's Hoard", model: 'high-vol', tag: 'mega',
    theme: { primary: '#450A0A', secondary: '#B91C1C', accent: '#FFC53D' }, limits: HIGH_LIMITS, art: 'asian' },
  { id: 'slot-vault-breaker', name: 'Vault Breaker', model: 'high-vol',
    theme: { primary: '#18181B', secondary: '#52525B', accent: '#2FE3D6' }, limits: HIGH_LIMITS, art: 'pirate' },
  { id: 'slot-supernova', name: 'Supernova', model: 'tumble-20', tag: 'new',
    theme: { primary: '#1E1B4B', secondary: '#7C3AED', accent: '#F0ABFC' }, limits: DEFAULT_LIMITS, art: 'orb' },
  { id: 'slot-pharaohs-vault', name: "Pharaoh's Vault", model: 'high-vol',
    theme: { primary: '#422006', secondary: '#CA8A04', accent: '#FEF08A' }, limits: HIGH_LIMITS, art: 'egypt' },
  { id: 'slot-storm-chaser', name: 'Storm Chaser', model: 'tumble-20',
    theme: { primary: '#164E63', secondary: '#06B6D4', accent: '#CFFAFE' }, limits: DEFAULT_LIMITS, art: 'myth' },

  // ---------------------------------------------------------------- three reel
  { id: 'slot-lucky-sevens', name: 'Lucky Sevens', model: 'classic-3',
    theme: { primary: '#7F1D1D', secondary: '#EF4444', accent: '#FFC53D' }, limits: LOW_LIMITS, art: 'fruit' },
  { id: 'slot-triple-bar', name: 'Triple Bar', model: 'classic-3x3',
    theme: { primary: '#1C1917', secondary: '#57534E', accent: '#E6CE8C' }, limits: LOW_LIMITS, art: 'fruit' },
  { id: 'slot-fruit-stand', name: 'Fruit Stand', model: 'classic-3x3',
    theme: { primary: '#166534', secondary: '#22C55E', accent: '#FEF08A' }, limits: LOW_LIMITS, art: 'fruit' },
];

/** The measured return for a game, which is its model's. */
export function slotRtp(definition: SlotDefinition): number {
  return slotModel(definition).rtp;
}

export function slotModel(definition: SlotDefinition): SlotModel {
  const model = SLOT_MODELS[definition.model];
  if (!model) throw new Error(`${definition.id} names unknown model ${definition.model}`);
  return model;
}
