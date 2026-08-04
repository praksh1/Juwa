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
