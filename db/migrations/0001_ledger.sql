-- ============================================================================
-- Juwa — core schema: identity, double-entry ledger, wallet, game rounds.
--
-- WHY DOUBLE-ENTRY?
--
-- The naive design is a `balance` column you add to and subtract from. It works
-- until the day the numbers are wrong, and then you are finished: there is no
-- way to tell whether a player was underpaid, a bug double-credited a bonus, or
-- someone with database access moved money. You cannot audit a number.
--
-- Double-entry records money as *movements between accounts*, and every
-- movement is balanced — the sum of entries in a transaction is always exactly
-- zero. Money is never created or destroyed, only moved. A balance is then a
-- derived fact (the sum of an account's entries), not a stored opinion.
--
-- This is how banks have worked since the 1400s and how Stripe works today. It
-- is enforced here by a database trigger, not by application code, because
-- application code is where bugs live.
-- ============================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------- identity

create table profiles (
  id              uuid primary key references auth.users(id) on delete cascade,
  username        text unique not null check (char_length(username) between 3 and 24),
  display_name    text,
  date_of_birth   date,
  country         text,
  region          text,
  -- KYC state gates redemption, never play. A player may enjoy the app long
  -- before we ever need their identity documents.
  kyc_status      text not null default 'none'
                    check (kyc_status in ('none','pending','verified','rejected')),
  -- Responsible gaming. These are legal requirements in every licensed market
  -- and simply the right thing to do in every other one.
  self_excluded_until timestamptz,
  daily_deposit_limit  bigint check (daily_deposit_limit is null or daily_deposit_limit > 0),
  session_limit_minutes int check (session_limit_minutes is null or session_limit_minutes > 0),
  created_at      timestamptz not null default now()
);

-- ----------------------------------------------------------------- accounts

-- System accounts are owned by the house, not a player. Every player-facing
-- movement has a system account on the other side of it, which is what makes
-- the books balance.
create type account_kind as enum (
  'player',        -- a player's spendable balance
  'house',         -- the operator's own funds; wins flow here, payouts flow out
  'promo',         -- source of bonuses and free credits
  'payment_float', -- money in transit with the payment processor
  'jackpot'        -- progressive jackpot pools
);

create table accounts (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid references profiles(id) on delete restrict,
  kind        account_kind not null,
  currency    text not null check (currency in ('USD','GC','SC')),
  created_at  timestamptz not null default now(),

  -- A player has exactly one account per currency.
  constraint one_account_per_player_currency unique nulls not distinct (owner_id, kind, currency),
  -- Player accounts must have an owner; system accounts must not.
  constraint owner_matches_kind check (
    (kind = 'player' and owner_id is not null) or
    (kind <> 'player' and owner_id is null)
  )
);

create index accounts_owner_idx on accounts (owner_id) where owner_id is not null;

-- ------------------------------------------------------------- transactions

create type txn_type as enum (
  'deposit', 'withdrawal', 'bet', 'payout', 'bonus', 'adjustment', 'refund'
);

create table transactions (
  id            uuid primary key default gen_random_uuid(),
  type          txn_type not null,
  -- Set by the caller to make retries safe. A network timeout on a deposit
  -- must never be able to credit the player twice.
  idempotency_key text unique,
  reference     text,
  metadata      jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now()
);

-- Amounts are integer MINOR UNITS (cents), never numeric/float. Positive
-- entries are debits into the account, negative are credits out of it.
create table ledger_entries (
  id             bigserial primary key,
  transaction_id uuid not null references transactions(id) on delete restrict,
  account_id     uuid not null references accounts(id) on delete restrict,
  amount         bigint not null check (amount <> 0),
  currency       text not null,
  created_at     timestamptz not null default now()
);

create index ledger_entries_account_idx on ledger_entries (account_id, id desc);
create index ledger_entries_txn_idx on ledger_entries (transaction_id);

-- The ledger is append-only. Correcting a mistake means posting a reversing
-- transaction, which leaves both the error and the correction visible forever.
-- Deleting history is how fraud hides.
create rule ledger_entries_no_update as on update to ledger_entries do instead nothing;
create rule ledger_entries_no_delete as on delete to ledger_entries do instead nothing;

-- ------------------------------------------------- the balancing constraint

-- Enforced at COMMIT time (deferred), so a transaction can insert its entries
-- one at a time and still be checked as a whole.
create or replace function assert_transaction_balances() returns trigger
language plpgsql as $$
declare
  imbalance record;
begin
  for imbalance in
    select currency, sum(amount) as total
    from ledger_entries
    where transaction_id = new.transaction_id
    group by currency
    having sum(amount) <> 0
  loop
    raise exception
      'Unbalanced transaction % : % is off by %',
      new.transaction_id, imbalance.currency, imbalance.total
      using errcode = 'check_violation';
  end loop;
  return null;
end;
$$;

create constraint trigger ledger_entries_balance
  after insert on ledger_entries
  deferrable initially deferred
  for each row execute function assert_transaction_balances();

-- ----------------------------------------------------------------- balances

-- The authoritative balance: derived, never stored.
create view account_balances as
select
  a.id as account_id,
  a.owner_id,
  a.kind,
  a.currency,
  coalesce(sum(e.amount), 0)::bigint as balance
from accounts a
left join ledger_entries e on e.account_id = a.id
group by a.id;

-- Summing the whole ledger on every balance read does not scale past a few
-- million rows, so we keep a cached balance that the ledger maintains itself.
-- It is a cache of the view above, and `reconcile_balances()` proves it.
create table account_balance_cache (
  account_id uuid primary key references accounts(id) on delete cascade,
  balance    bigint not null default 0,
  updated_at timestamptz not null default now()
);

create or replace function apply_entry_to_cache() returns trigger
language plpgsql as $$
begin
  insert into account_balance_cache (account_id, balance, updated_at)
  values (new.account_id, new.amount, now())
  on conflict (account_id) do update
    set balance = account_balance_cache.balance + excluded.balance,
        updated_at = now();

  -- A player account may never go negative. This is the last line of defence
  -- against a bug that lets someone bet money they do not have; the wallet
  -- function below should have already refused.
  if (select kind from accounts where id = new.account_id) = 'player'
     and (select balance from account_balance_cache where account_id = new.account_id) < 0
  then
    raise exception 'Player account % would go negative', new.account_id
      using errcode = 'check_violation';
  end if;

  return null;
end;
$$;

create trigger ledger_entries_cache
  after insert on ledger_entries
  for each row execute function apply_entry_to_cache();

-- Run nightly. If it ever returns a row, stop and investigate before trading.
create or replace function reconcile_balances()
returns table (account_id uuid, cached bigint, derived bigint)
language sql stable as $$
  select c.account_id, c.balance, b.balance
  from account_balance_cache c
  join account_balances b on b.account_id = c.account_id
  where c.balance <> b.balance;
$$;

-- ------------------------------------------------------ the transfer helper

-- Every money movement in the system goes through this one function. Having a
-- single choke point means the balance check, the idempotency check and the
-- audit trail cannot be forgotten by a caller in a hurry.
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

  -- Lock the paying account so two concurrent bets cannot both see the same
  -- balance and both succeed. Without this, a player with $10 can place two
  -- simultaneous $10 bets and the second one overdraws.
  select balance into v_from_balance
  from account_balance_cache
  where account_id = p_from_account
  for update;

  if (select kind from accounts where id = p_from_account) = 'player'
     and coalesce(v_from_balance, 0) < p_amount
  then
    raise exception 'Insufficient funds: balance %, requested %',
      coalesce(v_from_balance, 0), p_amount
      using errcode = 'insufficient_privilege';
  end if;

  insert into transactions (type, idempotency_key, metadata)
  values (p_type, p_idempotency_key, p_metadata)
  returning id into v_txn_id;

  insert into ledger_entries (transaction_id, account_id, amount, currency)
  values (v_txn_id, p_from_account, -p_amount, p_currency),
         (v_txn_id, p_to_account,    p_amount, p_currency);

  return v_txn_id;
end;
$$;

-- -------------------------------------------------------------- game rounds

-- Provably-fair seed pairs. The hash is shown to the player BEFORE they bet;
-- the seed itself is revealed only after rotation.
create table seed_pairs (
  id               uuid primary key default gen_random_uuid(),
  player_id        uuid not null references profiles(id) on delete cascade,
  server_seed      text not null,
  server_seed_hash text not null,
  client_seed      text not null,
  nonce            int not null default 0,
  revealed_at      timestamptz,
  created_at       timestamptz not null default now()
);

create unique index seed_pairs_active_idx
  on seed_pairs (player_id) where revealed_at is null;

create table game_rounds (
  id             uuid primary key default gen_random_uuid(),
  player_id      uuid not null references profiles(id) on delete restrict,
  game_id        text not null,
  seed_pair_id   uuid not null references seed_pairs(id) on delete restrict,
  nonce          int not null,
  stake          bigint not null check (stake > 0),
  payout         bigint check (payout >= 0),
  currency       text not null,
  status         text not null default 'open' check (status in ('open','settled','voided')),
  -- Full round state, so any historical round can be replayed and re-verified.
  state          jsonb not null default '{}'::jsonb,
  bet_txn_id     uuid references transactions(id),
  payout_txn_id  uuid references transactions(id),
  created_at     timestamptz not null default now(),
  settled_at     timestamptz,

  -- One round per (seed pair, nonce). Reusing a nonce would produce a
  -- duplicate outcome and break the fairness proof.
  constraint unique_nonce_per_seed unique (seed_pair_id, nonce)
);

create index game_rounds_player_idx on game_rounds (player_id, created_at desc);
create index game_rounds_open_idx on game_rounds (player_id) where status = 'open';

-- ------------------------------------------------------------- payments

create table payment_intents (
  id             uuid primary key default gen_random_uuid(),
  player_id      uuid not null references profiles(id) on delete restrict,
  provider       text not null,
  provider_ref   text,
  direction      text not null check (direction in ('deposit','withdrawal')),
  amount         bigint not null check (amount > 0),
  currency       text not null,
  status         text not null default 'pending'
                   check (status in ('pending','processing','succeeded','failed','reversed')),
  failure_reason text,
  txn_id         uuid references transactions(id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),

  unique (provider, provider_ref)
);

create index payment_intents_player_idx on payment_intents (player_id, created_at desc);

-- ------------------------------------------------------- row level security

alter table profiles             enable row level security;
alter table accounts             enable row level security;
alter table ledger_entries       enable row level security;
alter table transactions         enable row level security;
alter table game_rounds          enable row level security;
alter table seed_pairs           enable row level security;
alter table payment_intents      enable row level security;
alter table account_balance_cache enable row level security;

-- Players may READ their own data and nothing else. Note there are no INSERT
-- or UPDATE policies anywhere: no client can write to the ledger, ever. All
-- writes happen in server-side functions running as a service role.
create policy profiles_self on profiles
  for select using (auth.uid() = id);

create policy accounts_self on accounts
  for select using (auth.uid() = owner_id);

create policy balance_self on account_balance_cache
  for select using (
    exists (select 1 from accounts a
            where a.id = account_balance_cache.account_id and a.owner_id = auth.uid())
  );

create policy ledger_self on ledger_entries
  for select using (
    exists (select 1 from accounts a
            where a.id = ledger_entries.account_id and a.owner_id = auth.uid())
  );

create policy rounds_self on game_rounds
  for select using (auth.uid() = player_id);

create policy payments_self on payment_intents
  for select using (auth.uid() = player_id);

-- The active server seed is deliberately excluded: a player who could read it
-- before revelation could predict every outcome. They see the hash via an API
-- that selects specific columns, never this table directly.
create policy seeds_self_revealed on seed_pairs
  for select using (auth.uid() = player_id and revealed_at is not null);

-- --------------------------------------------------------- system accounts

insert into accounts (owner_id, kind, currency) values
  (null, 'house',         'USD'),
  (null, 'house',         'GC'),
  (null, 'house',         'SC'),
  (null, 'promo',         'GC'),
  (null, 'promo',         'SC'),
  (null, 'payment_float', 'USD'),
  (null, 'jackpot',       'GC');
