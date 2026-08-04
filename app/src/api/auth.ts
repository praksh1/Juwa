/**
 * Authentication.
 *
 * Supabase Auth owns identity: sign-up, password hashing, email confirmation,
 * session refresh. We never see a password. It hands us a JWT, we put it in the
 * Authorization header, and the API verifies the signature.
 *
 * The alternative — rolling our own — means owning password storage and reset
 * flows, which is a large amount of security-critical code to get wrong in
 * exchange for nothing.
 *
 * A demo mode exists so `npx expo start` works immediately after a clone with
 * no Supabase project configured. It authenticates nobody and is refused by the
 * real API, which cannot verify its fake token.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

// Trimmed and de-slashed for the same reason the API base URL is: these values
// are copied out of a dashboard, and a trailing slash or a stray space survives
// into the built bundle where nothing ever looks at it again.
const SUPABASE_URL = (process.env['EXPO_PUBLIC_SUPABASE_URL'] ?? '').trim().replace(/\/+$/, '');
const SUPABASE_ANON_KEY = (process.env['EXPO_PUBLIC_SUPABASE_ANON_KEY'] ?? '').trim();

export const IS_CONFIGURED = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

/**
 * The anon key is public by design — it identifies the project, it does not
 * grant access. Row Level Security is what actually protects the data, which is
 * why every policy in the schema is select-only and scoped to auth.uid().
 */
export const supabase: SupabaseClient | null = IS_CONFIGURED
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        // Web-only, so the browser's own storage is the right place. Supabase
        // refreshes the token in the background before it expires.
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null;

export interface Session {
  userId: string;
  email: string | null;
  accessToken: string;
}

export interface AuthResult {
  ok: boolean;
  message?: string;
  needsEmailConfirmation?: boolean;
}

/** Turn Supabase's error text into something a player can act on. */
function friendly(message: string): string {
  if (/invalid login credentials/i.test(message)) return 'That email or password is not right.';
  if (/already registered/i.test(message)) return 'That email already has an account. Try logging in.';
  if (/password should be at least/i.test(message)) return 'Passwords must be at least 6 characters.';
  if (/rate limit|too many/i.test(message)) return 'Too many attempts. Wait a minute and try again.';

  // "Failed to fetch" is what a browser says when the request never reached
  // anywhere — bad host, DNS failure, offline, or a paused project. It is the
  // exact string fetch throws, and shown raw it tells a player nothing and an
  // operator almost nothing.
  //
  // The detail goes to the console, not the screen. Naming the host or the
  // environment variable on a sign-up form leaks deployment shape to everyone
  // who visits, which has already happened twice in this codebase.
  if (/failed to fetch|networkerror|load failed|network request failed/i.test(message)) {
    console.error(
      `Sign-in service unreachable at ${SUPABASE_URL || '(not configured)'}. ` +
        'Check that the project is running and that EXPO_PUBLIC_SUPABASE_URL is correct. ' +
        'A free Supabase project pauses after a week of inactivity.',
    );
    return 'Cannot reach the sign-in service right now. Please try again in a moment.';
  }

  return message;
}

export async function signUp(email: string, password: string): Promise<AuthResult> {
  if (!supabase) return demoSignIn(email);
  // supabase-js usually converts a network failure into `error`, but not
  // always — a DNS failure can reject instead, and an uncaught rejection here
  // leaves the button spinning with nothing on screen at all.
  try {
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) return { ok: false, message: friendly(error.message) };
    // With email confirmation on, there is no session until the link is clicked.
    return { ok: true, needsEmailConfirmation: !data.session };
  } catch (error) {
    return { ok: false, message: friendly((error as Error).message) };
  }
}

export async function signIn(email: string, password: string): Promise<AuthResult> {
  if (!supabase) return demoSignIn(email);
  try {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return { ok: false, message: friendly(error.message) };
    return { ok: true };
  } catch (error) {
    return { ok: false, message: friendly((error as Error).message) };
  }
}

