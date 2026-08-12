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
--   0009_agents.sql
--   0010_agent_audit_actor.sql
--   0011_agent_created_players.sql
--   0012_responsible_gaming.sql
--   0013_zero_welcome_grant.sql
--   0014_casino_cash.sql
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
-- `kind::text` rather than `kind`, and 'agent' named explicitly, so that this
-- stays correct if it is ever re-run after 0009 exists. Agent inventory IS
-- cached and IS read on every allocation; deleting those rows would report an
-- agent as having nothing and refuse every allocation they attempted. The cast
-- keeps the statement valid on a database where the enum value does not exist
-- yet, which is the case when this file runs in order on a fresh install.
delete from account_balance_cache
where account_id in (
  select id from accounts where kind::text not in ('player', 'agent')
);

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


-- ==========================================================================
-- 0009_agents.sql
-- ==========================================================================

-- ============================================================================
-- Juwa — agents.
--
-- ADMIN -> AGENT -> PLAYER. Agents are distributors: they hold an inventory of
-- coins and allocate it to the players they brought to the platform. They do
-- not recruit other agents, there are no downlines, and there is no commission
-- structure. One level, deliberately.
--
-- WHY THIS IS A SMALL MIGRATION
--
-- Because the money layer was already right. An agent allocation is a transfer
-- between two accounts, and `post_transfer` has done exactly that — atomically,
-- double-entry, idempotent, deadlock-free — since 0001. Almost everything below
-- is identity and authorisation; the ledger needed six lines.
--
-- WHERE AUTHORISATION LIVES
--
-- Here, not in the API. `allocate_to_player` re-checks that the agent is active
-- and that the player is theirs, inside the same transaction that moves the
-- coins. An API bug, a mistaken route, or a direct psql session cannot move
-- coins between an agent and a player who are not related, because the function
-- that moves them refuses. The API's own checks are a better error message, not
-- the control.
--
-- WHAT AGENTS STILL CANNOT DO
--
-- Take coins back. There is no player -> agent path in this file, and that is
-- not an omission: a player who can return coins to an agent is a player who
-- can be paid cash for them, which is the line between a social casino and
-- something that needs a gambling licence.
-- ============================================================================

-- --------------------------------------------------------------- the kinds

/**
 * A third kind of account: an agent's undistributed inventory.
 *
 * SEPARATE from the agent's own player balance, which they still have and can
 * still play with. The uniqueness constraint on `accounts` is already keyed on
 * `kind`, so one profile holding both an 'agent' and a 'player' account needs
 * no schema change — and inventory can never be spent in a game, because every
 * game reaches its money through `player_account()`, which only ever returns
 * accounts of kind 'player'.
 */
alter type account_kind add value if not exists 'agent';

/**
 * Two new transaction types.
 *
 * `inventory` is admin -> agent, `allocation` is agent -> player. Both could
 * have been recorded as 'adjustment', and then every report about where coins
 * went would begin by parsing metadata to find out what kind of adjustment it
 * was. A ledger that describes itself is worth two enum values.
 */
alter type txn_type add value if not exists 'inventory';
alter type txn_type add value if not exists 'allocation';

-- --------------------------------------------------------------- identity

/**
 * An agent is a profile with an agent row, not a boolean on the profile.
 *
 * The distinction matters. A flag is one mistaken UPDATE from turning a player
 * into a distributor; a row in a table with its own lifecycle, its own audit
 * trail and its own foreign keys is not. It also means an agent is a normal
 * Supabase user — they log in, reset their password and verify their email
 * through the same flow every player uses, which is why nothing in this file
 * ever handles an agent's password, and why an agent never handles a player's.
 *
 * `status` gates everything. A suspended agent cannot allocate, cannot invite,
 * and cannot receive inventory, and that is enforced in `allocate_to_player`
 * rather than being left to whichever endpoint remembers to check.
 */
create table if not exists agents (
  profile_id   uuid primary key references profiles(id) on delete restrict,
  display_name text not null check (char_length(display_name) between 2 and 64),
  status       text not null default 'pending'
                 check (status in ('pending', 'active', 'suspended')),
  /** The operator who created this agent. Never another agent — see below. */
  created_by   uuid references operators(id),
  created_at   timestamptz not null default now(),
  activated_at timestamptz,
  suspended_at timestamptz,
  notes        text
);

comment on table agents is
  'Distributors. One level only: an agent cannot create another agent.';

/**
 * Which agent a player belongs to.
 *
 * A separate table rather than a column on `profiles` for two reasons: a player
 * may have no agent at all (everyone who registered before this existed, and
 * anyone who signs up directly), and the assignment carries its own history —
 * who did it and when. Primary key on the player, so a player has at most one
 * agent and reassignment is an UPDATE rather than a second row that silently
 * duplicates them.
 */
create table if not exists player_agents (
  player_id   uuid primary key references profiles(id) on delete cascade,
  agent_id    uuid not null references agents(profile_id) on delete restrict,
  assigned_at timestamptz not null default now(),
  /** The operator who reassigned, if this was not the original invitation. */
  assigned_by uuid references operators(id)
);

create index if not exists player_agents_by_agent on player_agents (agent_id, assigned_at desc);

comment on table player_agents is
  'Each player belongs to at most one agent. Reassignment is admin-only.';

/**
 * Invitations.
 *
 * The token is stored as a HASH, for the same reason `operator_sessions` stores
 * a hash: a database dump then contains nothing that can be redeemed. The agent
 * sends the raw token in a link; the server hashes what it is given and looks
 * for a match.
 *
 * Single-use and expiring are enforced by `redeem_agent_invite` below rather
 * than by convention.
 */
create table if not exists agent_invites (
  id           uuid primary key default gen_random_uuid(),
  agent_id     uuid not null references agents(profile_id) on delete cascade,
  token_hash   text unique not null,
  /** Optional label so an agent can tell two outstanding invites apart. */
  label        text,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null,
  redeemed_at  timestamptz,
  redeemed_by  uuid references profiles(id) on delete set null
);

create index if not exists agent_invites_by_agent on agent_invites (agent_id, created_at desc);

-- ------------------------------------------------------------- the account

/**
 * An agent's inventory account, created on first use.
 *
 * Mirrors `player_account` exactly, including the fact that it is the only way
 * to obtain the id. Nothing else in the system should look up an account by
 * `kind = 'agent'` directly.
 */
create or replace function agent_account(p_agent_id uuid, p_currency text)
returns uuid
language plpgsql security definer as $$
declare
  v_id uuid;
begin
  select id into v_id
  from accounts
  where owner_id = p_agent_id and kind = 'agent' and currency = p_currency;

  if v_id is null then
    insert into accounts (owner_id, kind, currency)
    values (p_agent_id, 'agent', p_currency)
    returning id into v_id;
  end if;

  return v_id;
end;
$$;

/**
 * Agent accounts have an owner, like player accounts do.
 *
 * The original constraint said: player accounts have an owner, everything else
 * does not. That was right when everything else was the house, the promo pool
 * and the jackpots — system accounts owned by nobody. An agent's inventory is
 * owned by a specific agent, so the rule becomes "accounts belonging to a
 * person have an owner; system accounts do not".
 */
/*
 * NOTE THE `::text` CASTS. They are not decoration.
 *
 * `ALTER TYPE ... ADD VALUE` cannot be USED in the transaction that adds it —
 * Postgres refuses with "unsafe use of new value". A CHECK constraint resolves
 * its literals against the enum at the moment the constraint is created, so
 * `kind in ('player','agent')` fails when this file runs as one script, which
 * is exactly how `ALL.sql` is applied. Comparing the text avoids resolving the
 * literal at DDL time and behaves identically at runtime.
 *
 * Function bodies are safe without the cast: plpgsql resolves literals when the
 * function runs, which is always after this has committed.
 */
alter table accounts drop constraint if exists owner_matches_kind;
alter table accounts add constraint owner_matches_kind check (
  (kind::text in ('player', 'agent') and owner_id is not null) or
  (kind::text not in ('player', 'agent') and owner_id is null)
);

-- ------------------------------------------------- money movement, extended

/**
 * Agent inventory is cached and cannot go negative — the same two properties
 * player balances have, for the same two reasons.
 *
 * The cache is what makes "how much has this agent got left" a single-row read
 * rather than a sum over the ledger, and it is the row `post_transfer` locks to
 * make concurrent allocations safe. The non-negative check is the whole of
 * "an agent must never be able to allocate more coins than they have": two
 * simultaneous requests for the last 100,000 coins cannot both succeed, because
 * the second one waits for the first to commit and then fails the check.
 *
 * Only the `= 'player'` tests change. Everything else is 0008 verbatim.
 */
