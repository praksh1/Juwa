/**
 * The agent endpoints.
 *
 * Two audiences, two halves of this file. The top half is what an AGENT can do
 * with their own Supabase session — see their players, allocate coins, mint an
 * invitation. The bottom half is what an OPERATOR can do from the console —
 * create agents, activate and suspend them, hand them inventory, move a player
 * from one agent to another.
 *
 * ## The one rule that shapes everything here
 *
 * An agent's identity comes from the verified token and NEVER from the request.
 * Every query below is scoped by `ctx.player.playerId`, and there is no route
 * that accepts an `agentId` from an agent-authenticated caller. That is what
 * makes "agent A cannot touch agent B's players" true by construction rather
 * than by remembering to check.
 *
 * ## Why the database still refuses things this file already refused
 *
 * `allocate_to_player` re-checks the agent's status and the player's ownership
 * inside the transaction that moves the coins. The checks here exist to turn a
 * Postgres exception into a sentence a person can read; the checks there are
 * the actual control. If the two ever disagree, the database wins.
 *
 * ## What is deliberately absent
 *
 * There is no route for an agent to take coins back, to cash a player out, to
 * transfer inventory to another agent, or to change which agent a player
 * belongs to. Those are not missing features — a player who can send coins back
 * to an agent is a player who can be paid cash for them, and that is the line
 * between a social casino and a licensed one.
 */

import { randomUUID } from 'node:crypto';
import { ApiError, type AgentsDb } from '@juwa/server';
import {
  RESTRICTED_STATE_MESSAGE,
  WELCOME_BONUS,
  isKnownState,
  isRestrictedState,
} from '@juwa/economy';
import type { OperatorIdentity } from './admin.js';
import { SupabaseAdminError, type SupabaseAdmin } from './supabase-admin.js';

/** The slice of the request context these routes actually use. */
export interface AgentCtx {
  url: URL;
  body: Record<string, unknown>;
  player: { playerId: string };
}

/**
 * A single allocation ceiling, in coins.
 *
 * Not a policy about how much an agent may distribute — the inventory is that,
 * and the database enforces it. This is a typo guard: the difference between
 * 50,000 and 50,000,000 is three keystrokes, and an agent who empties their
 * whole inventory into one player by accident has no way to undo it, because
 * there is deliberately no path back.
 */
const MAX_SINGLE_ALLOCATION = 10_000_000;

/**
 * Turn a database exception into something a person can act on.
 *
 * The raw messages name UUIDs and internal function names. An agent reading
 * "Player 8f3c… does not belong to agent 21ab…" learns nothing they can use;
 * "That player is not one of yours" tells them they picked the wrong row.
 *
 * Matching on SQLSTATE first and message second, because the codes are chosen
 * deliberately in 0009 and the wording is not load-bearing.
 */
