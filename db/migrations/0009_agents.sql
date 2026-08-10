-- ============================================================================
-- Juwa — agents.
--
-- ADMIN -> AGENT -> PLAYER. Agents are distributors: they hold an inventory of
-- coins and allocate it to the players they brought to the platform. They do
-- not recruit other agents, there are no downlines, and there is no commission
-- structure. One level, deliberately.
--
-- WHY THIS IS A SMALL MIGRATION
--
-- Because the money layer was already right. An agent allocation is a transfer
-- between two accounts, and `post_transfer` has done exactly that — atomically,
-- double-entry, idempotent, deadlock-free — since 0001. Almost everything below
-- is identity and authorisation; the ledger needed six lines.
--
-- WHERE AUTHORISATION LIVES
--
-- Here, not in the API. `allocate_to_player` re-checks that the agent is active
-- and that the player is theirs, inside the same transaction that moves the
-- coins. An API bug, a mistaken route, or a direct psql session cannot move
-- coins between an agent and a player who are not related, because the function
-- that moves them refuses. The API's own checks are a better error message, not
-- the control.
--
-- WHAT AGENTS STILL CANNOT DO
--
-- Take coins back. There is no player -> agent path in this file, and that is
-- not an omission: a player who can return coins to an agent is a player who
-- can be paid cash for them, which is the line between a social casino and
-- something that needs a gambling licence.
-- ============================================================================

-- --------------------------------------------------------------- the kinds

/**
 * A third kind of account: an agent's undistributed inventory.
 *
 * SEPARATE from the agent's own player balance, which they still have and can
 * still play with. The uniqueness constraint on `accounts` is already keyed on
 * `kind`, so one profile holding both an 'agent' and a 'player' account needs
 * no schema change — and inventory can never be spent in a game, because every
 * game reaches its money through `player_account()`, which only ever returns
 * accounts of kind 'player'.
 */
alter type account_kind add value if not exists 'agent';

/**
 * Two new transaction types.
 *
 * `inventory` is admin -> agent, `allocation` is agent -> player. Both could
 * have been recorded as 'adjustment', and then every report about where coins
 * went would begin by parsing metadata to find out what kind of adjustment it
 * was. A ledger that describes itself is worth two enum values.
 */
alter type txn_type add value if not exists 'inventory';
alter type txn_type add value if not exists 'allocation';

-- --------------------------------------------------------------- identity

/**
 * An agent is a profile with an agent row, not a boolean on the profile.
 *
 * The distinction matters. A flag is one mistaken UPDATE from turning a player
 * into a distributor; a row in a table with its own lifecycle, its own audit
 * trail and its own foreign keys is not. It also means an agent is a normal
 * Supabase user — they log in, reset their password and verify their email
 * through the same flow every player uses, which is why nothing in this file
 * ever handles an agent's password, and why an agent never handles a player's.
 *
 * `status` gates everything. A suspended agent cannot allocate, cannot invite,
 * and cannot receive inventory, and that is enforced in `allocate_to_player`
 * rather than being left to whichever endpoint remembers to check.
 */
create table if not exists agents (
  profile_id   uuid primary key references profiles(id) on delete restrict,
  display_name text not null check (char_length(display_name) between 2 and 64),
  status       text not null default 'pending'
                 check (status in ('pending', 'active', 'suspended')),
  /** The operator who created this agent. Never another agent — see below. */
  created_by   uuid references operators(id),
  created_at   timestamptz not null default now(),
  activated_at timestamptz,
  suspended_at timestamptz,
  notes        text
);

comment on table agents is
  'Distributors. One level only: an agent cannot create another agent.';

/**
 * Which agent a player belongs to.
 *
 * A separate table rather than a column on `profiles` for two reasons: a player
 * may have no agent at all (everyone who registered before this existed, and
 * anyone who signs up directly), and the assignment carries its own history —
 * who did it and when. Primary key on the player, so a player has at most one
 * agent and reassignment is an UPDATE rather than a second row that silently
 * duplicates them.
 */
create table if not exists player_agents (
  player_id   uuid primary key references profiles(id) on delete cascade,
  agent_id    uuid not null references agents(profile_id) on delete restrict,
  assigned_at timestamptz not null default now(),
  /** The operator who reassigned, if this was not the original invitation. */
  assigned_by uuid references operators(id)
);

