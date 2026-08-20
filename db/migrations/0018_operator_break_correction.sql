-- ============================================================================
-- Operator-only correction for an accidentally activated player break.
--
-- A break is intentionally irreversible from the player and agent apps. The
-- one escape hatch is for a verified UI/support mistake, requires an active
-- operator plus a written reason, and records the old end date in the
-- append-only operator audit log before returning.
-- ============================================================================

create or replace function correct_accidental_player_break(
  p_player   uuid,
  p_operator uuid,
  p_reason   text
) returns timestamptz
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_previous timestamptz;
begin
  if length(trim(coalesce(p_reason, ''))) < 10 then
    raise exception 'A correction reason of at least 10 characters is required'
      using errcode = '22023';
  end if;

  if not exists (
    select 1 from operators
     where id = p_operator and disabled_at is null
  ) then
    raise exception 'An active operator is required'
      using errcode = '42501';
  end if;

  select self_excluded_until
    into v_previous
    from profiles
   where id = p_player
   for update;

  if not found then
    raise exception 'Player not found' using errcode = 'P0002';
  end if;

  if v_previous is null or v_previous <= now() then
    raise exception 'That player has no active break' using errcode = '22023';
  end if;

  update profiles
     set self_excluded_until = null
   where id = p_player;

  insert into audit_log (operator_id, target, field, old_value, new_value)
  values (
    p_operator,
    'profiles:' || p_player::text,
    'self_excluded_until',
    v_previous::text,
    'cleared after verified accidental activation: ' || trim(p_reason)
  );

  return v_previous;
end;
$$;

revoke all on function correct_accidental_player_break(uuid, uuid, text) from public;

comment on function correct_accidental_player_break(uuid, uuid, text) is
  'Operator-only, audited correction for a verified accidental break activation.';
