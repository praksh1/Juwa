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
import { WELCOME_BONUS, COIN_PACKS, VIP_TIERS, coinsGranted, tierForXp } from '@juwa/economy';
import { listGames } from '@juwa/engine';
import { AuthError, bearerToken, verifyJwt } from './jwt.js';
import { LIMITS, RateLimiter } from './ratelimit.js';
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
  jwtSecret: string;
  /** Origins allowed to call this API. Never '*' — credentials are involved. */
  allowedOrigins: string[];
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
                daily_streak, last_bonus_date, has_purchased
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
        hasPurchased: row['has_purchased'],
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

    'POST /store/checkout': async (ctx) => {
      if (!config.stripe) {
        throw new ApiError('The store is not configured', 503, 'store_unavailable');
      }
      await assertCanPlay(config, ctx.player.playerId);

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
