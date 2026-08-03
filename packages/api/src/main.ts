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

const { server } = createServer({
  db: new PostgresDb(pool),
  query: (sql, params) => pool.query(sql, params as unknown[]) as never,
  jwtSecret: required('SUPABASE_JWT_SECRET'),
  allowedOrigins: required('ALLOWED_ORIGINS').split(',').map((origin) => origin.trim()),
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