function agentError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  const code = (error as { code?: string })?.code;
  const message = error instanceof Error ? error.message : '';

  // Raised by post_transfer when the inventory will not cover it. Checked
  // before the generic 42501 case below, which shares the SQLSTATE.
  if (/Insufficient funds/i.test(message)) {
    return new ApiError(
      'Not enough coins in your inventory to cover that allocation.',
      402,
      'insufficient_inventory',
    );
  }
  if (/does not belong to agent/i.test(message)) {
    return new ApiError('That player is not one of yours.', 403, 'not_your_player');
  }
  if (/is not active/i.test(message)) {
    return new ApiError(
      'Your agent account is not active. Contact support before allocating.',
      403,
      'agent_inactive',
    );
  }
  if (/is suspended/i.test(message)) {
    return new ApiError('That agent is suspended.', 403, 'agent_suspended');
  }
  if (/Invitation is invalid/i.test(message)) {
    return new ApiError(
      'That invitation link is invalid, expired or already used.',
      403,
      'invite_invalid',
    );
  }
  if (/has already been reversed/i.test(message) || code === '23505') {
    return new ApiError('That allocation has already been reversed.', 409, 'already_reversed');
  }
  if (/Only an allocation can be reversed/i.test(message)) {
    return new ApiError(
      'Only an agent-to-player allocation can be reversed. Inventory grants cannot.',
      400,
      'not_reversible',
    );
  }
  if (/No such transaction/i.test(message)) {
    return new ApiError('No such transaction.', 404, 'not_found');
  }
  if (/Unknown agent/i.test(message) || code === 'P0002') {
    return new ApiError('No such agent.', 404, 'unknown_agent');
  }
  if (/No player named/i.test(message)) {
    return new ApiError(
      `${message}. Search for them above — this field takes the USERNAME they ` +
        `chose when they signed up (or the email on their account), and it ` +
        `promotes an account that already exists.`,
      404,
      'unknown_player',
    );
  }
  // A foreign key that does not resolve: an agent id or player id that is not
  // there. Distinguishing which would mean probing, and either way the operator
  // typed something wrong.
  if (code === '23503') {
    return new ApiError('That agent or player does not exist.', 404, 'not_found');
  }
  if (/invalid input syntax for type uuid/i.test(message) || code === '22P02') {
    return new ApiError('That is not a valid id.', 400, 'invalid_input');
  }
  /*
   * Registration failures, which reach here now that an AGENT can create an
   * account. They arrive as check_violation, the same SQLSTATE an allocation of
   * zero coins raises, so they have to be matched before the amount-shaped
   * fallback below — otherwise an agent entering a fifteen-year-old's date of
   * birth is told "the amount must be a positive whole number of coins".
   */
  if (/must be at least \d+ to play/i.test(message)) {
    return new ApiError(message, 403, 'age_gate');
  }
  if (/not able to open accounts in your state/i.test(message)) {
    return new ApiError(message, 403, 'restricted_region');
  }
  if (/Username must be|Date of birth is required|State of residence is required/i.test(message)) {
    return new ApiError(message, 400, 'invalid_input');
  }
  if (/Registration is not complete/i.test(message)) {
    return new ApiError(message, 403, 'registration_incomplete');
  }
  if (/Allocation must be positive|Transfer amount must be positive/i.test(message) || code === '23514') {
    return new ApiError('The amount must be a positive whole number of coins.', 400, 'invalid_input');
  }
  if (code === '42501') return new ApiError('Not allowed.', 403, 'forbidden');
  return new ApiError('Internal error', 500, 'internal');
}

/** Whole coins, positive, and not an accidental extra three zeros. */
function coinAmount(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    throw new ApiError('amount must be a positive whole number of coins', 400, 'invalid_input');
  }
  if (value > MAX_SINGLE_ALLOCATION) {
    throw new ApiError(
      `A single allocation is capped at ${MAX_SINGLE_ALLOCATION.toLocaleString('en-US')} coins.`,
      400,
      'amount_too_large',
    );
  }
  return value;
}

function requireString(value: unknown, name: string, max = 200): string {
  if (typeof value !== 'string' || value.trim() === '' || value.length > max) {
    throw new ApiError(`${name} is required`, 400, 'invalid_input');
  }
  return value.trim();
}

// ------------------------------------------------------------- agent-facing

/**
 * Routes an agent calls with their own player session.
 *
 * Note the shape: every one of them starts by resolving the CALLER to an agent
 * record. A player who guesses these URLs gets a 403 with nothing in it,
 * because there is no agent row for them and therefore nothing to scope a query
 * to.
 */
