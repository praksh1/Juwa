-- ============================================================================
-- Juwa — the play path.
--
-- Turning a tap on "SPIN" into money moving correctly, exactly once.
--
-- THE ORDERING PROBLEM
--
-- A bet touches three things: the provably-fair nonce, the player's balance,
-- and the round record. They cannot all be done in one database call, because
-- the outcome is computed in TypeScript by the game engine, which sits between
-- reading the seed and writing the result.
--
-- The sequence is deliberately:
--
--   1. reserve_nonce()      -- one small transaction. Moves no money.
--   2. <engine runs in TS>  -- pure function of (seed, nonce, stake).
--   3. play_instant_round() -- ONE transaction: debit, credit, record.
--
-- Why this order is safe. A crash after step 1 burns a nonce and nothing else —
-- no money has moved. A crash during step 3 rolls the whole thing back. There
-- is no window in which a stake is taken but a payout is lost, which is the
-- failure that generates support tickets and refunds.
--
-- Replay is blocked by the unique constraint on (seed_pair_id, nonce): the same
-- nonce can never settle twice, so a retried or forged request cannot double-pay.
-- ============================================================================

-- ------------------------------------------------------------ seed lifecycle

-- Returns the player's active seed pair, creating one if they have never
-- played, and atomically claims the next nonce.
--
-- The UPDATE ... RETURNING is what makes this safe under concurrency: two
-- simultaneous spins cannot receive the same nonce, because the row is locked
-- for the duration of the increment.
create or replace function reserve_nonce(
  p_player_id uuid,
  p_server_seed text default null,
  p_server_seed_hash text default null,
  p_client_seed text default null
) returns table (
  seed_pair_id uuid,
  server_seed text,
  server_seed_hash text,
  client_seed text,
  nonce int
)
language plpgsql security definer as $$
declare
  v_seed seed_pairs%rowtype;
begin
  select * into v_seed
  from seed_pairs
  where player_id = p_player_id and revealed_at is null
  for update;

  if not found then
    if p_server_seed is null or p_server_seed_hash is null then
      raise exception 'No active seed for player % and no new seed supplied', p_player_id;
    end if;
    insert into seed_pairs (player_id, server_seed, server_seed_hash, client_seed, nonce)
    values (p_player_id, p_server_seed, p_server_seed_hash,
            coalesce(p_client_seed, encode(gen_random_bytes(8), 'hex')), 0)
    returning * into v_seed;
  end if;

  update seed_pairs
  set nonce = seed_pairs.nonce + 1
  where id = v_seed.id
  returning seed_pairs.nonce into nonce;

  seed_pair_id := v_seed.id;
  server_seed := v_seed.server_seed;
  server_seed_hash := v_seed.server_seed_hash;
  client_seed := v_seed.client_seed;
  return next;
end;
$$;

-- Reveal the current seed and issue a fresh one. After this the player can
-- verify every round played under the old seed against the hash they were
-- shown before they played.
create or replace function rotate_seed(
  p_player_id uuid,
  p_new_server_seed text,
  p_new_server_seed_hash text,
  p_new_client_seed text default null
) returns table (revealed_server_seed text, revealed_hash text)
language plpgsql security definer as $$
begin
  update seed_pairs
  set revealed_at = now()
  where player_id = p_player_id and revealed_at is null
  returning seed_pairs.server_seed, seed_pairs.server_seed_hash
  into revealed_server_seed, revealed_hash;

  insert into seed_pairs (player_id, server_seed, server_seed_hash, client_seed, nonce)
  values (p_player_id, p_new_server_seed, p_new_server_seed_hash,
          coalesce(p_new_client_seed, encode(gen_random_bytes(8), 'hex')), 0);

  return next;
end;
$$;

-- --------------------------------------------------------------- helpers

create or replace function player_account(p_player_id uuid, p_currency text)
returns uuid
language plpgsql security definer as $$
declare
  v_id uuid;
begin
  select id into v_id
  from accounts
  where owner_id = p_player_id and kind = 'player' and currency = p_currency;

  if v_id is null then
    insert into accounts (owner_id, kind, currency)
    values (p_player_id, 'player', p_currency)
    returning id into v_id;
  end if;
  return v_id;
end;
$$;

create or replace function system_account(p_kind account_kind, p_currency text)
returns uuid
language sql stable security definer as $$
  select id from accounts where owner_id is null and kind = p_kind and currency = p_currency;
$$;

-- ------------------------------------------------------- instant round play

