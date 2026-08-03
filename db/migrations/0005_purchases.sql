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
