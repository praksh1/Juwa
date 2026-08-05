-- ============================================================================
-- Juwa — complete schema.
--
-- GENERATED FILE. Do not edit; edit db/migrations/*.sql and re-run
-- `node scripts/build-migration.mjs`.
--
-- Paste the whole thing into the Supabase SQL editor and run it once. It is
-- every migration below, in order:
--   0001_ledger.sql
--   0002_social_economy.sql
--   0003_play.sql
--   0004_accounts.sql
--   0005_purchases.sql
--   0006_jurisdictions.sql
--   0007_operators.sql
--   0008_ledger_concurrency.sql
--
-- Safe to run on a fresh project. Running it twice will error on the first
-- CREATE TABLE, which is the correct behaviour — it means the schema is
-- already there.
-- ============================================================================


-- ==========================================================================
-- 0001_ledger.sql
-- ==========================================================================

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


-- ==========================================================================
-- 0002_social_economy.sql
-- ==========================================================================

-- ============================================================================
-- Juwa — social casino model.
--
-- Records the product decision in the schema: Gold Coins are entertainment,
-- bought or earned, and never convertible back to money. There is no
-- redemption path, and this migration removes the ability to create one by
-- accident.
--
-- Adds the free economy (welcome grant, daily streak, low-balance top-up), VIP
-- progression, and verified store purchases.
-- ============================================================================

-- ------------------------------------------------- retire the sweeps currency

-- Sweeps Coins existed for the sweepstakes model we did not take. Dropping the
-- currency now means no code can quietly start issuing a redeemable balance.
-- (Safe: no SC accounts have ever been created.)
delete from accounts where currency = 'SC';

alter table accounts drop constraint if exists accounts_currency_check;
alter table accounts add constraint accounts_currency_check
  check (currency in ('USD', 'GC'));

-- ---------------------------------------------------------- player economy

alter table profiles
  add column daily_streak        int not null default 0 check (daily_streak >= 0),
  -- Stored as a date, not a timestamp: the streak turns over on the player's
  -- calendar day. A rolling 24-hour timer drifts later each day until it lands
  -- at 3am and the player silently drops out.
  add column last_bonus_date     date,
  add column lifetime_wagered    bigint not null default 0 check (lifetime_wagered >= 0),
  add column vip_level           int not null default 0 check (vip_level between 0 and 5),
  add column top_ups_today       int not null default 0 check (top_ups_today >= 0),
  add column last_top_up_at      timestamptz,
  add column has_purchased       boolean not null default false;

comment on column profiles.lifetime_wagered is
  'VIP XP. Coins wagered, not dollars spent — status is earned by playing, which '
  'keeps free players climbing and returning.';

comment on column profiles.has_purchased is
  'Gates the one-time first-purchase coin doubler.';

-- --------------------------------------------------------------- purchases

create table coin_purchases (
  id               uuid primary key default gen_random_uuid(),
  player_id        uuid not null references profiles(id) on delete restrict,
  pack_id          text not null,
  channel          text not null check (channel in ('apple', 'google', 'stripe')),

  -- What we charged and what we granted. Denormalised on purpose: pack
  -- definitions change over time, and a receipt must always reflect the terms
  -- at the moment of sale, not today's price list.
  price_usd        bigint not null check (price_usd > 0),
  coins_granted    bigint not null check (coins_granted > 0),
  first_purchase_bonus boolean not null default false,

  -- The platform's transaction id. UNIQUE is what stops a replayed receipt from
  -- granting coins twice — the single most common fraud against an IAP flow.
  provider_txn_id  text not null,

  -- Never trust the client's word that a purchase happened. The app sends a
  -- receipt; the server validates it against Apple/Google/Stripe and only then
  -- flips this to 'verified' and mints coins.
  status           text not null default 'pending'
                     check (status in ('pending', 'verified', 'failed', 'refunded')),

  txn_id           uuid references transactions(id),
  created_at       timestamptz not null default now(),
  verified_at      timestamptz,

  unique (channel, provider_txn_id)
);

create index coin_purchases_player_idx on coin_purchases (player_id, created_at desc);
create index coin_purchases_pending_idx on coin_purchases (status) where status = 'pending';

-- ------------------------------------------------------------ bonus grants

-- Every free coin grant is recorded so the free economy can be measured against
-- the paid one. If top-ups start outweighing purchases, that shows up here
-- before it shows up in revenue.
create table bonus_grants (
  id          uuid primary key default gen_random_uuid(),
  player_id   uuid not null references profiles(id) on delete cascade,
  kind        text not null check (kind in ('welcome', 'daily', 'top_up', 'promo')),
  coins       bigint not null check (coins > 0),
  streak_day  int,
  -- The player's LOCAL calendar day, supplied by the caller rather than derived
  -- from created_at. Two reasons: casting a timestamptz to a date depends on the
  -- session timezone, so Postgres rightly refuses to index it; and the streak
  -- should turn over at the player's midnight, not the server's.
  grant_date  date not null,
  txn_id      uuid references transactions(id),
  created_at  timestamptz not null default now()
);

create index bonus_grants_player_idx on bonus_grants (player_id, created_at desc);

-- One daily bonus per player per calendar day, enforced by the database rather
-- than by application code that might race with itself.
create unique index bonus_grants_one_daily_per_day
  on bonus_grants (player_id, grant_date)
  where kind = 'daily';

-- ------------------------------------------------- the no-redemption guard

-- A hard stop at the schema level. Under the social model coins only ever leave
-- a player account to pay for a bet; they never flow out to a payment provider.
-- If a future withdrawal feature is written by mistake, this refuses the write
-- rather than quietly changing the company's legal position.
create or replace function forbid_coin_redemption() returns trigger
language plpgsql as $$
begin
  if new.direction = 'withdrawal' then
    raise exception
      'Withdrawals are disabled: Juwa operates the social casino model and Gold '
      'Coins have no cash value. Enabling redemption is a legal decision, not a '
      'code change — see docs/03-payments-and-legal.md.'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger payment_intents_no_withdrawals
  before insert or update on payment_intents
  for each row execute function forbid_coin_redemption();

-- --------------------------------------------------------------- promo pool

-- Free coins are minted from the promo account, so the ledger still balances:
-- every bonus is a movement from 'promo' to the player, never money appearing
-- from nowhere. The promo account runs negative by design — its balance is
-- exactly the total coins ever given away, which is a number worth watching.
insert into accounts (owner_id, kind, currency)
select null, 'promo', 'GC'
where not exists (
  select 1 from accounts where kind = 'promo' and currency = 'GC' and owner_id is null
);

-- ------------------------------------------------------- row level security

alter table coin_purchases enable row level security;
alter table bonus_grants   enable row level security;

create policy purchases_self on coin_purchases
  for select using (auth.uid() = player_id);

create policy grants_self on bonus_grants
  for select using (auth.uid() = player_id);


-- ==========================================================================
-- 0003_play.sql
-- ==========================================================================

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


-- ==========================================================================
-- 0004_accounts.sql
-- ==========================================================================

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


-- ==========================================================================
-- 0005_purchases.sql
-- ==========================================================================

-- ============================================================================
-- Juwa — coin purchases.
--
-- THE RULE THAT MATTERS: coins are granted from the payment provider's
-- *webhook*, never from the browser returning to a success page.
--
-- A success URL is not proof of payment. Anyone can navigate to
-- /store/success?ok=true, and if that granted coins the store would simply be
-- a free coin dispenser. The browser's return is a UI hint; the webhook,
-- verified against a signing secret, is the evidence.
--
-- Everything here is built so a webhook can arrive twice, out of order, or
-- weeks late — because all three happen.
-- ============================================================================

-- The Stripe session id is only known after we have created the purchase row,
-- so it starts null and is filled in a moment later.
alter table coin_purchases
  alter column provider_txn_id drop not null;

alter table coin_purchases
  drop constraint if exists coin_purchases_channel_provider_txn_id_key;

-- Still exactly one purchase per provider transaction — the constraint that
-- stops a replayed webhook from granting coins twice — but only once we
-- actually have an id.
create unique index if not exists coin_purchases_provider_txn_idx
  on coin_purchases (channel, provider_txn_id)
  where provider_txn_id is not null;

alter table coin_purchases
  add column if not exists checkout_url   text,
  add column if not exists expires_at     timestamptz,
  -- Why a checkout did not complete: expired, card declined, abandoned. Worth
  -- keeping — a spike in one particular reason is how you notice a broken
  -- payment flow before the revenue graph does.
  add column if not exists failure_reason text;

-- ------------------------------------------------------------ open a purchase

/**
 * Record an intended purchase before sending the player to the payment page.
 *
 * The price and coin amount are passed in by the SERVER from its own pack
 * catalogue. They are never accepted from the client — a client that can name
 * its own price will.
 */
