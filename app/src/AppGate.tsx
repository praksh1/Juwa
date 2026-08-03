import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, View, StyleSheet } from 'react-native';
import { colors } from '@juwa/ui';
import { AuthScreen } from './screens/AuthScreen';
import { RegisterScreen } from './screens/RegisterScreen';
import { onAuthChange, type Session } from './api/auth';
import { PlayApiError, createPlayApi } from './api/client';

/**
 * Decides which of three worlds the player is in:
 *
 *   no session          -> sign up or log in
 *   session, no profile -> the age gate
 *   both                -> the game
 *
 * The order matters. A player cannot reach a bet screen without a profile, and
 * cannot get a profile without passing the 18+ check. The server enforces the
 * same thing independently — this is convenience, not security.
 */
export function AppGate({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
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
    async (details: { username: string; dateOfBirth: string; country: string }) => {
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
  if (!session) return <AuthScreen />;
  if (registered === null) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.gold.default} size="large" />
      </View>
    );
  }
  if (!registered) return <RegisterScreen onRegister={register} />;
  return <>{children}</>;
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    backgroundColor: colors.surface.base,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
