/**
 * The GC <-> CC conversion endpoints.
 *
 * Three audiences and three sections: what a PLAYER can do with their own
 * session (see their two balances and the rate, raise a request, cancel one),
 * what an AGENT can do (see the queue addressed to them, approve, reject, buy
 * inventory with CC), and what an OPERATOR can do from the console (set rates,
 * hand out CC, adjust a balance by hand).
 *
 * ## The rule this file inherits
 *
 * Identity comes from the verified token and never from the request body. There
 * is no route here that accepts a `playerId` or an `agentId` from a caller
 * authenticated as that role — the player routes are scoped to
 * `ctx.player.playerId` and the agent routes resolve the caller to an agent
 * record first. `agent-routes.ts` says the same thing at more length and for
 * the same reason.
 *
 * ## Why these checks are not the control
 *
 * `approve_conversion` re-checks the agent's status, the player's ownership,
 * the request's state and the inventory, inside the transaction that moves the
 * coins. What is here turns a Postgres exception into a sentence a person can
 * act on. If the two ever disagree, the database wins.
 */

import { randomUUID } from 'node:crypto';
import { ApiError, type AgentsDb, type ConversionsDb } from '@juwa/server';
import type { OperatorIdentity } from './admin.js';

/** The slice of the request context these routes use. */
export interface ConversionCtx {
  url: URL;
  body: Record<string, unknown>;
  player: { playerId: string };
}

/**
 * The largest single conversion, in CC.
 *
 * A typo guard rather than a policy — the balances are the policy, and the
 * database enforces those. This exists because the difference between 100 and
 * 100,000 is three keystrokes and an approved conversion has no undo.
 */
const MAX_CC_PER_REQUEST = 100_000;
/** And in GC, for the direction where the player names a GC figure. */
const MAX_GC_PER_REQUEST = 1_000_000_000;

/**
 * Turn a database exception into something a person can act on.
 *
 * Matching the message rather than the SQLSTATE in most cases, because 0014
 * raises `check_violation` for several genuinely different situations and the
 * player needs to be told which one. The codes are used where they are precise:
 * `insufficient_privilege` from `post_transfer` means one specific thing.
 */
export function conversionError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  const code = (error as { code?: string })?.code;
  const message = error instanceof Error ? error.message : '';

  if (/Insufficient funds/i.test(message)) {
    return new ApiError(
      'There are not enough coins to cover that. Check the balance and try again.',
      402,
      'insufficient_funds',
    );
  }
  if (/multiple of/i.test(message)) {
    // The rate is in the raw message and is the actionable part of it.
    return new ApiError(message, 400, 'not_a_whole_amount');
  }
  if (/already have a pending request/i.test(message) || code === '23505') {
    return new ApiError(
      'You already have a request of this kind waiting. Cancel it first, or wait for your agent.',
      409,
      'request_already_open',
    );
  }
  if (/is not pending for this agent/i.test(message)) {
    return new ApiError(
      'That request is not yours to settle, or it has already been settled.',
      409,
      'not_pending',
    );
  }
  if (/is not yours or is no longer pending/i.test(message)) {
    return new ApiError('That request is not yours, or it has already been settled.', 409, 'not_pending');
  }
  if (/do not have an agent/i.test(message)) {
    return new ApiError(
      'Conversions go through your agent, and your account is not linked to one.',
      403,
      'no_agent',
    );
  }
  if (/agent is not currently able|is not active/i.test(message)) {
    return new ApiError('Your agent cannot process conversions at the moment.', 403, 'agent_inactive');
  }
  if (/no longer belongs to agent/i.test(message)) {
    return new ApiError('That player is no longer one of yours.', 403, 'not_your_player');
  }
  if (/No exchange rate|No operator exchange rate/i.test(message)) {
    return new ApiError('No exchange rate is set up yet. Contact support.', 503, 'no_rate');
  }
  if (/Unknown agent/i.test(message) || code === 'P0002') {
    return new ApiError('No such agent.', 404, 'unknown_agent');
  }
  if (/append-only/i.test(message)) {
    return new ApiError('Rates cannot be edited. Set a new one instead.', 409, 'append_only');
  }
  if (/needs a reason/i.test(message)) {
    return new ApiError('An adjustment needs a reason.', 400, 'invalid_input');
  }
  if (/must be positive|must be non-zero|too small/i.test(message) || code === '23514') {
    return new ApiError('That is not a valid amount.', 400, 'invalid_input');
  }
  if (/invalid input syntax for type uuid/i.test(message) || code === '22P02') {
    return new ApiError('That is not a valid id.', 400, 'invalid_input');
  }
  if (code === '42501') return new ApiError('Not allowed.', 403, 'forbidden');
  return new ApiError('Internal error', 500, 'internal');
}

function wholeAmount(value: unknown, max: number, unit: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new ApiError(`amount must be a positive whole number of ${unit}`, 400, 'invalid_input');
  }
  if (value > max) {
    throw new ApiError(
      `A single conversion is capped at ${max.toLocaleString('en-US')} ${unit}.`,
      400,
      'amount_too_large',
    );
  }
  return value;
}

