/**
 * Creating and updating auth accounts, through Supabase's admin API.
 *
 * ## Why this exists at all
 *
 * Agents recruit players in person, and many of those players have no email
 * address to sign up with. So an agent creates the account: they choose a
 * username, set a temporary password, and hand both over. That requires making
 * a real auth user on somebody else's behalf, which only the service-role
 * credential can do.
 *
 * ## The credential
 *
 * `SUPABASE_SERVICE_ROLE_KEY` bypasses every row-level security policy in the
 * project. It is the most dangerous value in the deployment — strictly more
 * powerful than the database password, because it also carries the auth API.
 *
 * It lives in the API service's environment and NOWHERE else. It must never be
 * in the app bundle, never in a repository, never in a chat message, and never
 * in a log line. Nothing in this file prints it, and nothing returns it.
 *
 * Without it configured, agent-created accounts return 503 and the invite-link
 * route still works. That degradation is deliberate: a missing key should
 * disable one feature, not the product.
 *
 * ## Synthetic email addresses
 *
 * Supabase identifies users by email, and these players have none. So the
 * account gets `<username>@<PLAYER_EMAIL_DOMAIN>` — a domain that must NOT be
 * one that can receive mail. A routable domain here would mean password-reset
 * links for real player accounts being delivered to whoever owns that mailbox.
 *
 * The consequence, which is worth stating because it is permanent: a player
 * created this way cannot reset their own password by email, because there is
 * no mailbox. Recovery is an operator action. That is the cost of accounts
 * without email addresses, and it is not fixable in code.
 */

const DEFAULT_PLAYER_EMAIL_DOMAIN = 'players.juwa.invalid';

export class SupabaseAdminError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'SupabaseAdminError';
  }
}

export interface SupabaseAdminConfig {
  url: string;
  serviceRoleKey: string;
  /** Where synthetic addresses live. Must not be able to receive mail. */
  playerEmailDomain: string;
}

/**
 * Read the configuration, or decide the feature is off.
 *
 * Returns undefined rather than throwing when the key is absent — an API that
 * refused to boot without an optional credential would turn "we have not set
 * this up yet" into an outage.
 */
export function supabaseAdminFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): SupabaseAdminConfig | { missing: string[]; nearMisses?: string[] } {
  const url = env['SUPABASE_URL']?.trim().replace(/\/+$/, '');
  const serviceRoleKey = env['SUPABASE_SERVICE_ROLE_KEY']?.trim();

  /*
   * Which one is missing, not just that something is.
   *
   * This needs BOTH variables — the key to authenticate and the URL to know
   * which project to authenticate against — and a project can easily have the
   * URL unset, because token verification also accepts the legacy
   * SUPABASE_JWT_SECRET instead. The first version of this logged "set
   * SUPABASE_SERVICE_ROLE_KEY to enable" whatever was absent, which is the
   * worst possible message for somebody who has just set exactly that and is
   * looking at the log to find out why nothing changed.
   */
  const missing: string[] = [];
  if (!url) missing.push('SUPABASE_URL');
  if (!serviceRoleKey) missing.push('SUPABASE_SERVICE_ROLE_KEY');
  if (missing.length > 0) {
    return { missing, ...(nearMisses(env, missing).length ? { nearMisses: nearMisses(env, missing) } : {}) };
  }

  return {
    url: url!,
    serviceRoleKey: serviceRoleKey!,
    playerEmailDomain: (
      env['PLAYER_EMAIL_DOMAIN']?.trim() || DEFAULT_PLAYER_EMAIL_DOMAIN
    ).replace(/^@/, ''),
  };
}

/**
 * Variables that look like somebody meant one of ours and mistyped it.
 *
 * The failure this catches is invisible from the outside: you set the variable,
 * you redeploy, and the log still says it is missing — because the name is
 * `SUPABASE_SERVICE_ROLE` or `SUPABASE_SERVICE_KEY` or has a stray space, and
 * nothing in the platform will ever tell you that a variable nobody reads is
 * not being read. Naming the near miss turns a half-hour of staring into one
 * line of log.
 *
 * NAMES ONLY, never values. A log line is the last place a service-role key
 * should appear, and printing "you set X" is exactly as useful as printing what
 * X contains.
 */