-- Slots, roulette, scratch cards: one call, settled immediately.
--
-- The stake and the payout are two separate ledger transactions rather than one
-- net movement. Netting would be simpler and is wrong: a player who bets 2,000
-- and wins 2,500 must see both movements in their history, and the analytics
-- need gross wagered, not net. "Handle drop" and "net win" are different
-- numbers and both matter.
create or replace function play_instant_round(
  p_player_id     uuid,
  p_game_id       text,
  p_seed_pair_id  uuid,
  p_nonce         int,
  p_stake         bigint,
  p_payout        bigint,
  p_currency      text,
  p_state         jsonb,
  p_idempotency_key text
) returns table (round_id uuid, balance bigint)
language plpgsql security definer as $$
declare
  v_player_account uuid;
  v_house_account  uuid;
  v_bet_txn        uuid;
  v_payout_txn     uuid;
  v_round_id       uuid;
begin
  if p_stake <= 0 then
    raise exception 'Stake must be positive, got %', p_stake;
  end if;
  if p_payout < 0 then
    raise exception 'Payout cannot be negative, got %', p_payout;
  end if;

  -- Replay guard. A retried request finds the existing round and returns it
  -- rather than charging the player a second time.
  select id into v_round_id
  from game_rounds
  where seed_pair_id = p_seed_pair_id and nonce = p_nonce;

  if found then
    round_id := v_round_id;
    select b.balance into balance
    from account_balance_cache b
    where b.account_id = player_account(p_player_id, p_currency);
    return next;
    return;
  end if;

  v_player_account := player_account(p_player_id, p_currency);
  v_house_account  := system_account('house', p_currency);

  -- Stake moves player -> house. Raises on insufficient funds.
  v_bet_txn := post_transfer(
    'bet', v_player_account, v_house_account, p_stake, p_currency,
    p_idempotency_key || ':bet',
    jsonb_build_object('game_id', p_game_id, 'nonce', p_nonce)
  );

  -- Payout moves house -> player. Skipped entirely on a losing round: the
  -- ledger forbids zero-amount entries, and a "you won nothing" row is noise.
  if p_payout > 0 then
    v_payout_txn := post_transfer(
      'payout', v_house_account, v_player_account, p_payout, p_currency,
      p_idempotency_key || ':payout',
      jsonb_build_object('game_id', p_game_id, 'nonce', p_nonce)
    );
  end if;

  insert into game_rounds (
    player_id, game_id, seed_pair_id, nonce, stake, payout, currency,
    status, state, bet_txn_id, payout_txn_id, settled_at
  ) values (
    p_player_id, p_game_id, p_seed_pair_id, p_nonce, p_stake, p_payout, p_currency,
    'settled', p_state, v_bet_txn, v_payout_txn, now()
  ) returning id into v_round_id;

  -- VIP progress is earned by wagering, not by spending money.
  update profiles
  set lifetime_wagered = lifetime_wagered + p_stake
  where id = p_player_id;

  round_id := v_round_id;
  select b.balance into balance
  from account_balance_cache b
  where b.account_id = v_player_account;
  return next;
end;
$$;

-- ----------------------------------------------------- multi-step round play

-- Blackjack and poker: the stake is taken up front, the round stays open while
-- the player acts, and the payout is credited when it settles.
create or replace function open_round(
  p_player_id     uuid,
  p_game_id       text,
  p_seed_pair_id  uuid,
  p_nonce         int,
  p_stake         bigint,
  p_currency      text,
  p_state         jsonb,
  p_idempotency_key text
) returns table (round_id uuid, balance bigint)
language plpgsql security definer as $$
declare
  v_player_account uuid;
  v_bet_txn        uuid;
  v_round_id       uuid;
begin
  select id into v_round_id
  from game_rounds
  where seed_pair_id = p_seed_pair_id and nonce = p_nonce;
  if found then
    raise exception 'Round already exists for seed % nonce %', p_seed_pair_id, p_nonce;
  end if;

  v_player_account := player_account(p_player_id, p_currency);

  v_bet_txn := post_transfer(
    'bet', v_player_account, system_account('house', p_currency),
    p_stake, p_currency, p_idempotency_key || ':bet',
    jsonb_build_object('game_id', p_game_id, 'nonce', p_nonce)
  );

  insert into game_rounds (
    player_id, game_id, seed_pair_id, nonce, stake, currency, status, state, bet_txn_id
  ) values (
    p_player_id, p_game_id, p_seed_pair_id, p_nonce, p_stake, p_currency,
    'open', p_state, v_bet_txn
  ) returning id into v_round_id;

  update profiles set lifetime_wagered = lifetime_wagered + p_stake where id = p_player_id;

  round_id := v_round_id;
  select b.balance into balance from account_balance_cache b
  where b.account_id = v_player_account;
  return next;
