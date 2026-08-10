import React, { useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import { colors, layout, radius, spacing, typography } from '@juwa/ui';
import { Button, Card, Screen, Txt } from '../components/primitives';
import { Logo } from '../components/Logo';
import { LegalFooter } from '../components/LegalFooter';
import { IS_CONFIGURED, signIn, signUp } from '../api/auth';
import { PasswordInput } from '../components/PasswordInput';

/**
 * Sign up and log in.
 *
 * No date of birth here on purpose — the age gate is a separate step after the
 * account exists, so a failed age check leaves an account we can refuse rather
 * than a half-created user and a coin balance nobody should have. See
 * `RegisterScreen`.
 */
export function AuthScreen({
  initialMode = 'signup',
  onBack,
}: {
  initialMode?: 'login' | 'signup';
  onBack?: () => void;
} = {}) {
  const [mode, setMode] = useState<'login' | 'signup'>(initialMode);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [confirmSent, setConfirmSent] = useState(false);

  const submit = async () => {
    setMessage(null);
    /*
     * Signing IN accepts a username as well as an email; signing UP still
     * requires a real address.
     *
     * Players an agent creates in person have no email — their account is
     * `<username>@<synthetic domain>` and they are told only the username. This
     * check used to demand an '@' in both modes, which meant every such player
     * was told "Enter a valid email address" and could not get into the account
     * that had just been made for them. Creating accounts they cannot sign into
     * is worse than not creating them.
     *
     * Sign-up is unchanged: it sends a confirmation link, and a link sent to a
     * synthetic address goes nowhere.
     */
    if (mode === 'signup' && !email.includes('@')) {
      setMessage('Enter a valid email address.');
      return;
    }
    if (mode === 'login' && email.trim().length < 3) {
      setMessage('Enter your email address or username.');
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
        <Logo height={52} />
        <Txt variant="bodySmall" color={colors.text.secondary}>
          Play for fun. Coins have no cash value.
        </Txt>
        {onBack ? (
          <Button label="Back" variant="secondary" onPress={onBack} />
        ) : null}
      </View>

      <Card style={styles.card}>
        <Txt variant="h2">{mode === 'signup' ? 'Create an account' : 'Welcome back'}</Txt>

        <TextInput
          style={styles.input}
          placeholder={mode === 'signup' ? 'Email' : 'Email or username'}
          placeholderTextColor={colors.text.muted}
          autoCapitalize="none"
          autoComplete={mode === 'signup' ? 'email' : 'username'}
          keyboardType={mode === 'signup' ? 'email-address' : 'default'}
          inputMode={mode === 'signup' ? 'email' : 'text'}
          value={email}
          onChangeText={setEmail}
          accessibilityLabel={mode === 'signup' ? 'Email address' : 'Email address or username'}
        />
        <PasswordInput
          label="Password"
          placeholder="Password"
          autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
          value={password}
          onChangeText={setPassword}
          onSubmitEditing={submit}
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

      <LegalFooter compact />
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
