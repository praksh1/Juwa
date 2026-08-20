-- Juwa — dormant Agent Vault returns and a global single-wager payout cap.
--
-- Saved GC remains the player's property during a 60-day inactivity period and
-- a further 30-day warning. The agent can only START the warning; an operator
-- must approve the return after the grace period. Any authenticated player
-- activity cancels the warning and puts the reserved GC back in their vault.

alter type account_kind add value if not exists 'vault_return_pending';
alter type txn_type add value if not exists 'vault_return';

alter table accounts drop constraint if exists owner_matches_kind;
alter table accounts add constraint owner_matches_kind check (
  (kind::text in ('player', 'agent', 'vault_pending', 'vault_saved', 'vault_return_pending')
    and owner_id is not null) or
  (kind::text not in ('player', 'agent', 'vault_pending', 'vault_saved', 'vault_return_pending')
    and owner_id is null)
);

alter table global_settings
  add column if not exists vault_inactive_days int not null default 60
    check (vault_inactive_days between 1 and 3650),
  add column if not exists vault_warning_days int not null default 30
    check (vault_warning_days between 1 and 365),
  add column if not exists max_single_bet_payout bigint
    check (max_single_bet_payout is null or max_single_bet_payout > 0);

-- Existing players receive a fresh inactivity clock when this feature goes
-- live. A NULL timestamp must never make every existing player reclaimable.
update profiles set last_seen_at = now() where last_seen_at is null;

alter table game_rounds
  add column if not exists max_win_multiplier numeric(12,2)
    check (max_win_multiplier is null or max_win_multiplier >= 0),
  add column if not exists max_payout_gc bigint
    check (max_payout_gc is null or max_payout_gc > 0);

create or replace function player_vault_account(p_player_id uuid, p_kind text)
returns uuid
language plpgsql security definer
set search_path = public, pg_temp as $$
declare
  v_id uuid;
begin
  if p_kind not in ('vault_pending', 'vault_saved', 'vault_return_pending') then
    raise exception 'Unknown vault account kind %', p_kind using errcode = 'check_violation';
  end if;

  insert into accounts (owner_id, kind, currency)
  values (p_player_id, p_kind::account_kind, 'GC')
  on conflict (owner_id, kind, currency) do nothing;

  select id into v_id from accounts
   where owner_id = p_player_id and kind::text = p_kind and currency = 'GC';
  return v_id;
end;
$$;

create or replace function apply_entry_to_cache() returns trigger
language plpgsql as $$
declare
  v_kind text;
begin
  select kind::text into v_kind from accounts where id = new.account_id;
  if v_kind not in ('player', 'agent', 'vault_pending', 'vault_saved', 'vault_return_pending') then
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
  p_type txn_type, p_from_account uuid, p_to_account uuid, p_amount bigint,
  p_currency text, p_idempotency_key text default null,
  p_metadata jsonb default '{}'::jsonb
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
    select c.account_id from account_balance_cache c
    join accounts a on a.id = c.account_id
    where c.account_id in (p_from_account, p_to_account)
      and a.kind::text in ('player', 'agent', 'vault_pending', 'vault_saved', 'vault_return_pending')
    order by c.account_id
  loop
    perform 1 from account_balance_cache where account_id = v_locked for update;
  end loop;

  if (select kind::text from accounts where id = p_from_account)
       in ('player', 'agent', 'vault_pending', 'vault_saved', 'vault_return_pending') then
    select balance into v_from_balance from account_balance_cache where account_id = p_from_account;
    if coalesce(v_from_balance, 0) < p_amount then
      raise exception 'Insufficient funds: balance %, requested %',
        coalesce(v_from_balance, 0), p_amount using errcode = 'insufficient_privilege';
    end if;
  end if;

  insert into transactions (type, idempotency_key, metadata)
  values (p_type, p_idempotency_key, p_metadata) returning id into v_txn_id;

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