create or replace function apply_entry_to_cache() returns trigger
language plpgsql as $$
declare
  v_kind text;
begin
  select kind::text into v_kind from accounts where id = new.account_id;

  -- House, escrow and revenue balances come from `account_balances`. Caching
  -- them bought nothing and cost every concurrent transaction in the system.
  if v_kind not in ('player', 'agent') then
    return null;
  end if;

  insert into account_balance_cache (account_id, balance, updated_at)
  values (new.account_id, new.amount, now())
  on conflict (account_id) do update
    set balance = account_balance_cache.balance + excluded.balance,
        updated_at = now();

  if (select balance from account_balance_cache where account_id = new.account_id) < 0 then
    raise exception 'Account % would go negative', new.account_id
      using errcode = 'check_violation';
  end if;

  return null;
end;
$$;

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

  if p_idempotency_key is not null then
    select id into v_txn_id from transactions where idempotency_key = p_idempotency_key;
    if found then
      return v_txn_id;
    end if;
  end if;

  -- Every OWNED row this transfer will touch, ascending by id, before writing
  -- anything. Agent rows join players here: an allocation locks the agent's
  -- inventory and the player's balance in id order, so it can never invert
  -- against a concurrent bet, payout or second allocation.
  for v_locked in
    select c.account_id
    from account_balance_cache c
    join accounts a on a.id = c.account_id
    where c.account_id in (p_from_account, p_to_account)
      and a.kind::text in ('player', 'agent')
    order by c.account_id
  loop
    perform 1 from account_balance_cache where account_id = v_locked for update;
  end loop;

  -- Players and agents can be short of funds; house accounts are allowed to run
  -- negative, which is what a jackpot looks like before revenue catches up.
  if (select kind::text from accounts where id = p_from_account) in ('player', 'agent') then
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

-- ---------------------------------------------------------- the operations

/**
 * Admin -> agent. Inventory in.
 *
 * Coins come from the house account, exactly as a player purchase does, because
 * that is where coins are issued from in this system. Nothing is minted.
 */
create or replace function grant_agent_inventory(
  p_agent_id        uuid,
  p_amount          bigint,
  p_operator_id     uuid,
  p_idempotency_key text default null,
  p_reference       text default null
) returns table (txn_id uuid, inventory bigint)
language plpgsql security definer as $$
declare
  v_account uuid;
  v_txn uuid;
  v_status text;
begin
  select status into v_status from agents where profile_id = p_agent_id;
  if not found then
    raise exception 'Unknown agent %', p_agent_id using errcode = 'no_data_found';
  end if;
  if v_status = 'suspended' then
    raise exception 'Agent % is suspended' , p_agent_id using errcode = 'insufficient_privilege';
  end if;

  v_account := agent_account(p_agent_id, 'GC');

  v_txn := post_transfer(
    'inventory',
    system_account('house', 'GC'),
    v_account,
    p_amount,
    'GC',
    p_idempotency_key,
    jsonb_build_object(
      'agent_id', p_agent_id,
      'operator_id', p_operator_id,
      'reference', p_reference
    )
  );

  insert into audit_log (operator_id, target, field, old_value, new_value)
  values (p_operator_id, 'agents:' || p_agent_id::text, 'inventory_granted',
          null, p_amount::text);

  txn_id := v_txn;
  select balance into inventory from account_balance_cache where account_id = v_account;
  return next;
end;
$$;

/**
 * Agent -> player. The operation this whole file exists for.
 *
 * ## Every guard that matters is in here
 *
 * The agent must exist and be active. The player must belong to THIS agent.
 * The amount must be positive. The inventory must cover it. None of those are
 * checked by the caller — they are checked here, inside the transaction that
 * moves the coins, so no API mistake and no direct database session can move
 * coins between an agent and a player who are not related.
 *
 * ## Why the balances are stamped into metadata
 *
 * The ledger can always reconstruct a balance by summing entries, so storing
 * "balance before" and "balance after" is strictly redundant. It is recorded
 * anyway because the question asked after something has gone wrong is never
 * "what does the ledger sum to now" — it is "what did this agent believe they
 * had at 14:32", and answering that from first principles months later is an
 * afternoon. It costs two integers.
 */
create or replace function allocate_to_player(
  p_agent_id        uuid,
  p_player_id       uuid,
  p_amount          bigint,
  p_idempotency_key text default null
) returns table (txn_id uuid, agent_inventory bigint, player_balance bigint)
language plpgsql security definer as $$
declare
  v_agent_account uuid;
  v_player_account uuid;
  v_txn uuid;
  v_status text;
  v_owner uuid;
  v_agent_before bigint;
  v_player_before bigint;
begin
  if p_amount <= 0 then
    raise exception 'Allocation must be positive, got %', p_amount
      using errcode = 'check_violation';
  end if;

  select status into v_status from agents where profile_id = p_agent_id;
  if not found then
    raise exception 'Unknown agent %', p_agent_id using errcode = 'no_data_found';
  end if;
  if v_status <> 'active' then
    raise exception 'Agent % is not active', p_agent_id
      using errcode = 'insufficient_privilege';
  end if;

  -- THE ownership check. An agent may only fund their own players.
  select agent_id into v_owner from player_agents where player_id = p_player_id;
  if v_owner is distinct from p_agent_id then
    raise exception 'Player % does not belong to agent %', p_player_id, p_agent_id
      using errcode = 'insufficient_privilege';
  end if;

  v_agent_account := agent_account(p_agent_id, 'GC');
  v_player_account := player_account(p_player_id, 'GC');

  select balance into v_agent_before from account_balance_cache where account_id = v_agent_account;
  select balance into v_player_before from account_balance_cache where account_id = v_player_account;

  v_txn := post_transfer(
    'allocation',
    v_agent_account,
    v_player_account,
    p_amount,
    'GC',
    p_idempotency_key,
    jsonb_build_object(
      'agent_id', p_agent_id,
      'player_id', p_player_id,
      'initiated_by', p_agent_id,
      'agent_balance_before', coalesce(v_agent_before, 0),
      'player_balance_before', coalesce(v_player_before, 0)
    )
  );

  txn_id := v_txn;
  select balance into agent_inventory from account_balance_cache where account_id = v_agent_account;
  select balance into player_balance from account_balance_cache where account_id = v_player_account;
  return next;
end;
$$;

comment on function allocate_to_player is
  'Agent -> player coin allocation. Checks agent status and player ownership '
  'inside the transaction that moves the coins, so the API is not the control.';

/**
 * Redeem an invitation and bind the player to the agent.
 *
 * Single-use, expiring, and both are enforced by the UPDATE's WHERE clause
 * rather than by a read followed by a write — two players redeeming the same
 * link at the same moment cannot both succeed, because only one UPDATE can
 * match a row whose `redeemed_at` is still null.
 */
create or replace function redeem_agent_invite(
  p_token_hash text,
  p_player_id  uuid
) returns uuid
language plpgsql security definer as $$
declare
  v_agent uuid;
begin
  update agent_invites
  set redeemed_at = now(), redeemed_by = p_player_id
  where token_hash = p_token_hash
    and redeemed_at is null
    and expires_at > now()
    and agent_id in (select profile_id from agents where status = 'active')
  returning agent_id into v_agent;

  if v_agent is null then
    raise exception 'Invitation is invalid, expired or already used'
      using errcode = 'insufficient_privilege';
  end if;

  insert into player_agents (player_id, agent_id)
  values (p_player_id, v_agent)
  on conflict (player_id) do nothing;

  return v_agent;
end;
$$;

-- ------------------------------------------------------------------ audit

/**
 * Agent lifecycle changes are audited from a trigger.
 *
 * The same argument as `game_configs`: application code can forget, a direct
 * psql session bypasses it entirely, and "who suspended this agent and when" is
 * asked only after it matters.
 */
create or replace function audit_agent_change() returns trigger
language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    insert into audit_log (operator_id, target, field, old_value, new_value)
    values (new.created_by, 'agents:' || new.profile_id::text, 'created', null, new.status);
  elsif new.status is distinct from old.status then
    insert into audit_log (operator_id, target, field, old_value, new_value)
    values (new.created_by, 'agents:' || new.profile_id::text, 'status', old.status, new.status);
  end if;
  return null;
end;
$$;

drop trigger if exists agents_audited on agents;
create trigger agents_audited
  after insert or update on agents
  for each row execute function audit_agent_change();

