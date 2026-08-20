import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, View, StyleSheet } from 'react-native';
import { colors } from '@juwa/ui';
import { AuthScreen } from './screens/AuthScreen';
import { LandingScreen } from './screens/LandingScreen';
import { RegisterScreen } from './screens/RegisterScreen';
import { SetPasswordScreen } from './screens/SetPasswordScreen';
import { onAuthChange, type Session } from './api/auth';
import { PlayApiError, createPlayApi } from './api/client';
import { PurchaseWatcher } from './components/PurchaseWatcher';
import { SessionReminder } from './components/SessionReminder';
import { notifyBalanceChanged } from './api/usePlayer';
import { captureInviteFromUrl, clearInvite, pendingInvite } from './api/invite';
import { publishResponsiblePlay } from './responsible-play';

/**
 * An agent's invite token, taken out of the URL before anything else runs.
 *
 * At module scope rather than in an effect, because the first thing Supabase
 * does with a magic-link return is rewrite the location — an effect that ran
 * after that would find the query string already gone. It is idempotent and
 * does nothing at all when there is no `?invite=`.
 */
captureInviteFromUrl();

/**
 * Decides which world the player is in:
 *
 *   no session          -> landing page, then sign up or log in
 *   session, no profile -> the age gate
 *   both                -> the game
 *
 * The order matters. A player cannot reach a bet screen without a profile, and
 * cannot get a profile without passing the 18+ check. The server enforces the
 * same thing independently — this is convenience, not security.
 */
export function AppGate({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  /**
   * What a logged-out visitor sees. Landing first, always: the previous
   * behaviour put an email field in front of anyone arriving from an ad, which
   * asks for something before offering anything.
   */
  const [entry, setEntry] = useState<'landing' | 'signup' | 'signin'>('landing');
  const [registered, setRegistered] = useState<boolean | null>(null);
  /**
   * Set while an agent-chosen temporary password is still in force.
   *
   * Gates the whole app rather than showing a banner, because until it is
   * cleared somebody else knows a working password for this account. See
   * SetPasswordScreen.
   */
  const [mustSetPassword, setMustSetPassword] = useState(false);
  const [loading, setLoading] = useState(true);
  const api = React.useRef(createPlayApi()).current;
  /**
   * Accounts that have finished choosing a password in THIS session.
   *
   * A latch, and it fixes a bug that made the whole feature look broken: a
   * player set their new password, the screen cleared, and it asked again.
   * Only the second attempt stuck.
   *
   * The cause is that changing a password makes Supabase emit an auth event of
   * its own. That reloads the profile — and the reload can land before the API
   * has recorded that the password was set, so the server still says
   * `mustSetPassword` and the gate slams shut on somebody who just walked
   * through it. Nothing about the ordering is under our control, so instead we
   * remember. The server is still the only thing that can clear the flag; this
   * only stops a stale read from re-raising it under the same player.
   */
  const passwordDone = React.useRef(new Set<string>());

  useEffect(() => {
    const unsubscribe = onAuthChange((next) => {
      setSession((current) => {
        /*
         * Only tear the app down when the PLAYER changes.
         *
         * Supabase fires this on every auth event, including the hourly token
         * refresh and the USER_UPDATED that a password change causes. Resetting
         * `registered` on all of them meant a full-screen loading spinner over
         * a working app once an hour, and a re-fetch mid-password-change that
         * caused the bug above.
         */
        if (current?.userId !== next?.userId) setRegistered(null);
        return next;
      });
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!session) return;
    let alive = true;
    api
      .getProfile()
      .then((profile) => {
        if (!alive) return;
        publishResponsiblePlay(profile.limits ?? null);
        setRegistered(profile.registered);
        setMustSetPassword(
          profile.mustSetPassword === true && !passwordDone.current.has(session.userId),
        );
      })
      // A failure here is far more likely to be an unreachable API than a
      // genuinely unregistered player, but showing the age gate is the safe
      // wrong answer: it cannot let anyone play who should not.
      .catch(() => alive && setRegistered(false));
    return () => {
      alive = false;
    };
  }, [api, session]);

  const register = useCallback(
    async (details: { username: string; dateOfBirth: string; country: string; region: string }) => {
      const invite = pendingInvite();
      try {
        // The token is sent WITH the registration, in the same request, so the
        // player is bound to their agent in the same moment the account becomes
        // real. Redeeming it afterwards would leave a window where a failure
        // produced a registered player attached to nobody, and there is no
        // self-service way to fix that — reassignment is an operator action.
        await api.register({ ...details, ...(invite ? { inviteToken: invite } : {}) });
        clearInvite();
        setRegistered(true);
        return { ok: true };
      } catch (error) {
        // The token is NOT cleared on failure: a username collision is the most
        // likely reason to land here, and the player is about to try again with
        // a different name. Throwing their agent link away because they picked
        // a taken username would be a strange punishment.
        return {
          ok: false,
          message:
            error instanceof PlayApiError ? error.message : 'Could not complete registration.',
        };
      }
    },
    [api],
  );

  if (loading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.gold.default} size="large" />
      </View>
    );
  }
  if (!session) {
    if (entry === 'landing') {
      return (
        <LandingScreen
          onCreateAccount={() => setEntry('signup')}
          onSignIn={() => setEntry('signin')}
        />
      );
    }
    return <AuthScreen initialMode={entry === 'signin' ? 'login' : 'signup'} onBack={() => setEntry('landing')} />;
  }
  if (registered === null) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.gold.default} size="large" />
      </View>
    );
  }
  if (!registered) return <RegisterScreen onRegister={register} />;

  /*
   * Before the lobby, before anything. A player whose password is still the one
   * their agent typed does not get to use the app until they have replaced it —
   * every second in this state is a second somebody else can sign in as them.
   */
  if (mustSetPassword) {
    return (
      <SetPasswordScreen
        onDone={() => {
          passwordDone.current.add(session.userId);
          setMustSetPassword(false);
        }}
      />
    );
  }

  return (
    <View style={styles.app}>
      {children}
      {/* Above the tabs so a returning payment is confirmed wherever the
          player lands — Stripe sends them to the site root, not the store. */}
      <PurchaseWatcher onGranted={notifyBalanceChanged} />
      {/* Mounted once, here, so the clock spans every screen rather than
          restarting each time the player moves between the lobby and a game. */}
      <SessionReminder />
    </View>
  );
}

const styles = StyleSheet.create({
  app: { flex: 1 },
  loading: {
    flex: 1,
    backgroundColor: colors.surface.base,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