create table if not exists agent_vault_returns (
  id                uuid primary key default gen_random_uuid(),
  player_id         uuid not null references profiles(id) on delete restrict,
  agent_id          uuid not null references agents(profile_id) on delete restrict,
  amount            bigint not null check (amount > 0),
  status            text not null default 'warning'
                      check (status in ('warning', 'approved', 'cancelled', 'rejected')),
  idempotency_key   text not null unique,
  last_activity_at  timestamptz not null,
  warning_started_at timestamptz not null default now(),
  eligible_at       timestamptz not null,
  resolved_at       timestamptz,
  resolved_by       uuid references operators(id),
  reason            text,
  request_txn_id    uuid not null references transactions(id),
  resolution_txn_id uuid references transactions(id)
);
create unique index if not exists agent_vault_one_return_warning_per_player
  on agent_vault_returns (player_id) where status = 'warning';
create index if not exists agent_vault_returns_agent
  on agent_vault_returns (agent_id, status, warning_started_at desc);
create index if not exists agent_vault_returns_status
  on agent_vault_returns (status, eligible_at);

create or replace function consume_saved_vault_requests(p_player_id uuid, p_amount bigint)
returns void
language plpgsql security definer
set search_path = public, pg_temp as $$
declare
  v_left bigint := p_amount;
  v_take bigint;
  r agent_vault_requests%rowtype;
begin
  for r in
    select * from agent_vault_requests
     where player_id = p_player_id and status = 'saved' and remaining_amount > 0
     order by requested_at, id for update
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
end;
$$;

create or replace function request_dormant_vault_return(
  p_agent_id uuid, p_player_id uuid, p_amount bigint, p_idempotency_key text
) returns uuid
language plpgsql security definer
set search_path = public, pg_temp as $$
declare
  v_id uuid;
  v_last_seen timestamptz;
  v_inactive_days int;
  v_warning_days int;
  v_txn uuid;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'Return amount must be positive' using errcode = 'check_violation';
  end if;
  if nullif(trim(coalesce(p_idempotency_key, '')), '') is null then
    raise exception 'An idempotency key is required' using errcode = 'check_violation';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('vault-return:' || p_idempotency_key, 0));
  select id into v_id from agent_vault_returns where idempotency_key = p_idempotency_key;
  if v_id is not null then return v_id; end if;

  if not exists (select 1 from agents where profile_id = p_agent_id and status = 'active') then
    raise exception 'Agent is not active' using errcode = 'insufficient_privilege';
  end if;
  if not exists (select 1 from player_agents where player_id = p_player_id and agent_id = p_agent_id) then
    raise exception 'Player does not belong to agent' using errcode = 'insufficient_privilege';
  end if;

  select coalesce(last_seen_at, registered_at, created_at) into v_last_seen
    from profiles where id = p_player_id for update;
  select vault_inactive_days, vault_warning_days into v_inactive_days, v_warning_days
    from global_settings where id = true;
  if v_last_seen > now() - make_interval(days => v_inactive_days) then
    raise exception 'Player has not been inactive for % days', v_inactive_days
      using errcode = 'check_violation';
  end if;

  v_txn := post_transfer(
    'vault_return', player_vault_account(p_player_id, 'vault_saved'),
    player_vault_account(p_player_id, 'vault_return_pending'), p_amount, 'GC',
    'vault:return:warning:' || p_idempotency_key,
    jsonb_build_object('player_id', p_player_id, 'agent_id', p_agent_id, 'stage', 'warning')
  );
  insert into agent_vault_returns
    (player_id, agent_id, amount, idempotency_key, last_activity_at,
     warning_started_at, eligible_at, request_txn_id)
  values
    (p_player_id, p_agent_id, p_amount, p_idempotency_key, v_last_seen,
     now(), now() + make_interval(days => v_warning_days), v_txn)
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function cancel_dormant_vault_return(p_request_id uuid, p_agent_id uuid)
returns uuid
language plpgsql security definer
set search_path = public, pg_temp as $$
declare
  r agent_vault_returns%rowtype;
  v_txn uuid;
begin
  select * into r from agent_vault_returns
   where id = p_request_id and agent_id = p_agent_id for update;
  if not found or r.status <> 'warning' then
    raise exception 'Dormant return warning is not available for this agent'
      using errcode = 'insufficient_privilege';
  end if;
  v_txn := post_transfer(
    'vault_return', player_vault_account(r.player_id, 'vault_return_pending'),
    player_vault_account(r.player_id, 'vault_saved'), r.amount, 'GC',
    'vault:return:agent-cancel:' || r.id::text,
    jsonb_build_object('return_id', r.id, 'stage', 'agent_cancelled')
  );
  update agent_vault_returns set status = 'cancelled', resolved_at = now(),
    reason = 'Cancelled by agent', resolution_txn_id = v_txn where id = r.id;
  return r.id;