create or replace function create_pending_purchase(
  p_player_id  uuid,
  p_pack_id    text,
  p_channel    text,
  p_price_usd  bigint,
  p_coins      bigint,
  p_first_purchase_bonus boolean
) returns uuid
language plpgsql security definer as $$
declare
  v_id uuid;
begin
  if p_price_usd <= 0 or p_coins <= 0 then
    raise exception 'A purchase must have a positive price and coin amount';
  end if;

  perform assert_can_play(p_player_id);

  insert into coin_purchases (
    player_id, pack_id, channel, price_usd, coins_granted,
    first_purchase_bonus, status, expires_at
  ) values (
    p_player_id, p_pack_id, p_channel, p_price_usd, p_coins,
    p_first_purchase_bonus, 'pending', now() + interval '1 hour'
  ) returning id into v_id;

  return v_id;
end;
$$;

create or replace function attach_provider_txn(
  p_purchase_id uuid,
  p_provider_txn_id text,
  p_checkout_url text
) returns void
language sql security definer as $$
  update coin_purchases
  set provider_txn_id = p_provider_txn_id, checkout_url = p_checkout_url
  where id = p_purchase_id and status = 'pending';
$$;

-- ---------------------------------------------------------- complete it

/**
 * Grant the coins. Called only from a signature-verified webhook.
 *
 * Idempotent by construction: the row is locked, and a purchase that is not
 * still 'pending' returns its existing state rather than paying again. Stripe
 * retries webhooks for days after any non-2xx response, so this WILL be called
 * more than once for the same purchase.
 *
 * Purchased coins are issued by the house account, the same source that holds
 * losing stakes. They stay distinguishable from free coins because the ledger
 * records the transaction type — 'deposit' here, 'bonus' for a giveaway — so
 * "coins sold" and "coins given away" remain separate numbers without needing
 * separate accounts.
 */
