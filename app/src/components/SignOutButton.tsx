/**
 * Sign out, in the two places a player looks for it.
 *
 * There was no way to sign out at all. On a shared or borrowed phone — which is
 * exactly how an agent-created account gets used, since the agent may have set
 * it up on their own device — that is not an inconvenience, it is somebody
 * else's balance left open on a screen.
 *
 * ## Why it confirms
 *
 * Because signing out of THIS product is expensive in a way it is not
 * elsewhere: players created by an agent have no email address, so they cannot
 * reset a forgotten password themselves. Signing out when you do not remember
 * your password means finding your agent. One extra tap is a fair price for
 * that.
 */

import React, { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { colors, spacing } from '@juwa/ui';
import { Button, Card, Txt } from './primitives';
import { signOut } from '../api/auth';
import { sounds } from '../sound';

export function SignOutButton({ hint }: { hint?: string }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  if (confirming) {
    return (
      <Card style={styles.confirm}>
        <Txt variant="bodySmall">Sign out of Juwa?</Txt>
        <Txt variant="caption" color={colors.text.muted}>
          You will need your username and password to get back in.
        </Txt>
        <View style={styles.row}>
          <Button
            label="Cancel"
            variant="secondary"
            style={styles.flex}
            onPress={() => setConfirming(false)}
          />
          <Button
            label="Sign out"
            loading={busy}
            style={styles.flex}
            onPress={async () => {
              setBusy(true);
              // No navigation afterwards: AppGate is subscribed to the auth
              // state and swaps the whole tree for the landing page the moment
              // the session goes. Pushing a screen here as well would race it.
              await signOut();
            }}
          />
        </View>
      </Card>
    );
  }

  return (
    <View style={styles.wrap}>
      <Button
        label="Sign out"
        variant="secondary"
        onPress={() => {
          sounds.tap();
          setConfirming(true);
        }}
      />
      {hint ? (
        <Txt variant="caption" color={colors.text.muted} style={styles.hint}>
          {hint}
        </Txt>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: spacing.lg, gap: spacing.xs },
  hint: { textAlign: 'center' },
  confirm: { gap: spacing.sm, marginTop: spacing.lg },
  row: { flexDirection: 'row', gap: spacing.sm },
  flex: { flex: 1 },
});