/**
 * Reassignment is audited too, and it is the only way a player changes agent.
 * There is no self-service path in the API for this by design.
 */
create or replace function audit_player_agent_change() returns trigger
language plpgsql as $$
begin
  insert into audit_log (operator_id, target, field, old_value, new_value)
  values (new.assigned_by, 'player_agents:' || new.player_id::text, 'agent_id',
          case when tg_op = 'UPDATE' then old.agent_id::text else null end,
          new.agent_id::text);
  return null;
end;
$$;

drop trigger if exists player_agents_audited on player_agents;
create trigger player_agents_audited
  after insert or update on player_agents
  for each row execute function audit_player_agent_change();

-- ------------------------------------------------------- cache reconciliation

/**
 * Rebuild the balance cache for every owned account from the ledger.
 *
 * Belt and braces, and cheap. The cache is a derived convenience — the ledger
 * is the truth — but `post_transfer` reads the cache to decide whether an agent
 * has enough inventory, so a missing row reads as zero and refuses a perfectly
 * good allocation. That can happen if 0008's one-time cleanup is ever re-run
 * after agents exist, or if a row is lost any other way.
 *
 * Recomputing from `ledger_entries` is always correct because the ledger is
 * append-only, and running it again changes nothing.
 */
insert into account_balance_cache (account_id, balance, updated_at)
select a.id, coalesce(sum(e.amount), 0), now()
from accounts a
left join ledger_entries e on e.account_id = a.id
where a.kind::text in ('player', 'agent')
group by a.id
on conflict (account_id) do update
  set balance = excluded.balance, updated_at = now();


-- ==========================================================================
-- 0010_agent_audit_actor.sql
-- ==========================================================================

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


-- ==========================================================================
-- 0011_agent_created_players.sql
-- ==========================================================================

-- ============================================================================
-- Juwa — agent-created player accounts, and admin reversals.
--
-- TWO CHANGES, AND THE FIRST ONE IS A DELIBERATE POLICY DECISION
--
-- Until now a player always created their own account with their own password,
-- and an agent could only invite. The founder has chosen to let agents CREATE
-- accounts and set a temporary password, because their players are recruited in
-- person and many will not have an email address to sign up with.
--
-- The consequence, stated plainly because it should be in the schema and not
-- only in somebody's memory: for the window between creation and the player
-- setting their own password, the agent knows a working credential for that
-- account. Two things below narrow that window as far as it can be narrowed
-- without removing the feature.
--
--   `must_set_password` forces the player to choose their own password the
--   first time they sign in. Until they do, the app will let them do nothing
--   else — so the agent's copy stops working at first contact rather than
--   lasting for the life of the account.
--
--   `created_by_agent` records who made every such account, permanently. When
--   a dispute arrives — and with shared credentials one eventually does — the
--   question "was this account ever under someone else's control" has an
--   answer that does not depend on anyone's recollection.
--
-- The age gate is NOT relaxed. An agent creating an account supplies the
-- player's date of birth and state, `complete_registration` checks them exactly
-- as it does for self-service sign-up, and the attestation is now attributable
-- to a named agent rather than to an anonymous form.
-- ============================================================================

-- ------------------------------------------------------- the two new columns

alter table profiles
  add column if not exists must_set_password boolean not null default false;

/**
 * Who created this account, when it was not the player themselves.
 *
 * `on delete set null` rather than restrict: an agent may eventually be
 * removed, and the player's account must survive that. The audit_log row
 * written at creation is the permanent record; this column is the fast answer.
 */
alter table profiles
  add column if not exists created_by_agent uuid references agents(profile_id) on delete set null;

comment on column profiles.must_set_password is
  'True while an agent-set temporary password is still in force. The app '
  'refuses to do anything else until the player replaces it.';

-- ------------------------------------------------------- creating a player

/**
 * An agent creates a player account.
 *
 * The auth user itself is created by the API through Supabase''s admin API —
 * passwords are Supabase''s business and nothing in this database ever sees
 * one. By the time this runs the auth row exists and this attaches everything
 * that is ours: the profile, the welcome bonus, the agent binding, and the
 * flag that forces the password to be replaced.
 *
 * Atomic, so a failure part way through cannot leave a player who exists but
 * belongs to nobody, or one bound to an agent with no balance record.
 */
create or replace function create_agent_player(
  p_agent_id      uuid,
  p_player_id     uuid,
  p_username      text,
  p_date_of_birth date,
  p_country       text,
  p_region        text,
  p_welcome_coins bigint
) returns table (username text, balance bigint)
language plpgsql security definer as $$
declare
  v_status text;
  v_row    record;
begin
  -- The same status gate allocation uses. A suspended agent creating accounts
  -- would be a suspended agent still growing their book.
  select status into v_status from agents where profile_id = p_agent_id;
  if not found then
    raise exception 'Unknown agent %', p_agent_id using errcode = 'no_data_found';
  end if;
  if v_status <> 'active' then
    raise exception 'Agent % is not active', p_agent_id using errcode = 'insufficient_privilege';
  end if;

  -- Age, jurisdiction, username rules, welcome bonus: all of it, unchanged.
  -- An account made by an agent is subject to exactly the checks an account
  -- made by its own owner is.
  select * into v_row from complete_registration(
    p_player_id, p_username, p_date_of_birth, p_country, p_region, p_welcome_coins
  );

  update profiles
     set must_set_password = true,
         created_by_agent  = p_agent_id
   where id = p_player_id;

  insert into player_agents (player_id, agent_id)
  values (p_player_id, p_agent_id)
  on conflict (player_id) do nothing;

  insert into audit_log (operator_id, target, field, old_value, new_value)
  values (null, 'profiles:' || p_player_id::text, 'created_by_agent',
          null, p_agent_id::text);

  username := v_row.username;
  balance  := v_row.balance;
  return next;
end;
$$;

comment on function create_agent_player is
  'Agent-created player account. Applies the full age and jurisdiction gate, '
  'and marks the temporary password as one that must be replaced.';

/**
 * The player has chosen their own password.
 *
 * Called by the API after Supabase has accepted the change, so this only ever
 * records that it happened — the password itself never reaches this database.
 */
create or replace function clear_must_set_password(p_player_id uuid)
returns void
language plpgsql security definer as $$
begin
  update profiles set must_set_password = false
   where id = p_player_id and must_set_password;

  if found then
    insert into audit_log (operator_id, target, field, old_value, new_value)
    values (null, 'profiles:' || p_player_id::text, 'must_set_password', 'true', 'false');
  end if;
end;
$$;

-- ------------------------------------------------------------- reversals

/**
 * Undo an allocation, as a NEW transaction.
 *
 * Nothing is deleted and nothing is edited. The original allocation stays in
 * the ledger exactly as it was posted, and this adds an equal and opposite
 * transaction beside it — so the balances come out right and the record still
 * shows that a mistake was made and then corrected. An accounting system where
 * errors can be made to disappear is one nobody can rely on afterwards.
 *
 * ADMIN ONLY, and that is the whole design. There is no agent-facing route to
 * this and there must not be: an agent who can pull coins back out of a
 * player''s balance on request is an agent who can settle up in cash, which is
 * the line this product does not cross.
 *
 * If the player has already spent the coins the reversal FAILS, because their
 * balance cannot go negative. That is correct — the alternative is a player
 * pushed into debt by an operator''s correction.
 */
create or replace function reverse_allocation(
  p_txn_id      uuid,
  p_operator_id uuid,
  p_reason      text
) returns table (txn_id uuid, agent_inventory bigint, player_balance bigint)
language plpgsql security definer as $$
declare
  v_type            txn_type;
  v_agent_id        uuid;
  v_player_id       uuid;
  v_amount          bigint;
  v_agent_account   uuid;
  v_player_account  uuid;
  v_new_txn         uuid;