end;
$$;

create or replace function resolve_dormant_vault_return(
  p_request_id uuid, p_operator_id uuid, p_approve boolean, p_reason text default null
) returns uuid
language plpgsql security definer
set search_path = public, pg_temp as $$
declare
  r agent_vault_returns%rowtype;
  v_txn uuid;
begin
  if not exists (select 1 from operators where id = p_operator_id and disabled_at is null) then
    raise exception 'Operator is not active' using errcode = 'insufficient_privilege';
  end if;
  select * into r from agent_vault_returns where id = p_request_id for update;
  if not found or r.status <> 'warning' then
    raise exception 'Dormant return warning is no longer pending' using errcode = 'check_violation';
  end if;

  if p_approve then
    if now() < r.eligible_at then
      raise exception 'Warning period has not ended' using errcode = 'check_violation';
    end if;
    if exists (select 1 from profiles where id = r.player_id and last_seen_at > r.warning_started_at) then
      raise exception 'Player returned during the warning period' using errcode = 'check_violation';
    end if;
    v_txn := post_transfer(
      'vault_return', player_vault_account(r.player_id, 'vault_return_pending'),
      agent_account(r.agent_id, 'GC'), r.amount, 'GC',
      'vault:return:approved:' || r.id::text,
      jsonb_build_object('return_id', r.id, 'player_id', r.player_id,
                         'agent_id', r.agent_id, 'stage', 'approved')
    );
    perform consume_saved_vault_requests(r.player_id, r.amount);
    update agent_vault_returns set status = 'approved', resolved_at = now(),
      resolved_by = p_operator_id, reason = nullif(trim(coalesce(p_reason, '')), ''),
      resolution_txn_id = v_txn where id = r.id;
  else
    v_txn := post_transfer(
      'vault_return', player_vault_account(r.player_id, 'vault_return_pending'),
      player_vault_account(r.player_id, 'vault_saved'), r.amount, 'GC',
      'vault:return:rejected:' || r.id::text,
      jsonb_build_object('return_id', r.id, 'stage', 'operator_rejected')
    );
    update agent_vault_returns set status = 'rejected', resolved_at = now(),
      resolved_by = p_operator_id, reason = nullif(trim(coalesce(p_reason, '')), ''),
      resolution_txn_id = v_txn where id = r.id;
  end if;
  return r.id;
end;
$$;

create or replace function record_player_activity(p_player_id uuid)
returns int
language plpgsql security definer
set search_path = public, pg_temp as $$
declare
  r agent_vault_returns%rowtype;
  v_txn uuid;
  v_cancelled int := 0;
begin
  for r in select * from agent_vault_returns
    where player_id = p_player_id and status = 'warning' for update
  loop
    v_txn := post_transfer(
      'vault_return', player_vault_account(r.player_id, 'vault_return_pending'),
      player_vault_account(r.player_id, 'vault_saved'), r.amount, 'GC',
      'vault:return:player-returned:' || r.id::text,
      jsonb_build_object('return_id', r.id, 'stage', 'player_returned')
    );
    update agent_vault_returns set status = 'cancelled', resolved_at = now(),
      reason = 'Player returned during warning period', resolution_txn_id = v_txn
      where id = r.id;
    v_cancelled := v_cancelled + 1;
  end loop;
  update profiles set last_seen_at = now()
   where id = p_player_id and (last_seen_at is null or last_seen_at < now() - interval '5 minutes');
  return v_cancelled;
end;
$$;

-- Wrapper functions preserve the cap snapshot on both instant and multi-step
-- rounds while reusing the already-audited atomic ledger functions.
create or replace function play_instant_round_with_limits(
  p_player_id uuid, p_game_id text, p_seed_pair_id uuid, p_nonce int,
  p_stake bigint, p_payout bigint, p_currency text, p_state jsonb,
  p_idempotency_key text, p_max_win_multiplier numeric, p_max_payout_gc bigint
) returns table (round_id uuid, balance bigint)
language plpgsql security definer
set search_path = public, pg_temp as $$
declare
  v_existing_round uuid;
