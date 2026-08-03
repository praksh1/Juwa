/**
 * The play handlers.
 *
 * THE ONE RULE: outcomes are computed here, on the server, from a seed the
 * player cannot see. The client sends "I want to bet 2,000 on slots" and
 * receives "here is the grid, you won 5,000". It never sends an outcome, and
 * nothing it sends is trusted beyond a stake and an action name.
 */

import { minor, type Minor } from '@juwa/money';
import {
  BetLimitError,
  IllegalActionError,
  RngStream,
  createServerSeed,
  getGame,
  hashSeed,
  toClientView,
  type GameEngine,
  type RoundState,
} from '@juwa/engine';
import {
  MAX_STREAK_DAY,
  TOP_UP,
  WELCOME_BONUS,
  canTopUp,
  dailyBonus,
  evaluateClaim,
  tierForXp,
} from '@juwa/economy';
import type { Db } from './db.js';
import {
  ApiError,
  errors,
  type ActRequest,
  type BalanceResponse,
  type FairnessProof,
  type PlaceBetRequest,
  type PlayerContext,
  type RoundResponse,
} from './types.js';

/** Days since the Unix epoch, in the player's timezone. */
export function localDayNumber(date: Date, utcOffsetMinutes: number): number {
  return Math.floor((date.getTime() + utcOffsetMinutes * 60_000) / 86_400_000);
}

export function localDateString(date: Date, utcOffsetMinutes: number): string {
  return new Date(date.getTime() + utcOffsetMinutes * 60_000).toISOString().slice(0, 10);
}

function engineFor(gameId: string): GameEngine<unknown, unknown, unknown> {
  try {
    return getGame(gameId);
  } catch {
    throw errors.unknownGame(gameId);
  }
}

/**
 * Translate engine and database exceptions into API errors the client can act
 * on.
 *
 * The balance and stake are parsed back out of the Postgres message rather than
 * defaulted to zero, because the app uses them: "you need 1,500 more coins" is
 * a useful message with a clear next step, and "insufficient funds" is not.
 */
function rethrow(error: unknown): never {
  if (error instanceof BetLimitError) throw errors.badStake(error.message);
  if (error instanceof IllegalActionError) throw errors.illegalAction(error.message);

  if (error instanceof Error) {
    const shortfall = /Insufficient funds: balance (-?\d+), requested (-?\d+)/i.exec(error.message);
    if (shortfall) {
      throw errors.insufficientFunds(Number(shortfall[1]), Number(shortfall[2]));
    }
    if (/Insufficient funds/i.test(error.message)) {
      throw new ApiError(error.message, 402, 'insufficient_funds');
    }
  }
  throw error;
}

/**
 * Shape an engine state into an API response.
 *
 * `toClientView` is what strips the private half of the round; this only
 * renames its `public` field to `state`, which is the name the API contract
 * uses. Going through one helper means there is exactly one place where a
 * round becomes a response, so private data cannot leak via a hand-rolled
 * spread that forgets to strip it.
 */
function clientRound(
  roundId: string,
  gameId: string,
  state: RoundState<unknown, unknown>,
  balance: number,
  fairness: RoundResponse['fairness'],
): RoundResponse {
  const view = toClientView(state);
  return {
    roundId,
    gameId,
    status: view.status,
    state: view.public,
    availableActions: view.availableActions,
    ...(view.settlement ? { settlement: view.settlement } : {}),
    balance: minor(balance),
    fairness,
  };
}

// --------------------------------------------------------------- place a bet

export async function placeBet(
  db: Db,
  ctx: PlayerContext,
  request: PlaceBetRequest,
): Promise<RoundResponse> {
  const engine = engineFor(request.gameId);

  if (!Number.isSafeInteger(request.stake) || request.stake <= 0) {
    throw errors.badStake(`Stake must be a positive whole number of coins`);
  }

  // Step 1: claim a nonce. Moves no money, so a crash here is harmless — it
  // burns a nonce and nothing else.
  const seed = await db.reserveNonce(ctx.playerId, createServerSeed());

  // Step 2: run the engine. Pure, deterministic, reproducible from the seed.
  const rng = new RngStream(seed.serverSeed, seed.clientSeed, seed.nonce);
  let state: RoundState<unknown, unknown>;
  try {
    state = engine.init(minor(request.stake), rng);

    // Roulette and friends need the bet layout before the wheel turns, so the
    // opening action is applied in the same request.
    if (state.status === 'awaiting-action' && request.action) {
      state = engine.act(state, request.action, rng);
    }
  } catch (error) {
    rethrow(error);
  }

  const fairness = {
    serverSeedHash: seed.serverSeedHash,
    clientSeed: seed.clientSeed,
    nonce: seed.nonce,
  };

  // Step 3: one transaction — debit the stake, credit any payout, record the
  // round. Either all of it happens or none of it does.
  try {
    if (state.status === 'settled') {
      const settlement = state.settlement!;
      const { roundId, balance } = await db.playInstantRound({
        playerId: ctx.playerId,
        gameId: engine.id,
        seedPairId: seed.seedPairId,
        nonce: seed.nonce,
        stake: settlement.stake,
        payout: settlement.payout,
        currency: ctx.currency,
        state,
        idempotencyKey: request.idempotencyKey,
      });
      return clientRound(roundId, engine.id, state, balance, fairness);
    }

    const { roundId, balance } = await db.openRound({
      playerId: ctx.playerId,
      gameId: engine.id,
      seedPairId: seed.seedPairId,
      nonce: seed.nonce,
      stake: request.stake,
      currency: ctx.currency,
      state,
      idempotencyKey: request.idempotencyKey,
    });
    return clientRound(roundId, engine.id, state, balance, fairness);
  } catch (error) {
    rethrow(error);
  }
}

