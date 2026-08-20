/**
 * Operator authentication and the panel's data.
 *
 * Operators are not players with a flag. They live in their own table, hold
 * their own sessions, and never present a Supabase token — a privilege bit on a
 * player row is one mistaken UPDATE away from handing the payout configuration
 * to whoever asks for it.
 *
 * WHAT THE PANEL CAN AND CANNOT CHANGE
 *
 * It can disable a game, cap a single round's payout, and move bet limits. It
 * CANNOT set return to player, and there is deliberately no field for it. RTP
 * here emerges from reel strips and a paytable, it is measured by simulation,
 * and it is published so a player can check it. A web form that appeared to
 * move it would either be a lie or the single most damaging feature in the
 * product. What the panel does instead is show the measured figure beside the
 * observed one, which is how you find out that the deployed code is not the
 * code that was measured.
 */

import { randomBytes, randomUUID, scrypt as scryptCb, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
import { verifyTotp } from './totp.js';

const scrypt = promisify(scryptCb) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
) => Promise<Buffer>;

/** Cost parameters are recorded in the stored string so they can be raised later. */
const SCRYPT_KEYLEN = 64;
const SESSION_HOURS = 8;

export class AdminAuthError extends Error {
  constructor(message = 'Invalid credentials') {
    super(message);
    this.name = 'AdminAuthError';
  }
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, SCRYPT_KEYLEN);
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, saltB64, keyB64] = stored.split('$');
  if (scheme !== 'scrypt' || !saltB64 || !keyB64) return false;

  const expected = Buffer.from(keyB64, 'base64');
  const actual = await scrypt(password, Buffer.from(saltB64, 'base64'), expected.length);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/**
 * Sessions are stored as a hash of the token.
 *
 * The bearer token exists only in the operator's browser, so a stolen database
 * dump yields nothing that can be presented. Same reasoning as the password
 * hash, applied to the credential that actually travels on every request.
 */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export interface OperatorIdentity {
  operatorId: string;
  email: string;
  role: string;
}