begin
  select t.type,
         (t.metadata->>'agent_id')::uuid,
         (t.metadata->>'player_id')::uuid
    into v_type, v_agent_id, v_player_id
    from transactions t
   where t.id = p_txn_id;

  if not found then
    raise exception 'No such transaction %', p_txn_id using errcode = 'no_data_found';
  end if;
  if v_type::text <> 'allocation' then
    raise exception 'Only an allocation can be reversed, not %', v_type
      using errcode = 'check_violation';
  end if;
  if v_agent_id is null or v_player_id is null then
    raise exception 'Transaction % does not name an agent and a player', p_txn_id
      using errcode = 'check_violation';
  end if;

  -- Refuse a second reversal of the same transaction. Without this, two
  -- operators reading the same support ticket take the coins back twice.
  if exists (
    select 1 from transactions
     where type::text = 'allocation'
       and (metadata->>'reverses') = p_txn_id::text
  ) then
    raise exception 'Transaction % has already been reversed', p_txn_id
      using errcode = 'unique_violation';
  end if;

  v_agent_account  := agent_account(v_agent_id, 'GC');
  v_player_account := player_account(v_player_id, 'GC');

  select abs(e.amount) into v_amount
    from ledger_entries e
   where e.transaction_id = p_txn_id and e.account_id = v_player_account;

  -- Player -> agent, which is the ONLY place in this schema that direction
  -- exists. It is reachable from one admin-only function, by transaction id,
  -- once per transaction, and never from any agent- or player-facing route.
  v_new_txn := post_transfer(
    'allocation',
    v_player_account,
    v_agent_account,
    v_amount,
    'GC',
    'reversal:' || p_txn_id::text,
    jsonb_build_object(
      'agent_id', v_agent_id,
      'player_id', v_player_id,
      'reverses', p_txn_id,
      'operator_id', p_operator_id,
      'reason', p_reason
    )
  );

  insert into audit_log (operator_id, target, field, old_value, new_value)
  values (p_operator_id, 'transactions:' || p_txn_id::text, 'reversed',
          v_amount::text, coalesce(p_reason, 'no reason given'));

  txn_id := v_new_txn;
  select balance into agent_inventory from account_balance_cache where account_id = v_agent_account;
  select balance into player_balance  from account_balance_cache where account_id = v_player_account;
  return next;
end;
$$;

comment on function reverse_allocation is
  'Admin-only correction of a mis-sent allocation. Posts an opposite '
  'transaction rather than editing history, and refuses to run twice.';

-- --------------------------------------------------------- applying to be one

/**
 * Someone asks to become an agent.
 *
 * Creates a `pending` row, which grants nothing: `allocate_to_player` and
 * `redeem_agent_invite` both require 'active', so an application is an entry in
 * a queue and not a capability. An operator approving it is what makes it real.
 *
 * One row per profile — the primary key sees to that — so this cannot be used
 * to flood the queue from a single account.
 */
create or replace function apply_to_be_agent(
  p_profile_id   uuid,
  p_display_name text,
  p_notes        text default null
) returns text
language plpgsql security definer as $$
declare
  v_status text;
begin
  if not exists (select 1 from profiles where id = p_profile_id and registered_at is not null) then
    raise exception 'Registration is not complete' using errcode = 'check_violation';
  end if;

  select status into v_status from agents where profile_id = p_profile_id;
  if found then
    -- Already applied or already an agent. Returning the current status rather
    -- than raising keeps a double-tap harmless.
    return v_status;
  end if;

  insert into agents (profile_id, display_name, status, created_by, notes)
  values (p_profile_id, p_display_name, 'pending', null, p_notes);

  return 'pending';
end;
$$;


-- ==========================================================================
-- 0012_responsible_gaming.sql
-- ==========================================================================

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


-- ==========================================================================
-- 0013_zero_welcome_grant.sql
-- ==========================================================================

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


-- ==========================================================================
-- 0014_casino_cash.sql
-- ==========================================================================

-- ============================================================================
-- Juwa — Casino Cash (CC), and the conversions between it and Gold Coins.
--
-- A second virtual currency. Players redeem GC for CC through their agent, and
-- convert CC back to GC through their agent; agents redeem their accumulated CC
-- with the operator for fresh GC inventory. Nothing here is money, nothing here
-- leaves the system, and there is no cash-out path — see the guardrail note at
-- the bottom of this file.
--
-- ## Why this is another small migration
--
-- The same reason 0009 was. The money layer was already right and already
-- currency-parameterised: `accounts` is keyed on (owner_id, kind, currency),
-- `post_transfer` takes a currency, `player_account` and `agent_account` take a
-- currency, and the balance cache refuses to let a player or agent account go
-- negative whatever the currency is. A player's CC balance is one more row in a
-- table that was built to hold it.
--
-- So almost everything below is the REQUEST LIFECYCLE — pending, approved,
-- rejected — and the exchange rates. The money movement is six lines calling a
-- function that has existed since 0001.
--
-- ## The one structural fact that shapes everything
--
-- `assert_transaction_balances` groups by currency, so a transaction must net
-- to zero IN EACH CURRENCY. A conversion is therefore NOT one transfer: a
-- single transaction holding -100,000 GC and +100 CC would be rejected, and
-- should be — those two numbers have no arithmetic relationship, only a
-- commercial one.
--
-- A conversion is TWO transfers inside one database transaction:
--
--     GC leg:   player GC        -> agent GC inventory
--     CC leg:   agent CC balance -> player CC balance
--
-- Both commit or neither does, because plpgsql functions are atomic. Double
-- entry stays intact in both currencies, and the agent's spread is a real
-- balance that can be summed from the ledger rather than a number someone
-- computed and stored.
--
-- ## Where the CC comes from
--
-- Not from nowhere. `house/CC` is the issuing account, exactly as `house/GC`
-- issues coins, and it is the only account permitted to run negative — the
-- outstanding CC in the economy is the negative of its balance, which is the
-- number an operator actually wants to know. An agent receives CC from the
-- operator and pays it out to players; a player receiving CC receives it from
-- their agent's balance, so an agent cannot pay out CC they were never given.
--
-- ## Where authorisation lives
--
-- Here, not in the API, for the reason 0009 gives at length: the checks that
-- matter run inside the transaction that moves the coins, so no API mistake and
-- no direct psql session can convert between a player and an agent who are not
-- related, approve a request twice, or approve a request the agent cannot fund.
-- ============================================================================

-- ---------------------------------------------------------- 1. the currency

/**
 * CC joins the currency list.
 *
 * A VALUE, not a type — the whole point of `accounts.currency` being text with
 * a check rather than an enum or a column per currency. Bonus Coins or
 * tournament tickets later are one more literal here and a rate row; they are
 * not another wallet. That is the "future-proof" requirement met by the design
 * that was already in place rather than by machinery added for it.
 *
 * `SC` was deliberately removed in 0002 with the note that dropping it stopped
 * code quietly issuing a redeemable balance. CC is added with its eyes open:
 * it is redeemable for GC and for nothing else, and the closed-loop guarantee
 * is stated and enforced at the bottom of this file.
 */
alter table accounts drop constraint if exists accounts_currency_check;
alter table accounts add constraint accounts_currency_check
  check (currency in ('USD', 'GC', 'CC'));

/**
 * The issuing account for CC.
 *
 * `house` rather than `promo`: promo is where free things come from, and CC is
 * never free — every unit a player holds was bought with GC they had to win or
 * be allocated. House accounts are also the only ones allowed to go negative
 * (see `apply_entry_to_cache`), which is what lets this one act as an issuer.
 */
insert into accounts (owner_id, kind, currency)
select null, 'house', 'CC'
where not exists (
  select 1 from accounts where owner_id is null and kind::text = 'house' and currency = 'CC'
);

/**
 * One transaction type, not six.
 *
 * The brief listed GC_TO_CC_REQUEST, GC_TO_CC_REJECTED and friends. Those are
 * request STATES: a request moves no money and a rejection moves no money, so
 * recording them as ledger transactions would write rows into a double-entry
 * ledger with nothing in them — and every report that sums the ledger would
 * then have to filter out the transactions that are not transactions.
 *
 * The lifecycle lives on `conversion_requests`, which links to its ledger
 * transactions and is linked back from them. Nothing is lost: every state
 * change is recorded, timestamped and attributed; only the empty ledger rows
 * are absent.
 *
 * `conversion` covers both legs of both directions. Which direction it was is
 * the sign of the entry, and which request it belongs to is in the metadata.
 */
alter type txn_type add value if not exists 'conversion';

-- ------------------------------------------------------ 2. exchange rates

/**
 * The rates, append-only.
 *
 * NEVER UPDATED IN PLACE. Changing a rate inserts a new row and the old one
 * stays, which makes rate history intrinsic rather than something a separate
 * audit table has to be trusted to have recorded. `current_rate` reads the most
 * recent row at or before now.
 *
 * That is belt to the braces of the rate being COPIED onto each request at
 * approval — see `conversion_requests.gc_per_cc`. The copy is what guarantees a
 * settled transaction can never be re-priced; this table is what lets an
 * operator answer "what was the player rate last March" without one.
 *
 * ## Two tiers, and why the difference is not called profit
 *
 * `player_agent` is what a player gets. `agent_operator` is what an agent gets.
 * The operator rate is the more generous of the two, and the difference is the
 * agent's economic incentive to do the work of distribution. The system tracks
 * two rates; it does not compute or display a margin, because naming it would
 * be a commercial decision this schema has no business making.
 */
