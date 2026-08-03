/**
 * Progressive Web App plumbing.
 *
 * Juwa ships as a website, not a store app. That decision removes Apple's and
 * Google's 15–30% cut entirely — a $9.99 pack nets $9.40 through Stripe against
 * $6.99 through in-app purchase — and removes store review from the release
 * cycle.
 *
 * What it costs is discovery and, specifically on iOS, push notifications:
 * Safari only delivers web push to sites the user has added to their home
 * screen. Since "your daily bonus is ready" is the main lever behind the streak
 * ladder, getting players to install is worth real effort, which is what
 * `useInstallPrompt` is for.
 */

import { Platform } from 'react-native';

export function isWeb(): boolean {
  return Platform.OS === 'web' && typeof window !== 'undefined';
}

export function registerServiceWorker(): void {
  if (!isWeb() || !('serviceWorker' in navigator)) return;

  const register = () => {
    navigator.serviceWorker.register('/sw.js').catch((error) => {
      // A failed registration costs offline support, nothing else. Never let
      // it take the app down.
      console.warn('Service worker registration failed:', error);
    });
  };

  // Deferred until load so it never competes with the first paint — but by the
  // time React has mounted and called this, `load` has usually already fired,
  // and a listener added afterwards never runs. Checking readyState first is
  // the difference between a registered worker and a silently absent one.
  if (document.readyState === 'complete') {
    register();
  } else {
    window.addEventListener('load', register, { once: true });
  }
}

/** True when already running from the home screen rather than a browser tab. */
export function isStandalone(): boolean {
  if (!isWeb()) return false;
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    // Safari's non-standard flag, which is how iOS reports it.
    (window.navigator as { standalone?: boolean }).standalone === true
  );
}

export function isIos(): boolean {
  if (!isWeb()) return false;
  return /iPad|iPhone|iPod/.test(navigator.userAgent);
}

export type InstallState =
  | { kind: 'unavailable' }
  | { kind: 'installed' }
  /** Chrome and Edge fire an event we can trigger from a button. */
  | { kind: 'prompt'; install: () => Promise<boolean> }
  /** iOS has no such event; the user must use Share → Add to Home Screen. */
  | { kind: 'ios-manual' };

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/**
 * Watch for installability.
 *
 * Returns an unsubscribe function. Deliberately not a React hook so it can be
 * used from anywhere, including before the tree mounts.
 */
export function watchInstallState(onChange: (state: InstallState) => void): () => void {
  if (!isWeb()) {
    onChange({ kind: 'unavailable' });
    return () => {};
  }
  if (isStandalone()) {
    onChange({ kind: 'installed' });
    return () => {};
  }
  if (isIos()) {
    onChange({ kind: 'ios-manual' });
    return () => {};
  }

  let deferred: BeforeInstallPromptEvent | null = null;

  const onBeforeInstall = (event: Event) => {
    // Stops the browser's own mini-infobar so we can choose the moment — after
    // a win reads very differently from during the first thirty seconds.
    event.preventDefault();
    deferred = event as BeforeInstallPromptEvent;
    onChange({
      kind: 'prompt',
      install: async () => {
        if (!deferred) return false;
        await deferred.prompt();
        const { outcome } = await deferred.userChoice;
        deferred = null;
        onChange({ kind: 'unavailable' });
        return outcome === 'accepted';
      },
    });
  };

  const onInstalled = () => onChange({ kind: 'installed' });

  window.addEventListener('beforeinstallprompt', onBeforeInstall);
  window.addEventListener('appinstalled', onInstalled);
  onChange({ kind: 'unavailable' });

  return () => {
    window.removeEventListener('beforeinstallprompt', onBeforeInstall);
    window.removeEventListener('appinstalled', onInstalled);
  };
}

const DISMISSED_KEY = 'juwa.install-prompt.dismissed-at';
/** Ask again after a week. Nagging every session is how you get uninstalled. */
const NAG_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;

export function wasRecentlyDismissed(): boolean {
  if (!isWeb()) return true;
  try {
    const at = Number(window.localStorage.getItem(DISMISSED_KEY));
    return Number.isFinite(at) && at > 0 && Date.now() - at < NAG_INTERVAL_MS;
  } catch {
    // Private mode, or storage blocked. Treat as dismissed rather than nagging.
    return true;
  }
}

export function markDismissed(): void {
  if (!isWeb()) return;
  try {
    window.localStorage.setItem(DISMISSED_KEY, String(Date.now()));
  } catch {
    /* storage unavailable — the prompt simply reappears next session */
  }
}
