-- ============================================================================
-- Juwa 3.0 — state of residence, and the states we decline.
--
-- A handful of US states define "gambling" broadly enough that a coin purchase
-- can be caught by the statute even though the coins are worthless by design.
-- The convention is to decline those registrations rather than argue.
--
-- The app also holds this list (packages/economy/src/jurisdictions.ts) so it
-- can offer only permitted states in the dropdown. That copy is a convenience.
-- THIS one is the enforcement: a client is a thing an adversary controls, and
-- a registration that reaches the database with a restricted region must fail
-- here regardless of what the app believed.
-- ============================================================================

-- ------------------------------------------------------- the restricted list

/**
 * Kept as a function rather than a table so it reads like `juwa_minimum_age()`
 * and changes through a reviewed migration rather than an UPDATE that nobody
 * sees. If this ever needs to change without a deploy, promote it to a table
 * with an audit trigger — do not make it editable in place.
 *
 * WA - broadest "thing of value" reading; the state supreme court allowed a
 *      suit against a free-to-play coin casino to proceed on that theory.
 * ID - narrow statutory definition of permitted contests, no social carve-out.
 * NV - bars unlicensed operators broadly.
 * MI - post-2019 internet gaming act, aggressively enforced.
 * MT - restricts internet gambling outright.
 */
create or replace function juwa_restricted_regions() returns text[]
language sql immutable as $$
  select array['WA','ID','NV','MI','MT']::text[];
$$;

comment on function juwa_restricted_regions() is
  'US states where Juwa declines to open an account. Mirrored in packages/economy/src/jurisdictions.ts.';

-- ------------------------------------------------- registration with a region

-- Adding a parameter to a plpgsql function creates a second overload rather
-- than replacing the first, and a five-argument call would then keep working
-- and skip the region check entirely. Drop it explicitly.
drop function if exists complete_registration(uuid, text, date, text, bigint);

create or replace function complete_registration(
  p_player_id     uuid,
  p_username      text,
  p_date_of_birth date,
  p_country       text,
  p_region        text,
  p_welcome_coins bigint
) returns table (username text, balance bigint, age_verified boolean)
language plpgsql security definer as $$
declare
  v_age int;
  v_region text;
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

  v_region := upper(nullif(trim(coalesce(p_region, '')), ''));

  if p_country is not null and upper(p_country) = 'US' then
    if v_region is null then
      raise exception 'State of residence is required'
        using errcode = 'check_violation';
    end if;
    if v_region = any (juwa_restricted_regions()) then
      raise exception 'We are not able to open accounts in your state at this time'
        using errcode = 'check_violation';
    end if;
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
        region = v_region,
        age_verified_at = now(),
        registered_at = now()
    where id = p_player_id;
  else
    insert into profiles (id, username, date_of_birth, country, region,
                          age_verified_at, registered_at)
    values (p_player_id, trim(p_username), p_date_of_birth, p_country, v_region,
            now(), now());
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

-- --------------------------------------------------------- existing accounts

-- Nobody registered before this migration has a region. They are not
-- retroactively excluded — the check applies at registration, and re-deciding
-- an existing player's eligibility from data we never collected would lock
-- people out on no evidence. Flag them for the next time they are asked.
comment on column profiles.region is
  'USPS state code for US players. Null for accounts created before 0006.';
