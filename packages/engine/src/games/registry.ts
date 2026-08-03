/**
 * The game registry.
 *
 * This is the "add as many games as possible" machinery. The API layer never
 * imports a specific game — it looks one up here by id. Shipping a new game is:
 *
 *   1. Write `games/<name>.ts` implementing `GameEngine`.
 *   2. Add one line to `GAMES` below.
 *   3. Build the client-side renderer for it.
 *
 * Steps 1 and 2 are hours of work. Step 3 is where the real time goes, which is
 * exactly the right shape: the risky part (money, fairness, settlement) is
 * shared and tested once, and the per-game work is presentation.
 */

import { BlackjackEngine } from './blackjack.js';
import { RouletteEngine } from './roulette.js';
import { SlotsEngine } from './slots.js';
import type { GameEngine, GameId } from './types.js';

const GAMES = new Map<GameId, GameEngine<any, any, any>>();

export function register(engine: GameEngine<any, any, any>): void {
  if (GAMES.has(engine.id)) throw new Error(`Duplicate game id: ${engine.id}`);
  GAMES.set(engine.id, engine);
}

export function getGame(id: GameId): GameEngine<any, any, any> {
  const engine = GAMES.get(id);
  if (!engine) throw new Error(`Unknown game: ${id}`);
  return engine;
}

export function listGames(): GameEngine<any, any, any>[] {
  return [...GAMES.values()];
}

register(new SlotsEngine());
register(new RouletteEngine());
register(new BlackjackEngine());
