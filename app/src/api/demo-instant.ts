/**
 * The instant games, faked on the device for demo mode.
 *
 * ⚠️ Everything here uses `Math.random()`. There is no commitment, no seed to
 * reveal, no ledger, and nothing about it is provably fair. It exists so the
 * five screens can be built and driven without standing up Postgres, exactly
 * like the fake slot grids next door in `client.ts`. It is selected only when
 * `EXPO_PUBLIC_API_URL` is unset.
 *
 * What is NOT faked is the maths. Every multiplier below comes from
 * `@juwa/economy`, which is the same module the server settles with — so a
 * demo Dice bet at 50.00 quotes and pays the identical 1.9803x the real one
 * would. That matters more than it sounds: these screens show the player their
 * odds *before* they bet, and a demo whose payouts disagree with its own
 * on-screen numbers teaches whoever is evaluating this app that the numbers
 * cannot be trusted.
 */

import {
  DEFAULT_HOUSE_EDGE,
  DICE_OUTCOMES,
  DISPLAY_SCALE,
  MAX_MULTIPLIER,
  MINES_TILES,
  diceMultiplier,
  minesMaxReveals,
  minesMultiplier,
  plinkoTable,
  truncate2,
  type PlinkoRisk,
  type PlinkoRows,
} from '@juwa/economy';

export const INSTANT_GAME_IDS = [
  'juwa-crash',
  'juwa-limbo',
  'juwa-dice',
  'juwa-plinko',
  'juwa-mines',
] as const;

export function isInstantGame(gameId: string): boolean {
  return (INSTANT_GAME_IDS as readonly string[]).includes(gameId);
}

/** The same 1/(1-r) tail the engine draws, on an untrustworthy source. */
function demoCrashPoint(): number {
  const raw = (1 - DEFAULT_HOUSE_EDGE) / (1 - Math.random());
  if (raw >= MAX_MULTIPLIER) return MAX_MULTIPLIER;
  return Math.max(1, truncate2(raw));
}

export interface DemoRound {
  status: 'awaiting-action' | 'settled';
  state: unknown;
  availableActions: string[];
  payout: number;
  multiplier: number;
}

/**
 * Mines rounds in flight.
 *
 * Held here rather than in the screen because the round survives across
 * several requests, which is exactly the shape the real server has. Keyed by
 * round id and never cleaned up — a demo session is short, and a Map that
 * grows by one entry per round is not a leak worth code.
 */
const minesRounds = new Map<
  string,
  { mines: number; order: number[]; revealed: number[]; stake: number }
>();

function shuffled(n: number): number[] {
  const out = Array.from({ length: n }, (_, i) => i);
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j]!, out[i]!];
  }
  return out;
}

/** Open a round. Four of the five settle immediately; Mines stays open. */
export function demoPlaceBet(
  gameId: string,
  stake: number,
  roundId: string,
  action?: { type: string; [key: string]: unknown },
): DemoRound {
  switch (gameId) {
    case 'juwa-crash':
    case 'juwa-limbo': {
      const target = Number(action?.['target'] ?? 2);
      const point = demoCrashPoint();
      const won = point >= target;
      const payout = won ? Math.floor(stake * target) : 0;
      const state =
        gameId === 'juwa-crash'
          ? { crashPoint: point, target, cashedOut: won }
          : { result: point, target, won };
      return { status: 'settled', state, availableActions: [], payout, multiplier: won ? target : 0 };
    }

    case 'juwa-dice': {
      const target = Number(action?.['target'] ?? 50);
      const direction = (action?.['direction'] as 'over' | 'under') ?? 'over';
      const multiplier = diceMultiplier(target, direction);
      const roll = Math.floor(Math.random() * DICE_OUTCOMES) / DISPLAY_SCALE;
      const won = direction === 'over' ? roll > target : roll < target;
      return {
        status: 'settled',
        state: { roll, target, direction, multiplier, won },
        availableActions: [],
        payout: won ? Math.floor(stake * multiplier) : 0,
        multiplier: won ? multiplier : 0,
      };
    }

    case 'juwa-plinko': {
      const rows = (Number(action?.['rows'] ?? 16) as PlinkoRows);
      const risk = ((action?.['risk'] as PlinkoRisk) ?? 'medium');
      const table = plinkoTable(rows, risk);
      const path: ('L' | 'R')[] = [];
      let bucket = 0;
      for (let r = 0; r < rows; r++) {
        const right = Math.random() < 0.5;
        path.push(right ? 'R' : 'L');
        if (right) bucket++;
      }
      const multiplier = table[bucket]!;
      return {
        status: 'settled',
        state: { rows, risk, path, bucket, multiplier, table },
        availableActions: [],
        // Plinko has no losing bucket: the worst outcome returns part of the
        // stake rather than none of it.
        payout: Math.floor(stake * multiplier),
        multiplier,
      };
    }

    case 'juwa-mines': {
      const mines = Math.max(1, Math.min(MINES_TILES - 1, Number(action?.['mines'] ?? 3)));
      minesRounds.set(roundId, { mines, order: shuffled(MINES_TILES), revealed: [], stake });
      return {
        status: 'awaiting-action',
        state: {
          mines,
          revealed: [],
          multiplier: 0,
          nextMultiplier: minesMultiplier(mines, 1),
          minePositions: [],
          bust: false,
          maxReveals: minesMaxReveals(mines),
        },
        availableActions: ['reveal'],
        payout: 0,
        multiplier: 0,
      };
    }

    default:
      throw new Error(`Not an instant game: ${gameId}`);
  }
}

/** Continue a Mines round. The only instant game with more than one step. */
export function demoAct(
  roundId: string,
  action: { type: string; [key: string]: unknown },
): DemoRound {
  const round = minesRounds.get(roundId);
  if (!round) throw new Error('Unknown round');
  const { mines, order, stake } = round;
  const minePositions = order.slice(0, mines);
  const safeTiles = MINES_TILES - mines;
  const cap = Math.min(safeTiles, minesMaxReveals(mines));

  const settle = (multiplier: number, extra: Record<string, unknown>): DemoRound => ({
    status: 'settled',
    state: {
      mines,
      revealed: round.revealed,
      multiplier,
      nextMultiplier: 0,
      minePositions,
      maxReveals: cap,
      bust: false,
      ...extra,
    },
    availableActions: [],
    payout: Math.floor(stake * multiplier),
    multiplier,
  });

  if (action.type === 'cashout') {
    return settle(minesMultiplier(mines, round.revealed.length), {});
  }

  const tile = Number(action['tile']);
  if (minePositions.includes(tile)) {
    return { ...settle(0, { bust: true }), payout: 0, multiplier: 0 };
  }

  round.revealed = [...round.revealed, tile];
  const multiplier = minesMultiplier(mines, round.revealed.length);
  if (round.revealed.length >= cap) return settle(multiplier, {});

  return {
    status: 'awaiting-action',
    state: {
      mines,
      revealed: round.revealed,
      multiplier,
      nextMultiplier: minesMultiplier(mines, round.revealed.length + 1),
      minePositions: [],
      bust: false,
      maxReveals: cap,
    },
    availableActions: ['reveal', 'cashout'],
    payout: 0,
    multiplier: 0,
  };
}