create table if not exists exchange_rates (
  id           uuid primary key default gen_random_uuid(),
  /** Which side of the chain this rate prices. */
  tier         text not null check (tier in ('player_agent', 'agent_operator')),
  /**
   * An override for one agent, or null for the default that applies to all.
   *
   * Nullable rather than a second table: an agent-specific rate is the same
   * fact as the default with a narrower scope, and `current_rate` resolves the
   * most specific match. A separate table would need the same resolution logic
   * plus a join.
   */
  agent_id     uuid references agents(profile_id) on delete cascade,
  /**
   * How many GC one CC is worth, as an INTEGER.
   *
   * Integer for the same reason every amount in this schema is: a rate held as
   * a float turns 100 CC into 999,999.9999999 GC on some pair of values, and
   * the resulting rounding error is a real coin that either exists or does not.
   * A rate of "one and a half thousand GC per CC" is not expressible and does
   * not need to be; the rates in play are tens of thousands.
   */
  gc_per_cc    bigint not null check (gc_per_cc > 0),
  effective_from timestamptz not null default now(),
  set_by       uuid references operators(id),
  note         text,
  created_at   timestamptz not null default now()
);

create index if not exists exchange_rates_lookup
  on exchange_rates (tier, agent_id, effective_from desc);

comment on table exchange_rates is
  'Append-only GC-per-CC rates. A change inserts a row; nothing is ever updated, '
  'so the rate in force at any past moment is recoverable.';

/**
 * Append-only, enforced rather than documented.
 *
 * The same rule the ledger and the audit log follow. A rate that could be
 * edited would make every historical conversion unverifiable, because the
 * evidence that the rate used was the rate in force would be gone.
 */
create or replace function exchange_rates_are_append_only() returns trigger
language plpgsql as $$
begin
  raise exception 'exchange_rates is append-only; insert a new rate instead'
    using errcode = 'check_violation';
end;
$$;

drop trigger if exists exchange_rates_no_change on exchange_rates;
create trigger exchange_rates_no_change
  before update or delete on exchange_rates
  for each row execute function exchange_rates_are_append_only();

/**
 * The rate in force, most specific first.
 *
 * An agent-specific rate beats the default; among rows of equal specificity the
 * most recent effective_from wins. Future-dated rows are ignored, so a rate can
 * be scheduled without taking effect early.
 */
create or replace function current_rate(p_tier text, p_agent_id uuid default null)
returns bigint
language sql stable security definer as $$
  select r.gc_per_cc
  from exchange_rates r
  where r.tier = p_tier
    and (r.agent_id is null or r.agent_id = p_agent_id)
    and r.effective_from <= now()
  order by (r.agent_id is not null) desc, r.effective_from desc, r.created_at desc
  limit 1;
$$;

/**
 * Opening rates.
 *
 * Placeholders with the shape the brief described, not a commercial decision:
 * the operator sets the real ones from the admin console, and the first row an
 * operator writes supersedes these without deleting them.
 */
insert into exchange_rates (tier, gc_per_cc, note)
select 'player_agent', 10000, 'opening default'
where not exists (select 1 from exchange_rates where tier = 'player_agent');

insert into exchange_rates (tier, gc_per_cc, note)
select 'agent_operator', 15000, 'opening default'
where not exists (select 1 from exchange_rates where tier = 'agent_operator');

-- --------------------------------------------------- 3. conversion requests

/**
 * A conversion a player has asked for and an agent has not yet answered.
 *
 * ## Why a request table and not an immediate transfer
 *
 * Because an agent has to agree. The GC leg of a CC -> GC conversion comes out
 * of the agent's own inventory, and the agent is the one who knows whether the
 * player has met whatever they agreed off-platform. A conversion that happened
 * the moment a player pressed a button would be a player spending an agent's
 * inventory without asking.
 *
 * ## Balances do not move until a decision
 *
 * Deliberately, and it is the part most likely to be "improved" later into a
 * hold or an escrow. It should not be: a pending request that had already taken
 * the player's GC would leave a player with coins they can neither play nor
 * spend for as long as their agent takes to look, and the failure mode of a
 * forgotten request would be a permanently frozen balance.
 *
 * The cost is that a player can request more than they have and be refused at
 * approval time. That is the right way round — the refusal is cheap, visible,
 * and happens to the request rather than to the balance.
 */
create table if not exists conversion_requests (
  id           uuid primary key default gen_random_uuid(),
  player_id    uuid not null references profiles(id) on delete restrict,
  /**
   * Stamped at REQUEST time, not resolved at approval.
   *
   * A player who is reassigned to a different agent while a request is open
   * must not have the new agent silently inherit an obligation they never saw.
   * The approval re-checks that this is still the player's agent.
   */
  agent_id     uuid not null references agents(profile_id) on delete restrict,
  direction    text not null check (direction in ('gc_to_cc', 'cc_to_gc')),
  /** Both sides, computed at request time so the player sees what they will get. */
  gc_amount    bigint not null check (gc_amount > 0),
  cc_amount    bigint not null check (cc_amount > 0),
  /**
   * The rate used, COPIED rather than referenced.
   *
   * `rate_id` records which row it came from; this integer is what the
   * transaction was actually priced at. Copying it is what makes "historical
   * exchange rates must never change after a transaction is completed" a
   * property of the data rather than a promise about future edits.
   */
  gc_per_cc    bigint not null check (gc_per_cc > 0),
  rate_id      uuid references exchange_rates(id),
  status       text not null default 'pending'
                 check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  /** The two ledger transactions, once there are any. Null while pending. */
  gc_txn_id    uuid references transactions(id),
  cc_txn_id    uuid references transactions(id),
  /**
   * Balances as they stood when the decision was made.
   *
   * Redundant against the ledger and recorded anyway, for the reason
   * `allocate_to_player` gives: the question after something goes wrong is
   * never "what does the ledger sum to now", it is "what did this agent believe
   * they had at 14:32".
   */
  player_gc_before bigint,
  player_cc_before bigint,
  agent_gc_before  bigint,
  agent_cc_before  bigint,
  requested_at timestamptz not null default now(),
  decided_at   timestamptz,
  /** The agent who approved or rejected. Never the player. */
  decided_by   uuid references profiles(id),
  reason       text,

  /** A decided request has a decision; a pending one does not. */
  constraint decision_is_complete check (
    (status = 'pending' and decided_at is null and decided_by is null) or
    (status <> 'pending' and decided_at is not null)
  )
);

/**
 * An approved request moved money; anything else did not.
 *
 * A TRIGGER rather than the obvious CHECK constraint, and deferred, because
 * `approve_conversion` claims the request before it does the work: it sets
 * status to 'approved' first — that UPDATE is what makes a double approval
 * impossible — and only then posts the two transfers and writes their ids back.
 * Between those two statements the row is approved with no transactions, which
 * a CHECK would reject and which is a perfectly legitimate intermediate state.
 *
 * Postgres cannot defer a CHECK (only unique, foreign key, exclusion and
 * constraint triggers can be deferred), so this is a constraint trigger fired
 * at COMMIT — the same instrument, and for the same reason, as the ledger's own
 * `ledger_entries_balance`. The invariant is unchanged; only the moment it is
 * tested moves to the end of the transaction, which is the only moment at which
 * it is meaningful.
 */
create or replace function conversion_request_is_settled() returns trigger
language plpgsql as $$
declare
  r conversion_requests%rowtype;
begin
  select * into r from conversion_requests where id = new.id;
  -- Gone by commit time. Nothing to check.
  if not found then return null; end if;

  if r.status = 'approved' and (r.gc_txn_id is null or r.cc_txn_id is null) then
    raise exception 'Approved conversion % has no ledger transactions', r.id
      using errcode = 'check_violation';
  end if;
  if r.status <> 'approved' and (r.gc_txn_id is not null or r.cc_txn_id is not null) then
    raise exception 'Conversion % is % but moved money', r.id, r.status
      using errcode = 'check_violation';
  end if;
  return null;
end;
$$;

drop trigger if exists conversion_requests_settled on conversion_requests;
create constraint trigger conversion_requests_settled
  after insert or update on conversion_requests
  deferrable initially deferred
  for each row execute function conversion_request_is_settled();

create index if not exists conversion_requests_by_agent
  on conversion_requests (agent_id, status, requested_at desc);
create index if not exists conversion_requests_by_player
  on conversion_requests (player_id, requested_at desc);

