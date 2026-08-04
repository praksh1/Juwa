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
import { CERT_FAILURE_ADVICE, decideSsl, isCertificateError, sslOptionFor } from './db-ssl.js';

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing required environment variable: ${name}`);
    process.exit(1);
  }
  return value;
}

const databaseUrl = required('DATABASE_URL');
const ssl = decideSsl(databaseUrl);
console.log(
  ssl.kind === 'defer'
    ? `Database TLS: left to the connection string — ${ssl.reason}.`
    : `Database TLS: required and verified${ssl.ca ? ' against DATABASE_CA_CERT' : ''}.`,
);

const pool = new Pool({
  connectionString: databaseUrl,
  max: Number(process.env['PG_POOL_MAX'] ?? 10),
  ...sslOptionFor(databaseUrl),
});

/**
 * A pool emits errors on idle clients, where there is no caller to reject.
 * Without this listener Node treats them as unhandled and kills the process,
 * turning a momentary network blip into an outage.
 */
pool.on('error', (error) => {
  console.error('Idle database client error:', error.message);
  if (isCertificateError(error)) console.error(CERT_FAILURE_ADVICE);
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

/**
 * Prove the database is reachable BEFORE accepting traffic.
 *
 * Everything above validates configuration by reading it; none of it opens a
 * socket. Without this probe a bad DATABASE_URL produces a service that starts
 * cleanly, passes its health check and then fails the first real bet — the
 * deploy looks green while the product is dead. One round trip at boot moves
 * that discovery into the deploy log, where somebody is already looking.
 */
async function start(): Promise<void> {
  try {
    await pool.query('select 1');
  } catch (error) {
    console.error(`Cannot reach the database: ${(error as Error).message}`);
    if (isCertificateError(error)) console.error(CERT_FAILURE_ADVICE);
    process.exit(1);
  }
  server.listen(port, () => console.log(`Juwa API listening on :${port}`));
}

void start();

// Finish in-flight requests before exiting, so a deploy never kills a bet
// between the debit and the credit.
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    server.close(() => pool.end().then(() => process.exit(0)));
  });
}