function requireId(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.trim() === '' || value.length > 64) {
    throw new ApiError(`${name} is required`, 400, 'invalid_input');
  }
  return value.trim();
}

function direction(value: unknown): 'gc_to_cc' | 'cc_to_gc' {
  if (value !== 'gc_to_cc' && value !== 'cc_to_gc') {
    throw new ApiError('direction must be gc_to_cc or cc_to_gc', 400, 'invalid_input');
  }
  return value;
}

// --------------------------------------------------------------- the routes

export function conversionRoutes(
  conversions: ConversionsDb,
  agents: AgentsDb,
): Record<string, (ctx: ConversionCtx) => Promise<unknown>> {
  const limit = (ctx: ConversionCtx, fallback: number, max: number) => {
    const raw = Number(ctx.url.searchParams.get('limit') ?? fallback);
    return Math.min(max, Math.max(1, Number.isFinite(raw) ? raw : fallback));
  };

  async function asActiveAgent(ctx: ConversionCtx) {
    const agent = await agents.agentStatus(ctx.player.playerId);
    if (!agent) throw new ApiError('Not found', 404, 'not_found');
    if (agent.status !== 'active') {
      throw new ApiError(
        agent.status === 'suspended'
          ? 'Your agent account is suspended.'
          : 'Your agent account has not been activated yet.',
        403,
        'agent_inactive',
      );
    }
    return agent;
  }

  return {
    // ----------------------------------------------------------- player

    /**
     * Everything the wallet needs in one call: both balances, the rate the
     * player is subject to, and their recent requests.
     *
     * One endpoint rather than three because the wallet screen shows all of it
     * at once, and three round trips on a phone means three chances for the
     * numbers on screen to disagree with each other for a second.
     */
    'GET /wallet': async (ctx) => {
      const agent = await agents.agentForPlayer(ctx.player.playerId);
      const [wallet, rates, requests] = await Promise.all([
        conversions.wallet(ctx.player.playerId),
        conversions.rates(agent?.agentId ?? null),
        conversions.playerRequests(ctx.player.playerId, limit(ctx, 25, 100)),
      ]);
      return {
        wallet,
        /*
         * Only the player-facing rate. The operator rate is the agent's
         * commercial term and has no business on a player's screen — showing
         * it would invite the reading that the difference is owed to them.
         */
        rate: rates.playerAgent,
        agent: agent ? { agentId: agent.agentId, displayName: agent.displayName } : null,
        requests,
      };
    },

    /**
     * Raise a conversion request. Moves nothing.
     *
     * The amount means GC for `gc_to_cc` and CC for `cc_to_gc` — the side the
     * player names is exact and the other is derived, so they are never
     * surprised by rounding. `request_conversion` refuses a GC figure that is
     * not a whole number of CC rather than rounding it.
     */
    'POST /wallet/convert': async (ctx) => {
      const dir = direction(ctx.body['direction']);
      const amount =
        dir === 'gc_to_cc'
          ? wholeAmount(ctx.body['amount'], MAX_GC_PER_REQUEST, 'GC')
          : wholeAmount(ctx.body['amount'], MAX_CC_PER_REQUEST, 'CC');
      try {
        return { request: await conversions.request(ctx.player.playerId, dir, amount) };
      } catch (error) {
        throw conversionError(error);
      }
    },

    /** Withdraw a request the agent has not answered yet. */
    'POST /wallet/convert/cancel': async (ctx) => {
      const requestId = requireId(ctx.body['requestId'], 'requestId');
      try {
        await conversions.cancel(requestId, ctx.player.playerId);
        return { ok: true };
      } catch (error) {
        throw conversionError(error);
      }
    },

    // ------------------------------------------------------------ agent

    /**
     * The agent's queue, plus their own two balances and both rates.
     *
     * The agent DOES see the operator rate — it is their own commercial term,
     * and they need it to decide whether to restock.
     */
    'GET /agent/conversions': async (ctx) => {
      const agent = await agents.agentStatus(ctx.player.playerId);
      if (!agent) throw new ApiError('Not found', 404, 'not_found');
      const status = ctx.url.searchParams.get('status');
      const [wallet, rates, requests, redemptions] = await Promise.all([
        conversions.agentWallet(agent.agentId),
        conversions.rates(agent.agentId),
        conversions.agentRequests(
          agent.agentId,
          status === 'all' || status === 'approved' || status === 'rejected'
            ? status
            : 'pending',
          limit(ctx, 100, 300),
        ),
        conversions.agentRedemptions(agent.agentId, 25),
      ]);
      return { wallet, rates, requests, redemptions };
    },

    'POST /agent/conversions/approve': async (ctx) => {
      const agent = await asActiveAgent(ctx);
      const requestId = requireId(ctx.body['requestId'], 'requestId');
      try {
        return { player: await conversions.approve(requestId, agent.agentId) };
      } catch (error) {
        throw conversionError(error);
      }
    },

    'POST /agent/conversions/reject': async (ctx) => {
      const agent = await asActiveAgent(ctx);
      const requestId = requireId(ctx.body['requestId'], 'requestId');
      const reason =
        typeof ctx.body['reason'] === 'string' ? ctx.body['reason'].slice(0, 300) : undefined;
      try {
        await conversions.reject(requestId, agent.agentId, reason);
        return { ok: true };
      } catch (error) {
        throw conversionError(error);
      }
    },

    /**
     * Agent -> operator: spend CC on GC inventory.
     *
     * The idempotency key is the agent's protection against a phone losing
     * signal mid-request, exactly as it is on `/agent/allocate`: retrying with
     * the same key redeems once.
     */
    'POST /agent/conversions/redeem': async (ctx) => {
      const agent = await asActiveAgent(ctx);
      const amount = wholeAmount(ctx.body['ccAmount'], MAX_CC_PER_REQUEST, 'CC');
      const key =
        typeof ctx.body['idempotencyKey'] === 'string'
          ? ctx.body['idempotencyKey'].slice(0, 100)
          : randomUUID();
      try {
        return await conversions.redeemAgentCc(agent.agentId, amount, key);
      } catch (error) {
        throw conversionError(error);
      }
    },
  };
}