/**
 * At most one open request per player per direction.
 *
 * A partial unique index rather than a check in the function, so it holds
 * against every writer including a direct psql session. Without it a player can
 * queue five requests for the same coins and an agent approving all five pays
 * five times — each approval individually passes its balance check because the
 * earlier ones have not been applied yet.
 */
create unique index if not exists conversion_requests_one_open
  on conversion_requests (player_id, direction)
  where status = 'pending';

comment on table conversion_requests is
  'Player-initiated GC<->CC conversions awaiting an agent decision. Balances do '
  'not move until approval.';

-- ------------------------------------------------------ 4. agent CC ledger

/**
 * An agent redeeming CC with the operator for GC inventory.
 *
 * Its own table rather than a row in `conversion_requests`, because it is not
 * the same shape: there is no player, and in the current model there is no
 * approval step — an agent with CC in hand and a published operator rate is
 * exercising a standing offer, not asking permission. Squeezing it into the
 * request table would mean a nullable player_id and a status that is always
 * 'approved', which is a table pretending to be two tables.
 *
 * If an operator approval step is wanted later, this table already has the
 * columns for it: add a status and stop writing the transaction ids inline.
 */
create table if not exists agent_cc_redemptions (
  id           uuid primary key default gen_random_uuid(),
  agent_id     uuid not null references agents(profile_id) on delete restrict,
  cc_amount    bigint not null check (cc_amount > 0),
  gc_amount    bigint not null check (gc_amount > 0),
  gc_per_cc    bigint not null check (gc_per_cc > 0),
  rate_id      uuid references exchange_rates(id),
  cc_txn_id    uuid not null references transactions(id),
  gc_txn_id    uuid not null references transactions(id),
  agent_cc_before bigint,
  agent_gc_before bigint,
  created_at   timestamptz not null default now()
);

create index if not exists agent_cc_redemptions_by_agent
  on agent_cc_redemptions (agent_id, created_at desc);

-- -------------------------------------------------------- 5. the operations

/**
 * Operator -> agent. CC in.
 *
 * The mirror of `grant_agent_inventory`, which does the same thing for GC, and
 * deliberately written the same way so the two read as one pair. CC comes from
 * `house/CC`; nothing is minted.
 */
create or replace function grant_agent_cc(
  p_agent_id        uuid,
  p_amount          bigint,
  p_operator_id     uuid,
  p_idempotency_key text default null,
  p_reference       text default null
) returns table (txn_id uuid, cc_balance bigint)
language plpgsql security definer as $$
declare
  v_account uuid;
  v_txn uuid;
  v_status text;
begin
  if p_amount <= 0 then
    raise exception 'CC grant must be positive, got %', p_amount
      using errcode = 'check_violation';
  end if;

  select status into v_status from agents where profile_id = p_agent_id;
  if not found then
    raise exception 'Unknown agent %', p_agent_id using errcode = 'no_data_found';
  end if;
  if v_status = 'suspended' then
    raise exception 'Agent % is suspended', p_agent_id using errcode = 'insufficient_privilege';
  end if;

  v_account := agent_account(p_agent_id, 'CC');

  v_txn := post_transfer(
    'inventory',
    system_account('house', 'CC'),
    v_account,
    p_amount,
    'CC',
    p_idempotency_key,
    jsonb_build_object(
      'agent_id', p_agent_id,
      'operator_id', p_operator_id,
      'reference', p_reference
    )
  );

  insert into audit_log (operator_id, target, field, old_value, new_value)
  values (p_operator_id, 'agents:' || p_agent_id::text, 'cc_granted', null, p_amount::text);

  txn_id := v_txn;
  select balance into cc_balance from account_balance_cache where account_id = v_account;
  return next;
end;
$$;

/**
 * A player asks to convert.
 *
 * Computes both sides at the rate in force and records it. Moves nothing.
 *
 * ## The amount the player names
 *
 * For `gc_to_cc` the player names GC and the CC follows; for `cc_to_gc` they
 * name CC and the GC follows. In both cases the named side is exact and the
 * other is derived, which is the only arrangement where the player is never
 * surprised by rounding: `100,000 GC / 10,000` is exactly 10 CC, but a player
 * naming 7 CC at a rate of 10,000 would get 70,000 GC and a player naming
 * 75,000 GC would get 7.5 CC — and CC is an integer.
 *
 * So a GC amount that is not a whole multiple of the rate is REFUSED rather
 * than rounded. Rounding down silently confiscates the remainder; rounding up
 * mints CC. Refusing costs the player one correction and costs the ledger
 * nothing.
 */
create or replace function request_conversion(
  p_player_id uuid,
  p_direction text,
  p_amount    bigint
) returns uuid
language plpgsql security definer as $$
declare
  v_agent uuid;
  v_agent_status text;
  v_rate bigint;
  v_rate_id uuid;
  v_gc bigint;
  v_cc bigint;
  v_request uuid;
begin
  if p_direction not in ('gc_to_cc', 'cc_to_gc') then
    raise exception 'Unknown conversion direction %', p_direction
      using errcode = 'check_violation';
  end if;
  if p_amount is null or p_amount <= 0 then
    raise exception 'Conversion amount must be positive' using errcode = 'check_violation';
  end if;

  select pa.agent_id into v_agent from player_agents pa where pa.player_id = p_player_id;
  if v_agent is null then
    raise exception 'You do not have an agent to convert with'
      using errcode = 'insufficient_privilege';
  end if;

  select status into v_agent_status from agents where profile_id = v_agent;
  if v_agent_status <> 'active' then
    raise exception 'Your agent is not currently able to process conversions'
      using errcode = 'insufficient_privilege';
  end if;

  v_rate := current_rate('player_agent', v_agent);
  if v_rate is null then
    raise exception 'No exchange rate is configured' using errcode = 'no_data_found';
  end if;
  select id into v_rate_id
  from exchange_rates
  where tier = 'player_agent'
    and (agent_id is null or agent_id = v_agent)
    and effective_from <= now()
  order by (agent_id is not null) desc, effective_from desc, created_at desc
  limit 1;

  if p_direction = 'gc_to_cc' then
    v_gc := p_amount;
    if v_gc % v_rate <> 0 then
      raise exception 'Redeem a multiple of % GC at the current rate', v_rate
        using errcode = 'check_violation';
    end if;
    v_cc := v_gc / v_rate;
  else
    v_cc := p_amount;
    v_gc := v_cc * v_rate;
  end if;

  if v_cc <= 0 or v_gc <= 0 then
    raise exception 'Conversion is too small at the current rate'
      using errcode = 'check_violation';
  end if;

  /*
   * The open-request index does the real work here; this is the friendly error.
   * A second request racing the first still fails, on the unique violation.
   */
  if exists (
    select 1 from conversion_requests
    where player_id = p_player_id and direction = p_direction and status = 'pending'
  ) then
    raise exception 'You already have a pending request of this kind'
      using errcode = 'unique_violation';
  end if;

  insert into conversion_requests (
    player_id, agent_id, direction, gc_amount, cc_amount, gc_per_cc, rate_id
  ) values (
    p_player_id, v_agent, p_direction, v_gc, v_cc, v_rate, v_rate_id
  ) returning id into v_request;

  return v_request;
end;
$$;

/**
 * The agent approves.
 *
 * ## Duplicate approval is stopped by the UPDATE, not by a read
 *
 * The state transition is a conditional UPDATE whose WHERE clause includes
 * `status = 'pending'`, and the function raises if no row matched. Two
 * approvals arriving together cannot both match: the second waits on the first
 * one's row lock, and when it proceeds the row is no longer pending. This is
 * the same shape `redeem_agent_invite` uses to make an invitation single-use,
 * and it is stronger than a read-then-write because there is no window between
 * the check and the change.
 *
 * The UPDATE happens FIRST, before any money moves, so the claim on the request
 * is taken before the work is done rather than after.
 *
 * ## Two transfers, one transaction
 *
 * A plpgsql function runs inside the caller's transaction, so a failure in the
 * second leg rolls back the first. There is no state in which a player has been
 * debited GC and not credited CC.
 */
create or replace function approve_conversion(
  p_request_id uuid,
  p_agent_id   uuid
) returns table (
  request_id uuid,
  gc_txn uuid,
  cc_txn uuid,
  player_gc bigint,
  player_cc bigint,
  agent_gc bigint,
  agent_cc bigint
)
language plpgsql security definer as $$
declare
  r conversion_requests%rowtype;
  v_agent_status text;
  v_owner uuid;
  v_player_gc_acct uuid;
  v_player_cc_acct uuid;
  v_agent_gc_acct uuid;
  v_agent_cc_acct uuid;
  v_gc_txn uuid;
  v_cc_txn uuid;
