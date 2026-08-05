-- ============================================================================
-- Juwa 3.0 — make the ledger survive more than one player at a time.
--
-- MEASURED BEFORE THIS MIGRATION, against real Postgres:
--
--     1 concurrent player    435 spins/sec     0 failures
--     5 concurrent players    11 spins/sec     4 of 50 failed
--    20 concurrent players     5 spins/sec    69 of 200 failed  (35%)
--
--   errors: deadlock detected x45, statement timeout x28
--
-- Two independent faults, both rooted in the balance cache.
--
-- FAULT 1 — DEADLOCK FROM INVERTED LOCK ORDER
--
-- post_transfer took `for update` on the paying account's cache row, then
-- inserted two ledger entries whose trigger updated both accounts' cache rows
-- in insert order. A bet pays player -> house, so it locked player then house.
-- A payout pays house -> player, so it locked house then player. Two spins
-- overlapping in opposite directions each held what the other wanted, and
-- Postgres killed one of them. Every spin is a bet AND a payout, so the
-- collision is not a rare interleaving — it is the normal case.
--
-- FAULT 2 — THE HOUSE ROW IS A GLOBAL LOCK
--
-- Every money movement in the system touches one house account, so every
-- transaction serialised on that single row. Even without deadlocks that caps
-- the whole product at the throughput of one row, no matter how large the
-- database.
--
-- The fix for both is the same observation: the house cache row is written by
-- every transaction and READ BY NOTHING. Every reader — get_balance, place_bet,
-- settle_round, the daily bonus, the store — looks up player_account(...). The
-- house balance is available from the `account_balances` view, which sums the
-- ledger and is always correct because the ledger is append-only.
--
-- So the cache becomes what its readers actually need: a per-player balance.
-- Player rows are naturally distinct per player, which removes the shared row
-- entirely rather than merely sharding it. Locking is then ordered by account
-- id so that even a future player-to-player transfer cannot invert.
--
-- NOTHING ABOUT CORRECTNESS CHANGES. The ledger is still the source of truth,
-- still append-only, still double-entry, and a player account still cannot go
-- negative — that check is untouched below.
-- ============================================================================

-- ------------------------------------------------- 1. cache players only

/**
 * Maintain the balance cache for player accounts only.
 *
 * House accounts still receive their ledger entries — the double-entry
 * invariant is unchanged and `account_balances` still reports them exactly.
 * They simply stop taking a row lock that nothing benefits from.
 */
create or replace function apply_entry_to_cache() returns trigger
language plpgsql as $$
declare
  v_kind account_kind;
begin
  select kind into v_kind from accounts where id = new.account_id;

  -- House, escrow and revenue balances come from `account_balances`. Caching
  -- them bought nothing and cost every concurrent transaction in the system.
  if v_kind is distinct from 'player' then
    return null;
  end if;

  insert into account_balance_cache (account_id, balance, updated_at)
  values (new.account_id, new.amount, now())
  on conflict (account_id) do update
    set balance = account_balance_cache.balance + excluded.balance,
        updated_at = now();

  -- A player account may never go negative. This is the last line of defence
  -- against a bug that lets someone bet money they do not have.
  if (select balance from account_balance_cache where account_id = new.account_id) < 0 then
    raise exception 'Player account % would go negative', new.account_id
      using errcode = 'check_violation';
  end if;

  return null;
end;
$$;

-- Existing house rows would otherwise sit frozen at their last value and be
-- reported as drift forever.
delete from account_balance_cache
where account_id in (select id from accounts where kind <> 'player');

-- ------------------------------------------- 2. one deterministic lock order

/**
 * Every money movement in the system, with locks taken in a fixed order.
 *
 * The body is unchanged from 0001 except for the locking section. Two
 * transactions that touch the same pair of accounts now always take those rows
 * in the same sequence, so neither can hold what the other is waiting for.
 * Ordering by account id is arbitrary but total, which is the only property
 * deadlock freedom requires.
 */
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

  -- Idempotency: a retry of the same logical operation returns the original
  -- transaction instead of performing a second one.
  if p_idempotency_key is not null then
    select id into v_txn_id from transactions where idempotency_key = p_idempotency_key;
    if found then
      return v_txn_id;
    end if;
  end if;

  -- Take every player row this transfer will touch, ascending by id, BEFORE
  -- writing anything. The trigger below updates these same rows; by the time it
  -- runs they are already held, so it cannot introduce a second, different
  -- order. A loop rather than `order by ... for update` because the loop's
  -- ordering guarantee does not depend on how the planner executes the query.
  for v_locked in
    select c.account_id
    from account_balance_cache c
    join accounts a on a.id = c.account_id
    where c.account_id in (p_from_account, p_to_account)
      and a.kind = 'player'
    order by c.account_id
  loop
    perform 1 from account_balance_cache where account_id = v_locked for update;
  end loop;

  -- Only a player can be short of funds; house accounts are allowed to run
  -- negative, which is what a jackpot looks like before revenue catches up.
  if (select kind from accounts where id = p_from_account) = 'player' then
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

  -- Entries are inserted lowest account id first, so the trigger's own writes
  -- follow the same order the locks were taken in.
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

comment on function post_transfer is
  'The single choke point for money movement. Locks player rows in id order so '
  'concurrent bets and payouts cannot deadlock; house balances are not cached '
  'because nothing reads them and the shared row serialised the whole system.';