function nearMisses(env: NodeJS.ProcessEnv, missing: string[]): string[] {
  /*
   * Every SUPABASE_* name this deployment legitimately reads.
   *
   * The rule is "anything else beginning SUPABASE_ is probably a typo", which
   * catches mistakes nobody has thought of yet — SUPABASE_SERVICE_KEY,
   * SUPABASE_SERVICEROLE_KEY, SUPABASE_SECRET. Matching on how similar two
   * strings look would have caught only the ones I could imagine; matching on
   * "not one of ours" catches the rest.
   */
  const known = new Set([
    'SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY',
    'SUPABASE_JWT_SECRET',
    'SUPABASE_ANON_KEY',
    'EXPO_PUBLIC_SUPABASE_URL',
    'EXPO_PUBLIC_SUPABASE_ANON_KEY',
  ]);

  const found: string[] = [];
  for (const [name, value] of Object.entries(env)) {
    const upper = name.toUpperCase();
    if (!upper.includes('SUPABASE')) continue;

    // Set to whitespace is as absent as unset, and much harder to spot — the
    // platform shows the variable, so it looks done.
    if (missing.includes(name) && !value?.trim()) {
      found.push(`${name} (set, but empty)`);
      continue;
    }
    if (!known.has(upper)) found.push(name);
  }
  return found;
}

/** Narrow the result of `supabaseAdminFromEnv`. */
export function isConfigured(
  result: SupabaseAdminConfig | { missing: string[]; nearMisses?: string[] },
): result is SupabaseAdminConfig {
  return !('missing' in result);
}

/** The address an agent-created player signs in with. */
export function syntheticEmail(username: string, domain: string): string {
  return `${username.trim().toLowerCase()}@${domain}`;
}

export interface CreatedAuthUser {
  id: string;
  email: string;
}

export class SupabaseAdmin {
  constructor(private readonly config: SupabaseAdminConfig) {}

  get emailDomain(): string {
    return this.config.playerEmailDomain;
  }

  private async request<T>(path: string, init: RequestInit): Promise<T> {
    const response = await fetch(`${this.config.url}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        // Both headers are required by GoTrue: apikey identifies the project,
        // Authorization carries the privilege.
        apikey: this.config.serviceRoleKey,
        Authorization: `Bearer ${this.config.serviceRoleKey}`,
        ...(init.headers ?? {}),
      },
      // A hung auth call would hold a player-facing request open. Fail fast.
      signal: AbortSignal.timeout(15_000),
    });

    const text = await response.text();
    if (!response.ok) {
      /*
       * Supabase's message is surfaced, the credential never is. `msg` is
       * GoTrue's field; `message` and `error_description` cover the shapes it
       * has used across versions.
       */
      let detail = `Supabase returned ${response.status}`;
      try {
        const body = JSON.parse(text) as Record<string, string>;
        detail = body['msg'] ?? body['message'] ?? body['error_description'] ?? detail;
      } catch {
        /* not JSON — keep the status line */
      }
      throw new SupabaseAdminError(detail, response.status);
    }
    return (text ? JSON.parse(text) : {}) as T;
  }

  /**
   * Create an auth account for a player who is not present to make their own.
   *
   * `email_confirm: true` because there is no mailbox to confirm from. The
   * account is usable immediately, which is the point — the agent is standing
   * in front of the player.
   */
  async createPlayer(username: string, password: string): Promise<CreatedAuthUser> {
    const email = syntheticEmail(username, this.config.playerEmailDomain);
    const created = await this.request<{ id?: string; email?: string }>('/auth/v1/admin/users', {
      method: 'POST',
      body: JSON.stringify({
        email,
        password,
        email_confirm: true,
        // Visible in the Supabase dashboard, so an account made this way is
        // identifiable there and not only in our own tables.
        user_metadata: { created_by: 'agent', username },
      }),
    });
    if (!created.id) {
      throw new SupabaseAdminError('Supabase did not return a user id', 502);
    }
    return { id: created.id, email: created.email ?? email };
  }

  /**
   * Set a new password on an existing account.
   *
   * Used when a player has forgotten theirs. They have no email address — the
   * account was made by an agent with a synthetic one — so there is no reset
   * link to send and never can be: recovery has to be somebody with authority
   * doing it on their behalf.
   *
   * The caller is responsible for re-raising `must_set_password`, so the
   * temporary password the agent chooses is replaced the moment the player
   * signs in with it. Without that step this would hand the agent a permanent
   * credential, which is the one thing the whole design is arranged to avoid.
   */
  async setPassword(userId: string, password: string): Promise<void> {
    await this.request(`/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
      method: 'PUT',
      body: JSON.stringify({ password }),
    });
  }

  /**
   * Remove an auth account.
   *
   * Used only to clean up after a failed creation: if Supabase makes the user
   * and our own registration then fails, leaving the orphan behind would burn
   * the username forever with nothing to show for it.
   */
  async deletePlayer(userId: string): Promise<void> {
    await this.request(`/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
      method: 'DELETE',
    });
  }
}
