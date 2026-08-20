-- Juwa — Agent Vault.
--
-- A player may move playable GC into named custody with their assigned agent.
-- These coins are still the player's virtual, no-cash-value GC. They are not
-- transferred to the agent's distributable inventory and cannot be sold to a
-- different player. The three balances are deliberately separate accounts:
--
--   player (playable) -> vault_pending -> vault_saved -> player (restored)
--
-- Every arrow is a balanced ledger transaction and every public operation is
-- idempotent. The database, not the UI, enforces ownership and non-negativity.

alter type account_kind add value if not exists 'vault_pending';
alter type account_kind add value if not exists 'vault_saved';
alter type txn_type add value if not exists 'vault_save';
alter type txn_type add value if not exists 'vault_restore';

alter table accounts drop constraint if exists owner_matches_kind;
alter table accounts add constraint owner_matches_kind check (
  (kind::text in ('player', 'agent', 'vault_pending', 'vault_saved') and owner_id is not null) or
  (kind::text not in ('player', 'agent', 'vault_pending', 'vault_saved') and owner_id is null)
);

create or replace function player_vault_account(p_player_id uuid, p_kind text)
returns uuid
language plpgsql security definer
set search_path = public, pg_temp as $$
declare
  v_id uuid;
begin
  if p_kind not in ('vault_pending', 'vault_saved') then
    raise exception 'Unknown vault account kind %', p_kind using errcode = 'check_violation';
  end if;

  insert into accounts (owner_id, kind, currency)
  values (p_player_id, p_kind::account_kind, 'GC')
  on conflict (owner_id, kind, currency) do nothing;

  select id into v_id
    from accounts
   where owner_id = p_player_id and kind::text = p_kind and currency = 'GC';
  return v_id;
end;
$$;

-- Vault accounts are owned balances. Cache and protect them exactly as player
-- and agent balances are cached and protected.
create or replace function apply_entry_to_cache() returns trigger
language plpgsql as $$
declare
  v_kind text;
begin
  select kind::text into v_kind from accounts where id = new.account_id;
  if v_kind not in ('player', 'agent', 'vault_pending', 'vault_saved') then
    return null;
  end if;

  insert into account_balance_cache (account_id, balance, updated_at)
  values (new.account_id, new.amount, now())
  on conflict (account_id) do update
    set balance = account_balance_cache.balance + excluded.balance,
        updated_at = now();

  if (select balance from account_balance_cache where account_id = new.account_id) < 0 then
    raise exception 'Account % would go negative', new.account_id
      using errcode = 'check_violation';
  end if;
  return null;
end;
$$;

create or replace function post_transfer(
  p_type            txn_type,
  p_from_account    uuid,
  p_to_account      uuid,
  p_amount          bigint,
  p_currency        text,
  p_idempotency_key text default null,
  p_metadata        jsonb default '{}'::jsonb
) returns uuid
language plpgsql security definer
set search_path = public, pg_temp as $$
declare
  v_txn_id uuid;
  v_from_balance bigint;
  v_locked uuid;
begin
  if p_amount <= 0 then raise exception 'Transfer amount must be positive, got %', p_amount; end if;
  if p_from_account = p_to_account then raise exception 'Cannot transfer to the same account'; end if;

  if p_idempotency_key is not null then
    select id into v_txn_id from transactions where idempotency_key = p_idempotency_key;
    if found then return v_txn_id; end if;
  end if;

  for v_locked in
    select c.account_id
      from account_balance_cache c
      join accounts a on a.id = c.account_id
     where c.account_id in (p_from_account, p_to_account)
       and a.kind::text in ('player', 'agent', 'vault_pending', 'vault_saved')
     order by c.account_id
  loop
    perform 1 from account_balance_cache where account_id = v_locked for update;
  end loop;

  if (select kind::text from accounts where id = p_from_account)
       in ('player', 'agent', 'vault_pending', 'vault_saved') then
    select balance into v_from_balance
      from account_balance_cache where account_id = p_from_account;
    if coalesce(v_from_balance, 0) < p_amount then
      raise exception 'Insufficient funds: balance %, requested %',
        coalesce(v_from_balance, 0), p_amount using errcode = 'insufficient_privilege';
    end if;
  end if;

  insert into transactions (type, idempotency_key, metadata)
  values (p_type, p_idempotency_key, p_metadata)
  returning id into v_txn_id;

  if p_from_account < p_to_account then
    insert into ledger_entries (transaction_id, account_id, amount, currency)
    values (v_txn_id, p_from_account, -p_amount, p_currency),
           (v_txn_id, p_to_account, p_amount, p_currency);
  else
    insert into ledger_entries (transaction_id, account_id, amount, currency)
    values (v_txn_id, p_to_account, p_amount, p_currency),
           (v_txn_id, p_from_account, -p_amount, p_currency);
  end if;
  return v_txn_id;
