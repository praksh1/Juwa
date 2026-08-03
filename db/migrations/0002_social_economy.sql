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