export function agentRoutes(
  agents: AgentsDb,
  supabase?: SupabaseAdmin,
): Record<string, (ctx: AgentCtx) => Promise<unknown>> {
  /**
   * The caller, as an agent, or a refusal.
   *
   * `pending` and `suspended` both reach the dashboard — an agent who has been
   * suspended should be able to see their own numbers and understand why
   * nothing works, rather than be shown a 403 with no explanation. Only
   * ALLOCATING and INVITING require 'active', and those check separately.
   */
  async function asAgent(ctx: AgentCtx) {
    const agent = await agents.agentStatus(ctx.player.playerId);
    if (!agent) throw new ApiError('Not found', 404, 'not_found');
    return agent;
  }

  async function asActiveAgent(ctx: AgentCtx) {
    const agent = await asAgent(ctx);
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

  const limit = (ctx: AgentCtx, fallback: number, max: number) => {
    const raw = Number(ctx.url.searchParams.get('limit') ?? fallback);
    return Math.min(max, Math.max(1, Number.isFinite(raw) ? raw : fallback));
  };

  return {
    /** The dashboard header: who am I, how much have I got, how many players. */
    'GET /agent/summary': async (ctx) => asAgent(ctx),

    /**
     * Ask to become an agent.
     *
     * Open to any registered player, because an application grants nothing: it
     * creates a `pending` row, and every capability an agent has is gated on
     * `active` inside the database. It exists so that an operator gets a queue
     * to approve from instead of having to hunt for a username somebody read
     * out over the phone.
     */
    'POST /agent/apply': async (ctx) => {
      const displayName = requireString(ctx.body['displayName'], 'displayName', 64);
      if (displayName.length < 2) {
        throw new ApiError('That name is too short', 400, 'invalid_input');
      }
      const notes = typeof ctx.body['notes'] === 'string' ? ctx.body['notes'].slice(0, 500) : undefined;
      try {
        return { status: await agents.apply(ctx.player.playerId, displayName, notes) };
      } catch (error) {
        throw agentError(error);
      }
    },

    /**
     * The player has replaced the temporary password their agent gave them.
     *
     * The password change itself happens in the browser against Supabase, with
     * the player's own session — this API never sees it. All this does is
     * record that it happened, which is what clears the flag blocking the rest
     * of the app.
     *
     * Note it is keyed on the CALLER's own id, so it can only ever clear the
     * flag on the account whose token was presented.
     */
    'POST /agent/password-set': async (ctx) => {
      await agents.clearMustSetPassword(ctx.player.playerId);
      return { ok: true };
    },

    'GET /agent/players': async (ctx) => {
      const agent = await asAgent(ctx);
      return { players: await agents.players(agent.agentId, limit(ctx, 200, 500)) };
    },

    /**
     * Move coins from inventory to a player.
     *
     * The idempotency key is the client's protection against a phone losing
     * signal mid-request: retrying with the same key pays once. A client that
     * forgets to send one still gets a unique transaction, it just cannot
     * safely retry — which is the same bargain `/bet` makes.
     */
    'POST /agent/allocate': async (ctx) => {
      const agent = await asActiveAgent(ctx);
      const playerId = requireString(ctx.body['playerId'], 'playerId', 64);
      const amount = coinAmount(ctx.body['amount']);

      // Checked here purely for the error message; `allocate_to_player` refuses
      // it again inside the transaction that moves the coins.
      if (!(await agents.ownsPlayer(agent.agentId, playerId))) {
        throw new ApiError('That player is not one of yours.', 403, 'not_your_player');
      }

      try {
        return await agents.allocate({
          agentId: agent.agentId,
          playerId,
          amount,
          idempotencyKey:
            typeof ctx.body['idempotencyKey'] === 'string'
              ? ctx.body['idempotencyKey']
              : randomUUID(),
        });
      } catch (error) {
        throw agentError(error);
      }
    },

    /** Inventory in and out, read from the ledger so it cannot disagree. */
    'GET /agent/transactions': async (ctx) => {
      const agent = await asAgent(ctx);
      return { transactions: await agents.transactions(agent.agentId, limit(ctx, 100, 200)) };
    },

    'GET /agent/invites': async (ctx) => {
      const agent = await asAgent(ctx);
      return { invites: await agents.invites(agent.agentId, limit(ctx, 50, 100)) };
    },

    /**
     * Mint an invitation.
     *
     * The raw token comes back exactly once, in this response, and is never
     * stored — only its hash is. An agent who loses the link issues another,
     * which is the same property a password reset link has and for the same
     * reason.
     */
    'POST /agent/invites': async (ctx) => {
      const agent = await asActiveAgent(ctx);
      const label = ctx.body['label'];
      try {
        return await agents.createInvite(
          agent.agentId,
          typeof label === 'string' && label.trim() !== '' ? label.trim().slice(0, 64) : undefined,
        );
      } catch (error) {
        throw agentError(error);
      }
    },

    /**
     * Create a player account on their behalf.
     *
     * The agent chooses the username and a temporary password and hands both
     * over in person. The account is flagged `must_set_password`, so the first
     * thing the player is made to do is replace it — after which the agent's
     * copy is worthless. That flag is the only thing standing between this
     * feature and an agent holding a permanent working credential for every
     * player they signed up, so it is set inside the same transaction that
     * creates the profile and is not optional.
     *
     * The age gate is NOT relaxed. The agent supplies the player's date of
     * birth and state, `complete_registration` checks both exactly as it does
     * for self-service sign-up, and the attestation is attributable to a named
     * agent rather than to an anonymous form.
     */
    'POST /agent/players': async (ctx) => {
      const agent = await asActiveAgent(ctx);
      if (!supabase) {
        throw new ApiError(
          'Creating accounts is not switched on for this deployment.',
          503,
          'account_creation_unavailable',
        );
      }

      const username = requireString(ctx.body['username'], 'username', 24);
      const password = ctx.body['password'];
      const dateOfBirth = requireString(ctx.body['dateOfBirth'], 'dateOfBirth', 10);
      const country = (
        typeof ctx.body['country'] === 'string' ? ctx.body['country'] : 'US'
      ).toUpperCase();
      const region =
        typeof ctx.body['region'] === 'string' ? ctx.body['region'].toUpperCase() : null;

      /*
       * The username becomes half of an email address and the whole of the
       * player's sign-in identity, so it is restricted to what can survive
       * being one: no spaces, no '@', no case games that would let two players
       * claim addresses differing only by capital letters.
       */
      if (!/^[a-z0-9_]{3,24}$/i.test(username)) {
        throw new ApiError(
          'Username must be 3–24 characters, letters, numbers or underscores only.',
          400,
          'invalid_input',
        );
      }
      if (typeof password !== 'string' || password.length < 8) {
        throw new ApiError(
          'The temporary password must be at least 8 characters.',
          400,
          'invalid_input',
        );
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dateOfBirth)) {
        throw new ApiError('dateOfBirth must be YYYY-MM-DD', 400, 'invalid_input');
      }
      if (country === 'US') {
        if (!region) throw new ApiError('State of residence is required', 400, 'invalid_input');
        if (!isKnownState(region)) throw new ApiError('Unrecognised state', 400, 'invalid_input');
        if (isRestrictedState(region)) {
          throw new ApiError(RESTRICTED_STATE_MESSAGE, 403, 'restricted_region');
        }
      }

      // Refused here as well as by the unique index, because the failure that
      // matters happens at Supabase — and an auth user created for a username
      // our own tables then reject is an orphan nobody cleans up.
      if (await agents.usernameTaken(username)) {
        throw new ApiError('That username is taken. Try another.', 409, 'username_taken');
      }

      const created = await supabase.createPlayer(username, password).catch((error) => {
        if (error instanceof SupabaseAdminError) {
          // 422 from GoTrue is almost always "already registered".
          if (error.status === 422 || /already/i.test(error.message)) {
            throw new ApiError('That username is taken. Try another.', 409, 'username_taken');
          }
          throw new ApiError(
            `Could not create the sign-in for that player: ${error.message}`,
            502,
            'auth_provider_failed',
          );
        }
        throw error;
      });

      try {
        const player = await agents.createPlayerForAgent({
          agentId: agent.agentId,
          playerId: created.id,
          username,
          dateOfBirth,
          country,
          region,
          welcomeCoins: WELCOME_BONUS,
        });
        return {
          playerId: created.id,
          username: player.username,
          balance: player.balance,
          // Echoed so the agent can read the exact sign-in back to the player.
          // The password is NOT echoed — they typed it, and a response body is
          // a worse place for it than their own screen already is.
          signInWith: created.email,
          mustSetPassword: true,
        };
      } catch (error) {
        /*
         * Our half failed after Supabase's half succeeded. Delete the auth user
         * rather than leave it: an orphan burns the username permanently, and
         * the agent retrying with the same name would then be told it is taken
         * by an account that has no profile and cannot be signed into usefully.
         */
        await supabase.deletePlayer(created.id).catch((cleanup) => {
          console.error('[POST /agent/players] orphaned auth user', created.id, cleanup);
        });
        throw agentError(error);
      }
    },
  };
}

