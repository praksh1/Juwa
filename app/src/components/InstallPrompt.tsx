import React, { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { colors, radius, spacing } from '@juwa/ui';
import { Button, Txt } from './primitives';
import {
  markDismissed,
  watchInstallState,
  wasRecentlyDismissed,
  type InstallState,
} from '../pwa';

/**
 * "Add Juwa to your home screen."
 *
 * Worth the screen space because installing is what makes push notifications
 * possible on iOS, and push is what makes the daily streak work. An installed
 * player also gets an icon among their apps, which is most of the retention
 * advantage a native app would have had.
 *
 * Shown in the lobby rather than on first load: someone who has just arrived
 * has no reason to install anything yet.
 */
export function InstallPrompt() {
  const [state, setState] = useState<InstallState>({ kind: 'unavailable' });
  const [hidden, setHidden] = useState(wasRecentlyDismissed());

  useEffect(() => watchInstallState(setState), []);

  if (hidden || state.kind === 'unavailable' || state.kind === 'installed') return null;

  const dismiss = () => {
    markDismissed();
    setHidden(true);
  };

  return (
    <View style={styles.card}>
      <View style={styles.text}>
        <Txt variant="bodySmall">Add Juwa to your home screen</Txt>
        <Txt variant="caption" color={colors.text.secondary}>
          {state.kind === 'ios-manual'
            ? 'Tap Share, then "Add to Home Screen" — it opens full screen and can remind you when your daily bonus is ready.'
            : 'Opens full screen, and we can remind you when your daily bonus is ready.'}
        </Txt>
      </View>
      <View style={styles.actions}>
        {state.kind === 'prompt' ? (
          <Button label="Install" onPress={() => void state.install()} />
        ) : null}
        <Button label="Not now" variant="ghost" onPress={dismiss} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface.overlay,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.gold.dark,
    padding: spacing.lg,
    gap: spacing.md,
  },
  text: { gap: spacing.xs },
  actions: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center' },
});