// ------------------------------------------------------------- act on a round

export async function act(
  db: Db,
  ctx: PlayerContext,
  request: ActRequest,
): Promise<RoundResponse> {
  const stored = await db.getRound(request.roundId);
  if (!stored) throw errors.unknownRound(request.roundId);
  // A player may only act on their own round. Without this check the round id
  // alone would be enough to play someone else's hand.
  if (stored.playerId !== ctx.playerId) throw errors.unknownRound(request.roundId);
  if (stored.status !== 'open') throw errors.roundClosed(request.roundId);

  const engine = engineFor(stored.gameId);
  const fairnessRow = await db.getRoundFairness(request.roundId);
  if (!fairnessRow) throw errors.unknownRound(request.roundId);

  // A fresh stream at the same nonce, which restarts from the beginning of the
  // sequence `init` already consumed.
  //
  // That is safe *because* multi-step engines are required to materialise all
  // their randomness during `init` — blackjack shuffles the entire 312-card shoe
  // up front and stores it in `private`, so `hit` pops a card rather than
  // drawing entropy. See the contract note in @juwa/engine's `GameEngine`.
  //
  // An engine that pulled fresh randomness inside `act` would silently replay
  // the same values here. `games.test.ts` guards the rule.
  const rng = new RngStream(
    fairnessRow.serverSeed,
    fairnessRow.clientSeed,
    fairnessRow.nonce,
  );

  const before = stored.state as RoundState<unknown, unknown>;
  const stakeBefore = totalStake(before, stored.stake);

  let after: RoundState<unknown, unknown>;
  try {
    after = engine.act(before, request.action, rng);
  } catch (error) {
    rethrow(error);
  }

  const fairness = {
    serverSeedHash: fairnessRow.serverSeedHash,
    clientSeed: fairnessRow.clientSeed,
    nonce: fairnessRow.nonce,
  };

  if (after.status === 'settled') {
    const settlement = after.settlement!;
    // A double or a split raised the exposure mid-hand; charge the difference
    // now, at settlement, so the ledger's `stake` matches what was really risked.
    const extra = settlement.stake - stakeBefore;
    if (extra > 0) {
      await db.updateRound({
        roundId: request.roundId,
        state: after,
        additionalStake: extra,
        idempotencyKey: `${request.idempotencyKey}:stake`,
      });
    }
    const balance = await db.settleRound({
      roundId: request.roundId,
      payout: settlement.payout,
      state: after,
      idempotencyKey: `${request.idempotencyKey}:payout`,
    });
    return clientRound(request.roundId, stored.gameId, after, balance, fairness);
  }

  const extra = totalStake(after, stored.stake) - stakeBefore;
  const balance = await db.updateRound({
    roundId: request.roundId,
    state: after,
    ...(extra > 0 ? { additionalStake: extra } : {}),
    idempotencyKey: `${request.idempotencyKey}:stake`,
  });

  return clientRound(request.roundId, stored.gameId, after, balance, fairness);
}

/** Sum the stakes across every hand — blackjack splits create more than one. */
function totalStake(state: RoundState<unknown, unknown>, fallback: number): number {
  const pub = state.public as { hands?: { stake: number }[] } | undefined;
  if (pub?.hands && Array.isArray(pub.hands)) {
    return pub.hands.reduce((sum, hand) => sum + hand.stake, 0);
  }
  return fallback;
}

// ------------------------------------------------------------------- balance

export async function getBalance(db: Db, ctx: PlayerContext): Promise<BalanceResponse> {
  const player = await db.getPlayer(ctx.playerId);
  if (!player) throw errors.notFound('Player');
  return {
    balance: minor(player.balance),
    currency: ctx.currency,
    vipLevel: tierForXp(player.lifetimeWagered).level,
    lifetimeWagered: player.lifetimeWagered,
    dailyStreak: player.dailyStreak,
  };
}

// -------------------------------------------------------------- free coins

export interface BonusResult {
  granted: boolean;
  coins: Minor;
  streakDay: number;
  balance: Minor;
  reason?: string;
}