create or replace function complete_coin_purchase(
  p_purchase_id uuid,
  p_provider_txn_id text
) returns table (granted boolean, coins bigint, balance bigint)
language plpgsql security definer as $$
declare
  v_purchase coin_purchases%rowtype;
  v_player_account uuid;
  v_txn uuid;
begin
  select * into v_purchase from coin_purchases where id = p_purchase_id for update;

  if not found then
    raise exception 'Unknown purchase %', p_purchase_id;
  end if;

  v_player_account := player_account(v_purchase.player_id, 'GC');

  -- Already done. Report the current state; do not pay twice.
  if v_purchase.status <> 'pending' then
    granted := false;
    coins := v_purchase.coins_granted;
    select b.balance into balance from account_balance_cache b
    where b.account_id = v_player_account;
    return next;
    return;
  end if;

  v_txn := post_transfer(
    'deposit',
    system_account('house', 'GC'),
    v_player_account,
    v_purchase.coins_granted,
    'GC',
    'purchase:' || p_purchase_id::text,
    jsonb_build_object(
      'pack_id', v_purchase.pack_id,
      'channel', v_purchase.channel,
      'price_usd', v_purchase.price_usd
    )
  );

  update coin_purchases
  set status = 'verified',
      verified_at = now(),
      txn_id = v_txn,
      provider_txn_id = coalesce(provider_txn_id, p_provider_txn_id)
  where id = p_purchase_id;

  -- Burns the one-time first-purchase doubler.
  update profiles set has_purchased = true where id = v_purchase.player_id;

  granted := true;
  coins := v_purchase.coins_granted;
  select b.balance into balance from account_balance_cache b
  where b.account_id = v_player_account;
  return next;
end;
$$;

create or replace function fail_coin_purchase(
  p_purchase_id uuid,
  p_reason text
) returns void
language sql security definer as $$
  update coin_purchases
  set status = 'failed', failure_reason = p_reason
  where id = p_purchase_id and status = 'pending';
$$;

-- --------------------------------------------------------------- webhooks

/**
 * Every webhook we accept, recorded before it is acted on.
 *
 * The primary key is the provider's own event id, so a redelivery collides and
 * is skipped. This is the outermost of the three defences against double
 * granting — the other two being the purchase status check above and the
 * idempotency key on post_transfer.
 */
create table if not exists webhook_events (
  id           text primary key,
  provider     text not null,
  event_type   text not null,
  payload      jsonb not null,
  received_at  timestamptz not null default now(),
  processed_at timestamptz,
  error        text
);

create index if not exists webhook_events_unprocessed_idx
  on webhook_events (received_at) where processed_at is null;

/** Returns false when this event has been seen before. */
create or replace function record_webhook_event(
  p_id text,
  p_provider text,
  p_event_type text,
  p_payload jsonb
) returns boolean
language plpgsql security definer as $$
begin
  insert into webhook_events (id, provider, event_type, payload)
  values (p_id, p_provider, p_event_type, p_payload);
  return true;
exception when unique_violation then
  return false;
end;
$$;