export interface AdminDb {
  query<T>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

/**
 * Sign in.
 *
 * Password and code are checked TOGETHER and a single generic failure is
 * returned. Saying "wrong code" confirms the password was right, which turns a
 * credential-stuffing run into a working password oracle.
 *
 * The dummy hash on the unknown-email path keeps the timing roughly constant.
 * Without it, a missing account returns in microseconds and a real one takes as
 * long as scrypt does, which is a trivially measurable way to enumerate staff.
 */
const DUMMY_HASH =
  'scrypt$AAAAAAAAAAAAAAAAAAAAAA==$' + Buffer.alloc(SCRYPT_KEYLEN).toString('base64');

export async function operatorLogin(
  db: AdminDb,
  email: string,
  password: string,
  code: string,
  now: Date = new Date(),
): Promise<{ token: string; expiresAt: string; operator: OperatorIdentity }> {
  const { rows } = await db.query<{
    id: string;
    email: string;
    role: string;
    password_hash: string;
    totp_secret: Buffer;
    disabled_at: string | null;
  }>(
    `select id, email, role, password_hash, totp_secret, disabled_at
       from operators where lower(email) = lower($1)`,
    [email],
  );

  const operator = rows[0];
  if (!operator || operator.disabled_at) {
    await verifyPassword(password, DUMMY_HASH);
    throw new AdminAuthError();
  }

  const passwordOk = await verifyPassword(password, operator.password_hash);
  const codeOk = verifyTotp(
    Buffer.from(operator.totp_secret),
    code,
    Math.floor(now.getTime() / 1000),
  );
  if (!passwordOk || !codeOk) throw new AdminAuthError();

  const token = randomUUID() + randomBytes(24).toString('hex');
  const expiresAt = new Date(now.getTime() + SESSION_HOURS * 3600_000);

  await db.query(
    `insert into operator_sessions (token_hash, operator_id, expires_at) values ($1, $2, $3)`,
    [hashToken(token), operator.id, expiresAt.toISOString()],
  );
  await db.query(`update operators set last_login_at = now() where id = $1`, [operator.id]);

  return {
    token,
    expiresAt: expiresAt.toISOString(),
    operator: { operatorId: operator.id, email: operator.email, role: operator.role },
  };
}

export async function operatorForToken(
  db: AdminDb,
  token: string | undefined,
): Promise<OperatorIdentity> {
  if (!token) throw new AdminAuthError('Not signed in');
  const { rows } = await db.query<{ operator_id: string; email: string; role: string }>(
    `select * from operator_for_session($1)`,
    [hashToken(token)],
  );
  const row = rows[0];
  if (!row) throw new AdminAuthError('Session expired');
  return { operatorId: row.operator_id, email: row.email, role: row.role };
}

export async function operatorLogout(db: AdminDb, token: string): Promise<void> {
  await db.query(
    `update operator_sessions set revoked_at = now() where token_hash = $1 and revoked_at is null`,
    [hashToken(token)],
  );
}

// ------------------------------------------------------------------ the data

export interface GameRow {
  id: string;
  name: string;
  /** Measured by simulation, published in the paytable. Not editable. */
  measuredRtp: number;
  enabled: boolean;
  maxWinMultiplier: number | null;
  minBet: number;
  maxBet: number;
  rounds: number;
  coinsWagered: number;
  coinsPaid: number;
  observedRtp: number | null;
  hitRate: number | null;
}

export interface EngineSummary {
  id: string;
  name: string;
  rtp: number;
  limits: { min: number; max: number };
}

export async function listGameAdmin(
  db: AdminDb,
  engines: EngineSummary[],
): Promise<GameRow[]> {
  const [configs, stats] = await Promise.all([
    db.query<{
      game_id: string;
      enabled: boolean;
      max_win_multiplier: string | null;
      min_bet: string | null;
      max_bet: string | null;
    }>(`select * from game_configs`),
    db.query<{
      game_id: string;
      rounds: string;
      coins_wagered: string;
      coins_paid: string;
      observed_rtp: string | null;
      hit_rate: string | null;
    }>(`select * from observed_game_stats()`),
  ]);

  const byId = new Map(configs.rows.map((c) => [c.game_id, c]));
  const statsById = new Map(stats.rows.map((s) => [s.game_id, s]));

  return engines.map((engine) => {
    // Absent config means engine defaults, not "disabled". A game that vanished
    // because nobody had configured it yet would be a spectacular own goal.
    const config = byId.get(engine.id);
    const observed = statsById.get(engine.id);
    return {
      id: engine.id,
      name: engine.name,
      measuredRtp: engine.rtp,
      enabled: config?.enabled ?? true,
      maxWinMultiplier: config?.max_win_multiplier == null ? null : Number(config.max_win_multiplier),
      minBet: config?.min_bet == null ? engine.limits.min : Number(config.min_bet),
      maxBet: config?.max_bet == null ? engine.limits.max : Number(config.max_bet),
      rounds: observed ? Number(observed.rounds) : 0,
      coinsWagered: observed ? Number(observed.coins_wagered) : 0,
      coinsPaid: observed ? Number(observed.coins_paid) : 0,
      observedRtp: observed?.observed_rtp == null ? null : Number(observed.observed_rtp),
      hitRate: observed?.hit_rate == null ? null : Number(observed.hit_rate),
    };
  });
}

export interface GamePatch {
  enabled?: boolean;
  maxWinMultiplier?: number | null;
  minBet?: number | null;
  maxBet?: number | null;
}

export interface GlobalControls {
  maxSingleBetPayout: number | null;
  vaultInactiveDays: number;
  vaultWarningDays: number;
}

export async function getGlobalControls(db: AdminDb): Promise<GlobalControls> {
  const { rows } = await db.query<{
    max_single_bet_payout: string | null;
    vault_inactive_days: number;
    vault_warning_days: number;
  }>(
    `select max_single_bet_payout, vault_inactive_days, vault_warning_days
       from global_settings where id = true`,
  );
  const row = rows[0];
  if (!row) throw new Error('Global settings are missing');
  return {
    maxSingleBetPayout: row.max_single_bet_payout == null
      ? null
      : Number(row.max_single_bet_payout),
    vaultInactiveDays: Number(row.vault_inactive_days),
    vaultWarningDays: Number(row.vault_warning_days),
  };
}

function optionalWhole(value: unknown, name: string): number | null {
  if (value === null || value === '') return null;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive whole number`);
  }
  return parsed;
}

/** Update the global hard payout ceiling and dormant-vault timing, attributed. */
export async function updateGlobalControls(
  db: AdminDb,
  operator: OperatorIdentity,
  patch: Record<string, unknown>,
): Promise<void> {
  const maxPayout = optionalWhole(patch['maxSingleBetPayout'], 'Maximum payout');
  const inactiveDays = optionalWhole(patch['vaultInactiveDays'], 'Inactive days');
  const warningDays = optionalWhole(patch['vaultWarningDays'], 'Warning days');
  if (inactiveDays == null || inactiveDays > 3650) {
    throw new Error('Inactive days must be between 1 and 3650');
  }
  if (warningDays == null || warningDays > 365) {
    throw new Error('Warning days must be between 1 and 365');
  }
  await db.query(
    `update global_settings set max_single_bet_payout = $1,
       vault_inactive_days = $2, vault_warning_days = $3,
       updated_at = now(), updated_by = $4 where id = true`,
    [maxPayout, inactiveDays, warningDays, operator.operatorId],
  );
}

/**
 * Apply a change, attributed.
 *
 * ONE statement, deliberately.
 *
 * This used to be `begin`, `set_config(..., is_local)`, the insert, `commit` —
 * four calls through `db.query`, which runs against a connection POOL. Four
 * pool queries can be four different connections, so the transaction-local
 * setting the audit trigger reads was frequently set on a connection that never
 * ran the insert, and the `begin` could strand a pooled connection sitting idle
 * inside an open transaction. The attribution came out blank and the pool
 * slowly lost connections.
 *
 * The row already carries `updated_by`, and as of migration 0010 the trigger
 * falls back to it. So the correct write is a single statement with no
 * transaction to lose.
 */
export async function updateGameConfig(
  db: AdminDb,
  operator: OperatorIdentity,
  gameId: string,
  patch: GamePatch,
): Promise<void> {
  if (patch.minBet != null && patch.maxBet != null && patch.maxBet < patch.minBet) {
    throw new Error('Maximum bet must be at least the minimum');
  }

  await db.query(
    `insert into game_configs (game_id, enabled, max_win_multiplier, min_bet, max_bet, updated_by)
     values ($1, coalesce($2, true), $3, $4, $5, $6)
     on conflict (game_id) do update set
       enabled            = coalesce($2, game_configs.enabled),
       max_win_multiplier = case when $7 then $3 else game_configs.max_win_multiplier end,
       min_bet            = case when $8 then $4 else game_configs.min_bet end,
       max_bet            = case when $9 then $5 else game_configs.max_bet end,
       updated_at         = now(),
       updated_by         = $6`,
    [
      gameId,
      patch.enabled ?? null,
      patch.maxWinMultiplier ?? null,
      patch.minBet ?? null,
      patch.maxBet ?? null,
      operator.operatorId,
      'maxWinMultiplier' in patch,
      'minBet' in patch,
      'maxBet' in patch,
    ],
  );
}

export async function listAudit(db: AdminDb, limit = 100): Promise<unknown[]> {
  const { rows } = await db.query(
    `select a.id, a.target, a.field, a.old_value, a.new_value, a.at,
            coalesce(o.email, 'unattributed') as operator
       from audit_log a
       left join operators o on o.id = a.operator_id
      order by a.id desc
      limit $1`,
    [Math.min(500, Math.max(1, limit))],
  );
  return rows;
}