end;
$$;

create table if not exists agent_vault_requests (
  id              uuid primary key default gen_random_uuid(),
  player_id       uuid not null references profiles(id) on delete restrict,
  agent_id        uuid not null references agents(profile_id) on delete restrict,
  amount          bigint not null check (amount > 0),
  remaining_amount bigint not null check (remaining_amount >= 0 and remaining_amount <= amount),
  status          text not null default 'pending'
                    check (status in ('pending', 'saved', 'cancelled', 'rejected', 'restored')),
  idempotency_key text not null unique,
  requested_at    timestamptz not null default now(),
  decided_at      timestamptz,
  decided_by      uuid references profiles(id),
  reason          text,
  request_txn_id  uuid references transactions(id),
  decision_txn_id uuid references transactions(id)
);

create unique index if not exists agent_vault_one_pending_per_player
  on agent_vault_requests (player_id) where status = 'pending';
create index if not exists agent_vault_requests_agent
  on agent_vault_requests (agent_id, status, requested_at desc);
create index if not exists agent_vault_requests_player
  on agent_vault_requests (player_id, requested_at desc);

create table if not exists agent_vault_restores (
  id              uuid primary key default gen_random_uuid(),
  player_id       uuid not null references profiles(id) on delete restrict,
  agent_id        uuid not null references agents(profile_id) on delete restrict,
  amount          bigint not null check (amount > 0),
  idempotency_key text not null unique,
  txn_id          uuid not null references transactions(id),
  created_at      timestamptz not null default now()
);
create index if not exists agent_vault_restores_agent
  on agent_vault_restores (agent_id, created_at desc);

create or replace function request_agent_vault_save(
  p_player_id uuid,
  p_amount bigint,
  p_idempotency_key text
) returns uuid
language plpgsql security definer
set search_path = public, pg_temp as $$
declare
  v_id uuid;
  v_agent_id uuid;
  v_status text;
  v_txn uuid;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'Save amount must be positive' using errcode = 'check_violation';
  end if;
  if nullif(trim(coalesce(p_idempotency_key, '')), '') is null then
    raise exception 'An idempotency key is required' using errcode = 'check_violation';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('vault-save:' || p_idempotency_key, 0));
  select id into v_id from agent_vault_requests where idempotency_key = p_idempotency_key;
  if v_id is not null then return v_id; end if;

  select pa.agent_id, a.status into v_agent_id, v_status
    from player_agents pa join agents a on a.profile_id = pa.agent_id
   where pa.player_id = p_player_id;
  if v_agent_id is null then
    raise exception 'Player does not have an agent' using errcode = 'insufficient_privilege';
  end if;
  if v_status <> 'active' then
    raise exception 'Agent is not active' using errcode = 'insufficient_privilege';
  end if;

  insert into agent_vault_requests
    (player_id, agent_id, amount, remaining_amount, idempotency_key)
  values (p_player_id, v_agent_id, p_amount, p_amount, p_idempotency_key)
  returning id into v_id;

  v_txn := post_transfer(
    'vault_save', player_account(p_player_id, 'GC'),
    player_vault_account(p_player_id, 'vault_pending'), p_amount, 'GC',
    'vault:request:' || p_idempotency_key,
    jsonb_build_object('request_id', v_id, 'player_id', p_player_id,
                       'agent_id', v_agent_id, 'stage', 'pending')
  );
  update agent_vault_requests set request_txn_id = v_txn where id = v_id;
  return v_id;
end;
$$;

create or replace function cancel_agent_vault_save(p_request_id uuid, p_player_id uuid)
returns uuid
language plpgsql security definer
set search_path = public, pg_temp as $$
declare
  r agent_vault_requests%rowtype;
  v_txn uuid;
