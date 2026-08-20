-- ============================================================================
-- Public Data API hardening
--
-- Juwa's browser uses Supabase Auth only. All application data is read and
-- written by the Railway API over its private DATABASE_URL connection. There
-- is therefore no reason for the anonymous or authenticated Data API roles to
-- read tables or invoke the privileged functions in the public schema.
-- ============================================================================

begin;

-- RLS was enabled on the original ledger tables, but several operator and
-- agent tables were added later without it. Enable it on every current public
-- table so a future audit cannot miss one of the later additions.
do $$
declare
  relation record;
begin
  for relation in
    select n.nspname as schema_name, c.relname as relation_name
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relkind in ('r', 'p')
  loop
    execute format(
      'alter table %I.%I enable row level security',
      relation.schema_name,
      relation.relation_name
    );
  end loop;
end;
$$;

-- Normal PostgreSQL views evaluate permissions as their owner by default.
-- Make the balance view obey the caller's RLS rules as an additional guard.
alter view public.account_balances set (security_invoker = true);

-- PUBLIC means every database role. Remove the broad defaults that exposed
-- tables, views, sequences and security-definer functions through PostgREST.
revoke all privileges on all tables in schema public from public;
revoke all privileges on all sequences in schema public from public;
revoke execute on all functions in schema public from public;

-- Supabase projects normally contain these two Data API roles. The conditional
-- block also lets the migration run in the repository's plain-Postgres tests.
do $$
declare
  api_role text;
begin
  foreach api_role in array array['anon', 'authenticated']
  loop
    if exists (select 1 from pg_roles where rolname = api_role) then
      execute format(
        'revoke all privileges on all tables in schema public from %I',
        api_role
      );
      execute format(
        'revoke all privileges on all sequences in schema public from %I',
        api_role
      );
      execute format(
        'revoke execute on all functions in schema public from %I',
        api_role
      );
    end if;
  end loop;
end;
$$;

-- Keep later migrations safe. These defaults apply to objects subsequently
-- created by the same database owner that applies this migration.
alter default privileges in schema public
  revoke all privileges on tables from public;
alter default privileges in schema public
  revoke all privileges on sequences from public;
alter default privileges in schema public
  revoke execute on functions from public;

do $$
declare
  api_role text;
begin
  foreach api_role in array array['anon', 'authenticated']
  loop
    if exists (select 1 from pg_roles where rolname = api_role) then
      execute format(
        'alter default privileges in schema public revoke all privileges on tables from %I',
        api_role
      );
      execute format(
        'alter default privileges in schema public revoke all privileges on sequences from %I',
        api_role
      );
      execute format(
        'alter default privileges in schema public revoke execute on functions from %I',
        api_role
      );
    end if;
  end loop;
end;
$$;

commit;
