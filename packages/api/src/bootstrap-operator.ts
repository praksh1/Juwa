/**
 * Create the FIRST operator from environment variables, once, at boot.
 *
 * ## Why this exists
 *
 * `create-operator.js` is the right tool and remains the right tool — but it
 * needs a shell on the server, and the platforms this deploys to (Railway,
 * Render, Fly) do not all give you one without installing a CLI and holding a
 * copy of the repository. The result was an operator console that could not be
 * signed into, an agent system that could not be turned on, and a product its
 * own owner could not administer. A feature nobody can reach is not shipped.
 *
 * Setting an environment variable is something every one of those platforms
 * puts in a text box on a web page, and it is where the database URL already
 * lives.
 *
 * ## The three properties that make this safe
 *
 * 1. **It runs only when the `operators` table is EMPTY.** Once one account
 *    exists this does nothing, forever, no matter what the variables say. It
 *    cannot be used to add a second back-door account later, and it cannot
 *    overwrite or re-enable an operator you disabled.
 *
 * 2. **The password is chosen by the person setting it, never generated and
 *    never logged.** They typed it into the variable; printing it back would
 *    put an admin credential into a deploy log that outlives the deploy.
 *
 * 3. **It fails loudly and starts anyway.** A bootstrap that could take the API
 *    down would trade "the owner cannot sign in" for "no player can play",
 *    which is a much worse failure.
 *
 * ## The one thing that IS printed
 *
 * The `otpauth://` URI, because a second factor cannot be set up without being
 * shown once. That line is a credential: it belongs in an authenticator app,
 * and nowhere else. Remove the variables and the console is back to being the
 * only way in.
 */

import { randomBytes } from 'node:crypto';
import { hashPassword } from './admin.js';
import { totpUri } from './totp.js';

interface BootstrapClient {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

/**
 * Short passwords are refused rather than accepted with a warning.
 *
 * This account can disable every game in the catalogue and mint coin inventory
 * for agents. Two-factor is required on top, but a weak first factor turns the
 * authenticator into the only thing standing between an attacker and the
 * payout configuration.
 */
const MIN_PASSWORD_LENGTH = 12;

export async function bootstrapOperator(
  db: BootstrapClient,
  env: NodeJS.ProcessEnv = process.env,
  log: (message: string) => void = console.log,
): Promise<'created' | 'skipped' | 'failed'> {
  const email = env['BOOTSTRAP_OPERATOR_EMAIL']?.trim();
  const password = env['BOOTSTRAP_OPERATOR_PASSWORD'];

  if (!email && !password) return 'skipped';

  if (!email || !password) {
    log(
      '\n⚠️  BOOTSTRAP_OPERATOR_EMAIL and BOOTSTRAP_OPERATOR_PASSWORD must be set together.\n' +
        '    No operator was created.\n',
    );
    return 'failed';
  }

  if (!email.includes('@')) {
    log(`\n⚠️  BOOTSTRAP_OPERATOR_EMAIL is not an email address. No operator was created.\n`);
    return 'failed';
  }

  if (password.length < MIN_PASSWORD_LENGTH) {
    log(
      `\n⚠️  BOOTSTRAP_OPERATOR_PASSWORD must be at least ${MIN_PASSWORD_LENGTH} characters.\n` +
        '    No operator was created. This account can change payout limits —\n' +
        '    use a long passphrase from a password manager.\n',
    );
    return 'failed';
  }

  try {
    /*
     * The emptiness check and the insert are ONE statement.
     *
     * Two statements — count, then insert — is a race that two instances
     * starting at the same moment would both win, and the platforms this runs
     * on start two instances during every rolling deploy. `where not exists`
     * evaluates against the same snapshot as the insert, and the unique index
     * on email catches whatever is left.
     */
    const { rows } = await db.query<{ id: string }>(
      `insert into operators (email, password_hash, totp_secret, role)
       select $1, $2, $3, 'admin'
        where not exists (select 1 from operators)
       returning id`,
      [email, await hashPassword(password), randomBytes(20)],
    );

    if (rows.length === 0) {
      // Already set up. Silent on purpose: this is the state every restart
      // after the first one is in, and a warning on every boot is a warning
      // nobody reads.
      return 'skipped';
    }

    // Read the secret back rather than keeping the generated buffer, so what
    // goes into the authenticator is provably what went into the database.
    const stored = await db.query<{ totp_secret: Buffer }>(
      `select totp_secret from operators where lower(email) = lower($1)`,
      [email],
    );
    const secret = Buffer.from(stored.rows[0]!.totp_secret);

    log(
      [
        '',
        '════════════════════════════════════════════════════════════════',
        '  FIRST OPERATOR CREATED',
        '',
        `  Sign in at:  <this service's URL>/admin`,
        `  Email:       ${email}`,
        '  Password:    the one you put in BOOTSTRAP_OPERATOR_PASSWORD',
        '',
        '  Add this to your authenticator app (1Password, Authy, Google',
        '  Authenticator). It is shown ONCE and is never printed again:',
        '',
        `  ${totpUri('Juwa 3.0', email, secret)}`,
        '',
        '  THEN DELETE BOTH BOOTSTRAP_OPERATOR_* VARIABLES.',
        '  The line above is a credential and this log is not a safe place',
        '  for it to live.',
        '════════════════════════════════════════════════════════════════',
        '',
      ].join('\n'),
    );
    return 'created';
  } catch (error) {
    // Never fatal. An API that refuses to start because an optional
    // convenience failed is an outage caused by a setup step.
    log(`\n⚠️  Could not create the first operator: ${(error as Error).message}\n`);
    return 'failed';
  }
}
