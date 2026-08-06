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
 * Slots skip all three: they share one engine driven by a config object, so a
 * new slot is an entry in `SLOT_CATALOGUE` and nothing else. That is the whole
 * point of the catalogue — twenty games cannot each carry their own settlement
 * bug if none of them carries its own settlement code.
 *
 * Steps 1 and 2 are hours of work. Step 3 is where the real time goes, which is
 * exactly the right shape: the risky part (money, fairness, settlement) is
 * shared and tested once, and the per-game work is presentation.
 */

import { BlackjackEngine } from './blackjack.js';
import { CrashEngine, LimboEngine } from './crash.js';
import { DiceEngine } from './dice.js';
import { MinesEngine } from './mines.js';
import { PlinkoEngine } from './plinko.js';
import { RouletteEngine } from './roulette.js';
import { allSlotEngines } from './slots.js';
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

for (const slot of allSlotEngines()) register(slot);
register(new RouletteEngine());
register(new BlackjackEngine());

// The "originals" — the instant games. Player-chosen odds, 1% edge on every
// one of them, and no third-party licence behind any of them.
register(new CrashEngine());
register(new LimboEngine());
register(new DiceEngine());
register(new PlinkoEngine());
register(new MinesEngine());
