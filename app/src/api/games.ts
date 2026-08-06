/**
 * The game catalogue, as the app sees it.
 *
 * IMPORTANT ARCHITECTURAL NOTE
 *
 * This file deliberately does NOT import `@juwa/engine`. The engine is
 * server-only code — it needs Node's crypto module, and more importantly, if
 * the app could compute outcomes then a modified app could compute *favourable*
 * outcomes.
 *
 * The app knows only what a game looks like in the lobby: name, art, category,
 * limits. When a player taps one, the server plays the round and sends back the
 * result to animate. This is the boundary that keeps the product honest, and it
 * is enforced by simply never adding the engine to this package's dependencies.
 *
 * Right now these are hard-coded so the wireframes have something to render.
 * In Phase 3 this becomes a `fetch` against the API — the shape stays the same.
 */

import { SLOT_GAMES, SLOT_MODEL_INFO } from './slot-games.generated';

export type GameCategory = 'slots' | 'table' | 'live' | 'instant' | 'poker';

export interface SlotGame {
  id: string;
  name: string;
  category: 'slots';
  rtp: number;
  volatility: 'low' | 'medium' | 'high' | 'very-high';
  reels: number;
  rows: number;
  lines: number;
  minBet: number;
  maxBet: number;
  theme: { primary: string; secondary: string; accent: string };
  tag?: 'new' | 'hot' | 'mega';
  /**
   * Artwork family for the picture symbols. Absent means the vector symbols,
   * which is deliberate for the fruit-machine titles.
   */
  art?: string;
  /** Which shared maths model this theme runs on. Keys `SLOT_MODEL_INFO`. */
  model: string;
}

/**
 * A model's paytable, for the rules screen and the in-game paytable.
 *
 * Attached to the MODEL rather than the game: twenty-three themes share five
 * pieces of maths, so there are five paytables. A copy per game would be
 * twenty-three places for five facts to disagree.
 *
 * ⚠️ THE TWO NUMBERS ARE IN DIFFERENT UNITS, which is not a quirk of ours —
 * it is how slots work, and getting it wrong misstates every payout on screen.
 *
 *   `symbols[].pays` is a multiple of the LINE bet. The engine divides the sum
 *   of line wins by the payline count, so 12 on a 20-line game returns 0.6× the
 *   total stake.
 *
 *   `scatterPays` is a multiple of the TOTAL bet. Scatters pay from anywhere on
 *   the grid and belong to no line.
 */
export interface SlotModelInfo {
  id: string;
  lines: number;
  symbols: {
    id: string;
    kind: 'normal' | 'wild' | 'scatter';
    pays: Record<'3' | '4' | '5', number>;
  }[];
  /** Total-bet multiple, by how many scatters landed. */
  scatterPays: Record<string, number>;
  /** Free spins awarded, by how many scatters landed. */
  freeSpinsAwarded: Record<string, number>;
  /** Every win during the bonus round is multiplied by this. */
  freeSpinMultiplier: number;
}

export interface GameSummary {
  id: string;
  name: string;
  category: GameCategory;
  /** Theoretical return to player, as published by the engine. */
  rtp: number;
  minBet: number;
  maxBet: number;
  /** Placeholder art direction until real assets exist. */
  accent: string;
  tag?: 'new' | 'hot' | 'jackpot';
  /**
   * Needs other players at the table.
   *
   * Juwa is deliberately single-player. Real-time multiplayer is a different
   * class of problem — persistent sockets, a matchmaking lobby, turn timers,
   * disconnect handling, and collusion detection — and it only works once
   * enough people are online at the same time to fill a table. These stay on
   * the shelf; the tile exists so the category is visible.
   */
  multiplayer?: boolean;
}

export const CATEGORIES: { id: GameCategory | 'all'; label: string }[] = [
  { id: 'all', label: 'All Games' },
  { id: 'slots', label: 'Slots' },
  { id: 'table', label: 'Table' },
  { id: 'poker', label: 'Poker' },
  { id: 'instant', label: 'Instant' },
];

/**
 * The slots, generated from the engine catalogue so the lobby cannot advertise
 * a game the server does not have — or miss one it does.
 */
const SLOT_SUMMARIES: GameSummary[] = SLOT_GAMES.map((slot) => ({
  id: slot.id,
  name: slot.name,
  category: 'slots' as const,
  rtp: slot.rtp,
  minBet: slot.minBet,
  maxBet: slot.maxBet,
  accent: slot.theme.secondary,
  ...(slot.tag && slot.tag !== 'mega' ? { tag: slot.tag } : {}),
}));

