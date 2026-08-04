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

/**
 * The listening port, and where it came from.
 *
 * Container platforms differ on this: some inject PORT and route to it, some
 * route to whatever the Dockerfile EXPOSEs, and a mismatch between the two
 * produces a container that starts perfectly and fails its health check
 * forever. "Attempt #6 failed with service unavailable" is the same message
 * whether the process died, bound the wrong port, or never started at all —
 * so the log has to say which.
 */
const portEnv = process.env['PORT'];
const port = Number(portEnv ?? 8787);
if (!Number.isInteger(port) || port <= 0 || port > 65535) {
  console.error(`PORT is not a usable port number: ${JSON.stringify(portEnv)}`);
  process.exit(1);
}
console.log(
  portEnv
    ? `Port ${port}, from the PORT environment variable.`
    : `Port ${port}, the built-in default — PORT was not set. If this platform ` +
      `routes to a different port, the health check will fail while the process ` +
      `looks fine.`,
);

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

  // A listen failure arrives as an event, not a rejection. Without this the
  // process stays alive with nothing bound — the health check times out and
  // the log says nothing at all, which is the least debuggable outcome
  // available.
  server.on('error', (error) => {
    console.error(`Cannot listen on port ${port}: ${error.message}`);
    process.exit(1);
  });

  // No host argument: Node binds every interface, IPv4 and IPv6 both. Pinning
  // 0.0.0.0 here would break platforms whose internal networking is IPv6-only.
  server.listen(port, () => console.log(`Juwa API listening on :${port} — ready.`));
}

void start();

// Finish in-flight requests before exiting, so a deploy never kills a bet
// between the debit and the credit.
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    server.close(() => pool.end().then(() => process.exit(0)));
  });
}