// ------------------------------------------------------------- operator side

/**
 * The console's conversion controls.
 *
 * Separate from the table above for the same reason `handleAdminAgents` is
 * separate: these authenticate as an OPERATOR, not as a player, so they cannot
 * share a context type or a middleware with routes that resolve a player from a
 * Supabase token.
 *
 * Returns null when the route is not one of these, so the caller falls through
 * to its own 404 rather than this function swallowing unknown paths.
 */
export async function handleAdminConversions(
  route: string,
  url: URL,
  body: Record<string, unknown>,
  operator: OperatorIdentity,
  conversions: ConversionsDb,
): Promise<unknown | null> {
  if (route === 'GET /admin/rates') {
    return {
      current: await conversions.rates(null),
      history: await conversions.rateHistory(100),
      agents: await conversions.agentBalances(200),
    };
  }

  if (route === 'POST /admin/rates') {
    const tier = body['tier'];
    if (tier !== 'player_agent' && tier !== 'agent_operator') {
      throw new ApiError('tier must be player_agent or agent_operator', 400, 'invalid_input');
    }
    const gcPerCc = wholeAmount(body['gcPerCc'], 100_000_000, 'GC');
    const agentId = typeof body['agentId'] === 'string' ? body['agentId'] : null;
    const note = typeof body['note'] === 'string' ? body['note'].slice(0, 200) : null;
    try {
      const id = await conversions.setRate({
        tier,
        gcPerCc,
        operatorId: operator.operatorId,
        agentId,
        note,
      });
      return { id, current: await conversions.rates(agentId) };
    } catch (error) {
      throw conversionError(error);
    }
  }

  if (route === 'POST /admin/agents/cc') {
    const agentId = requireId(body['agentId'], 'agentId');
    const amount = wholeAmount(body['amount'], MAX_CC_PER_REQUEST, 'CC');
    const key = typeof body['idempotencyKey'] === 'string' ? body['idempotencyKey'] : randomUUID();
    try {
      return {
        cc: await conversions.grantCc({
          agentId,
          amount,
          operatorId: operator.operatorId,
          idempotencyKey: key,
          // Spread rather than `: undefined`, because `exactOptionalPropertyTypes`
          // distinguishes "absent" from "present and undefined" and the target
          // only accepts the first.
          ...(typeof body['reference'] === 'string' ? { reference: body['reference'] } : {}),
        }),
      };
    } catch (error) {
      throw conversionError(error);
    }
  }

  if (route === 'POST /admin/adjust') {
    const ownerId = requireId(body['ownerId'], 'ownerId');
    const kind = body['kind'];
    if (kind !== 'player' && kind !== 'agent') {
      throw new ApiError('kind must be player or agent', 400, 'invalid_input');
    }
    const currency = body['currency'];
    if (currency !== 'GC' && currency !== 'CC') {
      throw new ApiError('currency must be GC or CC', 400, 'invalid_input');
    }
    const delta = body['delta'];
    if (typeof delta !== 'number' || !Number.isInteger(delta) || delta === 0) {
      throw new ApiError('delta must be a non-zero whole number', 400, 'invalid_input');
    }
    const reason = typeof body['reason'] === 'string' ? body['reason'].trim() : '';
    if (!reason) throw new ApiError('An adjustment needs a reason.', 400, 'invalid_input');

    try {
      return {
        balance: await conversions.adjust({
          ownerId,
          kind,
          currency,
          delta,
          operatorId: operator.operatorId,
          reason: reason.slice(0, 300),
        }),
      };
    } catch (error) {
      throw conversionError(error);
    }
  }

  return null;
}
