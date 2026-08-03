-- ============================================================================
-- Juwa — registration, the age gate, and top-up accounting.
--
-- Supabase Auth owns identity: it creates the row in auth.users and issues the
-- JWT. This migration owns everything after that — the player profile, the
-- 18+ check, and the welcome bonus.
--
-- The age gate lives here rather than in application code for the same reason
-- the ledger rules do: it is a legal obligation, and a legal obligation that
-- depends on someone remembering to call a function is not an obligation.
-- ============================================================================

alter table profiles
  add column age_verified_at timestamptz,
  add column registered_at   timestamptz,
  add column last_seen_at    timestamptz;

-- Minimum age for a casino-themed app. 18 is the sensible default; a market
-- that demands 21 changes this one constant.
create or replace function juwa_minimum_age() returns int
language sql immutable as $$ select 18 $$;

/**
 * Complete registration in one transaction: claim a username, record and check
 * the date of birth, and pay the welcome bonus.
 *
 * Doing all three together means there is no state in which a player exists,
 * has coins, and has not passed the age check.
 */
create or replace function complete_registration(
  p_player_id     uuid,
  p_username      text,
  p_date_of_birth date,
  p_country       text,
  p_welcome_coins bigint
) returns table (username text, balance bigint, age_verified boolean)
language plpgsql security definer as $$
declare
  v_age int;
  v_existing profiles%rowtype;
begin
  if p_username is null or char_length(trim(p_username)) < 3 then
    raise exception 'Username must be at least 3 characters'
      using errcode = 'check_violation';
  end if;
  if p_date_of_birth is null then
    raise exception 'Date of birth is required' using errcode = 'check_violation';
  end if;

  v_age := extract(year from age(current_date, p_date_of_birth));
  if v_age < juwa_minimum_age() then
    raise exception 'You must be at least % to play', juwa_minimum_age()
      using errcode = 'check_violation';
  end if;

  select * into v_existing from profiles where id = p_player_id;

  if found and v_existing.registered_at is not null then
    -- Already registered. Return the current state rather than paying a second
    -- welcome bonus; a retried request must be harmless.
    return query
      select v_existing.username,
             coalesce((select b.balance from account_balance_cache b
                       join accounts a on a.id = b.account_id
                       where a.owner_id = p_player_id and a.currency = 'GC'), 0)::bigint,
             v_existing.age_verified_at is not null;
    return;
  end if;

  if found then
    update profiles
    set username = trim(p_username),
        date_of_birth = p_date_of_birth,
        country = p_country,
        age_verified_at = now(),
        registered_at = now()
    where id = p_player_id;
  else
    insert into profiles (id, username, date_of_birth, country, age_verified_at, registered_at)
    values (p_player_id, trim(p_username), p_date_of_birth, p_country, now(), now());
  end if;

  perform grant_bonus(
    p_player_id, 'welcome', p_welcome_coins, null, current_date,
    'welcome:' || p_player_id::text
  );

  return query
    select trim(p_username),
           (select b.balance from account_balance_cache b
            join accounts a on a.id = b.account_id
            where a.owner_id = p_player_id and a.currency = 'GC')::bigint,
           true;
end;
$$;

-- --------------------------------------------------------- the play gate

/**
 * Every play endpoint calls this first.
 *
 * Refuses anyone unregistered, under age, or currently self-excluded. Raising
 * here rather than returning false means a caller cannot ignore the answer.
 */
create or replace function assert_can_play(p_player_id uuid) returns void
language plpgsql stable security definer as $$
declare
  v profiles%rowtype;
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
end;
$$;

-- ------------------------------------------------------ top-up accounting

/**
 * How many top-ups a player has taken today, and how long since the last one.
 *
 * Derived from bonus_grants rather than kept as a counter on the profile: a
 * counter has to be reset at midnight by something, and that something is a
 * cron job that will eventually fail silently.
 */
create or replace function top_up_status(p_player_id uuid, p_grant_date date)
returns table (claims_today int, minutes_since_last numeric)
language sql stable security definer as $$
  select
    count(*) filter (where grant_date = p_grant_date)::int,
    extract(epoch from (now() - max(created_at))) / 60
  from bonus_grants
  where player_id = p_player_id and kind = 'top_up';
$$;

create index if not exists bonus_grants_topup_idx
  on bonus_grants (player_id, kind, created_at desc);
