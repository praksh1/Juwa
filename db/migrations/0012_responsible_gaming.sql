-- ============================================================================
-- Juwa — the responsible-gaming controls, made real.
--
-- The Profile screen has listed "Daily spend limit", "Session reminder", "Take a
-- break" and "Self-exclude" since the wireframe. Three of the four did nothing
-- at all, and the fourth — self-exclusion — was already enforced by
-- `assert_can_play` but had no way to be switched on.
--
-- That gap is worse than not offering them. A player who sets a limit believes
-- they have set a limit; a control that silently does nothing is a promise the
-- product breaks at the exact moment somebody was trying to look after
-- themselves. It is also the first thing a regulator or an acquirer looks at.
--
-- WHAT IS ENFORCED WHERE
--
--   self-exclusion    `assert_can_play` — already, since 0004. Every bet route
--                     calls it, so exclusion blocks play by the same path the
--                     age gate does.
--   daily wager cap   `assert_can_play` too, added below. Same choke point,
--                     same guarantee: it cannot be bypassed by a route that
--                     forgets to check.
--   session reminder  the app. It is a nudge, not a control — nothing is
--                     refused — so enforcing it server-side would buy nothing
--                     and cost a request per minute.
--
-- WHY A LIMIT CAN BE LOOSENED ONLY AFTER A DELAY
--
-- Tightening a limit takes effect immediately; loosening one takes 24 hours.
-- That asymmetry is the entire point of the feature. A limit that can be raised
-- the instant it bites is not a limit, it is a speed bump — and the moment
-- somebody wants it raised is precisely the moment it is doing its job.
-- ============================================================================

alter table profiles
  add column if not exists daily_wager_limit bigint
    check (daily_wager_limit is null or daily_wager_limit > 0);

/**
 * When a loosened limit becomes effective.
 *
 * Null means no pending change. The columns above always hold what is IN FORCE
 * now, so every read path stays a plain column read and cannot forget to apply
 * a pending value.
 */
alter table profiles
  add column if not exists pending_wager_limit bigint
    check (pending_wager_limit is null or pending_wager_limit > 0);
alter table profiles
  add column if not exists pending_limit_at timestamptz;

comment on column profiles.daily_wager_limit is
  'Coins this player may stake per day. Enforced in assert_can_play.';

-- ------------------------------------------------------------- how much today

/**
 * Coins staked since the player's local midnight.
 *
 * Summed from `game_rounds` rather than kept as a counter, for the same reason
 * `top_up_status` is: a counter needs resetting at midnight by something, and
 * that something is a cron job that fails silently one night and never gets
 * noticed.
 *
 * The offset is the player's, passed in by the API from the browser, so the day
 * turns over at their midnight and not the server's.
 */
create or replace function wagered_today(p_player_id uuid, p_utc_offset_minutes int default 0)
returns bigint
language sql stable security definer as $$
  select coalesce(sum(r.stake), 0)::bigint
    from game_rounds r
   where r.player_id = p_player_id
     and (r.created_at + make_interval(mins => p_utc_offset_minutes))::date
         = (now() + make_interval(mins => p_utc_offset_minutes))::date;
$$;

-- ------------------------------------------------------------ the gate itself

/**
 * Everything that can stop a bet, in one function.
 *
 * 0004 verbatim plus two additions: any pending limit change that has matured
 * is applied first, then the daily cap is checked. Doing the maturity check
 * here rather than in a scheduled job means there is nothing to schedule and
 * nothing that can be down at midnight.
 *
 * NO LONGER `stable`. It writes when a pending limit matures, and a stable
 * function that writes is a function Postgres is entitled to skip.
 */
/*
 * The single-argument version from 0004 is DROPPED first, and it has to be.
 *
 * `create or replace` cannot change a signature, so the new three-argument form
 * is a second function rather than a replacement — and because its extra
 * arguments have defaults, every existing one-argument call becomes ambiguous:
 * "function assert_can_play(unknown) is not unique". Postgres refuses to guess,
 * so the age gate, the self-exclusion check and every bet start failing at
 * once. Nothing about that is visible in the migration that adds the overload;
 * it shows up as unrelated routes returning 500.
 */
drop function if exists assert_can_play(uuid);

create or replace function assert_can_play(
  p_player_id uuid,
  p_utc_offset_minutes int default 0,
  p_stake bigint default 0
) returns void
language plpgsql security definer as $$
declare
  v profiles%rowtype;
  v_wagered bigint;