end;
$$;

-- Persist an in-progress round. Used after a hit or a stand that does not end
-- the hand. Takes no money, but may increase the stake (a double or a split),
-- which must be charged at the moment the player commits to it.
create or replace function update_round(
  p_round_id        uuid,
  p_state           jsonb,
  p_additional_stake bigint default 0,
  p_idempotency_key text default null
) returns bigint
language plpgsql security definer as $$
declare
  v_round game_rounds%rowtype;
  v_balance bigint;
begin
  select * into v_round from game_rounds where id = p_round_id for update;
  if not found then raise exception 'Unknown round %', p_round_id; end if;
  if v_round.status <> 'open' then
    raise exception 'Round % is already %', p_round_id, v_round.status;
  end if;

  if p_additional_stake > 0 then
    perform post_transfer(
      'bet',
      player_account(v_round.player_id, v_round.currency),
      system_account('house', v_round.currency),
      p_additional_stake, v_round.currency, p_idempotency_key,
      jsonb_build_object('round_id', p_round_id, 'reason', 'double-or-split')
    );
    update game_rounds set stake = stake + p_additional_stake where id = p_round_id;
    update profiles set lifetime_wagered = lifetime_wagered + p_additional_stake
    where id = v_round.player_id;
  end if;

  update game_rounds set state = p_state where id = p_round_id;

  select balance into v_balance from account_balance_cache
  where account_id = player_account(v_round.player_id, v_round.currency);
  return v_balance;
end;
$$;

create or replace function settle_round(
  p_round_id        uuid,
  p_payout          bigint,
  p_state           jsonb,
  p_idempotency_key text
) returns bigint
language plpgsql security definer as $$
declare
  v_round game_rounds%rowtype;
  v_payout_txn uuid;
  v_balance bigint;
begin
  select * into v_round from game_rounds where id = p_round_id for update;
  if not found then raise exception 'Unknown round %', p_round_id; end if;
  if v_round.status <> 'open' then
    raise exception 'Round % is already %', p_round_id, v_round.status;
  end if;
  if p_payout < 0 then raise exception 'Payout cannot be negative'; end if;

  if p_payout > 0 then
    v_payout_txn := post_transfer(
      'payout',
      system_account('house', v_round.currency),
      player_account(v_round.player_id, v_round.currency),
      p_payout, v_round.currency, p_idempotency_key,
      jsonb_build_object('round_id', p_round_id)
    );
  end if;

  update game_rounds
  set status = 'settled', payout = p_payout, state = p_state,
      payout_txn_id = v_payout_txn, settled_at = now()
  where id = p_round_id;

  select balance into v_balance from account_balance_cache
  where account_id = player_account(v_round.player_id, v_round.currency);
  return v_balance;
end;
$$;

-- ------------------------------------------------------------ free coins

-- Bonuses are minted from the promo account so the ledger still balances. The
-- promo account's balance runs negative by design and equals the total coins
-- ever given away — a number worth putting on a dashboard.
create or replace function grant_bonus(
  p_player_id uuid,
  p_kind      text,
  p_coins     bigint,
  p_streak_day int,
  p_grant_date date,
  p_idempotency_key text
) returns bigint
language plpgsql security definer as $$
declare
  v_player_account uuid;
  v_txn uuid;
  v_balance bigint;
begin
  if p_coins <= 0 then raise exception 'Bonus must be positive'; end if;

  v_player_account := player_account(p_player_id, 'GC');
  v_txn := post_transfer(
    'bonus', system_account('promo', 'GC'), v_player_account,
    p_coins, 'GC', p_idempotency_key,
    jsonb_build_object('kind', p_kind, 'streak_day', p_streak_day)
  );

  -- The unique index on (player_id, grant_date) where kind = 'daily' is what
  -- actually stops a double claim, even if two requests race.
  insert into bonus_grants (player_id, kind, coins, streak_day, grant_date, txn_id)
  values (p_player_id, p_kind, p_coins, p_streak_day, p_grant_date, v_txn);

  if p_kind = 'daily' then
    update profiles
    set daily_streak = p_streak_day, last_bonus_date = p_grant_date
    where id = p_player_id;
  end if;

  select balance into v_balance from account_balance_cache
  where account_id = v_player_account;
  return v_balance;
end;
$$;