// --------------------------------------------------------------- admin-facing

export interface AdminAgentRequest {
  method: string;
  pathname: string;
  body: Record<string, unknown>;
  operator: OperatorIdentity;
  /** Present for GETs that take a query string, absent otherwise. */
  url?: URL;
}

/**
 * Operator routes for agents.
 *
 * Returns `undefined` when the path is not one of these, so the caller can fall
 * through to its own 404 — the same shape the rest of `handleAdmin` uses.
 *
 * Everything here requires a live operator session, which the caller has
 * already established. There is deliberately no agent-authenticated route that
 * does any of it: an agent cannot create an agent, cannot grant themselves
 * inventory, and cannot move a player between agents.
 */
export async function handleAdminAgents(
  agents: AgentsDb,
  request: AdminAgentRequest,
): Promise<unknown | undefined> {
  const { method, pathname, body, operator, url } = request;
  const route = `${method} ${pathname}`;

  try {
    if (route === 'GET /admin/agents') {
      return { agents: await agents.listAgents() };
    }

    /**
     * Find a player, by username or email.
     *
     * Operator-only, and it returns email addresses, so it is behind the same
     * session as everything else here. Requires at least two characters: a
     * one-letter search is a request for the whole player table.
     */
    if (route === 'GET /admin/players') {
      const query = (url?.searchParams.get('q') ?? '').trim();
      if (query.length < 2) return { players: [] };
      return { players: await agents.findPlayers(query) };
    }

    /**
     * Promote an existing player to agent.
     *
     * Takes a USERNAME, not an email and never a password. The person signs up
     * through the ordinary player flow with their own credentials and is then
     * marked as an agent — nothing in this system creates a login on somebody
     * else's behalf or ever sees their password.
     */
    if (route === 'POST /admin/agents') {
      const username = requireString(body['username'], 'username', 64);
      const displayName = requireString(body['displayName'], 'displayName', 64);
      const notes = typeof body['notes'] === 'string' ? body['notes'].slice(0, 500) : undefined;
      return await agents.createAgent({
        username,
        displayName,
        operatorId: operator.operatorId,
        ...(notes ? { notes } : {}),
      });
    }

    const agentMatch = /^\/admin\/agents\/([0-9a-f-]{36})(\/[a-z]+)?$/i.exec(pathname);
    if (agentMatch) {
      const agentId = agentMatch[1]!;
      const tail = agentMatch[2] ?? '';

      if (method === 'PATCH' && tail === '') {
        const status = body['status'];
        if (status !== 'pending' && status !== 'active' && status !== 'suspended') {
          throw new ApiError('status must be pending, active or suspended', 400, 'invalid_input');
        }
        await agents.setAgentStatus(agentId, status, operator.operatorId);
        return { ok: true, status };
      }

      if (method === 'GET' && tail === '/players') {
        return { players: await agents.players(agentId) };
      }

      /**
       * Hand an agent inventory.
       *
       * House -> agent, through the same double-entry ledger every other coin
       * movement uses. Nothing is minted, and the reference is free text so an
       * operator can record why — a wire reference, a ticket number, "opening
       * float". It ends up in the transaction metadata and in the audit log.
       */
      if (method === 'POST' && tail === '/inventory') {
        const amount = coinAmount(body['amount']);
        const reference =
          typeof body['reference'] === 'string' ? body['reference'].slice(0, 200) : undefined;
        return await agents.grantInventory({
          agentId,
          amount,
          operatorId: operator.operatorId,
          ...(reference ? { reference } : {}),
          idempotencyKey:
            typeof body['idempotencyKey'] === 'string' ? body['idempotencyKey'] : randomUUID(),
        });
      }
    }

    /**
     * Move a player to a different agent.
     *
     * Admin only, and the only way it can happen — there is no self-service
     * path for either an agent or a player, by design. Audited by trigger with
     * the operator's id, so "who moved this player and when" always has an
     * answer.
     */
    /**
     * Undo a mis-sent allocation.
     *
     * ADMIN ONLY, and deliberately not available to the agent who made the
     * mistake. An agent who can pull coins back out of a player's balance on
     * request is an agent who can settle up in cash, and that is the one
     * direction this product does not let coins travel. Routing it through a
     * person who is not party to the transaction is what keeps a correction a
     * correction.
     *
     * It posts an opposite transaction rather than editing anything, refuses to
     * run twice, and fails outright if the player has already spent the coins —
     * a correction must never push a player negative.
     */
    if (route === 'POST /admin/allocations/reverse') {
      const txnId = requireString(body['txnId'], 'txnId', 64);
      const reason = requireString(body['reason'], 'reason', 200);
      try {
        return await agents.reverseAllocation(txnId, operator.operatorId, reason);
      } catch (error) {
        // The shared mapper reads "Insufficient funds" as the AGENT being short
        // of inventory, which is the usual case. Here it is the player's
        // balance, and telling an operator to top up an inventory they are
        // trying to refill would send them in a circle.
        if (error instanceof Error && /Insufficient funds/i.test(error.message)) {
          throw new ApiError(
            'The player has already spent some of those coins, so this cannot be ' +
              'reversed without pushing them below zero.',
            409,
            'already_spent',
          );
        }
        throw error;
      }
    }

    if (route === 'POST /admin/players/reassign') {
      const playerId = requireString(body['playerId'], 'playerId', 64);
      const agentId = requireString(body['agentId'], 'agentId', 64);
      await agents.reassignPlayer(playerId, agentId, operator.operatorId);
      return { ok: true };
    }

    return undefined;
  } catch (error) {
    throw agentError(error);
  }
}