create or replace function mark_webhook_processed(p_id text, p_error text default null)
returns void
language sql security definer as $$
  update webhook_events set processed_at = now(), error = p_error where id = p_id;
$$;

alter table webhook_events enable row level security;
-- No policy: webhook payloads are operator data. Players never read this table.


-- ==========================================================================
-- 0006_jurisdictions.sql
-- ==========================================================================

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


-- ==========================================================================
-- 0007_operators.sql
-- ==========================================================================

-- ============================================================================
-- Juwa 3.0 — the operator panel.
--
-- Separate identity from players. An operator is not a player with a flag: the
-- two live in different tables, authenticate differently, and share no session.
-- A privilege flag on a player row is one mistaken UPDATE away from handing the
-- payout configuration to whoever asks.
--
-- THE AUDIT TRAIL IS ENFORCED HERE, NOT IN THE APPLICATION
--
-- Every change to game configuration or global settings writes an audit row
-- from a TRIGGER. Application code cannot forget, cannot be bypassed by a
-- direct psql session, and cannot be refactored around. "Who changed the max
-- win cap, from what, to what, and when" is the question that gets asked after
-- something has gone wrong, and by then it is too late to start recording.
-- ============================================================================

-- ------------------------------------------------------------------ identity

create table operators (
  id            uuid primary key default gen_random_uuid(),
  email         text unique not null check (position('@' in email) > 1),
  -- scrypt, salted per operator. Never a bare hash of the password.
  password_hash text not null,
  -- Raw TOTP key. Two-factor is mandatory, so this is not nullable: an
  -- operator without a second factor is a password away from the paytable.
  totp_secret   bytea not null,
  role          text not null default 'operator'
                  check (role in ('operator', 'admin')),
  disabled_at   timestamptz,
  last_login_at timestamptz,
  created_at    timestamptz not null default now()
);

comment on table operators is
  'Staff accounts for the operator panel. Separate from players by design.';

/**
 * Sessions hold a HASH of the token, never the token.
 *
 * A stolen database dump then yields nothing usable: the bearer token exists
 * only in the operator''s browser. This is the same reason password_hash is a
 * hash, applied to the thing that is actually presented on every request.
 */
create table operator_sessions (
  token_hash  text primary key,
  operator_id uuid not null references operators(id) on delete cascade,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  revoked_at  timestamptz
);

create index operator_sessions_by_operator on operator_sessions (operator_id, expires_at desc);

-- ------------------------------------------------------------ configuration

/**
 * Per-game operator settings.
 *
 * Deliberately does NOT include return to player. RTP is not a dial on this
 * system: it emerges from the reel strips and the paytable, it is measured by
 * simulation, and it is published so a player can check it. A field here called
 * `rtp` would imply the house can move it per game from a web form, which is
 * both untrue and exactly the accusation a social casino must never invite.
 * The panel shows the measured figure beside the observed one instead.
 *
 * A row is created lazily. Absent means "engine defaults", which is why every
 * read is a left join rather than an inner one.
 */
create table game_configs (
  game_id             text primary key,
  enabled             boolean not null default true,
  /** Hard ceiling on a single round's payout, as a multiple of the stake. */
  max_win_multiplier  numeric(12,2) check (max_win_multiplier is null or max_win_multiplier > 0),
  min_bet             bigint check (min_bet is null or min_bet > 0),
  max_bet             bigint check (max_bet is null or max_bet > 0),
  updated_at          timestamptz not null default now(),
  -- SET NULL, not NO ACTION: attribution for a config row is a convenience
  -- (audit_log is the record), and a foreign key here should never be the
  -- reason an account cannot be removed.
  updated_by          uuid references operators(id) on delete set null,
  constraint bet_range_sane check (
    min_bet is null or max_bet is null or max_bet >= min_bet
  )
);

/**
 * Global economy settings. Exactly one row, enforced.
 *
 * A settings table that can hold two rows will eventually hold two rows, and
 * then half the servers read one and half read the other.
 */
create table global_settings (
  id                 boolean primary key default true check (id),
  welcome_grant      bigint not null default 100000 check (welcome_grant >= 0),
  daily_bonus_base   bigint not null default 5000 check (daily_bonus_base >= 0),
  top_up_amount      bigint not null default 2500 check (top_up_amount >= 0),
  updated_at         timestamptz not null default now(),
  updated_by         uuid references operators(id) on delete set null
);

insert into global_settings (id) values (true);

-- ----------------------------------------------------------------- the audit

