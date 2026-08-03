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
  ApiError,
  PostgresDb,
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
import { WELCOME_BONUS, COIN_PACKS, VIP_TIERS, tierForXp } from '@juwa/economy';
import { listGames } from '@juwa/engine';
import { AuthError, bearerToken, verifyJwt } from './jwt.js';
import { LIMITS, RateLimiter } from './ratelimit.js';

export interface ServerConfig {
  db: PostgresDb;
  /** Raw SQL access, for the few reads that are not worth a Db method. */
  query: <T = Record<string, unknown>>(sql: string, params?: unknown[]) => Promise<{ rows: T[] }>;
  jwtSecret: string;
  /** Origins allowed to call this API. Never '*' — credentials are involved. */
  allowedOrigins: string[];
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
  if (error instanceof Error) {
    const message = error.message;
    if (/Registration is not complete/i.test(message)) {
      return new ApiError(message, 403, 'registration_incomplete');
    }
    if (/Age verification/i.test(message) || /must be at least \d+ to play/i.test(message)) {
      return new ApiError(message, 403, 'age_gate');
    }
    if (/self-excluded/i.test(message)) return new ApiError(message, 403, 'self_excluded');
    if (/Insufficient funds/i.test(message)) {
      return new ApiError(message, 402, 'insufficient_funds');
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

export function createServer(config: ServerConfig) {
  const limiters = {
    bet: new RateLimiter(LIMITS.bet.capacity, LIMITS.bet.refillPerSecond),
    bonus: new RateLimiter(LIMITS.bonus.capacity, LIMITS.bonus.refillPerSecond),
    read: new RateLimiter(LIMITS.read.capacity, LIMITS.read.refillPerSecond),
    register: new RateLimiter(LIMITS.register.capacity, LIMITS.register.refillPerSecond),
  };

  const sweeper = setInterval(() => {
    for (const limiter of Object.values(limiters)) limiter.sweep();
  }, 60_000);
  // Never hold the process open just to sweep a cache.
  sweeper.unref?.();

  // ------------------------------------------------------------- handlers

  const routes: Record<string, (ctx: Ctx) => Promise<unknown>> = {
    'GET /balance': async (ctx) => {
      const balance = await getBalance(config.db, ctx.player);
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

    'POST /register': async (ctx) => {
      const { username, dateOfBirth, country } = ctx.body as {
        username?: string;
        dateOfBirth?: string;
        country?: string;
      };
      if (!username || !dateOfBirth) {
        throw new ApiError('username and dateOfBirth are required', 400, 'invalid_input');
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dateOfBirth)) {
        throw new ApiError('dateOfBirth must be YYYY-MM-DD', 400, 'invalid_input');
      }

      const { rows } = await config.query<{ username: string; balance: string; age_verified: boolean }>(
        `select * from complete_registration($1, $2, $3::date, $4, $5)`,
        [ctx.player.playerId, username, dateOfBirth, country ?? null, WELCOME_BONUS],
      );
      const row = rows[0]!;
      return {
        username: row.username,
        balance: Number(row.balance),
        ageVerified: row.age_verified,
      };
    },

    'GET /me': async (ctx) => {
      const { rows } = await config.query<Record<string, unknown>>(
        `select username, registered_at, age_verified_at, self_excluded_until,
                daily_streak, last_bonus_date
           from profiles where id = $1`,
        [ctx.player.playerId],
      );
      const row = rows[0];
      if (!row || !row['registered_at']) {
        return { registered: false };
      }
      return {
        registered: true,
        username: row['username'],
        ageVerified: row['age_verified_at'] !== null,
        selfExcludedUntil: row['self_excluded_until'],
        dailyStreak: row['daily_streak'],
      };
    },

    'POST /bet': async (ctx) => {
      await assertCanPlay(config, ctx.player.playerId);
      const { gameId, stake, action, idempotencyKey } = ctx.body as {
        gameId?: string;
        stake?: number;
        action?: { type: string };
        idempotencyKey?: string;
      };
      if (typeof gameId !== 'string' || typeof stake !== 'number') {
        throw new ApiError('gameId and stake are required', 400, 'invalid_input');
      }
      return placeBet(config.db, ctx.player, {
        gameId,
        stake,
        // A client that forgets to send one still gets replay protection, it
        // just cannot benefit from retrying the exact same request.
        idempotencyKey: idempotencyKey ?? randomUUID(),
        ...(action ? { action } : {}),
      });
    },

    'POST /act': async (ctx) => {
      await assertCanPlay(config, ctx.player.playerId);
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
      await assertCanPlay(config, ctx.player.playerId);
      return claimDailyBonus(config.db, ctx.player, new Date(), ctx.utcOffset);
    },

    'POST /bonus/topup': async (ctx) => {
      await assertCanPlay(config, ctx.player.playerId);
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

    'POST /seed/rotate': async (ctx) => {
      const { clientSeed } = ctx.body as { clientSeed?: string };
      if (clientSeed !== undefined && (typeof clientSeed !== 'string' || clientSeed.length > 64)) {
        throw new ApiError('clientSeed must be a string of at most 64 characters', 400, 'invalid_input');
      }
      return rotateSeed(config.db, ctx.player, clientSeed);
    },
  };

  const limiterFor = (route: string) => {
    if (route === 'POST /bet' || route === 'POST /act') return limiters.bet;
    if (route.startsWith('POST /bonus')) return limiters.bonus;
    if (route === 'POST /register') return limiters.register;
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

    if (url.pathname === '/health') {
      send(res, 200, { ok: true });
      return;
    }

    const route = `${req.method} ${url.pathname}`;
    const handler = routes[route];
    if (!handler) {
      send(res, 404, { message: 'Not found', code: 'no_route' });
      return;
    }

    try {
      const claims = verifyJwt(bearerToken(req.headers.authorization), config.jwtSecret);
      const player: PlayerContext = { playerId: claims.sub, currency: 'GC' };

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

async function assertCanPlay(config: ServerConfig, playerId: string): Promise<void> {
  await config.query(`select assert_can_play($1)`, [playerId]);
}
