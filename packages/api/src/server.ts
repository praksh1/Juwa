/**
 * The Juwa HTTP API.
 *
 * A small node:http server with no framework. The routing surface is a dozen
 * endpoints, and the handlers in @juwa/server already contain all the logic —
 * this file is transport: parse, authenticate, rate limit, call, serialise.
 *
 * Deploys anywhere that runs Node (Fly, Railway, Render, a container). It
 * connects to Supabase's Postgres and verifies Supabase's JWTs, so Supabase
 * still owns identity and storage; this owns the game.
 */

import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import {
  AgentsDb,
  ApiError,
  ConversionsDb,
  PostgresDb,
  VaultsDb,
  act,
  claimDailyBonus,
  claimTopUp,
  getBalance,
  localDateString,
  placeBet,
  rotateSeed,
  verifyRound,
  type PlayerContext,
} from '@juwa/server';
import {
  WELCOME_BONUS,
  COIN_PACKS,
  VIP_TIERS,
  RESTRICTED_STATE_MESSAGE,
  coinsGranted,
  isKnownState,
  isRestrictedState,
  tierForXp,
} from '@juwa/economy';
import { listGames } from '@juwa/engine';
import { AuthError, bearerToken, optionalBearerToken, verifyJwtWithKeys } from './jwt.js';
import type { JwksCache } from './jwks.js';
import { LIMITS, RateLimiter } from './ratelimit.js';
import {
  AdminAuthError,
  listAudit,
  listGameAdmin,
  operatorForToken,
  operatorLogin,
  operatorLogout,
  updateGameConfig,
  getGlobalControls,
  updateGlobalControls,
} from './admin.js';
import { GameConfigCache, assertBetAllowed } from './game-config.js';
import { agentRoutes, handleAdminAgents } from './agent-routes.js';
import { conversionRoutes, handleAdminConversions } from './conversion-routes.js';
import { handleAdminVaultReturns, vaultRoutes } from './vault-routes.js';
import { SupabaseAdmin, type SupabaseAdminConfig } from './supabase-admin.js';
import { ADMIN_CONSOLE_HTML } from './admin-console.js';
import {
  WebhookVerificationError,
  isPaid,
  purchaseIdFromEvent,
  verifyWebhookSignature,
  type StripeGateway,
} from './stripe.js';

export interface ServerConfig {
  db: PostgresDb;
  /** Raw SQL access, for the few reads that are not worth a Db method. */
  query: <T = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<{ rows: T[] }>;
  /** Legacy shared secret. Optional now that projects sign asymmetrically. */
  jwtSecret?: string;
  /** Published public keys, for ES256/RS256 tokens. */
  jwks?: JwksCache;
  /** Origins allowed to call this API. Never '*' — credentials are involved. */
  allowedOrigins: string[];
  /** Dormant legacy GC/CC exchange. Agent Vault is the default live model. */
  casinoCashEnabled?: boolean;
  /**
   * Service-role access to Supabase Auth, for accounts an AGENT creates on a
   * player's behalf. Omit and that one route returns 503 — invite links, which
   * need no privileged credential, keep working.
   */
  supabaseAdmin?: SupabaseAdminConfig;
  /** Omit to run without a store; the checkout route then returns 503. */
  stripe?: {
    gateway: StripeGateway;
    webhookSecret: string;
    /** Where Stripe returns the browser. Ours, not the client's. */
    successUrl: string;
    cancelUrl: string;
  };
}

interface Ctx {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  body: Record<string, unknown>;
  player: PlayerContext;
  /** Minutes east of UTC, sent by the browser so bonuses use the local day. */
  utcOffset: number;
}

const MAX_BODY_BYTES = 16 * 1024;
const READINESS_TIMEOUT_MS = 3_000;

/**
 * Keep a stalled database connection from leaving a health request open until
 * the platform gives up. The query may still finish later, but callers get a
 * useful 503 quickly and Railway can avoid routing traffic to an unhealthy
 * deployment.
 */
