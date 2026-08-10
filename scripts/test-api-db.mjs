#!/usr/bin/env node
/**
 * Run the API's database-backed tests, each against its own database.
 *
 * `node --test` runs test FILES in parallel, and each of these three files
 * builds a schema from scratch in its `before` hook. Pointed at one database
 * they race on the same DDL, and whichever loses is cancelled with "relation
 * already exists" — non-deterministically, which is the worst kind of red.
 *
 * So each gets its own, created here and dropped and recreated on every run, so
 * a suite never inherits rows from the last one.
 *
 *   PGHOST=/var/run/postgresql npm run test:api
 *
 * Point it somewhere else with JUWA_TEST_PG, which must be a connection string
 * for a server this can create databases on — a local one. Never a real
 * database: the first thing it does is DROP.
 */

import { execFileSync } from 'node:child_process';

const admin = process.env['JUWA_TEST_PG'] ?? 'postgres://postgres@localhost:5432/postgres';

/** One database per test file, named after it so a leftover is identifiable. */
const databases = {
  JUWA_TEST_DATABASE_URL: 'juwa_test_api',
  JUWA_AGENT_TEST_DATABASE_URL: 'juwa_test_agents',
  JUWA_STRIPE_TEST_DATABASE_URL: 'juwa_test_stripe',
  JUWA_BOOTSTRAP_TEST_DATABASE_URL: 'juwa_test_bootstrap',
  JUWA_LIMITS_TEST_DATABASE_URL: 'juwa_test_limits',
};

const url = (name) => {
  const parsed = new URL(admin);
  parsed.pathname = `/${name}`;
  return parsed.toString();
};

const psql = (database, sql) =>
  execFileSync('psql', [url(database), '-v', 'ON_ERROR_STOP=1', '-q', '-c', sql], {
    stdio: ['ignore', 'ignore', 'inherit'],
  });

const env = { ...process.env };
for (const [variable, name] of Object.entries(databases)) {
  // Dropped and recreated rather than truncated: the schema itself is what the
  // `before` hooks build, and a half-migrated leftover is harder to spot than
  // an empty one.
  psql('postgres', `drop database if exists ${name}`);
  psql('postgres', `create database ${name}`);
  env[variable] = url(name);
}

execFileSync('npm', ['run', 'build'], { stdio: 'inherit' });
execFileSync('node', ['--test', 'packages/api/dist/**/*.test.js'], { stdio: 'inherit', env });