create index if not exists player_agents_by_agent on player_agents (agent_id, assigned_at desc);

comment on table player_agents is
  'Each player belongs to at most one agent. Reassignment is admin-only.';

/**
 * Invitations.
 *
 * The token is stored as a HASH, for the same reason `operator_sessions` stores
 * a hash: a database dump then contains nothing that can be redeemed. The agent
 * sends the raw token in a link; the server hashes what it is given and looks
 * for a match.
 *
 * Single-use and expiring are enforced by `redeem_agent_invite` below rather
 * than by convention.
 */
create table if not exists agent_invites (
  id           uuid primary key default gen_random_uuid(),
  agent_id     uuid not null references agents(profile_id) on delete cascade,
  token_hash   text unique not null,
  /** Optional label so an agent can tell two outstanding invites apart. */
  label        text,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null,
  redeemed_at  timestamptz,
  redeemed_by  uuid references profiles(id) on delete set null
);

create index if not exists agent_invites_by_agent on agent_invites (agent_id, created_at desc);

-- ------------------------------------------------------------- the account

/**
 * An agent's inventory account, created on first use.
 *
 * Mirrors `player_account` exactly, including the fact that it is the only way
 * to obtain the id. Nothing else in the system should look up an account by
 * `kind = 'agent'` directly.
 */
create or replace function agent_account(p_agent_id uuid, p_currency text)
returns uuid
language plpgsql security definer as $$
declare
  v_id uuid;
begin
  select id into v_id
  from accounts
  where owner_id = p_agent_id and kind = 'agent' and currency = p_currency;

  if v_id is null then
    insert into accounts (owner_id, kind, currency)
    values (p_agent_id, 'agent', p_currency)
    returning id into v_id;
  end if;

  return v_id;
end;
$$;

/**
 * Agent accounts have an owner, like player accounts do.
 *
 * The original constraint said: player accounts have an owner, everything else
 * does not. That was right when everything else was the house, the promo pool
 * and the jackpots — system accounts owned by nobody. An agent's inventory is
 * owned by a specific agent, so the rule becomes "accounts belonging to a
 * person have an owner; system accounts do not".
 */
/*
 * NOTE THE `::text` CASTS. They are not decoration.
 *
 * `ALTER TYPE ... ADD VALUE` cannot be USED in the transaction that adds it —
 * Postgres refuses with "unsafe use of new value". A CHECK constraint resolves
 * its literals against the enum at the moment the constraint is created, so
 * `kind in ('player','agent')` fails when this file runs as one script, which
 * is exactly how `ALL.sql` is applied. Comparing the text avoids resolving the
 * literal at DDL time and behaves identically at runtime.
 *
 * Function bodies are safe without the cast: plpgsql resolves literals when the
 * function runs, which is always after this has committed.
 */
alter table accounts drop constraint if exists owner_matches_kind;
alter table accounts add constraint owner_matches_kind check (
  (kind::text in ('player', 'agent') and owner_id is not null) or
  (kind::text not in ('player', 'agent') and owner_id is null)
);

-- ------------------------------------------------- money movement, extended

/**
 * Agent inventory is cached and cannot go negative — the same two properties
 * player balances have, for the same two reasons.
 *
 * The cache is what makes "how much has this agent got left" a single-row read
 * rather than a sum over the ledger, and it is the row `post_transfer` locks to
 * make concurrent allocations safe. The non-negative check is the whole of
 * "an agent must never be able to allocate more coins than they have": two
 * simultaneous requests for the last 100,000 coins cannot both succeed, because
 * the second one waits for the first to commit and then fails the check.
 *
 * Only the `= 'player'` tests change. Everything else is 0008 verbatim.
 */
create or replace function apply_entry_to_cache() returns trigger
language plpgsql as $$
declare
  v_kind text;
begin
  select kind::text into v_kind from accounts where id = new.account_id;

  -- House, escrow and revenue balances come from `account_balances`. Caching
  -- them bought nothing and cost every concurrent transaction in the system.
  if v_kind not in ('player', 'agent') then
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
language plpgsql security definer as $$
declare
  v_txn_id uuid;
  v_from_balance bigint;
  v_locked uuid;