function withReadinessTimeout<T>(operation: Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Database readiness check exceeded ${READINESS_TIMEOUT_MS}ms`)),
      READINESS_TIMEOUT_MS,
    );
    timer.unref();

    operation.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

async function readRaw(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw new ApiError('Request body too large', 413, 'body_too_large');
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    // A bet request is a few hundred bytes. Anything larger is not a bet.
    if (size > MAX_BODY_BYTES) throw new ApiError('Request body too large', 413, 'body_too_large');
    chunks.push(chunk as Buffer);
  }
  if (chunks.length === 0) return {};
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    throw new ApiError('Body must be valid JSON', 400, 'bad_json');
  }
}

function send(res: ServerResponse, status: number, payload: unknown, extra: Record<string, string> = {}) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    // The API is authenticated and per-player; nothing here may be cached.
    'Cache-Control': 'no-store',
    ...extra,
  });
  res.end(body);
}

/** Map a database exception onto a status the client can act on. */
function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  if (error instanceof AuthError) return new ApiError(error.message, 401, 'unauthenticated');
  if (error instanceof AdminAuthError) return new ApiError(error.message, 401, 'admin_unauthenticated');
  if (error instanceof Error && error.name === 'GameDisabledError') {
    return new ApiError(error.message, 403, 'game_disabled');
  }
  if (error instanceof Error && error.name === 'StakeOutOfRangeError') {
    return new ApiError(error.message, 400, 'stake_out_of_range');
  }
  if (error instanceof Error) {
    const message = error.message;
    if (/Registration is not complete/i.test(message)) {
      return new ApiError(message, 403, 'registration_incomplete');
    }
    if (/Age verification/i.test(message) || /must be at least \d+ to play/i.test(message)) {
      return new ApiError(message, 403, 'age_gate');
    }
    if (/self-excluded/i.test(message)) {
      const until = message.match(/until\s+(.+)$/i)?.[1];
      return new ApiError(
        until
          ? `You are taking a play break. Betting is unavailable until ${until}.`
          : 'You are taking a play break. Betting is currently unavailable.',
        403,
        'self_excluded',
      );
    }
    /*
     * The player's own daily cap, raised by `assert_can_play`.
     *
     * Without this it fell through to a 500 — a limit working exactly as
     * designed, presented to the player as "Internal error". The one moment
     * this feature exists for is the moment it says no, so that moment has to
     * read as a decision they made rather than as a broken app.
     */
    if (/Daily limit reached/i.test(message)) {
      return new ApiError(message, 403, 'daily_limit_reached');
    }
    if (/Insufficient funds/i.test(message)) {
      return new ApiError(message, 402, 'insufficient_funds');
    }
    // Username collisions are the one duplicate a player can actually fix, so
    // they get their own message. "Already done" tells them nothing and leaves
    // them retyping the same name.
    if (/duplicate key/i.test(message) && /username/i.test(message)) {
      return new ApiError('That username is taken. Try another.', 409, 'username_taken');
    }
    if (/duplicate key|already exists/i.test(message)) {
      return new ApiError('Already done', 409, 'conflict');
    }
    if (/Username must be|Date of birth is required/i.test(message)) {
      return new ApiError(message, 400, 'invalid_input');
    }
  }
  return new ApiError('Internal error', 500, 'internal');
}

/**
 * Operator routes.
 *
 * Deliberately not in the `routes` table: everything there assumes a
 * `PlayerContext`, and an operator does not have one.
 */
async function handleAdmin(
  config: ServerConfig,
  gameConfigs: GameConfigCache,
  agents: AgentsDb,
  conversions: ConversionsDb,
  vaults: VaultsDb,
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
): Promise<void> {
  const route = `${req.method} ${url.pathname}`;

  // The console itself. Static, self-contained, and served from the API rather
  // than the player app so no operator code ever reaches a player's device.
  if (route === 'GET /admin') {
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      // Never cache the console: an operator on a stale build could be looking
      // at fields the server no longer honours.
      'Cache-Control': 'no-store',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'no-referrer',
    }).end(ADMIN_CONSOLE_HTML);
    return;
  }

  const body =
    req.method === 'POST' || req.method === 'PATCH' ? await readBody(req) : {};
  const token = optionalBearerToken(req.headers.authorization);

  try {
    if (route === 'POST /admin/login') {
      const { email, password, code } = body as Record<string, string>;
      if (!email || !password || !code) {
        throw new ApiError('email, password and code are required', 400, 'invalid_input');
      }
      send(res, 200, await operatorLogin(config, email, password, code));
      return;
    }

    if (route === 'POST /admin/logout') {
      if (token) await operatorLogout(config, token);
      send(res, 200, { ok: true });
      return;
    }

    // Everything below needs a live operator session.
    const operator = await operatorForToken(config, token);

    if (route === 'GET /admin/games') {
      const engines = listGames().map((game) => ({
        id: game.id,
        name: game.name,
        rtp: game.rtp,
        limits: { min: game.limits.min, max: game.limits.max },
      }));
      const [games, settings] = await Promise.all([
        listGameAdmin(config, engines),
        getGlobalControls(config),
      ]);
      send(res, 200, { operator, games, settings });
      return;
    }

    if (route === 'PATCH /admin/settings') {
      await updateGlobalControls(config, operator, body as Record<string, unknown>);
      gameConfigs.invalidate();
      send(res, 200, { ok: true, settings: await getGlobalControls(config) });
      return;
    }

    const vaultResult = await handleAdminVaultReturns(vaults, {
      method: req.method ?? 'GET', pathname: url.pathname,
      body: body as Record<string, unknown>, operator,
    });
    if (vaultResult !== undefined) {
      send(res, 200, vaultResult);
      return;
    }

    if (req.method === 'PATCH' && url.pathname.startsWith('/admin/games/')) {
      const gameId = decodeURIComponent(url.pathname.slice('/admin/games/'.length));
      await updateGameConfig(config, operator, gameId, body as Record<string, never>);
      // The play path caches configuration for half a minute; an operator who
      // just disabled a game should not have to wait for that to expire.
      gameConfigs.invalidate();
      send(res, 200, { ok: true });
      return;
    }

    if (route === 'GET /admin/audit') {
      const limit = Number(url.searchParams.get('limit') ?? 100);
      send(res, 200, { entries: await listAudit(config, limit) });
      return;
    }

    // Agents. Returns undefined when the path is none of its business, so this
    // falls through to the 404 below rather than swallowing unknown routes.
    const agentResult = await handleAdminAgents(agents, {
      method: req.method ?? 'GET',
      pathname: url.pathname,
      body: body as Record<string, unknown>,
      operator,
      url,
    });
    if (agentResult !== undefined) {
      send(res, 200, agentResult);
      return;
    }

    // Exchange rates, CC grants and manual adjustments. Null when the path is
    // none of its business, for the same reason.
    if (config.casinoCashEnabled === true) {
      const conversionResult = await handleAdminConversions(
        route,
        url,
        body as Record<string, unknown>,
        operator,
        conversions,
      );
      if (conversionResult !== null) {
        send(res, 200, conversionResult);
        return;
      }
    }

    send(res, 404, { message: 'Not found', code: 'no_route' });
  } catch (error) {
    const api = toApiError(error);
    send(res, api.status, { message: api.message, code: api.code });
  }
}

export function createServer(config: ServerConfig) {
  const limiters = {
    bet: new RateLimiter(LIMITS.bet.capacity, LIMITS.bet.refillPerSecond),
    bonus: new RateLimiter(LIMITS.bonus.capacity, LIMITS.bonus.refillPerSecond),
    read: new RateLimiter(LIMITS.read.capacity, LIMITS.read.refillPerSecond),
    register: new RateLimiter(LIMITS.register.capacity, LIMITS.register.refillPerSecond),
    invite: new RateLimiter(LIMITS.invite.capacity, LIMITS.invite.refillPerSecond),
  };

  const gameConfigs = new GameConfigCache(config);
  /**
   * The agent data layer, over the same pool as everything else.
   *
   * Not a separate connection or a separate set of credentials: an allocation
   * and a bet must be able to lock the same player's balance row and queue
   * behind each other, which they can only do inside one database.
   */
  const agents = new AgentsDb({ query: (text, values) => config.query(text, values) });
  /*
   * The conversion layer, over the SAME pool for the same reason: an approval
   * moves a player's GC and an agent's inventory, and it has to be able to
   * queue behind a bet on the same balance row.
   */
  const conversions = new ConversionsDb({ query: (text, values) => config.query(text, values) });
  const vaults = new VaultsDb({ query: (text, values) => config.query(text, values) });
  const supabaseAdmin = config.supabaseAdmin ? new SupabaseAdmin(config.supabaseAdmin) : undefined;

  const sweeper = setInterval(() => {
    for (const limiter of Object.values(limiters)) limiter.sweep();
  }, 60_000);
  // Never hold the process open just to sweep a cache.
  sweeper.unref?.();

  // ------------------------------------------------------------- handlers

  const routes: Record<string, (ctx: Ctx) => Promise<unknown>> = {
    'GET /balance': async (ctx) => {
      // The offset is passed so `bonusClaimedToday` turns over at the player's
      // midnight, matching when the claim itself becomes available again.
      const balance = await getBalance(config.db, ctx.player, new Date(), ctx.utcOffset);
      const tier = tierForXp(balance.lifetimeWagered);
      return { ...balance, vip: { level: tier.level, name: tier.name } };
    },

    'GET /games': async () =>
      // Served from the engine registry so the lobby can never advertise a game
      // the server cannot actually deal.
      listGames().map((game) => ({
        id: game.id,
        name: game.name,
        category: game.category,
        rtp: game.rtp,
        minBet: game.limits.min,
        maxBet: game.limits.max,
      })),

    'GET /store': async () => ({ packs: COIN_PACKS, vipTiers: VIP_TIERS }),

    /**
     * The player's coin history, straight from the ledger.
     *
     * Every row here is one side of a balanced double-entry transaction, which
     * is why a support question — "where did my 500 coins go?" — always has an
     * answer that reconciles. Nothing is summarised or recomputed for display.
     */
    'GET /history': async (ctx) => {
      const limit = Math.min(100, Math.max(1, Number(ctx.url.searchParams.get('limit') ?? 50)));
      const before = ctx.url.searchParams.get('before');

      const { rows } = await config.query<Record<string, unknown>>(
        `select e.id, e.amount, e.created_at, t.type, t.metadata
           from ledger_entries e
           join transactions t on t.id = e.transaction_id
           join accounts a on a.id = e.account_id
          where a.owner_id = $1 and a.kind = 'player' and a.currency = 'GC'
            and ($2::bigint is null or e.id < $2::bigint)
          order by e.id desc
          limit $3`,
        [ctx.player.playerId, before ?? null, limit],
      );

      return {
        entries: rows.map((row) => ({
          id: String(row['id']),
          amount: Number(row['amount']),
          type: row['type'],
          at: row['created_at'],
          meta: row['metadata'] ?? {},
        })),
        // Keyset pagination rather than OFFSET: a player's history only grows,
        // and OFFSET pages drift as new rows land at the top.
        nextBefore: rows.length === limit ? String(rows[rows.length - 1]!['id']) : null,
      };
    },

    'POST /register': async (ctx) => {
      const { username, dateOfBirth, country, region, inviteToken } = ctx.body as {
        username?: string;
        dateOfBirth?: string;
        country?: string;
        region?: string;
        inviteToken?: string;
      };
      if (!username || !dateOfBirth) {
        throw new ApiError('username and dateOfBirth are required', 400, 'invalid_input');
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dateOfBirth)) {
        throw new ApiError('dateOfBirth must be YYYY-MM-DD', 400, 'invalid_input');
      }

      // Jurisdiction. `complete_registration` checks this again and is the
      // real gate — an API is also a client as far as the database is
      // concerned. Checking here buys a readable message instead of a
      // check_violation, and stops an obviously bad request at the door.
      const resolvedCountry = (country ?? 'US').toUpperCase();
      if (resolvedCountry === 'US') {
        if (!region) {
          throw new ApiError('State of residence is required', 400, 'invalid_input');
        }
        if (!isKnownState(region)) {
          throw new ApiError('Unrecognised state', 400, 'invalid_input');
        }
        if (isRestrictedState(region)) {
          throw new ApiError(RESTRICTED_STATE_MESSAGE, 403, 'restricted_region');
        }
      }

      /**
       * An agent's invitation, checked BEFORE the account is created.
       *
       * Order matters and the alternative is worse. Redeem first and a
       * registration that then fails on a taken username burns a single-use
       * link the player cannot get back. Register first and a bad link leaves
       * them permanently unattached to the agent who recruited them, with no
       * self-service way to fix it.
       *
       * So: look it up read-only, refuse early with a message they can act on,
       * then register, then redeem. The remaining window is the few
       * milliseconds between the check and the redemption, and if somebody else
       * takes the link in that window the account still exists and the response
       * says the link did not attach.
       */
      if (inviteToken !== undefined) {
        if (typeof inviteToken !== 'string' || inviteToken.length > 128) {
          throw new ApiError('inviteToken is not valid', 400, 'invalid_input');
        }
        if (!(await agents.inviteAgentName(inviteToken))) {
          throw new ApiError(
            'That invitation link is invalid, expired or already used. ' +
              'Ask for a new one, or continue without it.',
            403,
            'invite_invalid',
          );
        }
      }

      const { rows } = await config.query<{ username: string; balance: string; age_verified: boolean }>(
        `select * from complete_registration($1, $2, $3::date, $4, $5, $6)`,
        [
          ctx.player.playerId,
          username,
          dateOfBirth,
          resolvedCountry,
          region ? region.toUpperCase() : null,
          WELCOME_BONUS,
        ],
      );
      const row = rows[0]!;

      let agentName: string | null = null;
      if (typeof inviteToken === 'string') {
        try {
          await agents.redeemInvite(inviteToken, ctx.player.playerId);
          agentName = (await agents.agentForPlayer(ctx.player.playerId))?.displayName ?? null;
        } catch (error) {
          // The account exists and the welcome bonus has been paid. Losing the
          // agent link is recoverable by an operator; throwing away a completed
          // registration is not.
          console.warn('[register] invite redemption failed after registration:', error);
        }
      }

      return {
        username: row.username,
        balance: Number(row.balance),
        ageVerified: row.age_verified,
        agentName,
      };
    },

    'GET /me': async (ctx) => {
      const { rows } = await config.query<Record<string, unknown>>(
        `select username, registered_at, age_verified_at, self_excluded_until,
                daily_streak, last_bonus_date, has_purchased, must_set_password,
                daily_wager_limit, pending_wager_limit, pending_limit_at,
                session_limit_minutes
           from profiles where id = $1`,
        [ctx.player.playerId],
      );
      const row = rows[0];
      if (!row || !row['registered_at']) {
        return { registered: false };
      }

      /**
       * Role, resolved server-side on every load.
       *
       * The app uses `agent` to decide whether to show the agent dashboard, but
       * that is presentation only — hiding a tab is not access control, and
       * every `/agent/*` route resolves the caller's agent record again from
       * the token before it will do anything. A player who forges this field in
       * their own browser gets a dashboard that returns 404 to everything.
       */
      const [agent, belongsTo] = await Promise.all([
        agents.agentStatus(ctx.player.playerId),
        agents.agentForPlayer(ctx.player.playerId),
      ]);

      return {
        registered: true,
        username: row['username'],
        ageVerified: row['age_verified_at'] !== null,
        selfExcludedUntil: row['self_excluded_until'],
        dailyStreak: row['daily_streak'],
        hasPurchased: row['has_purchased'],
        /**
         * True while an agent-set temporary password is still in force. The
         * app blocks everything else until it is replaced, which is what stops
         * the agent's copy of the password from outliving the handover.
         */
        mustSetPassword: row['must_set_password'] === true,
        /**
         * The responsible-gaming settings actually in force.
         *
         * Sent so Profile can show the real value rather than the word "Not
         * set" it displayed regardless of what a player had chosen. `pending`
         * is the loosening waiting out its 24 hours — showing it is the whole
         * reason the delay is tolerable rather than baffling.
         */
        limits: {
          dailyWagerLimit:
            row['daily_wager_limit'] == null ? null : Number(row['daily_wager_limit']),
          pendingWagerLimit:
            row['pending_wager_limit'] == null ? null : Number(row['pending_wager_limit']),
          pendingAt: row['pending_limit_at'],
          sessionReminderMinutes:
            row['session_limit_minutes'] == null ? null : Number(row['session_limit_minutes']),
          selfExcludedUntil: row['self_excluded_until'],
        },
        agent,
        // Who they belong to, by NAME only. A player can see which agent funds
        // them — support questions start there — and cannot change it: there is
        // no route that lets them, only an operator reassignment.
        agentName: belongsTo?.displayName ?? null,
      };
    },

    'POST /bet': async (ctx) => {
      const startedAt = Date.now();
      const { gameId, stake, action, idempotencyKey } = ctx.body as {
        gameId?: string;
        stake?: number;
        action?: { type: string };
        idempotencyKey?: string;
      };
      if (typeof gameId !== 'string' || typeof stake !== 'number') {
        throw new ApiError('gameId and stake are required', 400, 'invalid_input');
      }

      // The player's own limits, checked with the stake in hand so a daily cap
      // can refuse the spin that would cross it.
      await assertCanPlay(config, ctx.player.playerId, ctx.utcOffset, stake);
      const policyCheckedAt = Date.now();

      // Operator configuration, read per bet. A round already in flight settles
      // on the terms it started on; only NEW spins see a change.
      const gameConfig = await gameConfigs.get(gameId);
      assertBetAllowed(gameConfig, gameId, stake);
      const configLoadedAt = Date.now();

      const result = await placeBet(config.db, ctx.player, {
        gameId,
        stake,
        maxWinMultiplier: gameConfig.maxWinMultiplier,
        maxPayoutGc: gameConfig.maxPayoutGc,
        // A client that forgets to send one still gets replay protection, it
        // just cannot benefit from retrying the exact same request.
        idempotencyKey: idempotencyKey ?? randomUUID(),
        ...(action ? { action } : {}),
      });
      const finishedAt = Date.now();

      // A slow spin is impossible to diagnose from a screenshot alone. Keep
      // phase timings in Railway's private log without recording the player,
      // stake, outcome, token, seed, or idempotency key.
      if (finishedAt - startedAt >= 1_000) {
        console.warn('[slow-bet]', JSON.stringify({
          gameId,
          totalMs: finishedAt - startedAt,
          policyMs: policyCheckedAt - startedAt,
          configMs: configLoadedAt - policyCheckedAt,
          roundMs: finishedAt - configLoadedAt,
        }));
      }

      return result;
    },

    'POST /act': async (ctx) => {
      // No stake: continuing a round already paid for cannot push a player past
      // a daily cap, and refusing mid-hand would strand their money in it.
      await assertCanPlay(config, ctx.player.playerId, ctx.utcOffset);
      const { roundId, action, idempotencyKey } = ctx.body as {
        roundId?: string;
        action?: { type: string };
        idempotencyKey?: string;
      };
      if (typeof roundId !== 'string' || !action || typeof action.type !== 'string') {
        throw new ApiError('roundId and action are required', 400, 'invalid_input');
      }
      return act(config.db, ctx.player, {
        roundId,
        action,
        idempotencyKey: idempotencyKey ?? randomUUID(),
      });
    },

    'POST /bonus/daily': async (ctx) => {
      await assertCanPlay(config, ctx.player.playerId, ctx.utcOffset);
      return claimDailyBonus(config.db, ctx.player, new Date(), ctx.utcOffset);
    },

    'POST /bonus/topup': async (ctx) => {
      await assertCanPlay(config, ctx.player.playerId, ctx.utcOffset);
      const grantDate = localDateString(new Date(), ctx.utcOffset);
      const { rows } = await config.query<{ claims_today: number; minutes_since_last: string | null }>(
        `select * from top_up_status($1, $2::date)`,
        [ctx.player.playerId, grantDate],
      );
      const status = rows[0];
      return claimTopUp(
        config.db,
        ctx.player,
        new Date(),
        ctx.utcOffset,
        status?.minutes_since_last == null ? null : Number(status.minutes_since_last),
        status?.claims_today ?? 0,
      );
    },

    'GET /verify': async (ctx) => {
      const roundId = ctx.url.searchParams.get('roundId');
      if (!roundId) throw new ApiError('roundId is required', 400, 'invalid_input');
      // Deliberately checks ownership: a player may verify their own rounds,
      // not go fishing through everyone else's.
      const round = await config.db.getRound(roundId);
      if (!round || round.playerId !== ctx.player.playerId) {
        throw new ApiError('Round not found', 404, 'not_found');
      }
      return verifyRound(config.db, roundId);
    },

    'POST /store/checkout': async (ctx) => {
      if (!config.stripe) {
        throw new ApiError('The store is not configured', 503, 'store_unavailable');
      }
      await assertCanPlay(config, ctx.player.playerId, ctx.utcOffset);

      const { packId } = ctx.body as { packId?: string };
      if (typeof packId !== 'string') {
        throw new ApiError('packId is required', 400, 'invalid_input');
      }

      // The price and coin amount come from OUR catalogue, keyed by an id. The
      // client names which pack it wants and nothing else — a client that can
      // send an amount will eventually send 1 cent for the biggest pack.
      const pack = COIN_PACKS.find((candidate) => candidate.id === packId);
      if (!pack) throw new ApiError(`Unknown pack: ${packId}`, 404, 'unknown_pack');

      const player = await config.query<{ has_purchased: boolean }>(
        `select has_purchased from profiles where id = $1`,
        [ctx.player.playerId],
      );
      const isFirstPurchase = player.rows[0]?.has_purchased === false;
      const coins = coinsGranted(pack, isFirstPurchase);

      const { rows } = await config.query<{ create_pending_purchase: string }>(
        `select create_pending_purchase($1, $2, 'stripe', $3, $4, $5)`,
        [ctx.player.playerId, pack.id, pack.priceUsd, coins, isFirstPurchase],
      );
      const purchaseId = rows[0]!.create_pending_purchase;

      const session = await config.stripe.gateway.createCheckoutSession({
        purchaseId,
        playerId: ctx.player.playerId,
        packName: `${pack.name} — ${coins.toLocaleString('en-US')} Gold Coins`,
        coins,
        priceUsd: pack.priceUsd,
        // Built from server config, never from the request: an attacker-supplied
        // return URL turns our checkout into an open redirect.
        successUrl: `${config.stripe.successUrl}?purchase=${purchaseId}`,
        cancelUrl: config.stripe.cancelUrl,
      });

      await config.query(`select attach_provider_txn($1, $2, $3)`, [
        purchaseId,
        session.id,
        session.url,
      ]);

      return { purchaseId, checkoutUrl: session.url, coins, priceUsd: pack.priceUsd };
    },

    'GET /store/purchase': async (ctx) => {
      const purchaseId = ctx.url.searchParams.get('id');
      if (!purchaseId) throw new ApiError('id is required', 400, 'invalid_input');
      const { rows } = await config.query<Record<string, unknown>>(
        `select id, status, coins_granted, price_usd, pack_id
           from coin_purchases where id = $1 and player_id = $2`,
        [purchaseId, ctx.player.playerId],
      );
      const row = rows[0];
      if (!row) throw new ApiError('Purchase not found', 404, 'not_found');
      return {
        id: row['id'],
        status: row['status'],
        coins: Number(row['coins_granted']),
        priceUsd: Number(row['price_usd']),
        packId: row['pack_id'],
      };
    },

    /**
     * The player changing their own responsible-gaming settings.
     *
     * All the asymmetries live in `set_player_limits`: tightening is immediate,
     * loosening waits a day, and a break only ever extends. None of that is
     * enforced here, because a control a client could talk its way around is
     * not a control — this route validates shapes and passes them on.
     */
    'POST /me/limits': async (ctx) => {
      const { dailyWagerLimit, sessionReminderMinutes, breakDays } = ctx.body as {
        dailyWagerLimit?: number | null;
        sessionReminderMinutes?: number | null;
        breakDays?: number;
      };

      let limit: number | null = null;
      let clear = false;
      if (dailyWagerLimit === null) {
        clear = true;
      } else if (dailyWagerLimit !== undefined) {
        if (!Number.isInteger(dailyWagerLimit) || dailyWagerLimit <= 0) {
          throw new ApiError(
            'A daily limit must be a positive whole number of coins',
            400,
            'invalid_input',
          );
        }
        limit = dailyWagerLimit;
      }

      if (
        sessionReminderMinutes !== undefined &&
        sessionReminderMinutes !== null &&
        (!Number.isInteger(sessionReminderMinutes) ||
          sessionReminderMinutes < 0 ||
          sessionReminderMinutes > 24 * 60)
      ) {
        throw new ApiError('Remind me every: 0 to 1440 minutes', 400, 'invalid_input');
      }

      // A break is expressed in DAYS, so a client cannot send a timestamp in
      // the past and clear an exclusion by arithmetic.
      let excludeUntil: string | null = null;
      if (breakDays !== undefined) {
        if (!Number.isInteger(breakDays) || breakDays < 1 || breakDays > 3650) {
          throw new ApiError('A break must be between 1 and 3650 days', 400, 'invalid_input');
        }
        excludeUntil = new Date(Date.now() + breakDays * 86_400_000).toISOString();
      }

      const { rows } = await config.query<Record<string, unknown>>(
        `select * from set_player_limits($1, $2, $3, $4, $5::timestamptz)`,
        [
          ctx.player.playerId,
          limit,
          clear,
          sessionReminderMinutes === undefined ? null : sessionReminderMinutes,
          excludeUntil,
        ],
      );
      const row = rows[0]!;
      return {
        dailyWagerLimit:
          row['daily_wager_limit'] == null ? null : Number(row['daily_wager_limit']),
        pendingWagerLimit:
          row['pending_wager_limit'] == null ? null : Number(row['pending_wager_limit']),
        pendingAt: row['pending_limit_at'],
        sessionReminderMinutes:
          row['session_limit_minutes'] == null ? null : Number(row['session_limit_minutes']),
        selfExcludedUntil: row['self_excluded_until'],
      };
    },

    'POST /seed/rotate': async (ctx) => {
      const { clientSeed } = ctx.body as { clientSeed?: string };
      if (clientSeed !== undefined && (typeof clientSeed !== 'string' || clientSeed.length > 64)) {
        throw new ApiError('clientSeed must be a string of at most 64 characters', 400, 'invalid_input');
      }
      return rotateSeed(config.db, ctx.player, clientSeed);
    },

    // Agent-facing routes. Every one of them scopes itself to the caller's own
    // agent record, resolved from the verified token — see agent-routes.ts.
    ...agentRoutes(agents, supabaseAdmin),

    // Legacy CC remains reversible in code, but is dark unless explicitly
    // enabled. Agent Vault is the live, one-currency custody model.
    ...(config.casinoCashEnabled === true
      ? conversionRoutes(conversions, agents)
      : vaultRoutes(vaults, agents)),
  };

  const limiterFor = (route: string) => {
    if (route === 'POST /bet' || route === 'POST /act') return limiters.bet;
    if (route.startsWith('POST /bonus')) return limiters.bonus;
    if (route === 'POST /register') return limiters.register;
    // Allocations move real balances and minting invitations creates rows. An
    // agent doing either by hand cannot exceed two a second; a script can.
    if (route.startsWith('POST /agent/')) return limiters.bet;
    return limiters.read;
  };

  // -------------------------------------------------------------- server

  const server = createHttpServer(async (req, res) => {
    const origin = req.headers.origin;
    const allowed = origin && config.allowedOrigins.includes(origin);

    if (allowed) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, X-UTC-Offset');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Max-Age', '86400');
    }

    if (req.method === 'OPTIONS') {
      res.writeHead(allowed ? 204 : 403).end();
      return;
    }

    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const requestStartedAt = Date.now();

    // Railway did not retain enough request detail to explain the August 26
    // slow-spin recording. Log only requests that are observably slow, and
    // never log query strings (invite tokens and other private values can live
    // there), bodies, headers, or account identifiers.
    res.once('finish', () => {
      const durationMs = Date.now() - requestStartedAt;
      if (durationMs >= 1_000) {
        console.warn('[slow-http]', JSON.stringify({
          method: req.method ?? 'UNKNOWN',
          path: url.pathname,
          status: res.statusCode,
          durationMs,
        }));
      }
    });

    if (url.pathname === '/health') {
      send(res, 200, { ok: true });
      return;
    }

    if (url.pathname === '/health/ready') {
      const startedAt = Date.now();
      try {
        await withReadinessTimeout(config.query('select 1'));
        send(res, 200, {
          ok: true,
          database: 'reachable',
          responseTimeMs: Date.now() - startedAt,
        });
      } catch (error) {
        // Do not expose database hostnames, credentials, or provider details in
        // this public endpoint. The full reason stays in Railway's private log.
        console.error('[GET /health/ready]', error instanceof Error ? error.message : error);
        send(res, 503, {
          ok: false,
          database: 'unavailable',
          responseTimeMs: Date.now() - startedAt,
        });
      }
      return;
    }

    /**
     * "Who invited me?" — the one unauthenticated read in the API.
     *
     * It exists because the sign-up screen has to be able to say "invited by
     * Sunrise Gaming" BEFORE the player has an account, and at that point there
     * is no token to present. It returns a display name and nothing else: never
     * the agent's id, never their player list, never whether a token merely
     * exists — an unusable link and an unknown link give the identical answer.
     *
     * Limited by address, and answered before the JWT gate for the same reason
     * the Stripe webhook is: requiring a session here would be requiring a
     * session the caller cannot yet have.
     */
    if (url.pathname === '/invite' && req.method === 'GET') {
      const address = req.socket.remoteAddress ?? 'unknown';
      const limit = limiters.invite.check(`invite:${address}`);
      if (!limit.allowed) {
        send(res, 429, { message: 'Slow down', code: 'rate_limited' }, {
          'Retry-After': String(limit.retryAfter),
        });
        return;
      }
      const token = url.searchParams.get('token');
      if (!token || token.length > 128) {
        send(res, 400, { message: 'token is required', code: 'invalid_input' });
        return;
      }
      try {
        const agentName = await agents.inviteAgentName(token);
        send(res, 200, { valid: agentName !== null, agentName });
      } catch (error) {
        console.error('[GET /invite]', error);
        send(res, 500, { message: 'Internal error', code: 'internal' });
      }
      return;
    }

    /**
     * The Stripe webhook.
     *
     * Handled before the JWT check because Stripe has no bearer token — the
     * signature IS the authentication, and it is strictly stronger: it proves
     * the body came from Stripe unmodified, which a token could not.
     *
     * Never rate limited. Throttling Stripe means dropping payment
     * notifications, and a dropped notification is a player who paid and got
     * nothing.
     */
    if (url.pathname === '/webhooks/stripe' && req.method === 'POST') {
      await handleStripeWebhook(config, req, res);
      return;
    }

    /**
     * The operator panel.
     *
     * Handled before the player JWT check because operators do not have one —
     * they authenticate against their own table with their own session token.
     * Running them through the player path would mean one of two bad things:
     * either a Supabase token grants operator access, or operator access is a
     * flag on a player row.
     */
    if (url.pathname === '/admin' || url.pathname.startsWith('/admin/')) {
      await handleAdmin(config, gameConfigs, agents, conversions, vaults, req, res, url);
      return;
    }

    const route = `${req.method} ${url.pathname}`;
    const handler = routes[route];
    if (!handler) {
      send(res, 404, { message: 'Not found', code: 'no_route' });
      return;
    }

    try {
      const claims = await verifyJwtWithKeys(bearerToken(req.headers.authorization), {
        ...(config.jwtSecret ? { secret: config.jwtSecret } : {}),
        ...(config.jwks ? { jwks: config.jwks } : {}),
      });
      const player: PlayerContext = { playerId: claims.sub, currency: 'GC' };

      // A returning player automatically cancels any dormant-vault warning.
      // This runs after JWT verification and before every authenticated route,
      // so neither a client bug nor a forgotten screen can bypass it.
      await config.query(`select record_player_activity($1)`, [claims.sub]);

      const limit = limiterFor(route).check(`${claims.sub}:${route}`);
      if (!limit.allowed) {
        send(
          res,
          429,
          { message: 'Slow down', code: 'rate_limited' },
          { 'Retry-After': String(limit.retryAfter) },
        );
        return;
      }

      const offsetHeader = Number(req.headers['x-utc-offset']);
      const utcOffset =
        Number.isFinite(offsetHeader) && Math.abs(offsetHeader) <= 14 * 60 ? offsetHeader : 0;

      const body = req.method === 'POST' ? await readBody(req) : {};
      const result = await handler({ req, res, url, body, player, utcOffset });
      send(res, 200, result);
    } catch (error) {
      const apiError = toApiError(error);
      if (apiError.status >= 500) {
        // Log the real thing; return nothing that describes our internals.
        console.error(`[${route}]`, error);
      }
      send(res, apiError.status, { message: apiError.message, code: apiError.code });
    }
  });

  return { server, limiters, close: () => clearInterval(sweeper) };
}

