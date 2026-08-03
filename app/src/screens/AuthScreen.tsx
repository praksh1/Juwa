import React, { useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import { colors, layout, radius, spacing, typography } from '@juwa/ui';
import { Button, Card, Screen, Txt } from '../components/primitives';
import { IS_CONFIGURED, signIn, signUp } from '../api/auth';

/**
 * Sign up and log in.
 *
 * No date of birth here on purpose — the age gate is a separate step after the
 * account exists, so a failed age check leaves an account we can refuse rather
 * than a half-created user and a coin balance nobody should have. See
 * `RegisterScreen`.
 */
export function AuthScreen() {
  const [mode, setMode] = useState<'login' | 'signup'>('signup');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [confirmSent, setConfirmSent] = useState(false);

  const submit = async () => {
    setMessage(null);
    if (!email.includes('@')) {
      setMessage('Enter a valid email address.');
      return;
    }
    if (password.length < 6) {
      setMessage('Passwords must be at least 6 characters.');
      return;
    }

    setBusy(true);
    const result = mode === 'signup' ? await signUp(email, password) : await signIn(email, password);
    setBusy(false);

    if (!result.ok) {
      setMessage(result.message ?? 'Something went wrong.');
      return;
    }
    if (result.needsEmailConfirmation) setConfirmSent(true);
  };

  if (confirmSent) {
    return (
      <Screen contentStyle={styles.centered}>
        <Card style={styles.card}>
          <Txt variant="h2">Check your email</Txt>
          <Txt variant="bodySmall" color={colors.text.secondary}>
            We sent a confirmation link to {email}. Click it and come back.
          </Txt>
          <Button label="Back" variant="secondary" onPress={() => setConfirmSent(false)} />
        </Card>
      </Screen>
    );
  }

  return (
    <Screen contentStyle={styles.centered}>
      <View style={styles.brand}>
        <Txt variant="display" color={colors.gold.default}>
          JUWA
        </Txt>
        <Txt variant="bodySmall" color={colors.text.secondary}>
          Play for fun. Coins have no cash value.
        </Txt>
      </View>

      <Card style={styles.card}>
        <Txt variant="h2">{mode === 'signup' ? 'Create an account' : 'Welcome back'}</Txt>

        <TextInput
          style={styles.input}
          placeholder="Email"
          placeholderTextColor={colors.text.muted}
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          inputMode="email"
          value={email}
          onChangeText={setEmail}
          accessibilityLabel="Email address"
        />
        <TextInput
          style={styles.input}
          placeholder="Password"
          placeholderTextColor={colors.text.muted}
          secureTextEntry
          autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
          value={password}
          onChangeText={setPassword}
          onSubmitEditing={submit}
          accessibilityLabel="Password"
        />

        {message ? (
          <Txt variant="bodySmall" color={colors.feedback.error}>
            {message}
          </Txt>
        ) : null}

        <Button
          label={mode === 'signup' ? 'Sign up' : 'Log in'}
          onPress={submit}
          loading={busy}
          disabled={busy}
        />
        <Button
          label={mode === 'signup' ? 'I already have an account' : 'Create an account instead'}
          variant="ghost"
          onPress={() => {
            setMode(mode === 'signup' ? 'login' : 'signup');
            setMessage(null);
          }}
        />
      </Card>

      {/* Deployed demo builds are on a public URL, so this says what a visitor
          needs to know and nothing more. Naming the environment variables here
          told strangers how the site is configured and read, to anyone who was
          not expecting it, as a broken page. The build log is where a
          misconfiguration belongs. */}
      {!IS_CONFIGURED ? (
        <Txt variant="caption" color={colors.feedback.warning} style={styles.notice}>
          Demo mode — play as much as you like, but accounts and coins are not
          saved.
        </Txt>
      ) : null}

      <Txt variant="caption" color={colors.text.muted} style={styles.notice}>
        You must be 18 or over. Juwa is a free-to-play social casino: Gold Coins
        are for entertainment only, have no cash value, and cannot be exchanged
        for money or prizes.
      </Txt>
    </Screen>
  );
}

const styles = StyleSheet.create({
  centered: { flexGrow: 1, justifyContent: 'center', maxWidth: 480 },
  brand: { alignItems: 'center', gap: spacing.xs },
  card: { gap: spacing.md },
  input: {
    minHeight: layout.minTouchTarget,
    backgroundColor: colors.surface.base,
    borderWidth: 1,
    borderColor: colors.surface.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.lg,
    color: colors.text.primary,
    fontSize: typography.body.fontSize,
  },
  notice: { textAlign: 'center' },
});
