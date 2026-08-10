-- ============================================================================
-- Juwa — agent-created player accounts, and admin reversals.
--
-- TWO CHANGES, AND THE FIRST ONE IS A DELIBERATE POLICY DECISION
--
-- Until now a player always created their own account with their own password,
-- and an agent could only invite. The founder has chosen to let agents CREATE
-- accounts and set a temporary password, because their players are recruited in
-- person and many will not have an email address to sign up with.
--
-- The consequence, stated plainly because it should be in the schema and not
-- only in somebody's memory: for the window between creation and the player
-- setting their own password, the agent knows a working credential for that
-- account. Two things below narrow that window as far as it can be narrowed
-- without removing the feature.
--
--   `must_set_password` forces the player to choose their own password the
--   first time they sign in. Until they do, the app will let them do nothing
--   else — so the agent's copy stops working at first contact rather than
--   lasting for the life of the account.
--
--   `created_by_agent` records who made every such account, permanently. When
--   a dispute arrives — and with shared credentials one eventually does — the
--   question "was this account ever under someone else's control" has an
--   answer that does not depend on anyone's recollection.
--
-- The age gate is NOT relaxed. An agent creating an account supplies the
-- player's date of birth and state, `complete_registration` checks them exactly
-- as it does for self-service sign-up, and the attestation is now attributable
-- to a named agent rather than to an anonymous form.
-- ============================================================================

-- ------------------------------------------------------- the two new columns

alter table profiles
  add column if not exists must_set_password boolean not null default false;

/**
 * Who created this account, when it was not the player themselves.
 *
 * `on delete set null` rather than restrict: an agent may eventually be
 * removed, and the player's account must survive that. The audit_log row
 * written at creation is the permanent record; this column is the fast answer.
 */
alter table profiles
  add column if not exists created_by_agent uuid references agents(profile_id) on delete set null;

comment on column profiles.must_set_password is
  'True while an agent-set temporary password is still in force. The app '
  'refuses to do anything else until the player replaces it.';

-- ------------------------------------------------------- creating a player

/**
 * An agent creates a player account.
 *
 * The auth user itself is created by the API through Supabase''s admin API —
 * passwords are Supabase''s business and nothing in this database ever sees
 * one. By the time this runs the auth row exists and this attaches everything
 * that is ours: the profile, the welcome bonus, the agent binding, and the
 * flag that forces the password to be replaced.
 *
 * Atomic, so a failure part way through cannot leave a player who exists but
 * belongs to nobody, or one bound to an agent with no balance record.
 */
create or replace function create_agent_player(
  p_agent_id      uuid,
  p_player_id     uuid,
  p_username      text,
  p_date_of_birth date,
  p_country       text,
  p_region        text,
  p_welcome_coins bigint
) returns table (username text, balance bigint)
language plpgsql security definer as $$
declare
  v_status text;
  v_row    record;
begin
  -- The same status gate allocation uses. A suspended agent creating accounts
  -- would be a suspended agent still growing their book.
  select status into v_status from agents where profile_id = p_agent_id;
  if not found then
    raise exception 'Unknown agent %', p_agent_id using errcode = 'no_data_found';
  end if;
  if v_status <> 'active' then
    raise exception 'Agent % is not active', p_agent_id using errcode = 'insufficient_privilege';
  end if;

  -- Age, jurisdiction, username rules, welcome bonus: all of it, unchanged.
  -- An account made by an agent is subject to exactly the checks an account
  -- made by its own owner is.
  select * into v_row from complete_registration(
    p_player_id, p_username, p_date_of_birth, p_country, p_region, p_welcome_coins
  );

  update profiles
     set must_set_password = true,
         created_by_agent  = p_agent_id
   where id = p_player_id;

  insert into player_agents (player_id, agent_id)
  values (p_player_id, p_agent_id)
  on conflict (player_id) do nothing;

  insert into audit_log (operator_id, target, field, old_value, new_value)
  values (null, 'profiles:' || p_player_id::text, 'created_by_agent',
          null, p_agent_id::text);

  username := v_row.username;
  balance  := v_row.balance;
  return next;
end;
$$;

comment on function create_agent_player is
  'Agent-created player account. Applies the full age and jurisdiction gate, '
  'and marks the temporary password as one that must be replaced.';

/**
 * The player has chosen their own password.
 *
 * Called by the API after Supabase has accepted the change, so this only ever
 * records that it happened — the password itself never reaches this database.
 */
create or replace function clear_must_set_password(p_player_id uuid)
returns void
language plpgsql security definer as $$
begin
  update profiles set must_set_password = false
   where id = p_player_id and must_set_password;

  if found then
    insert into audit_log (operator_id, target, field, old_value, new_value)
    values (null, 'profiles:' || p_player_id::text, 'must_set_password', 'true', 'false');
  end if;
end;
$$;

-- ------------------------------------------------------------- reversals