begin
  select * into r from agent_vault_requests
   where id = p_request_id and player_id = p_player_id for update;
  if not found or r.status <> 'pending' then
    raise exception 'Vault request is not yours or is no longer pending'
      using errcode = 'insufficient_privilege';
  end if;
  v_txn := post_transfer(
    'vault_restore', player_vault_account(r.player_id, 'vault_pending'),
    player_account(r.player_id, 'GC'), r.amount, 'GC',
    'vault:cancel:' || r.id::text,
    jsonb_build_object('request_id', r.id, 'player_id', r.player_id,
                       'agent_id', r.agent_id, 'stage', 'cancelled')
  );
  update agent_vault_requests
     set status = 'cancelled', remaining_amount = 0, decided_at = now(),
         decided_by = p_player_id, decision_txn_id = v_txn
   where id = r.id;
  return r.id;
end;
$$;

create or replace function approve_agent_vault_save(p_request_id uuid, p_agent_id uuid)
returns uuid
language plpgsql security definer
set search_path = public, pg_temp as $$
declare
  r agent_vault_requests%rowtype;
  v_txn uuid;
begin
  if not exists (select 1 from agents where profile_id = p_agent_id and status = 'active') then
    raise exception 'Agent is not active' using errcode = 'insufficient_privilege';
  end if;
  select * into r from agent_vault_requests
   where id = p_request_id and agent_id = p_agent_id for update;
  if not found or r.status <> 'pending' then
    raise exception 'Vault request is not pending for this agent'
      using errcode = 'insufficient_privilege';
  end if;
  if not exists (select 1 from player_agents where player_id = r.player_id and agent_id = p_agent_id) then
    raise exception 'Player no longer belongs to agent' using errcode = 'insufficient_privilege';
  end if;
  v_txn := post_transfer(
    'vault_save', player_vault_account(r.player_id, 'vault_pending'),
    player_vault_account(r.player_id, 'vault_saved'), r.amount, 'GC',
    'vault:approve:' || r.id::text,
    jsonb_build_object('request_id', r.id, 'player_id', r.player_id,
                       'agent_id', r.agent_id, 'stage', 'saved')
  );
  update agent_vault_requests
     set status = 'saved', decided_at = now(), decided_by = p_agent_id,
         decision_txn_id = v_txn
   where id = r.id;
  return r.id;
end;
$$;

create or replace function reject_agent_vault_save(
  p_request_id uuid, p_agent_id uuid, p_reason text default null
) returns uuid
language plpgsql security definer
set search_path = public, pg_temp as $$
declare
  r agent_vault_requests%rowtype;
  v_txn uuid;
begin
  if not exists (select 1 from agents where profile_id = p_agent_id and status = 'active') then
    raise exception 'Agent is not active' using errcode = 'insufficient_privilege';
  end if;
  select * into r from agent_vault_requests
   where id = p_request_id and agent_id = p_agent_id for update;
  if not found or r.status <> 'pending' then
    raise exception 'Vault request is not pending for this agent'
      using errcode = 'insufficient_privilege';
  end if;
  v_txn := post_transfer(
    'vault_restore', player_vault_account(r.player_id, 'vault_pending'),
    player_account(r.player_id, 'GC'), r.amount, 'GC',
    'vault:reject:' || r.id::text,
    jsonb_build_object('request_id', r.id, 'player_id', r.player_id,
                       'agent_id', r.agent_id, 'stage', 'rejected')
  );
  update agent_vault_requests
     set status = 'rejected', remaining_amount = 0, decided_at = now(),
         decided_by = p_agent_id, decision_txn_id = v_txn,
         reason = nullif(trim(coalesce(p_reason, '')), '')
   where id = r.id;
  return r.id;
end;
$$;