begin
  select status into v_agent_status from agents where profile_id = p_agent_id;
  if not found then
    raise exception 'Unknown agent %', p_agent_id using errcode = 'no_data_found';
  end if;
  if v_agent_status <> 'active' then
    raise exception 'Agent % is not active', p_agent_id using errcode = 'insufficient_privilege';
  end if;

  /*
   * CLAIM THE REQUEST FIRST. Everything after this line is done by exactly one
   * caller, because only one UPDATE can have matched a pending row.
   */
  update conversion_requests
  set status = 'approved', decided_at = now(), decided_by = p_agent_id
  where id = p_request_id and status = 'pending' and agent_id = p_agent_id
  returning * into r;

  if not found then
    raise exception 'Request % is not pending for this agent', p_request_id
      using errcode = 'insufficient_privilege';
  end if;

  -- Still this agent's player? A reassignment between request and approval
  -- must not let the old agent settle it.
  select agent_id into v_owner from player_agents where player_id = r.player_id;
  if v_owner is distinct from p_agent_id then
    raise exception 'Player % no longer belongs to agent %', r.player_id, p_agent_id
      using errcode = 'insufficient_privilege';
  end if;

  v_player_gc_acct := player_account(r.player_id, 'GC');
  v_player_cc_acct := player_account(r.player_id, 'CC');
  v_agent_gc_acct  := agent_account(p_agent_id, 'GC');
  v_agent_cc_acct  := agent_account(p_agent_id, 'CC');

  select coalesce(balance, 0) into r.player_gc_before from account_balance_cache where account_id = v_player_gc_acct;
  select coalesce(balance, 0) into r.player_cc_before from account_balance_cache where account_id = v_player_cc_acct;
  select coalesce(balance, 0) into r.agent_gc_before  from account_balance_cache where account_id = v_agent_gc_acct;
  select coalesce(balance, 0) into r.agent_cc_before  from account_balance_cache where account_id = v_agent_cc_acct;

  if r.direction = 'gc_to_cc' then
    -- The player's GC goes to the agent's inventory; the agent's CC goes to the
    -- player. An agent who has no CC cannot pay out CC, which is the whole of
    -- "no arbitrary balance creation" for this direction.
    v_gc_txn := post_transfer(
      'conversion', v_player_gc_acct, v_agent_gc_acct, r.gc_amount, 'GC',
      'conv:gc:' || p_request_id::text,
      jsonb_build_object('request_id', p_request_id, 'direction', r.direction,
                         'gc_per_cc', r.gc_per_cc, 'player_id', r.player_id,
                         'agent_id', p_agent_id, 'approved_by', p_agent_id,
                         'player_gc_before', r.player_gc_before,
                         'agent_gc_before', r.agent_gc_before)
    );
    v_cc_txn := post_transfer(
      'conversion', v_agent_cc_acct, v_player_cc_acct, r.cc_amount, 'CC',
      'conv:cc:' || p_request_id::text,
      jsonb_build_object('request_id', p_request_id, 'direction', r.direction,
                         'gc_per_cc', r.gc_per_cc, 'player_id', r.player_id,
                         'agent_id', p_agent_id, 'approved_by', p_agent_id,
                         'player_cc_before', r.player_cc_before,
                         'agent_cc_before', r.agent_cc_before)
    );
  else
    -- The reverse. The GC comes out of the agent's inventory, so an agent
    -- without enough inventory cannot approve — `post_transfer` refuses, and
    -- the whole function including the claim above rolls back, leaving the
    -- request pending and approvable once the agent has restocked.
    v_cc_txn := post_transfer(
      'conversion', v_player_cc_acct, v_agent_cc_acct, r.cc_amount, 'CC',
      'conv:cc:' || p_request_id::text,
      jsonb_build_object('request_id', p_request_id, 'direction', r.direction,
                         'gc_per_cc', r.gc_per_cc, 'player_id', r.player_id,
                         'agent_id', p_agent_id, 'approved_by', p_agent_id,
                         'player_cc_before', r.player_cc_before,
                         'agent_cc_before', r.agent_cc_before)
    );
    v_gc_txn := post_transfer(
      'conversion', v_agent_gc_acct, v_player_gc_acct, r.gc_amount, 'GC',
      'conv:gc:' || p_request_id::text,
      jsonb_build_object('request_id', p_request_id, 'direction', r.direction,
                         'gc_per_cc', r.gc_per_cc, 'player_id', r.player_id,
                         'agent_id', p_agent_id, 'approved_by', p_agent_id,
                         'player_gc_before', r.player_gc_before,
                         'agent_gc_before', r.agent_gc_before)
    );
  end if;

  update conversion_requests
  set gc_txn_id = v_gc_txn,
      cc_txn_id = v_cc_txn,
      player_gc_before = r.player_gc_before,
      player_cc_before = r.player_cc_before,
      agent_gc_before = r.agent_gc_before,
      agent_cc_before = r.agent_cc_before
  where id = p_request_id;

  request_id := p_request_id;
  gc_txn := v_gc_txn;
  cc_txn := v_cc_txn;
  select balance into player_gc from account_balance_cache where account_id = v_player_gc_acct;
  select balance into player_cc from account_balance_cache where account_id = v_player_cc_acct;
  select balance into agent_gc  from account_balance_cache where account_id = v_agent_gc_acct;
  select balance into agent_cc  from account_balance_cache where account_id = v_agent_cc_acct;
  return next;
end;
$$;

comment on function approve_conversion is
  'Agent approval. Claims the request with a conditional UPDATE before moving '
  'anything, so a double approval cannot pay twice.';

/**
 * The agent rejects. No balances change; the reason is recorded.
 *
 * Same conditional UPDATE, same guarantee: a rejection cannot follow an
 * approval, and two rejections cannot both take effect.
 */
create or replace function reject_conversion(
  p_request_id uuid,
  p_agent_id   uuid,
  p_reason     text default null
) returns uuid
language plpgsql security definer as $$
declare
  v_id uuid;
begin
  update conversion_requests
  set status = 'rejected', decided_at = now(), decided_by = p_agent_id,
      reason = nullif(trim(coalesce(p_reason, '')), '')
  where id = p_request_id and status = 'pending' and agent_id = p_agent_id
  returning id into v_id;

  if v_id is null then
    raise exception 'Request % is not pending for this agent', p_request_id
      using errcode = 'insufficient_privilege';
  end if;

  return v_id;
end;
$$;

/**
 * A player withdraws their own request.
 *
 * Only their own, only while pending. `cancelled` rather than `rejected` so the
 * agent's rejection rate is not polluted by requests nobody ever saw.
 */
create or replace function cancel_conversion(
  p_request_id uuid,
  p_player_id  uuid
) returns uuid
language plpgsql security definer as $$
declare
  v_id uuid;
begin
  update conversion_requests
  set status = 'cancelled', decided_at = now(), decided_by = p_player_id
  where id = p_request_id and status = 'pending' and player_id = p_player_id
  returning id into v_id;

  if v_id is null then
    raise exception 'Request % is not yours or is no longer pending', p_request_id
      using errcode = 'insufficient_privilege';
  end if;

  return v_id;
end;
$$;

/**
 * Agent -> operator. CC out, GC inventory in.
 *
 * No approval step: the operator publishes a rate and an agent with CC takes
 * it. The two transfers are the same pattern as a conversion — CC back to the
 * house account it was issued from, GC out of the house account coins are
 * issued from — and the whole thing is one transaction.
 *
 * This is the step that makes the chain close. An agent's CC is only worth
 * anything because it buys inventory, and inventory is the only thing an agent
 * can give a player.
 */
create or replace function agent_redeem_cc(
  p_agent_id        uuid,
  p_cc_amount       bigint,
  p_idempotency_key text default null
) returns table (
  redemption_id uuid,
  gc_amount bigint,
  gc_per_cc bigint,
  agent_gc bigint,
  agent_cc bigint
)
language plpgsql security definer as $$
declare
  v_status text;
  v_rate bigint;
  v_rate_id uuid;
  v_gc bigint;
  v_cc_acct uuid;
  v_gc_acct uuid;
  v_cc_txn uuid;
  v_gc_txn uuid;
  v_cc_before bigint;
  v_gc_before bigint;
  v_id uuid;