/**
 * Everything that can stop a bet, asked before the bet.
 *
 * The stake is passed so a daily wager cap can refuse the bet that would cross
 * it — checking only what is already staked would let the last bet of the day
 * be any size at all. The offset is passed so "today" is the player's day.
 */
async function assertCanPlay(
  config: ServerConfig,
  playerId: string,
  utcOffset = 0,
  stake = 0,
): Promise<void> {
  await config.query(`select assert_can_play($1, $2, $3)`, [playerId, utcOffset, stake]);
}

/**
 * Process a Stripe webhook.
 *
 * Three layers stop a replayed event from granting coins twice:
 *
 *   1. `record_webhook_event` — the provider's event id is a primary key, so a
 *      redelivery collides and is skipped here.
 *   2. `complete_coin_purchase` — locks the purchase row and refuses anything
 *      not still 'pending'.
 *   3. `post_transfer` — the idempotency key on the ledger transaction itself.
 *
 * Any one of them would do. All three are cheap, and the failure they prevent
 * is handing out coins nobody paid for.
 *
 * On an unexpected error we return 500 deliberately, so Stripe retries. The
 * alternative — swallowing it with a 200 — loses a real payment silently, and a
 * player who paid and got nothing is the worst outcome in the product.
 */
async function handleStripeWebhook(
  config: ServerConfig,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (!config.stripe) {
    send(res, 503, { message: 'The store is not configured', code: 'store_unavailable' });
    return;
  }

  let raw: string;
  try {
    raw = await readRaw(req);
  } catch (error) {
    const apiError = toApiError(error);
    send(res, apiError.status, { message: apiError.message, code: apiError.code });
    return;
  }

  let event;
  try {
    // The RAW body, byte for byte. Re-serialising the parsed object reorders
    // keys and the signature stops matching.
    event = verifyWebhookSignature(
      raw,
      req.headers['stripe-signature'] as string | undefined,
      config.stripe.webhookSecret,
    );
  } catch (error) {
    // 400, not 500: the request is bad and retrying it will not help.
    const message = error instanceof WebhookVerificationError ? error.message : 'Invalid webhook';
    console.warn('[stripe webhook] rejected:', message);
    send(res, 400, { message, code: 'invalid_signature' });
    return;
  }

  try {
    const { rows } = await config.query<{ record_webhook_event: boolean }>(
      `select record_webhook_event($1, 'stripe', $2, $3::jsonb)`,
      [event.id, event.type, raw],
    );
    if (rows[0]?.record_webhook_event === false) {
      // Seen before. Acknowledge so Stripe stops retrying.
      send(res, 200, { received: true, duplicate: true });
      return;
    }

    const relevant =
      event.type === 'checkout.session.completed' ||
      event.type === 'checkout.session.async_payment_succeeded';

    if (relevant && isPaid(event)) {
      const purchaseId = purchaseIdFromEvent(event);
      if (!purchaseId) {
        await config.query(`select mark_webhook_processed($1, $2)`, [
          event.id,
          'No purchase id on the event',
        ]);
        send(res, 200, { received: true, ignored: 'no purchase id' });
        return;
      }
      const session = event.data.object as { id?: string };
      await config.query(`select * from complete_coin_purchase($1, $2)`, [
        purchaseId,
        session.id ?? null,
      ]);
    } else if (
      event.type === 'checkout.session.expired' ||
      event.type === 'checkout.session.async_payment_failed'
    ) {
      const purchaseId = purchaseIdFromEvent(event);
      if (purchaseId) {
        await config.query(`select fail_coin_purchase($1, $2)`, [purchaseId, event.type]);
      }
    }

    await config.query(`select mark_webhook_processed($1)`, [event.id]);
    send(res, 200, { received: true });
  } catch (error) {
    console.error('[stripe webhook]', event.id, error);
    await config
      .query(`select mark_webhook_processed($1, $2)`, [event.id, String(error)])
      .catch(() => {});
    // 500 so Stripe retries. Never swallow a payment.
    send(res, 500, { message: 'Could not process webhook', code: 'webhook_failed' });
  }
}
