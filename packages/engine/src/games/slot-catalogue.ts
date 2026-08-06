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
    rtp: 0.9614,
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
    rtp: 0.9541,
    math: {
      reels: 5, rows: 3, paylines: LINES_10, symbols: fiveReelSymbols(1.15),
      payoutScale: 0.7384,
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
    rtp: 0.9595,
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
    rtp: 0.9554,
    math: {
      reels: 5, rows: 3, paylines: LINES_20, symbols: fiveReelSymbols(1.6),
      payoutScale: 0.5985,
      scatterPays: { 3: 5, 4: 25, 5: 150 },
      freeSpinsAwarded: { 3: 12, 4: 18, 5: 30 },
      freeSpinMultiplier: 5,
      stripLength: 36,
    },
  },
  /** Three reels, one line. No bonus round, nothing to learn. */
  'classic-3': {
    id: 'classic-3',
    volatility: 'high',
    rtp: 0.9455,
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
   * Absent means the vector symbols, which is right for the fruit-machine
   * titles: dressing Lucky Sevens as ancient Egypt would be worse than leaving
   * it plain.
   */
  art?: 'egypt' | 'pirate' | 'wildwest' | 'asian' | 'jungle' | 'myth' | 'orb';
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
    theme: { primary: '#7C3AED', secondary: '#C026D3', accent: '#FFC53D' }, limits: DEFAULT_LIMITS },
  { id: 'slot-emerald-nights', name: 'Emerald Nights', model: 'classic-20',
    theme: { primary: '#065F46', secondary: '#10B981', accent: '#A7F3D0' }, limits: DEFAULT_LIMITS, art: 'jungle' },
  { id: 'slot-royal-flush', name: 'Royal Fortune', model: 'classic-20',
    theme: { primary: '#7F1D1D', secondary: '#DC2626', accent: '#FCA5A5' }, limits: DEFAULT_LIMITS, art: 'myth' },
  { id: 'slot-ocean-drift', name: 'Ocean Drift', model: 'classic-20',
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
  { id: 'slot-jade-temple', name: 'Jade Temple', model: 'lines-10',
    theme: { primary: '#134E4A', secondary: '#14B8A6', accent: '#99F6E4' }, limits: DEFAULT_LIMITS, art: 'asian' },

  // -------------------------------------------------------------- twenty-five
  { id: 'slot-carnival-row', name: 'Carnival Row', model: 'lines-25',
    theme: { primary: '#831843', secondary: '#EC4899', accent: '#FBCFE8' }, limits: DEFAULT_LIMITS, art: 'orb' },
  { id: 'slot-jungle-run', name: 'Jungle Run', model: 'lines-25',
    theme: { primary: '#14532D', secondary: '#65A30D', accent: '#D9F99D' }, limits: DEFAULT_LIMITS, art: 'jungle' },
  { id: 'slot-city-lights', name: 'City Lights', model: 'lines-25',
    theme: { primary: '#0F172A', secondary: '#38BDF8', accent: '#F1F5F9' }, limits: DEFAULT_LIMITS, art: 'orb' },
  { id: 'slot-spice-market', name: 'Spice Market', model: 'lines-25',
    theme: { primary: '#7C2D12', secondary: '#EA580C', accent: '#FFEDD5' }, limits: LOW_LIMITS, art: 'asian' },
  { id: 'slot-aurora-borealis', name: 'Aurora', model: 'lines-25',
    theme: { primary: '#312E81', secondary: '#818CF8', accent: '#C7D2FE' }, limits: DEFAULT_LIMITS, art: 'orb' },

  // ------------------------------------------------------------ high volatility
  { id: 'slot-dragons-hoard', name: "Dragon's Hoard", model: 'high-vol', tag: 'mega',
    theme: { primary: '#450A0A', secondary: '#B91C1C', accent: '#FFC53D' }, limits: HIGH_LIMITS, art: 'asian' },
  { id: 'slot-vault-breaker', name: 'Vault Breaker', model: 'high-vol',
    theme: { primary: '#18181B', secondary: '#52525B', accent: '#2FE3D6' }, limits: HIGH_LIMITS, art: 'pirate' },
  { id: 'slot-supernova', name: 'Supernova', model: 'high-vol', tag: 'new',
    theme: { primary: '#1E1B4B', secondary: '#7C3AED', accent: '#F0ABFC' }, limits: DEFAULT_LIMITS, art: 'orb' },
  { id: 'slot-pharaohs-vault', name: "Pharaoh's Vault", model: 'high-vol',
    theme: { primary: '#422006', secondary: '#CA8A04', accent: '#FEF08A' }, limits: HIGH_LIMITS, art: 'egypt' },
  { id: 'slot-storm-chaser', name: 'Storm Chaser', model: 'high-vol',
    theme: { primary: '#164E63', secondary: '#06B6D4', accent: '#CFFAFE' }, limits: DEFAULT_LIMITS, art: 'myth' },

  // ---------------------------------------------------------------- three reel
  { id: 'slot-lucky-sevens', name: 'Lucky Sevens', model: 'classic-3',
    theme: { primary: '#7F1D1D', secondary: '#EF4444', accent: '#FFC53D' }, limits: LOW_LIMITS },
  { id: 'slot-triple-bar', name: 'Triple Bar', model: 'classic-3',
    theme: { primary: '#1C1917', secondary: '#57534E', accent: '#E6CE8C' }, limits: LOW_LIMITS },
  { id: 'slot-fruit-stand', name: 'Fruit Stand', model: 'classic-3',
    theme: { primary: '#166534', secondary: '#22C55E', accent: '#FEF08A' }, limits: LOW_LIMITS },
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