begin
  -- A retried idempotent request must retain the limits captured when its
  -- original round was created, even if an operator changes them later.
  select id into v_existing_round
    from game_rounds
   where player_id = p_player_id
     and seed_pair_id = p_seed_pair_id
     and nonce = p_nonce;
  select x.round_id, x.balance into round_id, balance
    from play_instant_round(p_player_id, p_game_id, p_seed_pair_id, p_nonce,
      p_stake, p_payout, p_currency, p_state, p_idempotency_key) x;
  if v_existing_round is null then
    update game_rounds set max_win_multiplier = p_max_win_multiplier,
      max_payout_gc = p_max_payout_gc where id = round_id;
  end if;
  return next;
end;
$$;

create or replace function open_round_with_limits(
  p_player_id uuid, p_game_id text, p_seed_pair_id uuid, p_nonce int,
  p_stake bigint, p_currency text, p_state jsonb, p_idempotency_key text,
  p_max_win_multiplier numeric, p_max_payout_gc bigint
) returns table (round_id uuid, balance bigint)
language plpgsql security definer
set search_path = public, pg_temp as $$
begin
  select x.round_id, x.balance into round_id, balance
    from open_round(p_player_id, p_game_id, p_seed_pair_id, p_nonce,
      p_stake, p_currency, p_state, p_idempotency_key) x;
  update game_rounds set max_win_multiplier = p_max_win_multiplier,
    max_payout_gc = p_max_payout_gc where id = round_id;
  return next;
end;
$$;

create or replace function audit_config_change() returns trigger
language plpgsql as $$
declare
  v_target text; v_field text; v_old text; v_new text; v_cols text[];
begin
  if TG_TABLE_NAME = 'game_configs' then
    v_target := 'game_configs:' || new.game_id;
    v_cols := array['enabled', 'max_win_multiplier', 'min_bet', 'max_bet'];
  else
    v_target := 'global_settings';
    v_cols := array['welcome_grant', 'daily_bonus_base', 'top_up_amount',
                    'vault_inactive_days', 'vault_warning_days', 'max_single_bet_payout'];
  end if;
  foreach v_field in array v_cols loop
    execute format('select ($1).%I::text, ($2).%I::text', v_field, v_field)
      into v_old, v_new using (case when TG_OP = 'INSERT' then null else old end), new;
    if TG_OP = 'INSERT' then v_old := null; end if;
    if v_old is distinct from v_new then
      insert into audit_log (operator_id, target, field, old_value, new_value)
      values (coalesce(juwa_current_operator(), new.updated_by), v_target, v_field, v_old, v_new);
    end if;
  end loop;
  return new;
end;
$$;

revoke execute on function player_vault_account(uuid, text) from public;
revoke execute on function consume_saved_vault_requests(uuid, bigint) from public;
revoke execute on function request_dormant_vault_return(uuid, uuid, bigint, text) from public;
revoke execute on function cancel_dormant_vault_return(uuid, uuid) from public;
revoke execute on function resolve_dormant_vault_return(uuid, uuid, boolean, text) from public;
revoke execute on function record_player_activity(uuid) from public;
revoke execute on function play_instant_round_with_limits(uuid, text, uuid, int, bigint, bigint, text, jsonb, text, numeric, bigint) from public;
revoke execute on function open_round_with_limits(uuid, text, uuid, int, bigint, text, jsonb, text, numeric, bigint) from public;

alter table agent_vault_returns enable row level security;
drop policy if exists agent_vault_returns_player_read on agent_vault_returns;
create policy agent_vault_returns_player_read on agent_vault_returns
  for select using (auth.uid() = player_id);
drop policy if exists agent_vault_returns_agent_read on agent_vault_returns;
create policy agent_vault_returns_agent_read on agent_vault_returns
  for select using (auth.uid() = agent_id);

comment on table agent_vault_returns is
  'Audited dormant-player vault return: 60 inactive days, 30-day warning, operator approval.';
