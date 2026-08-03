#!/usr/bin/env bash
# Apply the migrations to a throwaway Postgres and assert the ledger's
# invariants actually hold — overdraw protection, idempotency, balanced
# double-entry, append-only history, and the no-withdrawal guard.
#
# These rules are enforced by the database rather than by application code, so
# they have to be tested against a real database. Usage:
#
#   PGPORT=5433 db/test/run.sh
set -euo pipefail

PGHOST="${PGHOST:-/tmp}"
PGPORT="${PGPORT:-5432}"
PGUSER="${PGUSER:-postgres}"
DB="${DB:-juwa_test}"
HERE="$(cd "$(dirname "$0")" && pwd)"

psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -q \
  -c "drop database if exists $DB;" -c "create database $DB;"

# The `auth` schema is provided by Supabase in production; stub it locally.
psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$DB" -q -v ON_ERROR_STOP=1 \
  -f "$HERE/supabase_shim.sql" \
  -f "$HERE/../migrations/0001_ledger.sql" \
  -f "$HERE/../migrations/0002_social_economy.sql"

echo "migrations applied cleanly"
psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -d "$DB" -f "$HERE/ledger_invariants.sql"