begin
  if p_amount <= 0 then
    raise exception 'Transfer amount must be positive, got %', p_amount;
  end if;
  if p_from_account = p_to_account then
    raise exception 'Cannot transfer to the same account';
  end if;

  if p_idempotency_key is not null then
    select id into v_txn_id from transactions where idempotency_key = p_idempotency_key;
    if found then
      return v_txn_id;
    end if;
  end if;

  -- Every OWNED row this transfer will touch, ascending by id, before writing
  -- anything. Agent rows join players here: an allocation locks the agent's
  -- inventory and the player's balance in id order, so it can never invert
  -- against a concurrent bet, payout or second allocation.
  for v_locked in
    select c.account_id
    from account_balance_cache c
    join accounts a on a.id = c.account_id
    where c.account_id in (p_from_account, p_to_account)
      and a.kind::text in ('player', 'agent')
    order by c.account_id
  loop
    perform 1 from account_balance_cache where account_id = v_locked for update;
  end loop;

  -- Players and agents can be short of funds; house accounts are allowed to run
  -- negative, which is what a jackpot looks like before revenue catches up.
  if (select kind::text from accounts where id = p_from_account) in ('player', 'agent') then
    select balance into v_from_balance
    from account_balance_cache
    where account_id = p_from_account;

    if coalesce(v_from_balance, 0) < p_amount then
      raise exception 'Insufficient funds: balance %, requested %',
        coalesce(v_from_balance, 0), p_amount
        using errcode = 'insufficient_privilege';
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

-- ---------------------------------------------------------- the operations

/**
 * Admin -> agent. Inventory in.
 *
 * Coins come from the house account, exactly as a player purchase does, because
 * that is where coins are issued from in this system. Nothing is minted.
 */
create or replace function grant_agent_inventory(
  p_agent_id        uuid,
  p_amount          bigint,
  p_operator_id     uuid,
  p_idempotency_key text default null,
  p_reference       text default null
) returns table (txn_id uuid, inventory bigint)
language plpgsql security definer as $$
declare
  v_account uuid;
  v_txn uuid;
  v_status text;
begin
  select status into v_status from agents where profile_id = p_agent_id;
  if not found then
    raise exception 'Unknown agent %', p_agent_id using errcode = 'no_data_found';
  end if;
  if v_status = 'suspended' then
    raise exception 'Agent % is suspended' , p_agent_id using errcode = 'insufficient_privilege';
  end if;

  v_account := agent_account(p_agent_id, 'GC');

  v_txn := post_transfer(
    'inventory',
    system_account('house', 'GC'),
    v_account,
    p_amount,
    'GC',
    p_idempotency_key,
    jsonb_build_object(
      'agent_id', p_agent_id,
      'operator_id', p_operator_id,
      'reference', p_reference
    )
  );

  insert into audit_log (operator_id, target, field, old_value, new_value)
  values (p_operator_id, 'agents:' || p_agent_id::text, 'inventory_granted',
          null, p_amount::text);

  txn_id := v_txn;
  select balance into inventory from account_balance_cache where account_id = v_account;
  return next;
end;
$$;

/**
 * Agent -> player. The operation this whole file exists for.
 *
 * ## Every guard that matters is in here
 *
 * The agent must exist and be active. The player must belong to THIS agent.
 * The amount must be positive. The inventory must cover it. None of those are
 * checked by the caller — they are checked here, inside the transaction that
 * moves the coins, so no API mistake and no direct database session can move
 * coins between an agent and a player who are not related.
 *
 * ## Why the balances are stamped into metadata
 *
 * The ledger can always reconstruct a balance by summing entries, so storing
 * "balance before" and "balance after" is strictly redundant. It is recorded
 * anyway because the question asked after something has gone wrong is never
 * "what does the ledger sum to now" — it is "what did this agent believe they
 * had at 14:32", and answering that from first principles months later is an
 * afternoon. It costs two integers.
 */
create or replace function allocate_to_player(
  p_agent_id        uuid,
  p_player_id       uuid,
  p_amount          bigint,
  p_idempotency_key text default null
) returns table (txn_id uuid, agent_inventory bigint, player_balance bigint)
language plpgsql security definer as $$
declare
  v_agent_account uuid;
  v_player_account uuid;
  v_txn uuid;
  v_status text;
  v_owner uuid;
  v_agent_before bigint;
  v_player_before bigint;
