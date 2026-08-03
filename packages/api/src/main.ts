/**
 * Entry point for deployment.
 *
 * Everything is read from the environment and validated on boot. A missing JWT
 * secret must stop the process, not surface later as a request that mysteriously
 * accepts every token.
 */
import { Pool } from 'pg';
import { PostgresDb } from '@juwa/server';
import { createServer } from './server.js';
import { LiveStripeGateway } from './stripe.js';

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing required environment variable: ${name}`);
    process.exit(1);
  }
  return value;
}

const pool = new Pool({
  connectionString: required('DATABASE_URL'),
  max: Number(process.env['PG_POOL_MAX'] ?? 10),
});

/**
 * The store is optional. Without Stripe configured the API runs perfectly well
 * and the checkout route returns 503 — useful for a staging environment that
 * should never be able to take a payment.
 *
 * But a HALF-configured store is refused outright: a secret key with no webhook
 * secret would take money and never grant coins, which is the worst possible
 * failure and exactly the kind of thing a hurried deploy produces.
 */
const stripeKey = process.env['STRIPE_SECRET_KEY'];
const stripeWebhookSecret = process.env['STRIPE_WEBHOOK_SECRET'];

if (Boolean(stripeKey) !== Boolean(stripeWebhookSecret)) {
  console.error(
    'STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET must be set together. ' +
      'A key without a webhook secret would charge players and never grant coins.',
  );
  process.exit(1);
}

const stripe = stripeKey
  ? {
      gateway: new LiveStripeGateway(stripeKey),
      webhookSecret: stripeWebhookSecret!,
      successUrl: required('STRIPE_SUCCESS_URL'),
      cancelUrl: required('STRIPE_CANCEL_URL'),
    }
  : undefined;

if (!stripe) console.warn('Stripe is not configured — the store will return 503.');

const { server } = createServer({
  db: new PostgresDb(pool),
  query: (sql, params) => pool.query(sql, params as unknown[]) as never,
  jwtSecret: required('SUPABASE_JWT_SECRET'),
  allowedOrigins: required('ALLOWED_ORIGINS').split(',').map((origin) => origin.trim()),
  ...(stripe ? { stripe } : {}),
});

const port = Number(process.env['PORT'] ?? 8787);
server.listen(port, () => console.log(`Juwa API listening on :${port}`));

// Finish in-flight requests before exiting, so a deploy never kills a bet
// between the debit and the credit.
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    server.close(() => pool.end().then(() => process.exit(0)));
  });
}