/**
 * Undo an allocation, as a NEW transaction.
 *
 * Nothing is deleted and nothing is edited. The original allocation stays in
 * the ledger exactly as it was posted, and this adds an equal and opposite
 * transaction beside it — so the balances come out right and the record still
 * shows that a mistake was made and then corrected. An accounting system where
 * errors can be made to disappear is one nobody can rely on afterwards.
 *
 * ADMIN ONLY, and that is the whole design. There is no agent-facing route to
 * this and there must not be: an agent who can pull coins back out of a
 * player''s balance on request is an agent who can settle up in cash, which is
 * the line this product does not cross.
 *
 * If the player has already spent the coins the reversal FAILS, because their
 * balance cannot go negative. That is correct — the alternative is a player
 * pushed into debt by an operator''s correction.
 */
create or replace function reverse_allocation(
  p_txn_id      uuid,
  p_operator_id uuid,
  p_reason      text
) returns table (txn_id uuid, agent_inventory bigint, player_balance bigint)
language plpgsql security definer as $$
declare
  v_type            txn_type;
  v_agent_id        uuid;
  v_player_id       uuid;
  v_amount          bigint;
  v_agent_account   uuid;
  v_player_account  uuid;
  v_new_txn         uuid;
begin
  select t.type,
         (t.metadata->>'agent_id')::uuid,
         (t.metadata->>'player_id')::uuid
    into v_type, v_agent_id, v_player_id
    from transactions t
   where t.id = p_txn_id;

  if not found then
    raise exception 'No such transaction %', p_txn_id using errcode = 'no_data_found';
  end if;
  if v_type::text <> 'allocation' then
    raise exception 'Only an allocation can be reversed, not %', v_type
      using errcode = 'check_violation';
  end if;
  if v_agent_id is null or v_player_id is null then
    raise exception 'Transaction % does not name an agent and a player', p_txn_id
      using errcode = 'check_violation';
  end if;

  -- Refuse a second reversal of the same transaction. Without this, two
  -- operators reading the same support ticket take the coins back twice.
  if exists (
    select 1 from transactions
     where type::text = 'allocation'
       and (metadata->>'reverses') = p_txn_id::text
  ) then
    raise exception 'Transaction % has already been reversed', p_txn_id
      using errcode = 'unique_violation';
  end if;

  v_agent_account  := agent_account(v_agent_id, 'GC');
  v_player_account := player_account(v_player_id, 'GC');

  select abs(e.amount) into v_amount
    from ledger_entries e
   where e.transaction_id = p_txn_id and e.account_id = v_player_account;

  -- Player -> agent, which is the ONLY place in this schema that direction
  -- exists. It is reachable from one admin-only function, by transaction id,
  -- once per transaction, and never from any agent- or player-facing route.
  v_new_txn := post_transfer(
    'allocation',
    v_player_account,
    v_agent_account,
    v_amount,
    'GC',
    'reversal:' || p_txn_id::text,
    jsonb_build_object(
      'agent_id', v_agent_id,
      'player_id', v_player_id,
      'reverses', p_txn_id,
      'operator_id', p_operator_id,
      'reason', p_reason
    )
  );

  insert into audit_log (operator_id, target, field, old_value, new_value)
  values (p_operator_id, 'transactions:' || p_txn_id::text, 'reversed',
          v_amount::text, coalesce(p_reason, 'no reason given'));

  txn_id := v_new_txn;
  select balance into agent_inventory from account_balance_cache where account_id = v_agent_account;
  select balance into player_balance  from account_balance_cache where account_id = v_player_account;
  return next;
end;
$$;

comment on function reverse_allocation is
  'Admin-only correction of a mis-sent allocation. Posts an opposite '
  'transaction rather than editing history, and refuses to run twice.';

-- --------------------------------------------------------- applying to be one

/**
 * Someone asks to become an agent.
 *
 * Creates a `pending` row, which grants nothing: `allocate_to_player` and
 * `redeem_agent_invite` both require 'active', so an application is an entry in
 * a queue and not a capability. An operator approving it is what makes it real.
 *
 * One row per profile — the primary key sees to that — so this cannot be used
 * to flood the queue from a single account.
 */
create or replace function apply_to_be_agent(
  p_profile_id   uuid,
  p_display_name text,
  p_notes        text default null
) returns text
language plpgsql security definer as $$
declare
  v_status text;
begin
  if not exists (select 1 from profiles where id = p_profile_id and registered_at is not null) then
    raise exception 'Registration is not complete' using errcode = 'check_violation';
  end if;

  select status into v_status from agents where profile_id = p_profile_id;
  if found then
    -- Already applied or already an agent. Returning the current status rather
    -- than raising keeps a double-tap harmless.
    return v_status;
  end if;

  insert into agents (profile_id, display_name, status, created_by, notes)
  values (p_profile_id, p_display_name, 'pending', null, p_notes);

  return 'pending';
end;
$$;
