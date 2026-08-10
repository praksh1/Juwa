/**
 * The agent invitation, from link to registered player.
 *
 * An agent hands out `https://juwa.app/?invite=<token>`. What happens next is
 * not one page load: the visitor lands, creates a Supabase account, verifies an
 * email, comes back on a fresh navigation, and only THEN reaches the screen
 * that can redeem the token. The query string is long gone by that point.
 *
 * So the token is captured the instant the app boots and put in session
 * storage, where it survives the round trip but not the browser being closed.
 *
 * ## Why session storage and not local
 *
 * A token in `localStorage` outlives the sign-up it was for. Someone opens an
 * agent's link, changes their mind, and signs up a fortnight later on the same
 * device — and silently becomes that agent's player. `sessionStorage` ends with
 * the tab, which is the same lifetime as the intention.
 */

const KEY = 'juwa.invite';

/** Guarded because the app also runs on native, where there is no window. */
function storage(): Storage | null {
  try {
    return typeof window !== 'undefined' && window.sessionStorage ? window.sessionStorage : null;
  } catch {
    // Safari in private mode throws on access rather than returning null.
    return null;
  }
}

/**
 * Read `?invite=` out of the URL, remember it, and take it out of the address
 * bar.
 *
 * The token is removed from the visible URL for the same reason a password
 * reset link is: it is a credential, and a credential sitting in an address bar
 * gets screenshotted, pasted into a support chat, and captured by every
 * analytics tool on the page.
 */
export function captureInviteFromUrl(): void {
  if (typeof window === 'undefined' || !window.location) return;
  const params = new URLSearchParams(window.location.search);
  const token = params.get('invite');
  if (!token) return;

  storage()?.setItem(KEY, token);

  params.delete('invite');
  const query = params.toString();
  const clean = `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`;
  window.history.replaceState(null, '', clean);
}

export function pendingInvite(): string | null {
  return storage()?.getItem(KEY) ?? null;
}

export function clearInvite(): void {
  storage()?.removeItem(KEY);
}

/**
 * Who does this link belong to?
 *
 * Deliberately NOT a method on `PlayApi`: it is answered before the visitor has
 * an account, so there is no session to authenticate with and no client to hang
 * it off. It returns a display name and nothing else — an invalid link and an
 * unknown one give the identical answer, so the endpoint cannot be used to
 * probe for live tokens.
 *
 * Returns null on any failure, including the network being down. The
 * consequence of a false null is a sign-up screen that does not say who invited
 * you, which is cosmetic; the token is still redeemed at registration, and the
 * server is the one that decides whether it is good.
 */
export async function lookupInvite(baseUrl: string, token: string): Promise<string | null> {
  if (!baseUrl) return null;
  try {
    const response = await fetch(`${baseUrl}/invite?token=${encodeURIComponent(token)}`, {
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { valid?: boolean; agentName?: string | null };
    return body.valid && body.agentName ? body.agentName : null;
  } catch {
    return null;
  }
}
