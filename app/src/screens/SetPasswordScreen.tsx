/**
 * Replace the temporary password an agent set.
 *
 * ## Why this blocks everything
 *
 * When an agent creates an account they choose the first password and say it
 * out loud to the player. Until the player changes it, the agent knows a
 * working credential for someone else's balance — they could sign in as that
 * player, spend their coins, and leave no trace that distinguishes them from
 * the account's owner.
 *
 * This screen is what closes that window, so it is a gate and not a prompt.
 * There is no "later", no dismiss, and no way around it: `AppGate` renders this
 * INSTEAD of the app whenever the server says `mustSetPassword`, and the server
 * is the only thing that can clear the flag.
 *
 * ## The password goes to Supabase, not to us
 *
 * `changePassword` calls Supabase with the player's own session. Our API is
 * told only that it happened, which is what clears the flag. Nothing in this
 * product ever transports or stores a player's password, and that stays true
 * for accounts an agent created.
 */

import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { colors, spacing } from '@juwa/ui';
import { Button, Card, Screen, Txt } from '../components/primitives';
import { PasswordInput } from '../components/PasswordInput';
import { changePassword } from '../api/auth';
import { PlayApiError, createPlayApi } from '../api/client';

/** Short enough to be typed on a phone by someone standing at a counter. */
const MIN_LENGTH = 8;

export function SetPasswordScreen({ onDone }: { onDone: () => void }) {
  const api = React.useRef(createPlayApi()).current;
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const submit = async () => {
    setMessage(null);
    if (password.length < MIN_LENGTH) {
      setMessage(`Pick a password of at least ${MIN_LENGTH} characters.`);
      return;
    }
    if (password !== confirm) {
      setMessage('The two passwords do not match.');
      return;
    }

    setBusy(true);
    const changed = await changePassword(password);
    if (!changed.ok) {
      setBusy(false);
      setMessage(changed.message ?? 'Could not change your password.');
      return;
    }

    /*
     * Supabase has accepted the new password, so the agent's copy is already
     * dead — that is the part that mattered and it has happened. Telling our
     * API is bookkeeping, and if it fails the player is still safe, so the
     * failure only stops them from getting past this screen. Retrying is
     * better than blocking them out of an account whose password is now
     * theirs alone.
     */
    try {
      await api.confirmPasswordSet();
      onDone();
    } catch (error) {
      setBusy(false);
      setMessage(
        error instanceof PlayApiError
          ? `Your password was changed, but we could not finish setting up. ${error.message}`
          : 'Your password was changed. Tap again to finish.',
      );
    }
  };

  return (
    <Screen contentStyle={styles.centered}>
      <Card style={styles.card}>
        <Txt variant="h2">Choose your password</Txt>
        <Txt variant="bodySmall" color={colors.text.secondary}>
          Your account was set up for you with a temporary password. Pick your own now — whoever
          set the account up will not be able to sign in as you afterwards.
        </Txt>

        <PasswordInput
          label="New password"
          placeholder="New password"
          autoComplete="new-password"
          value={password}
          onChangeText={setPassword}
        />
        <PasswordInput
          label="Confirm new password"
          placeholder="Type it again"
          autoComplete="new-password"
          value={confirm}
          onChangeText={setConfirm}
        />

        {message ? (
          <Txt variant="caption" color={colors.feedback.error}>
            {message}
          </Txt>
        ) : null}

        <Button label="Save and continue" onPress={() => void submit()} loading={busy} />

        <Txt variant="caption" color={colors.text.muted}>
          Keep it to yourself. Nobody from Juwa will ever ask you for it.
        </Txt>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  centered: { justifyContent: 'center', flexGrow: 1 },
  card: { gap: spacing.md, padding: spacing.xl },
});
