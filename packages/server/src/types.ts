/**
 * The play API.
 *
 * This is the boundary between the app and the game engines. Everything the
 * client is allowed to know is in these types; everything it must not know
 * (the shoe, the hole card, the unrevealed server seed) is deliberately absent.
 *
 * The handlers below are plain functions over a `Db` interface rather than HTTP
 * routes, which keeps them testable and portable. Wiring them to Supabase Edge
 * Functions, Express, or anything else is a thin adapter — see `http.ts`.
 */

import type { Minor } from '@juwa/money';
import type { RoundStatus, Settlement } from '@juwa/engine';

export interface PlayerContext {
  playerId: string;
  currency: 'GC';
}

// ------------------------------------------------------------------ requests

export interface PlaceBetRequest {
  gameId: string;
  stake: number;
  /**
   * Supplied by the client and echoed back. A retried request with the same key
   * returns the original outcome instead of charging the player twice — the
   * difference between a flaky connection and a support ticket.
   */
  idempotencyKey: string;
  /** Bet layout for games that need one before the wheel turns (roulette). */
  action?: { type: string; [key: string]: unknown };
  /**
   * Operator ceiling on this round's payout, as a multiple of the stake.
   *
   * Passed in per bet rather than read here, because policy belongs to the
   * caller and the engine must stay pure — an engine that consulted a database
   * could not be replayed to verify a past round.
   */
  maxWinMultiplier?: number | null;
}

export interface ActRequest {
  roundId: string;
  action: { type: string; [key: string]: unknown };
  idempotencyKey: string;
}

// ----------------------------------------------------------------- responses

export interface RoundResponse {
  roundId: string;
  gameId: string;
  status: RoundStatus;
  /** Public game state only. Private state never crosses this boundary. */
  state: unknown;
  availableActions: string[];
  settlement?: Settlement;
  /** The player's balance after this call, so the UI never has to guess. */
  balance: Minor;
  /** Proof material: the commitment, plus which nonce produced this round. */
  fairness: {
    serverSeedHash: string;
    clientSeed: string;
    nonce: number;
  };
}

export interface BalanceResponse {
  balance: Minor;
  currency: 'GC';
  vipLevel: number;
  lifetimeWagered: number;
  dailyStreak: number;
  /** True once today's free coins have been taken, in the player's own day. */
  bonusClaimedToday: boolean;
}

export interface FairnessProof {
  /** Only present once the seed has been rotated and revealed. */
  serverSeed: string | null;
  serverSeedHash: string;
  clientSeed: string;
  nonce: number;
  gameId: string;
  stake: number;
  payout: number;
  /**
   * True when re-running the engine from the revealed seed reproduces the
   * recorded payout exactly. This is the whole promise, checked server-side so
   * a player can compare it against their own independent calculation.
   */
  verified: boolean;
}

// --------------------------------------------------------------------- errors

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export const errors = {
  insufficientFunds: (balance: number, stake: number) =>
    new ApiError(
      `Not enough coins: balance ${balance}, stake ${stake}`,
      402,
      'insufficient_funds',
    ),
  unknownGame: (id: string) => new ApiError(`Unknown game: ${id}`, 404, 'unknown_game'),
  unknownRound: (id: string) => new ApiError(`Unknown round: ${id}`, 404, 'unknown_round'),
  roundClosed: (id: string) => new ApiError(`Round ${id} is already settled`, 409, 'round_closed'),
  illegalAction: (message: string) => new ApiError(message, 400, 'illegal_action'),
  badStake: (message: string) => new ApiError(message, 400, 'bad_stake'),
  notFound: (what: string) => new ApiError(`${what} not found`, 404, 'not_found'),
};
