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
import { describeProblems, parseAllowedOrigins } from './origins.js';
import { JwksCache, jwksUrlForSupabase } from './jwks.js';
import { bootstrapOperator } from './bootstrap-operator.js';
import { isConfigured, supabaseAdminFromEnv } from './supabase-admin.js';

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
    : `Database TLS: required and verified${ssl.caSource ? `, trusting ${ssl.caSource}` : ''}.`,
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

/**
 * Refuse to start on an origin list that cannot match anything.
 *
 * A wrong entry here produces the least debuggable failure in the system: the
 * API is healthy, /health returns 200, every log is clean, and the player is
 * told the server is unreachable. The browser makes that decision privately —
 * the request never even arrives — so no amount of reading server logs finds
 * it, and the configured value looks correct to anyone who checks it.
 */
const parsedOrigins = parseAllowedOrigins(required('ALLOWED_ORIGINS'));
if (parsedOrigins.problems.length > 0) {
  console.error(describeProblems(parsedOrigins.problems));
  process.exit(1);
}
const allowedOrigins = parsedOrigins.origins;
console.log(`Accepting browser requests from: ${allowedOrigins.join(', ')}`);

/**
 * Where session tokens come from.
 *
 * Supabase signs new projects' tokens with a private key and publishes the
 * public half; older projects use a shared secret. Either is enough to start,
 * both is fine, neither is refused — a service that cannot verify a single
 * token should not pretend to be running.
 */
const legacySecret = process.env['SUPABASE_JWT_SECRET'];
const supabaseUrl = process.env['SUPABASE_URL']?.trim().replace(/\/+$/, '');
const jwks = supabaseUrl ? new JwksCache(jwksUrlForSupabase(supabaseUrl)) : undefined;

if (!legacySecret && !jwks) {
  console.error(
    'No way to verify session tokens.\n\n' +
      'Set SUPABASE_URL (recommended — projects now sign with a published key,\n' +
      'and tokens arrive as ES256), or SUPABASE_JWT_SECRET for a project still\n' +
      'using the legacy shared secret. Setting both is fine.\n\n' +
      'SUPABASE_URL looks like https://<project>.supabase.co',
  );
  process.exit(1);
}
console.log(
  `Token verification: ${[
    jwks ? `published keys from ${supabaseUrl}` : null,
    legacySecret ? 'legacy shared secret' : null,
  ]
    .filter(Boolean)
    .join(' and ')}.`,
);

/**
 * Service-role access, for accounts an agent creates on a player's behalf.
 *
 * SUPABASE_SERVICE_ROLE_KEY bypasses every row-level security policy in the
 * project — it is the most powerful value in this deployment. It belongs in the
 * API service's environment and nowhere else: never the app bundle, never the
 * repository, never a log line.
 *
 * Absent, agent-created accounts return 503 and invite links still work. One
 * missing optional credential must disable one feature, not the product.
 */
const supabaseAdminEnv = supabaseAdminFromEnv();
const supabaseAdmin = isConfigured(supabaseAdminEnv) ? supabaseAdminEnv : undefined;
if (supabaseAdmin) {
  console.log(
    `Agent-created player accounts: on, signing in at @${supabaseAdmin.playerEmailDomain}.`,
  );
} else if (!isConfigured(supabaseAdminEnv)) {
  console.log(
    `Agent-created player accounts: off — still needs ${supabaseAdminEnv.missing.join(' and ')}. ` +
      'Agents can still invite players by link.',
  );
  // Names only. A near miss is almost always a typo in the variable NAME, and
  // the platform will never volunteer that a variable nobody reads exists.
  if (supabaseAdminEnv.nearMisses?.length) {
    console.log(
      `  ...but these are set and look close: ${supabaseAdminEnv.nearMisses.join(', ')}. ` +
        'Check the spelling — the name has to match exactly.',
    );
  }
}

const { server } = createServer({
  db: new PostgresDb(pool),
  query: (sql, params) => pool.query(sql, params as unknown[]) as never,
  ...(legacySecret ? { jwtSecret: legacySecret } : {}),
  ...(jwks ? { jwks } : {}),
  allowedOrigins,
  ...(supabaseAdmin ? { supabaseAdmin } : {}),
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

  /*
   * The first operator, if the environment asks for one and there is not one
   * already. Runs after the database probe — it needs a working connection —
   * and before listening, so the credentials are printed above the "ready" line
   * rather than buried under request logs.
   *
   * Does nothing on every boot after the first. See bootstrap-operator.ts.
   */
  await bootstrapOperator(pool);

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
