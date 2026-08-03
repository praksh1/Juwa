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

export type GameCategory = 'slots' | 'table' | 'live' | 'instant' | 'poker';

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
}

export const CATEGORIES: { id: GameCategory | 'all'; label: string }[] = [
  { id: 'all', label: 'All Games' },
  { id: 'slots', label: 'Slots' },
  { id: 'table', label: 'Table' },
  { id: 'poker', label: 'Poker' },
  { id: 'instant', label: 'Instant' },
];

export const GAMES: GameSummary[] = [
  {
    id: 'juwa-classic-slots',
    name: 'Juwa Classic',
    category: 'slots',
    rtp: 0.9625,
    minBet: 20,
    maxBet: 50_000,
    accent: '#D4AF37',
    tag: 'hot',
  },
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
  // Phase 4 placeholders — greyed out in the lobby so the shape of the finished
  // product is visible from day one.
  {
    id: 'juwa-holdem',
    name: "Texas Hold'em",
    category: 'poker',
    rtp: 0.97,
    minBet: 200,
    maxBet: 200_000,
    accent: '#8B5CF6',
    tag: 'new',
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
 * Games with a shipped *renderer*.
 *
 * Blackjack and roulette have finished, tested engines and are fully playable
 * through the API — they simply have no UI yet, so the lobby still shows them
 * as coming soon. Adding one is a screen, not a game.
 */
export const PLAYABLE = new Set(['juwa-classic-slots']);

export function gamesInCategory(category: GameCategory | 'all'): GameSummary[] {
  return category === 'all' ? GAMES : GAMES.filter((g) => g.category === category);
}
