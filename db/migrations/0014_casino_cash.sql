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
