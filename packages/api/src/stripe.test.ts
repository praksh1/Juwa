/**
 * Stripe: signature verification and the purchase lifecycle.
 *
 * The webhook is the only evidence a payment happened, so most of this file is
 * about trying to forge one.
 */

import { strict as assert } from 'node:assert';
import { after, before, describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import type { AddressInfo } from 'node:net';
import { randomUUID } from 'node:crypto';
import { PostgresDb } from '@juwa/server';
import { COIN_PACKS, FIRST_PURCHASE_MULTIPLIER, WELCOME_BONUS } from '@juwa/economy';
import { createServer } from './server.js';
import { signJwt } from './jwt.js';
import {
  DEFAULT_TOLERANCE_SECONDS,
  WebhookVerificationError,
  purchaseIdFromEvent,
  signWebhook,
  verifyWebhookSignature,
  type CheckoutRequest,
  type StripeGateway,
} from './stripe.js';

const URL_ENV = process.env['JUWA_TEST_DATABASE_URL'];
const here = dirname(fileURLToPath(import.meta.url));
const migrations = resolve(here, '../../../db/migrations');
const dbTest = resolve(here, '../../../db/test');

const SECRET = 'test-jwt-secret';
const WEBHOOK_SECRET = 'whsec_test_secret';
const ORIGIN = 'https://play.juwa.test';

// ------------------------------------------------- unit: signature checking

describe('stripe webhook signatures', () => {
  const body = JSON.stringify({ id: 'evt_1', type: 'checkout.session.completed', data: { object: {} } });
  const now = Date.now();
  const ts = Math.floor(now / 1000);

  it('accepts a correctly signed payload', () => {
    const event = verifyWebhookSignature(body, signWebhook(body, WEBHOOK_SECRET, ts), WEBHOOK_SECRET, now);
    assert.equal(event.id, 'evt_1');
  });

  it('rejects a signature made with the wrong secret', () => {
    assert.throws(
      () => verifyWebhookSignature(body, signWebhook(body, 'whsec_wrong', ts), WEBHOOK_SECRET, now),
      /does not match/,
    );
  });

  it('rejects a tampered body', () => {
    // The attack this stops: take a real "you were paid $1.99" event and edit
    // it into a $99.99 one.
    const header = signWebhook(body, WEBHOOK_SECRET, ts);
    const tampered = body.replace('evt_1', 'evt_2');
    assert.throws(() => verifyWebhookSignature(tampered, header, WEBHOOK_SECRET, now), /does not match/);
  });

  it('rejects a replayed signature once it is stale', () => {
    // Without the timestamp window, one captured "payment succeeded" body could
    // be replayed forever for free coins.
    const old = ts - DEFAULT_TOLERANCE_SECONDS - 60;
    assert.throws(
      () => verifyWebhookSignature(body, signWebhook(body, WEBHOOK_SECRET, old), WEBHOOK_SECRET, now),
      /outside the \d+s window/,
    );
    // A future-dated timestamp is equally suspicious.
    const future = ts + DEFAULT_TOLERANCE_SECONDS + 60;
    assert.throws(
      () => verifyWebhookSignature(body, signWebhook(body, WEBHOOK_SECRET, future), WEBHOOK_SECRET, now),
      /outside the \d+s window/,
    );
  });

  it('rejects malformed headers and missing configuration', () => {
    const good = signWebhook(body, WEBHOOK_SECRET, ts);
    assert.throws(() => verifyWebhookSignature(body, undefined, WEBHOOK_SECRET, now), /Missing Stripe-Signature/);
    assert.throws(() => verifyWebhookSignature(body, 'garbage', WEBHOOK_SECRET, now), /timestamp/);
    assert.throws(() => verifyWebhookSignature(body, `t=${ts}`, WEBHOOK_SECRET, now), /no v1 signature/);
    assert.throws(() => verifyWebhookSignature(body, good, '', now), /No webhook signing secret/);
    assert.throws(
      () => verifyWebhookSignature(body, `t=${ts},v1=nothex!!`, WEBHOOK_SECRET, now),
      WebhookVerificationError,
    );
  });

  it('accepts one valid signature among several, for secret rotation', () => {
    const valid = signWebhook(body, WEBHOOK_SECRET, ts).split('v1=')[1];
    const header = `t=${ts},v1=${'0'.repeat(64)},v1=${valid}`;
    assert.equal(verifyWebhookSignature(body, header, WEBHOOK_SECRET, now).id, 'evt_1');
  });

  it('rejects a body that is not a Stripe event', () => {
    const notEvent = JSON.stringify({ hello: 'world' });
    assert.throws(
      () => verifyWebhookSignature(notEvent, signWebhook(notEvent, WEBHOOK_SECRET, ts), WEBHOOK_SECRET, now),
      /not a Stripe event/,
    );
  });

  it('finds the purchase id from metadata or client_reference_id', () => {
    assert.equal(
      purchaseIdFromEvent({ id: 'e', type: 't', data: { object: { metadata: { purchase_id: 'p1' } } } }),
      'p1',
    );
    assert.equal(
      purchaseIdFromEvent({ id: 'e', type: 't', data: { object: { client_reference_id: 'p2' } } }),
      'p2',
    );
    assert.equal(purchaseIdFromEvent({ id: 'e', type: 't', data: { object: {} } }), null);
  });
});

// ------------------------------------------------------------- integration

describe('store', { skip: URL_ENV ? false : 'JUWA_TEST_DATABASE_URL not set' }, () => {
  let pool: import('pg').Pool;
  let base: string;
  let stop: () => void;

  const PLAYER = randomUUID();
  const token = signJwt({ sub: PLAYER, exp: Math.floor(Date.now() / 1000) + 3600 }, SECRET);

  /** Records what the gateway was asked for, so we can assert on the price. */
  const requests: CheckoutRequest[] = [];
  const gateway: StripeGateway = {
    async createCheckoutSession(request) {
      requests.push(request);
      return { id: `cs_test_${requests.length}`, url: `https://checkout.stripe.test/${request.purchaseId}` };
    },
  };

  async function call(path: string, options: { body?: unknown; auth?: string | null } = {}) {
    const response = await fetch(`${base}${path}`, {
      method: options.body ? 'POST' : 'GET',
      headers: {
        'Content-Type': 'application/json',
        Origin: ORIGIN,
        ...(options.auth === null ? {} : { Authorization: `Bearer ${options.auth ?? token}` }),
      },
      ...(options.body ? { body: JSON.stringify(options.body) } : {}),
    });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : {} };
  }

  async function webhook(event: unknown, secret = WEBHOOK_SECRET, atSeconds?: number) {
    const raw = JSON.stringify(event);
    const ts = atSeconds ?? Math.floor(Date.now() / 1000);
    const response = await fetch(`${base}/webhooks/stripe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Stripe-Signature': signWebhook(raw, secret, ts) },
      body: raw,
    });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : {} };
  }

  const paidEvent = (id: string, purchaseId: string, sessionId = 'cs_test_1') => ({
    id,
    type: 'checkout.session.completed',
    data: {
      object: { id: sessionId, payment_status: 'paid', metadata: { purchase_id: purchaseId } },
    },
  });

  before(async () => {
    const { Pool } = await import('pg');
    pool = new Pool({ connectionString: URL_ENV });
    const sql = (p: string) => readFileSync(p, 'utf8');
    await pool.query(sql(resolve(dbTest, 'supabase_shim.sql')));
    for (const file of [
      '0001_ledger.sql', '0002_social_economy.sql', '0003_play.sql',
      '0004_accounts.sql', '0005_purchases.sql',
    ]) {
      await pool.query(sql(resolve(migrations, file)));
    }
    await pool.query(`insert into auth.users (id) values ($1)`, [PLAYER]);

    const created = createServer({
      db: new PostgresDb(pool),
      query: (text, params) => pool.query(text, params as unknown[]) as never,
      jwtSecret: SECRET,
      allowedOrigins: [ORIGIN],
      stripe: {
        gateway,
        webhookSecret: WEBHOOK_SECRET,
        successUrl: 'https://play.juwa.test/store/success',
        cancelUrl: 'https://play.juwa.test/store',
      },
    });
    await new Promise<void>((done) => created.server.listen(0, done));
    base = `http://127.0.0.1:${(created.server.address() as AddressInfo).port}`;
    stop = () => {
      created.close();
      created.server.close();
    };

    await call('/register', { body: { username: 'buyer', dateOfBirth: '1990-01-01', country: 'US' } });
  });

  after(async () => {
    stop?.();
    await pool?.end();
  });

  it('creates a checkout session priced from the server catalogue', async () => {
    const pack = COIN_PACKS.find((p) => p.id === 'pack_stack')!;
    const response = await call('/store/checkout', { body: { packId: 'pack_stack' } });
    assert.equal(response.status, 200);
    assert.equal(response.body.priceUsd, pack.priceUsd);
    assert.match(response.body.checkoutUrl, /^https:\/\/checkout\.stripe\.test\//);

    // First purchase, so the coins are doubled — by the server, from its own
    // catalogue.
    assert.equal(response.body.coins, pack.coins * FIRST_PURCHASE_MULTIPLIER);
    const sent = requests.at(-1)!;
    assert.equal(sent.priceUsd, pack.priceUsd);
    assert.equal(sent.playerId, PLAYER);
    // The return URL is ours, never the client's — otherwise checkout becomes
    // an open redirect.
    assert.match(sent.successUrl, /^https:\/\/play\.juwa\.test\/store\/success/);
  });

  it('ignores any price the client tries to send', async () => {
    const before = requests.length;
    await call('/store/checkout', {
      body: { packId: 'pack_starter', priceUsd: 1, coins: 99_999_999, amount: 1 },
    });
    const sent = requests.at(-1)!;
    assert.equal(requests.length, before + 1);
    assert.equal(sent.priceUsd, COIN_PACKS.find((p) => p.id === 'pack_starter')!.priceUsd);
    assert.notEqual(sent.coins, 99_999_999);
  });

  it('refuses an unknown pack', async () => {
    const response = await call('/store/checkout', { body: { packId: 'pack_free_money' } });
    assert.equal(response.status, 404);
  });

  it('grants no coins until the webhook arrives', async () => {
    const before = (await call('/balance')).body.balance;
    const checkout = await call('/store/checkout', { body: { packId: 'pack_starter' } });
    assert.equal(checkout.status, 200);

    // The player has been sent to Stripe but has not paid. Visiting the success
    // page — which anyone can do — must change nothing.
    assert.equal((await call('/balance')).body.balance, before, 'coins granted before payment');
    const status = await call(`/store/purchase?id=${checkout.body.purchaseId}`);
    assert.equal(status.body.status, 'pending');
  });

  it('grants coins on a verified webhook', async () => {
    const before = (await call('/balance')).body.balance;
    const checkout = await call('/store/checkout', { body: { packId: 'pack_handful' } });
    const purchaseId = checkout.body.purchaseId;

    const response = await webhook(paidEvent(`evt_${randomUUID()}`, purchaseId));
    assert.equal(response.status, 200);

    const after = (await call('/balance')).body.balance;
    assert.equal(after, before + checkout.body.coins, 'coins did not match the pack');
    assert.equal((await call(`/store/purchase?id=${purchaseId}`)).body.status, 'verified');
  });

  it('refuses a forged webhook and grants nothing', async () => {
    const before = (await call('/balance')).body.balance;
    const checkout = await call('/store/checkout', { body: { packId: 'pack_vault' } });

    const forged = await webhook(paidEvent(`evt_${randomUUID()}`, checkout.body.purchaseId), 'whsec_attacker');
    assert.equal(forged.status, 400);
    assert.equal((await call('/balance')).body.balance, before, 'a forged webhook granted coins');

    // Missing signature entirely.
    const raw = JSON.stringify(paidEvent('evt_nosig', checkout.body.purchaseId));
    const unsigned = await fetch(`${base}/webhooks/stripe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: raw,
    });
    assert.equal(unsigned.status, 400);
    assert.equal((await call('/balance')).body.balance, before);
  });

  it('rejects a stale signature even though it is genuine', async () => {
    const before = (await call('/balance')).body.balance;
    const checkout = await call('/store/checkout', { body: { packId: 'pack_pile' } });
    const old = Math.floor(Date.now() / 1000) - DEFAULT_TOLERANCE_SECONDS - 120;

    const response = await webhook(paidEvent(`evt_${randomUUID()}`, checkout.body.purchaseId), WEBHOOK_SECRET, old);
    assert.equal(response.status, 400);
    assert.equal((await call('/balance')).body.balance, before);
  });

  it('pays once no matter how many times the webhook is redelivered', async () => {
    const before = (await call('/balance')).body.balance;
    const checkout = await call('/store/checkout', { body: { packId: 'pack_fortune' } });
    const purchaseId = checkout.body.purchaseId;
    const eventId = `evt_${randomUUID()}`;

    // Same event id — Stripe's own retry.
    for (let i = 0; i < 3; i++) {
      assert.equal((await webhook(paidEvent(eventId, purchaseId))).status, 200);
    }
    // A different event id for the same purchase — a more determined attempt.
    assert.equal((await webhook(paidEvent(`evt_${randomUUID()}`, purchaseId))).status, 200);

    const after = (await call('/balance')).body.balance;
    assert.equal(after, before + checkout.body.coins, 'coins were granted more than once');
  });

  it('applies the first-purchase doubler exactly once', async () => {
    // The player above has now bought several packs, so the doubler is spent.
    const pack = COIN_PACKS.find((p) => p.id === 'pack_stack')!;
    const response = await call('/store/checkout', { body: { packId: 'pack_stack' } });
    assert.equal(response.body.coins, pack.coins, 'the doubler was applied twice');
  });

  it('ignores an unpaid or unrelated event', async () => {
    const before = (await call('/balance')).body.balance;
    const checkout = await call('/store/checkout', { body: { packId: 'pack_starter' } });

    const unpaid = {
      id: `evt_${randomUUID()}`,
      type: 'checkout.session.completed',
      data: {
        object: { id: 'cs_x', payment_status: 'unpaid', metadata: { purchase_id: checkout.body.purchaseId } },
      },
    };
    assert.equal((await webhook(unpaid)).status, 200);
    assert.equal((await call('/balance')).body.balance, before, 'an unpaid session granted coins');

    // An event type we do not handle is acknowledged, not an error.
    const other = { id: `evt_${randomUUID()}`, type: 'customer.created', data: { object: {} } };
    assert.equal((await webhook(other)).status, 200);
  });

  it('marks an expired checkout as failed', async () => {
    const checkout = await call('/store/checkout', { body: { packId: 'pack_starter' } });
    const expired = {
      id: `evt_${randomUUID()}`,
      type: 'checkout.session.expired',
      data: { object: { id: 'cs_exp', metadata: { purchase_id: checkout.body.purchaseId } } },
    };
    assert.equal((await webhook(expired)).status, 200);
    assert.equal((await call(`/store/purchase?id=${checkout.body.purchaseId}`)).body.status, 'failed');
  });

  it('does not let a player read another player\'s purchase', async () => {
    const checkout = await call('/store/checkout', { body: { packId: 'pack_starter' } });
    const stranger = signJwt({ sub: randomUUID(), exp: Math.floor(Date.now() / 1000) + 60 }, SECRET);
    const response = await call(`/store/purchase?id=${checkout.body.purchaseId}`, { auth: stranger });
    assert.equal(response.status, 404);
  });

  it('requires a token to start a checkout', async () => {
    assert.equal((await call('/store/checkout', { body: { packId: 'pack_starter' }, auth: null })).status, 401);
  });

  it('leaves the ledger balanced after every purchase above', async () => {
    const { rows } = await pool.query<{ currency: string; total: string }>(
      `select currency, sum(amount)::text as total from ledger_entries group by currency`,
    );
    for (const row of rows) assert.equal(Number(row.total), 0, `${row.currency} is off`);
    assert.equal((await pool.query(`select * from reconcile_balances()`)).rows.length, 0);

    // Purchased coins must be distinguishable from free ones — that is the
    // difference between revenue and giveaway in any later report.
    const sold = await pool.query<{ total: string }>(
      `select coalesce(sum(e.amount), 0)::text as total
         from ledger_entries e
         join transactions t on t.id = e.transaction_id
         join accounts a on a.id = e.account_id
        where t.type = 'deposit' and a.kind = 'player'`,
    );
    assert.ok(Number(sold.rows[0]!.total) > 0, 'no purchased coins recorded as deposits');

    const welcome = await pool.query<{ total: string }>(
      `select coalesce(sum(e.amount), 0)::text as total
         from ledger_entries e
         join transactions t on t.id = e.transaction_id
         join accounts a on a.id = e.account_id
        where t.type = 'bonus' and a.kind = 'player'`,
    );
    assert.equal(Number(welcome.rows[0]!.total), WELCOME_BONUS);
  });
});
