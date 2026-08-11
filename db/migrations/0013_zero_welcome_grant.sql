-- ============================================================================
-- Juwa — let a welcome bonus of zero mean zero.
--
-- `grant_bonus` refuses a non-positive amount, which is right for it: a bonus of
-- nought coins is a transaction that moves nothing and clutters the ledger, and
-- a NEGATIVE one is a bug being asked for politely.
--
-- But `complete_registration` called it unconditionally, so "register this
-- player with no welcome bonus" was not expressible — the whole registration
-- failed with "Bonus must be positive".
--
-- That matters now that agents create accounts. A player an agent signs up in
-- person should start empty and be funded from their agent's inventory; paying
-- them 100,000 free coins on top made a 50,000 coin allocation look like it had
-- done nothing, and it mints coins outside the inventory the whole distribution
-- model rests on.
--
-- This is 0006's function copied verbatim with TWO changes, both marked below.
-- Everything else — the age gate, the jurisdiction check, the idempotent
-- re-registration — is byte for byte what it was.
-- ============================================================================

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
    --
    -- CHANGE 2 of 2: `and a.kind::text = 'player'` on the balance lookup.
    -- An agent owns TWO accounts — their playable balance and their coin
    -- inventory — so an unfiltered owner_id match could return either, at
    -- random, and report an agent's inventory as their balance.
    return query
      select v_existing.username,
             coalesce((select b.balance from account_balance_cache b
                       join accounts a on a.id = b.account_id
                       where a.owner_id = p_player_id
                         and a.kind::text = 'player'
                         and a.currency = 'GC'), 0)::bigint,
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

  -- CHANGE 1 of 2: a grant of zero is SKIPPED rather than refused, so an
  -- agent-created account can start empty and be funded by its agent.
  if coalesce(p_welcome_coins, 0) > 0 then
    perform grant_bonus(
      p_player_id, 'welcome', p_welcome_coins, null, current_date,
      'welcome:' || p_player_id::text
    );
  end if;

  return query
    select trim(p_username),
           coalesce((select b.balance from account_balance_cache b
                     join accounts a on a.id = b.account_id
                     where a.owner_id = p_player_id
                       and a.kind::text = 'player'
                       and a.currency = 'GC'), 0)::bigint,
           true;
end;
$$;