begin
  if p_cc_amount is null or p_cc_amount <= 0 then
    raise exception 'Redemption must be positive' using errcode = 'check_violation';
  end if;

  select status into v_status from agents where profile_id = p_agent_id;
  if not found then
    raise exception 'Unknown agent %', p_agent_id using errcode = 'no_data_found';
  end if;
  if v_status <> 'active' then
    raise exception 'Agent % is not active', p_agent_id using errcode = 'insufficient_privilege';
  end if;

  v_rate := current_rate('agent_operator', p_agent_id);
  if v_rate is null then
    raise exception 'No operator exchange rate is configured' using errcode = 'no_data_found';
  end if;
  select id into v_rate_id
  from exchange_rates
  where tier = 'agent_operator'
    and (agent_id is null or agent_id = p_agent_id)
    and effective_from <= now()
  order by (agent_id is not null) desc, effective_from desc, created_at desc
  limit 1;

  v_gc := p_cc_amount * v_rate;
  v_cc_acct := agent_account(p_agent_id, 'CC');
  v_gc_acct := agent_account(p_agent_id, 'GC');

  select coalesce(balance, 0) into v_cc_before from account_balance_cache where account_id = v_cc_acct;
  select coalesce(balance, 0) into v_gc_before from account_balance_cache where account_id = v_gc_acct;

  v_cc_txn := post_transfer(
    'conversion', v_cc_acct, system_account('house', 'CC'), p_cc_amount, 'CC',
    case when p_idempotency_key is null then null else 'agcc:cc:' || p_idempotency_key end,
    jsonb_build_object('agent_id', p_agent_id, 'gc_per_cc', v_rate,
                       'agent_cc_before', v_cc_before)
  );
  v_gc_txn := post_transfer(
    'conversion', system_account('house', 'GC'), v_gc_acct, v_gc, 'GC',
    case when p_idempotency_key is null then null else 'agcc:gc:' || p_idempotency_key end,
    jsonb_build_object('agent_id', p_agent_id, 'gc_per_cc', v_rate,
                       'agent_gc_before', v_gc_before)
  );

  insert into agent_cc_redemptions (
    agent_id, cc_amount, gc_amount, gc_per_cc, rate_id,
    cc_txn_id, gc_txn_id, agent_cc_before, agent_gc_before
  ) values (
    p_agent_id, p_cc_amount, v_gc, v_rate, v_rate_id,
    v_cc_txn, v_gc_txn, v_cc_before, v_gc_before
  ) returning id into v_id;

  redemption_id := v_id;
  gc_amount := v_gc;
  gc_per_cc := v_rate;
  select balance into agent_gc from account_balance_cache where account_id = v_gc_acct;
  select balance into agent_cc from account_balance_cache where account_id = v_cc_acct;
  return next;
end;
$$;

/**
 * An operator correcting something, in either currency.
 *
 * Deliberately separate from every other path and deliberately noisy: it writes
 * an `adjustment` transaction, an audit_log row, and requires a reason. An
 * adjustment that looked like an allocation would be a way to move coins
 * without anyone being able to tell later that a human did it by hand.
 *
 * Positive credits the account from the house; negative debits back to it.
 */
create or replace function admin_adjust_balance(
  p_owner_id    uuid,
  p_kind        text,
  p_currency    text,
  p_delta       bigint,
  p_operator_id uuid,
  p_reason      text
) returns bigint
language plpgsql security definer as $$
declare
  v_account uuid;
  v_house uuid;
begin
  if p_delta = 0 then
    raise exception 'Adjustment must be non-zero' using errcode = 'check_violation';
  end if;
  if nullif(trim(coalesce(p_reason, '')), '') is null then
    raise exception 'An adjustment needs a reason' using errcode = 'check_violation';
  end if;
  if p_kind not in ('player', 'agent') then
    raise exception 'Adjust a player or an agent, not %', p_kind
      using errcode = 'check_violation';
  end if;

  v_account := case p_kind
    when 'player' then player_account(p_owner_id, p_currency)
    else agent_account(p_owner_id, p_currency)
  end;
  v_house := system_account('house', p_currency);

  if p_delta > 0 then
    perform post_transfer('adjustment', v_house, v_account, p_delta, p_currency, null,
      jsonb_build_object('operator_id', p_operator_id, 'reason', p_reason,
                         'owner_id', p_owner_id, 'kind', p_kind));
  else
    perform post_transfer('adjustment', v_account, v_house, -p_delta, p_currency, null,
      jsonb_build_object('operator_id', p_operator_id, 'reason', p_reason,
                         'owner_id', p_owner_id, 'kind', p_kind));
  end if;

  insert into audit_log (operator_id, target, field, old_value, new_value)
  values (p_operator_id, p_kind || ':' || p_owner_id::text,
          'balance_adjusted_' || p_currency, p_reason, p_delta::text);

  return (select balance from account_balance_cache where account_id = v_account);
end;
$$;

/**
 * Set a rate. Insert, never update — see the trigger above.
 */
create or replace function set_exchange_rate(
  p_tier        text,
  p_gc_per_cc   bigint,
  p_operator_id uuid,
  p_agent_id    uuid default null,
  p_note        text default null
) returns uuid
language plpgsql security definer as $$
declare
  v_id uuid;
  v_old bigint;
begin
  if p_tier not in ('player_agent', 'agent_operator') then
    raise exception 'Unknown rate tier %', p_tier using errcode = 'check_violation';
  end if;
  if p_gc_per_cc is null or p_gc_per_cc <= 0 then
    raise exception 'A rate must be a positive number of GC per CC'
      using errcode = 'check_violation';
  end if;

  v_old := current_rate(p_tier, p_agent_id);

  insert into exchange_rates (tier, agent_id, gc_per_cc, set_by, note)
  values (p_tier, p_agent_id, p_gc_per_cc, p_operator_id, p_note)
  returning id into v_id;

  insert into audit_log (operator_id, target, field, old_value, new_value)
  values (p_operator_id,
          'exchange_rates:' || p_tier || coalesce(':' || p_agent_id::text, ''),
          'gc_per_cc', v_old::text, p_gc_per_cc::text);

  return v_id;
end;
$$;

-- ------------------------------------------------------- 6. row level security

alter table exchange_rates       enable row level security;
alter table conversion_requests  enable row level security;
alter table agent_cc_redemptions enable row level security;

/**
 * Rates are public to signed-in users.
 *
 * A player is being asked to accept a price; hiding the price would be
 * indefensible. There is nothing sensitive in the table — the operator tier is
 * the agents' own commercial terms, and agents can already infer it.
 */
drop policy if exists exchange_rates_readable on exchange_rates;
create policy exchange_rates_readable on exchange_rates
  for select using (auth.uid() is not null);

/** A player sees their own requests. */
drop policy if exists conversion_requests_self on conversion_requests;
create policy conversion_requests_self on conversion_requests
  for select using (auth.uid() = player_id);

/** An agent sees the requests addressed to them. */
drop policy if exists conversion_requests_agent on conversion_requests;
create policy conversion_requests_agent on conversion_requests
  for select using (auth.uid() = agent_id);

/** An agent sees their own redemptions. */
drop policy if exists agent_cc_redemptions_self on agent_cc_redemptions;
create policy agent_cc_redemptions_self on agent_cc_redemptions
  for select using (auth.uid() = agent_id);

/*
 * Note what is absent, as everywhere else in this schema: there is no INSERT,
 * UPDATE or DELETE policy on any of these tables. No client writes to them. The
 * functions above run as `security definer` and are the only way in.
 */

-- ------------------------------------------------------------ 7. guardrail

/**
 * WHAT CC IS NOT.
 *
 * CC is a closed-loop virtual currency. It is bought with GC and it buys GC,
 * and there is no third thing it touches. Specifically, and by absence:
 *
 *   - No CC account of kind `payment_float`, so CC cannot reach a payment
 *     processor.
 *   - No function converts CC to USD, and `admin_adjust_balance` refuses any
 *     kind that is not a player or an agent.
 *   - No player-to-player transfer of either currency exists. `post_transfer`
 *     would happily do one; nothing calls it that way, and the account lookups
 *     available to the API are keyed to the authenticated user.
 *   - No withdrawal path. `payment_intents` has a `withdrawal` direction from
 *     0001 and is USD-only; nothing in this file touches it.
 *
 * CC must never be displayed with a currency symbol. It is not dollars, it is
 * not redeemable for dollars, and the moment it is presented as though it were,
 * every claim this schema makes about being a social casino stops being true.
 */
comment on constraint accounts_currency_check on accounts is
  'GC and CC are virtual and closed-loop. USD exists only for store purchases '
  'and never for payouts.';