begin
  if p_amount <= 0 then
    raise exception 'Allocation must be positive, got %', p_amount
      using errcode = 'check_violation';
  end if;

  select status into v_status from agents where profile_id = p_agent_id;
  if not found then
    raise exception 'Unknown agent %', p_agent_id using errcode = 'no_data_found';
  end if;
  if v_status <> 'active' then
    raise exception 'Agent % is not active', p_agent_id
      using errcode = 'insufficient_privilege';
  end if;

  -- THE ownership check. An agent may only fund their own players.
  select agent_id into v_owner from player_agents where player_id = p_player_id;
  if v_owner is distinct from p_agent_id then
    raise exception 'Player % does not belong to agent %', p_player_id, p_agent_id
      using errcode = 'insufficient_privilege';
  end if;

  v_agent_account := agent_account(p_agent_id, 'GC');
  v_player_account := player_account(p_player_id, 'GC');

  select balance into v_agent_before from account_balance_cache where account_id = v_agent_account;
  select balance into v_player_before from account_balance_cache where account_id = v_player_account;

  v_txn := post_transfer(
    'allocation',
    v_agent_account,
    v_player_account,
    p_amount,
    'GC',
    p_idempotency_key,
    jsonb_build_object(
      'agent_id', p_agent_id,
      'player_id', p_player_id,
      'initiated_by', p_agent_id,
      'agent_balance_before', coalesce(v_agent_before, 0),
      'player_balance_before', coalesce(v_player_before, 0)
    )
  );

  txn_id := v_txn;
  select balance into agent_inventory from account_balance_cache where account_id = v_agent_account;
  select balance into player_balance from account_balance_cache where account_id = v_player_account;
  return next;
end;
$$;

comment on function allocate_to_player is
  'Agent -> player coin allocation. Checks agent status and player ownership '
  'inside the transaction that moves the coins, so the API is not the control.';

/**
 * Redeem an invitation and bind the player to the agent.
 *
 * Single-use, expiring, and both are enforced by the UPDATE's WHERE clause
 * rather than by a read followed by a write — two players redeeming the same
 * link at the same moment cannot both succeed, because only one UPDATE can
 * match a row whose `redeemed_at` is still null.
 */
create or replace function redeem_agent_invite(
  p_token_hash text,
  p_player_id  uuid
) returns uuid
language plpgsql security definer as $$
declare
  v_agent uuid;
begin
  update agent_invites
  set redeemed_at = now(), redeemed_by = p_player_id
  where token_hash = p_token_hash
    and redeemed_at is null
    and expires_at > now()
    and agent_id in (select profile_id from agents where status = 'active')
  returning agent_id into v_agent;

  if v_agent is null then
    raise exception 'Invitation is invalid, expired or already used'
      using errcode = 'insufficient_privilege';
  end if;

  insert into player_agents (player_id, agent_id)
  values (p_player_id, v_agent)
  on conflict (player_id) do nothing;

  return v_agent;
end;
$$;

-- ------------------------------------------------------------------ audit

/**
 * Agent lifecycle changes are audited from a trigger.
 *
 * The same argument as `game_configs`: application code can forget, a direct
 * psql session bypasses it entirely, and "who suspended this agent and when" is
 * asked only after it matters.
 */
create or replace function audit_agent_change() returns trigger
language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    insert into audit_log (operator_id, target, field, old_value, new_value)
    values (new.created_by, 'agents:' || new.profile_id::text, 'created', null, new.status);
  elsif new.status is distinct from old.status then
    insert into audit_log (operator_id, target, field, old_value, new_value)
    values (new.created_by, 'agents:' || new.profile_id::text, 'status', old.status, new.status);
  end if;
  return null;
end;
$$;

drop trigger if exists agents_audited on agents;
create trigger agents_audited
  after insert or update on agents
  for each row execute function audit_agent_change();

/**
 * Reassignment is audited too, and it is the only way a player changes agent.
 * There is no self-service path in the API for this by design.
 */
create or replace function audit_player_agent_change() returns trigger
language plpgsql as $$
begin
  insert into audit_log (operator_id, target, field, old_value, new_value)
  values (new.assigned_by, 'player_agents:' || new.player_id::text, 'agent_id',
          case when tg_op = 'UPDATE' then old.agent_id::text else null end,
          new.agent_id::text);
  return null;
end;
$$;

drop trigger if exists player_agents_audited on player_agents;
create trigger player_agents_audited
  after insert or update on player_agents
  for each row execute function audit_player_agent_change();
