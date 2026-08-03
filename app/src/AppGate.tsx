import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, View, StyleSheet } from 'react-native';
import { colors } from '@juwa/ui';
import { AuthScreen } from './screens/AuthScreen';
import { LandingScreen } from './screens/LandingScreen';
import { RegisterScreen } from './screens/RegisterScreen';
import { onAuthChange, type Session } from './api/auth';
import { PlayApiError, createPlayApi } from './api/client';
import { PurchaseWatcher } from './components/PurchaseWatcher';
import { notifyBalanceChanged } from './api/usePlayer';

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
  const [loading, setLoading] = useState(true);
  const api = React.useRef(createPlayApi()).current;

  useEffect(() => {
    const unsubscribe = onAuthChange((next) => {
      setSession(next);
      setRegistered(null);
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!session) return;
    let alive = true;
    api
      .getProfile()
      .then((profile) => alive && setRegistered(profile.registered))
      // A failure here is far more likely to be an unreachable API than a
      // genuinely unregistered player, but showing the age gate is the safe
      // wrong answer: it cannot let anyone play who should not.
      .catch(() => alive && setRegistered(false));
    return () => {
      alive = false;
    };
  }, [api, session]);

  const register = useCallback(
    async (details: {
      username: string;
      dateOfBirth: string;
      country: string;
      region: string;
    }) => {
      try {
        await api.register(details);
        setRegistered(true);
        return { ok: true };
      } catch (error) {
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

  return (
    <View style={styles.app}>
      {children}
      {/* Above the tabs so a returning payment is confirmed wherever the
          player lands — Stripe sends them to the site root, not the store. */}
      <PurchaseWatcher onGranted={notifyBalanceChanged} />
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
