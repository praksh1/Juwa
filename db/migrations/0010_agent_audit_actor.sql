-- ============================================================================
-- Juwa — attribute agent status changes to whoever made them.
--
-- 0009's audit trigger recorded `new.created_by` as the operator on every row,
-- including status changes. That is the operator who CREATED the agent, so an
-- audit log written that way says the wrong thing in the one case anybody ever
-- reads it for: "who suspended this agent, and when". If Priya creates an agent
-- in March and Sam suspends them in August, the log credits Priya.
--
-- `juwa_current_operator()` already exists (0007) and already reads the
-- transaction-local `juwa.operator_id` the API sets before it writes. This
-- makes the agent triggers use it, falling back to `created_by` so a change
-- made outside the console is still attributed to somebody plausible rather
-- than dropped.
--
-- Safe to re-run, and safe to run on a database that already has 0009 applied:
-- it replaces two function bodies and touches no data.
-- ============================================================================

create or replace function audit_agent_change() returns trigger
language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    insert into audit_log (operator_id, target, field, old_value, new_value)
    values (coalesce(juwa_current_operator(), new.created_by),
            'agents:' || new.profile_id::text, 'created', null, new.status);
  elsif new.status is distinct from old.status then
    insert into audit_log (operator_id, target, field, old_value, new_value)
    values (coalesce(juwa_current_operator(), new.created_by),
            'agents:' || new.profile_id::text, 'status', old.status, new.status);
  elsif new.display_name is distinct from old.display_name then
    insert into audit_log (operator_id, target, field, old_value, new_value)
    values (coalesce(juwa_current_operator(), new.created_by),
            'agents:' || new.profile_id::text, 'display_name',
            old.display_name, new.display_name);
  end if;
  return null;
end;
$$;

/**
 * Change an agent's status, attributed, in one statement.
 *
 * A function rather than an UPDATE from the API, because the API's `query` runs
 * against a POOL: `begin` may check out one connection and the next statement a
 * different one, so a transaction-local `set_config` set by the caller is not
 * reliably visible to the trigger that reads it. Inside a function the whole
 * thing is one statement on one connection, which is the only arrangement where
 * the attribution is guaranteed to land.
 */
create or replace function set_agent_status(
  p_agent_id    uuid,
  p_status      text,
  p_operator_id uuid
) returns text
language plpgsql security definer as $$
begin
  if p_status not in ('pending', 'active', 'suspended') then
    raise exception 'Unknown agent status %', p_status using errcode = 'check_violation';
  end if;

  perform set_config('juwa.operator_id', coalesce(p_operator_id::text, ''), true);

  update agents
     set status       = p_status,
         activated_at = case when p_status = 'active' then coalesce(activated_at, now())
                             else activated_at end,
         -- Cleared on any non-suspended status, so "suspended_at" always means
         -- "suspended right now, since". A stale timestamp on a reinstated
         -- agent reads as a suspension that never ended.
         suspended_at = case when p_status = 'suspended' then now() else null end
   where profile_id = p_agent_id;

  if not found then
    raise exception 'Unknown agent %', p_agent_id using errcode = 'no_data_found';
  end if;

  return p_status;
end;
$$;

/**
 * Config changes fall back to `updated_by` too.
 *
 * Same pooling problem, found while fixing the agent one: `updateGameConfig`
 * issued `begin`, `set_config`, `insert`, `commit` as four separate pool
 * queries, which can be four different connections. In the best case the
 * attribution was silently lost; in the worst the `begin` stranded a pooled
 * connection idle in a transaction. Both rows already carry `updated_by`, so
 * reading that is strictly better than the setting AND removes the need for the
 * caller to open a transaction at all.
 */
create or replace function audit_config_change() returns trigger
language plpgsql as $$
declare
  v_target text;
  v_field  text;
  v_old    text;
  v_new    text;
  v_cols   text[];
begin
  if TG_TABLE_NAME = 'game_configs' then
    v_target := 'game_configs:' || new.game_id;
    v_cols := array['enabled', 'max_win_multiplier', 'min_bet', 'max_bet'];
  else
    v_target := 'global_settings';
    v_cols := array['welcome_grant', 'daily_bonus_base', 'top_up_amount'];
  end if;

  foreach v_field in array v_cols loop
    execute format('select ($1).%I::text, ($2).%I::text', v_field, v_field)
      into v_old, v_new
      using (case when TG_OP = 'INSERT' then null else old end), new;

    if TG_OP = 'INSERT' then v_old := null; end if;
    if v_old is distinct from v_new then
      insert into audit_log (operator_id, target, field, old_value, new_value)
      values (coalesce(juwa_current_operator(), new.updated_by), v_target, v_field, v_old, v_new);
    end if;
  end loop;

  return new;
end;
$$;

/**
 * Reassignment, same treatment.
 *
 * `assigned_by` is already passed explicitly by the admin path, so this changes
 * nothing there. It matters for the OTHER writer: `redeem_agent_invite` inserts
 * with `assigned_by` null, because a player redeeming a link is not an operator
 * action — and now that row is attributed to nobody deliberately rather than by
 * accident, which is the correct reading.
 */
create or replace function audit_player_agent_change() returns trigger
language plpgsql as $$
begin
  insert into audit_log (operator_id, target, field, old_value, new_value)
  values (coalesce(new.assigned_by, juwa_current_operator()),
          'player_agents:' || new.player_id::text, 'agent_id',
          case when tg_op = 'UPDATE' then old.agent_id::text else null end,
          new.agent_id::text);
  return null;
end;
$$;