export async function signOut(): Promise<void> {
  if (!supabase) {
    demoSession = null;
    saveDemoSession(null);
    notify();
    return;
  }
  await supabase.auth.signOut();
}

export async function getSession(): Promise<Session | null> {
  if (!supabase) {
    if (!demoSession) demoSession = loadDemoSession();
    // Keep the token fresh if it was injected after sign-in.
    const injected = devToken();
    if (demoSession && injected) demoSession = { ...demoSession, accessToken: injected };
    return demoSession;
  }
  const { data } = await supabase.auth.getSession();
  if (!data.session) return null;
  return {
    userId: data.session.user.id,
    email: data.session.user.email ?? null,
    accessToken: data.session.access_token,
  };
}

/**
 * The current access token, for the Authorization header.
 *
 * Read fresh on every request rather than cached: Supabase rotates it roughly
 * hourly, and a cached token becomes a mystery 401 an hour into a session.
 */
export async function getAccessToken(): Promise<string | null> {
  return (await getSession())?.accessToken ?? null;
}

type Listener = (session: Session | null) => void;
const listeners = new Set<Listener>();

function notify() {
  void getSession().then((session) => {
    for (const listener of listeners) listener(session);
  });
}

export function onAuthChange(listener: Listener): () => void {
  listeners.add(listener);

  if (supabase) {
    const { data } = supabase.auth.onAuthStateChange(() => notify());
    // Supabase emits INITIAL_SESSION on subscribe, but emitting once ourselves
    // costs nothing and removes the dependency on that behaviour.
    notify();
    return () => {
      listeners.delete(listener);
      data.subscription.unsubscribe();
    };
  }

  // Demo mode has nothing to subscribe to, so without this the subscriber
  // never hears anything and the app sits on its loading spinner forever —
  // which is exactly what a fresh clone with no Supabase project does.
  notify();
  return () => listeners.delete(listener);
}

// --------------------------------------------------------------- demo mode

const DEMO_SESSION_KEY = 'juwa.demo-session';

/**
 * Demo sessions persist in localStorage, exactly as Supabase's do.
 *
 * Not cosmetic: any flow that leaves the site and comes back — a payment
 * redirect being the obvious one — reloads the page. An in-memory session
 * evaporates there, so the player returns to a sign-up screen instead of their
 * confirmation, and the bug looks like the payment failed.
 */
function loadDemoSession(): Session | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(DEMO_SESSION_KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

function saveDemoSession(session: Session | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (session) window.localStorage.setItem(DEMO_SESSION_KEY, JSON.stringify(session));
    else window.localStorage.removeItem(DEMO_SESSION_KEY);
  } catch {
    /* private mode — the session simply does not survive a reload */
  }
}

let demoSession: Session | null = loadDemoSession();

/**
 * A local-development escape hatch: run the app against a real API without
 * standing up a Supabase project, by putting a valid token in
 * `localStorage['juwa.dev-token']`.
 *
 * This grants nothing. It only changes which token the client sends, and the
 * server still verifies the signature against its own secret — you cannot use
 * this unless you already hold a token the server would have accepted anyway.
 * It is also ignored entirely once Supabase is configured, so it cannot be
 * reached in production.
 */
const DEV_TOKEN_KEY = 'juwa.dev-token';

function devToken(): string | null {
  if (IS_CONFIGURED || typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(DEV_TOKEN_KEY);
  } catch {
    return null;
  }
}

function demoSignIn(email: string): AuthResult {
  const injected = devToken();
  demoSession = {
    userId: '00000000-0000-4000-8000-000000000001',
    email,
    // Without an injected token this is deliberately not a real JWT: the API
    // rejects it, so demo mode can never look like it authenticated anyone.
    accessToken: injected ?? 'demo-mode-not-a-real-token',
  };
  saveDemoSession(demoSession);
  notify();
  return { ok: true };
}
