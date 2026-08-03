-- Minimal stand-in for the Supabase-provided auth schema, so the migrations can
-- be validated against a stock Postgres.
create schema if not exists auth;
create table auth.users (id uuid primary key default gen_random_uuid());
create or replace function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