begin
  select * into v from profiles where id = p_player_id;

  if not found or v.registered_at is null then
    raise exception 'Registration is not complete' using errcode = 'check_violation';
  end if;
  if v.age_verified_at is null then
    raise exception 'Age verification is required' using errcode = 'check_violation';
  end if;
  if v.self_excluded_until is not null and v.self_excluded_until > now() then
    raise exception 'Account is self-excluded until %', v.self_excluded_until
      using errcode = 'check_violation';
  end if;

  -- A loosening that has served its cooling-off period takes effect now.
  if v.pending_limit_at is not null and v.pending_limit_at <= now() then
    update profiles
       set daily_wager_limit   = v.pending_wager_limit,
           pending_wager_limit = null,
           pending_limit_at    = null
     where id = p_player_id;
    v.daily_wager_limit := v.pending_wager_limit;
  end if;

  if v.daily_wager_limit is not null then
    v_wagered := wagered_today(p_player_id, p_utc_offset_minutes);
    -- The stake being ATTEMPTED counts. Checking only what is already staked
    -- would let the last bet of the day be any size at all.
    if v_wagered + greatest(p_stake, 0) > v.daily_wager_limit then
      raise exception
        'Daily limit reached: you set a cap of % coins and have staked % today',
        v.daily_wager_limit, v_wagered
        using errcode = 'check_violation';
    end if;
  end if;
end;
$$;

-- ------------------------------------------------------------ setting them

/**
 * Change the player's own limits.
 *
 * ## Tighter now, looser later
 *
 * A lower cap (or a longer exclusion) applies immediately. A higher cap waits
 * 24 hours, recorded in `pending_*` and applied by `assert_can_play` when it
 * matures. Removing the cap entirely is a loosening and waits too.
 *
 * ## Self-exclusion only ever extends
 *
 * There is deliberately no way to shorten or cancel one. That is what makes it
 * meaningful rather than a pause button, and it is why the app asks twice
 * before setting one.
 */
create or replace function set_player_limits(
  p_player_id            uuid,
  p_daily_wager_limit    bigint,
  p_clear_wager_limit    boolean,
  p_session_minutes      int,
  p_exclude_until        timestamptz
) returns table (
  daily_wager_limit     bigint,
  pending_wager_limit   bigint,
  pending_limit_at      timestamptz,
  session_limit_minutes int,
  self_excluded_until   timestamptz
)
language plpgsql security definer as $$
declare
  v profiles%rowtype;
  v_target bigint;
begin
  select * into v from profiles where id = p_player_id for update;
  if not found then
    raise exception 'Unknown player %', p_player_id using errcode = 'no_data_found';
  end if;

  -- ---- the wager cap
  if p_clear_wager_limit or p_daily_wager_limit is not null then
    v_target := case when p_clear_wager_limit then null else p_daily_wager_limit end;

    if v_target is not null and v_target <= 0 then
      raise exception 'A daily limit must be a positive number of coins'
        using errcode = 'check_violation';
    end if;

    -- Tightening: straight away. Removing a cap, or raising one, is a
    -- loosening and waits 24 hours.
    if v.daily_wager_limit is null
       or (v_target is not null and v_target < v.daily_wager_limit) then
      update profiles
         set daily_wager_limit = v_target, pending_wager_limit = null, pending_limit_at = null
       where id = p_player_id;
    elsif v_target is not distinct from v.daily_wager_limit then
      -- No change. Cancel any pending loosening — asking for what you already
      -- have is the clearest way to say "leave it alone".
      update profiles set pending_wager_limit = null, pending_limit_at = null
       where id = p_player_id;
    else
      update profiles
         set pending_wager_limit = v_target, pending_limit_at = now() + interval '24 hours'
       where id = p_player_id;
    end if;
  end if;

  -- ---- the session reminder. A nudge, so it applies immediately either way.
  if p_session_minutes is not null then
    update profiles
       set session_limit_minutes = nullif(greatest(p_session_minutes, 0), 0)
     where id = p_player_id;
  end if;

  -- ---- self-exclusion, which only ever extends
  if p_exclude_until is not null then
    if p_exclude_until <= now() then
      raise exception 'A break must end in the future' using errcode = 'check_violation';
    end if;
    /*
     * `profiles.` is load-bearing.
     *
     * This function RETURNS a column called `self_excluded_until`, which makes
     * it a plpgsql variable, which makes a bare mention of that name on the
     * right-hand side ambiguous — and Postgres refuses the whole statement
     * rather than guessing. Unqualified, every attempt to take a break failed
     * with "column reference is ambiguous"; the left-hand side is fine because
     * an UPDATE target is unambiguously a column.
     */
    update profiles
       set self_excluded_until =
             greatest(coalesce(profiles.self_excluded_until, p_exclude_until), p_exclude_until)
     where id = p_player_id;
  end if;

  select * into v from profiles where id = p_player_id;
  daily_wager_limit     := v.daily_wager_limit;
  pending_wager_limit   := v.pending_wager_limit;
  pending_limit_at      := v.pending_limit_at;
  session_limit_minutes := v.session_limit_minutes;
  self_excluded_until   := v.self_excluded_until;
  return next;
end;
$$;

comment on function set_player_limits is
  'A player changing their own responsible-gaming settings. Tightening is '
  'immediate; loosening waits 24 hours; self-exclusion only ever extends.';