/**
 * Note the absence of ON DELETE here, and it is deliberate.
 *
 * A foreign key with no action BLOCKS deleting an operator who has ever changed
 * anything, which is the correct outcome: the record of who changed the payout
 * configuration must outlive their employment. Staff who leave are DISABLED
 * (`operators.disabled_at`), which stops them signing in while keeping the
 * trail intact. Cascading here would let someone erase their own history by
 * deleting their account.
 */
create table audit_log (
  id          bigserial primary key,
  operator_id uuid references operators(id),
  /** Table and row the change applied to, e.g. 'game_configs:juwa-classic-slots'. */
  target      text not null,
  field       text not null,
  old_value   text,
  new_value   text,
  at          timestamptz not null default now()
);

create index audit_log_recent on audit_log (at desc);
create index audit_log_by_target on audit_log (target, at desc);

comment on table audit_log is
  'Append-only record of every operator configuration change. Written by trigger.';

/**
 * Append-only, like the ledger.
 *
 * An audit trail that can be edited is not an audit trail. Deleting or
 * rewriting history is refused outright rather than merely discouraged.
 */
create or replace function audit_log_is_append_only() returns trigger
language plpgsql as $$
begin
  raise exception 'audit_log is append-only';
end;
$$;

create trigger audit_log_no_update before update or delete on audit_log
  for each row execute function audit_log_is_append_only();

/**
 * Who is making this change.
 *
 * The API sets `juwa.operator_id` for the transaction before it writes. If it
 * is missing the change is still recorded, attributed to nobody — losing the
 * row entirely because the attribution was absent would be the wrong trade.
 */
create or replace function juwa_current_operator() returns uuid
language plpgsql stable as $$
declare
  v text;
begin
  v := current_setting('juwa.operator_id', true);
  if v is null or v = '' then return null; end if;
  return v::uuid;
exception when others then
  return null;
end;
$$;

/**
 * Record every changed column, one audit row per field.
 *
 * Per-field rather than a JSON blob of the whole row: the question is always
 * "when did the max win cap change", and answering it from a diff of two blobs
 * is work nobody does under pressure.
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
      values (juwa_current_operator(), v_target, v_field, v_old, v_new);
    end if;
  end loop;

  return new;
end;
$$;

create trigger game_configs_audited after insert or update on game_configs
  for each row execute function audit_config_change();

create trigger global_settings_audited after update on global_settings
  for each row execute function audit_config_change();

-- ---------------------------------------------------------------- the index

/**
 * The panel groups every settled round by game. Without this that is a full
 * scan of the rounds table, which is the largest table in the system and grows
 * forever — the dashboard would get slower every day and nobody would connect
 * the two.
 */
create index if not exists game_rounds_game_settled_idx
  on game_rounds (game_id, settled_at desc)
  where settled_at is not null;

-- ------------------------------------------------------- observed statistics

/**
 * What the games have ACTUALLY paid, from the rounds table.
 *
 * The panel puts this beside the simulated figure. They should agree within
 * sampling error; a persistent gap means the deployed code is not the code that
 * was measured, which is the single most valuable thing this panel can tell
 * anyone. Publishing only the configured number would hide exactly that.
 */
create or replace function observed_game_stats(p_since timestamptz default null)
returns table (
  game_id        text,
  rounds         bigint,
  coins_wagered  bigint,
  coins_paid     bigint,
  observed_rtp   numeric,
  hit_rate       numeric
)
language sql stable as $$
  select
    r.game_id,
    count(*)::bigint                                   as rounds,
    coalesce(sum(r.stake), 0)::bigint                  as coins_wagered,
    coalesce(sum(r.payout), 0)::bigint                 as coins_paid,
    case when coalesce(sum(r.stake), 0) = 0 then null
         else round(sum(r.payout)::numeric / sum(r.stake)::numeric, 4) end as observed_rtp,
    case when count(*) = 0 then null
         else round(count(*) filter (where r.payout > 0)::numeric / count(*)::numeric, 4) end as hit_rate
  from game_rounds r
  where r.settled_at is not null
    and (p_since is null or r.settled_at >= p_since)
  group by r.game_id
  order by rounds desc;
$$;

-- ------------------------------------------------------------ session helper

/** Resolve a presented token hash to a live operator, or nothing. */
create or replace function operator_for_session(p_token_hash text)
returns table (operator_id uuid, email text, role text)
language sql stable as $$
  select o.id, o.email, o.role
  from operator_sessions s
  join operators o on o.id = s.operator_id
  where s.token_hash = p_token_hash
    and s.revoked_at is null
    and s.expires_at > now()
    and o.disabled_at is null;
$$;


-- ==========================================================================
-- 0008_ledger_concurrency.sql
-- ==========================================================================

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