export async function claimDailyBonus(
  db: Db,
  ctx: PlayerContext,
  now: Date,
  utcOffsetMinutes: number,
): Promise<BonusResult> {
  const player = await db.getPlayer(ctx.playerId);
  if (!player) throw errors.notFound('Player');

  const today = localDayNumber(now, utcOffsetMinutes);
  const lastDay = player.lastBonusDate
    ? Math.floor(Date.parse(`${player.lastBonusDate}T00:00:00Z`) / 86_400_000)
    : null;

  const { canClaim, newStreak } = evaluateClaim(lastDay, today, player.dailyStreak);
  if (!canClaim) {
    return {
      granted: false,
      coins: minor(0),
      streakDay: player.dailyStreak,
      balance: minor(player.balance),
      reason: 'Already claimed today',
    };
  }

  const vip = tierForXp(player.lifetimeWagered);
  const coins = dailyBonus(Math.min(newStreak, MAX_STREAK_DAY), vip.dailyBonusMultiplier);
  const grantDate = localDateString(now, utcOffsetMinutes);

  const balance = await db.grantBonus({
    playerId: ctx.playerId,
    kind: 'daily',
    coins,
    streakDay: newStreak,
    grantDate,
    // Keyed by date, so a double-tap on a slow connection cannot claim twice.
    idempotencyKey: `daily:${ctx.playerId}:${grantDate}`,
  });

  return { granted: true, coins, streakDay: newStreak, balance: minor(balance) };
}

export async function claimTopUp(
  db: Db,
  ctx: PlayerContext,
  now: Date,
  utcOffsetMinutes: number,
  minutesSinceLast: number | null,
  claimsToday: number,
): Promise<BonusResult> {
  const player = await db.getPlayer(ctx.playerId);
  if (!player) throw errors.notFound('Player');

  if (!canTopUp(minor(player.balance), minutesSinceLast, claimsToday)) {
    return {
      granted: false,
      coins: minor(0),
      streakDay: player.dailyStreak,
      balance: minor(player.balance),
      reason:
        player.balance >= TOP_UP.thresholdCoins
          ? 'You still have coins to play with'
          : 'Top-up not available yet',
    };
  }

  const grantDate = localDateString(now, utcOffsetMinutes);
  const balance = await db.grantBonus({
    playerId: ctx.playerId,
    kind: 'top_up',
    coins: TOP_UP.amountCoins,
    streakDay: null,
    grantDate,
    idempotencyKey: `topup:${ctx.playerId}:${grantDate}:${claimsToday}`,
  });

  return {
    granted: true,
    coins: TOP_UP.amountCoins,
    streakDay: player.dailyStreak,
    balance: minor(balance),
  };
}

export async function grantWelcomeBonus(
  db: Db,
  ctx: PlayerContext,
  now: Date,
  utcOffsetMinutes: number,
): Promise<BonusResult> {
  const grantDate = localDateString(now, utcOffsetMinutes);
  const balance = await db.grantBonus({
    playerId: ctx.playerId,
    kind: 'welcome',
    coins: WELCOME_BONUS,
    streakDay: null,
    grantDate,
    idempotencyKey: `welcome:${ctx.playerId}`,
  });
  return { granted: true, coins: WELCOME_BONUS, streakDay: 0, balance: minor(balance) };
}

// -------------------------------------------------------------- fairness

/**
 * Re-run a historical round from its revealed seed and confirm the recorded
 * payout is what the engine actually produces.
 *
 * This is the promise made good. A player runs the same calculation themselves
 * and compares; if the two ever disagree, the operator is caught.
 */
export async function verifyRound(db: Db, roundId: string): Promise<FairnessProof> {
  const row = await db.getRoundFairness(roundId);
  if (!row) throw errors.unknownRound(roundId);

  // The seed is only disclosed once it has been rotated out. Until then a
  // player could use it to predict every remaining round.
  const disclosable = row.revealed ? row.serverSeed : null;

  let verified = false;
  if (disclosable) {
    if (hashSeed(disclosable) !== row.serverSeedHash) {
      // The revealed seed does not match the commitment shown before play.
      verified = false;
    } else {
      const engine = engineFor(row.gameId);
      const rng = new RngStream(disclosable, row.clientSeed, row.nonce);
      try {
        const replayed = engine.init(minor(row.stake), rng);
        verified = replayed.settlement?.payout === row.payout;
      } catch {
        verified = false;
      }
    }
  }

  return {
    serverSeed: disclosable,
    serverSeedHash: row.serverSeedHash,
    clientSeed: row.clientSeed,
    nonce: row.nonce,
    gameId: row.gameId,
    stake: row.stake,
    payout: row.payout,
    verified,
  };
}

export async function rotateSeed(db: Db, ctx: PlayerContext, clientSeed?: string) {
  const fresh = createServerSeed();
  const revealed = await db.rotateSeed(ctx.playerId, {
    ...fresh,
    ...(clientSeed ? { clientSeed } : {}),
  });
  return {
    revealed,
    next: { serverSeedHash: fresh.serverSeedHash },
  };
}