/** Table and instant games, which are hand-built rather than catalogue-driven. */
const OTHER_GAMES: GameSummary[] = [
  {
    id: 'juwa-blackjack',
    name: 'Blackjack',
    category: 'table',
    rtp: 0.995,
    minBet: 100,
    maxBet: 100_000,
    accent: '#22C55E',
  },
  {
    id: 'juwa-roulette-eu',
    name: 'European Roulette',
    category: 'table',
    rtp: 36 / 37,
    minBet: 50,
    maxBet: 500_000,
    accent: '#DC2626',
  },
  // The "originals" — the instant games. Every one has a finished, tested
  // engine on the server; what they are waiting on is a renderer each, so they
  // sit greyed out in the lobby alongside the genuinely unbuilt tiles below.
  //
  // All five carry a 1% house edge, which is thinner than anything else in the
  // catalogue. That is not generosity: this is the category players compare
  // sites on, and they check. See packages/engine/src/games/instant-math.ts.
  {
    id: 'juwa-crash',
    name: 'Crash',
    category: 'instant',
    rtp: 0.99,
    minBet: 50,
    maxBet: 500_000,
    accent: '#F97316',
    tag: 'new',
  },
  {
    id: 'juwa-limbo',
    name: 'Limbo',
    category: 'instant',
    rtp: 0.99,
    minBet: 50,
    maxBet: 500_000,
    accent: '#06B6D4',
    tag: 'new',
  },
  {
    id: 'juwa-dice',
    name: 'Dice',
    category: 'instant',
    rtp: 0.99,
    minBet: 50,
    maxBet: 500_000,
    accent: '#A3E635',
    tag: 'new',
  },
  {
    id: 'juwa-plinko',
    name: 'Plinko',
    category: 'instant',
    rtp: 0.99,
    minBet: 50,
    maxBet: 500_000,
    accent: '#E879F9',
    tag: 'new',
  },
  {
    id: 'juwa-mines',
    name: 'Mines',
    category: 'instant',
    rtp: 0.99,
    minBet: 50,
    maxBet: 500_000,
    accent: '#38BDF8',
    tag: 'new',
  },
  // Not yet built. Greyed out in the lobby so the shape of the finished product
  // is visible from day one. Each needs an engine plus a screen — see
  // docs/04-adding-a-game.md.
  {
    id: 'juwa-holdem',
    name: "Texas Hold'em",
    category: 'poker',
    rtp: 0.97,
    minBet: 200,
    maxBet: 200_000,
    accent: '#8B5CF6',
    multiplayer: true,
  },
  {
    id: 'juwa-video-poker',
    name: 'Jacks or Better',
    category: 'poker',
    rtp: 0.9954,
    minBet: 25,
    maxBet: 25_000,
    accent: '#00E5FF',
  },
  {
    id: 'juwa-scratch',
    name: 'Golden Scratch',
    category: 'instant',
    rtp: 0.95,
    minBet: 100,
    maxBet: 10_000,
    accent: '#FF2E88',
    tag: 'jackpot',
  },
];

/**
 * Every tile in the lobby, playable or not.
 *
 * Three states are mixed here, and the distinction matters when reading the
 * list:
 *
 *  - **Playable** — engine and renderer both shipped. Listed in `PLAYABLE`.
 *  - **Engine only** — the five instant games. The server can settle a round
 *    today; there is no screen to play it on yet. Greyed out.
 *  - **Neither** — poker and scratch. Placeholders, so the shape of the
 *    finished product is visible from day one.
 *
 * Adding either missing half is documented in docs/04-adding-a-game.md.
 */
export const GAMES: GameSummary[] = [...SLOT_SUMMARIES, ...OTHER_GAMES];

/** Theme and reel geometry for a slot, or undefined for a non-slot. */
export function slotDetails(id: string): SlotGame | undefined {
  return SLOT_GAMES.find((game) => game.id === id);
}

/** The paytable behind a game, or undefined for a non-slot. */
export function slotPaytable(id: string): SlotModelInfo | undefined {
  const game = slotDetails(id);
  return game ? SLOT_MODEL_INFO[game.model] : undefined;
}

/**
 * Games with a shipped renderer.
 *
 * Every slot in the catalogue is playable: they share one screen driven by the
 * game's own config, so there is nothing per-game left to build.
 */
export const PLAYABLE = new Set<string>([
  ...SLOT_GAMES.map((game) => game.id),
  'juwa-blackjack',
  'juwa-roulette-eu',
]);

export function gamesInCategory(category: GameCategory | 'all'): GameSummary[] {
  return category === 'all' ? GAMES : GAMES.filter((g) => g.category === category);
}