create or replace function restore_agent_vault_gc(
  p_agent_id uuid,
  p_player_id uuid,
  p_amount bigint,
  p_idempotency_key text
) returns uuid
language plpgsql security definer
set search_path = public, pg_temp as $$
declare
  v_id uuid;
  v_txn uuid;
  v_available bigint;
  v_left bigint;
  v_take bigint;
  r agent_vault_requests%rowtype;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'Restore amount must be positive' using errcode = 'check_violation';
  end if;
  if nullif(trim(coalesce(p_idempotency_key, '')), '') is null then
    raise exception 'An idempotency key is required' using errcode = 'check_violation';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('vault-restore:' || p_idempotency_key, 0));
  select id into v_id from agent_vault_restores where idempotency_key = p_idempotency_key;
  if v_id is not null then return v_id; end if;

  if not exists (select 1 from agents where profile_id = p_agent_id and status = 'active') then
    raise exception 'Agent is not active' using errcode = 'insufficient_privilege';
  end if;
  if not exists (select 1 from player_agents where player_id = p_player_id and agent_id = p_agent_id) then
    raise exception 'Player does not belong to agent' using errcode = 'insufficient_privilege';
  end if;

  perform 1 from account_balance_cache
   where account_id = player_vault_account(p_player_id, 'vault_saved') for update;
  select coalesce(balance, 0) into v_available from account_balance_cache
   where account_id = player_vault_account(p_player_id, 'vault_saved');
  if v_available < p_amount then
    raise exception 'Insufficient saved funds: balance %, requested %', v_available, p_amount
      using errcode = 'insufficient_privilege';
  end if;

  v_txn := post_transfer(
    'vault_restore', player_vault_account(p_player_id, 'vault_saved'),
    player_account(p_player_id, 'GC'), p_amount, 'GC',
    'vault:restore:' || p_idempotency_key,
    jsonb_build_object('player_id', p_player_id, 'agent_id', p_agent_id,
                       'stage', 'restored')
  );
  insert into agent_vault_restores (player_id, agent_id, amount, idempotency_key, txn_id)
  values (p_player_id, p_agent_id, p_amount, p_idempotency_key, v_txn)
  returning id into v_id;

  v_left := p_amount;
  -- Saved GC belongs to the player, not to the agent who originally approved
  -- the save. If an operator later reassigns that player, their current agent
  -- can still restore it; the original request keeps its historical agent_id.
  for r in
    select * from agent_vault_requests
     where player_id = p_player_id and status = 'saved' and remaining_amount > 0
     order by requested_at, id
     for update
  loop
    exit when v_left = 0;
    v_take := least(v_left, r.remaining_amount);
    update agent_vault_requests
       set remaining_amount = remaining_amount - v_take,
           status = case when remaining_amount - v_take = 0 then 'restored' else status end
     where id = r.id;
    v_left := v_left - v_take;
  end loop;
  if v_left <> 0 then
    raise exception 'Vault request ledger does not reconcile' using errcode = 'data_exception';
  end if;
  return v_id;
end;
$$;

-- The browser authenticates with Supabase, but all application money movement
-- goes through the private Railway API. PostgreSQL grants EXECUTE on a new
-- function to PUBLIC by default unless the migration owner's default grants
-- were configured perfectly, so revoke it here as an explicit invariant.
revoke execute on function player_vault_account(uuid, text) from public;
revoke execute on function request_agent_vault_save(uuid, bigint, text) from public;
revoke execute on function cancel_agent_vault_save(uuid, uuid) from public;
revoke execute on function approve_agent_vault_save(uuid, uuid) from public;
revoke execute on function reject_agent_vault_save(uuid, uuid, text) from public;
revoke execute on function restore_agent_vault_gc(uuid, uuid, bigint, text) from public;

do $$
declare
  api_role text;
begin
  foreach api_role in array array['anon', 'authenticated']
  loop
    if exists (select 1 from pg_roles where rolname = api_role) then
      execute format(
        'revoke execute on function player_vault_account(uuid, text), request_agent_vault_save(uuid, bigint, text), cancel_agent_vault_save(uuid, uuid), approve_agent_vault_save(uuid, uuid), reject_agent_vault_save(uuid, uuid, text), restore_agent_vault_gc(uuid, uuid, bigint, text) from %I',
        api_role
      );
    end if;
  end loop;
end;
$$;

alter table agent_vault_requests enable row level security;
alter table agent_vault_restores enable row level security;

drop policy if exists agent_vault_requests_player_read on agent_vault_requests;
create policy agent_vault_requests_player_read on agent_vault_requests
  for select using (auth.uid() = player_id);
drop policy if exists agent_vault_requests_agent_read on agent_vault_requests;
create policy agent_vault_requests_agent_read on agent_vault_requests
  for select using (auth.uid() = agent_id);
drop policy if exists agent_vault_restores_player_read on agent_vault_restores;
create policy agent_vault_restores_player_read on agent_vault_restores
  for select using (auth.uid() = player_id);
drop policy if exists agent_vault_restores_agent_read on agent_vault_restores;
create policy agent_vault_restores_agent_read on agent_vault_restores
  for select using (auth.uid() = agent_id);

comment on table agent_vault_requests is
  'Player-attributed GC custody. Saved balances never enter agent inventory and have no cash value.';
