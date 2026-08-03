import React from 'react';
import { StyleSheet, Switch, View } from 'react-native';
import { colors, spacing } from '@juwa/ui';
import { Card, Screen, SectionHeader, Txt } from '../components/primitives';

/**
 * Profile wireframe.
 *
 * Responsible-gaming controls sit at the top level, not buried three menus
 * deep. That placement is a legal requirement in licensed markets and the
 * right default everywhere else.
 */
function Row({ label, hint, value }: { label: string; hint?: string; value?: string }) {
  return (
    <View style={styles.row}>
      <View style={styles.rowLeft}>
        <Txt variant="bodySmall">{label}</Txt>
        {hint ? (
          <Txt variant="caption" color={colors.text.muted}>
            {hint}
          </Txt>
        ) : null}
      </View>
      {value ? (
        <Txt variant="bodySmall" color={colors.text.secondary}>
          {value}
        </Txt>
      ) : (
        <Switch value={false} onValueChange={() => {}} />
      )}
    </View>
  );
}

export function ProfileScreen() {
  return (
    <Screen>
      <Card style={styles.identity}>
        <View style={styles.avatar}>
          <Txt variant="h1" color={colors.text.inverse}>
            A
          </Txt>
        </View>
        <Txt variant="h2">Alex</Txt>
        <Txt variant="bodySmall" color={colors.text.muted}>
          Member since August 2026
        </Txt>
      </Card>

      <View>
        <SectionHeader title="Play Responsibly" />
        <Card style={styles.group}>
          <Row label="Daily spend limit" hint="You choose the cap" value="Not set" />
          <Row label="Session reminder" hint="Every 60 minutes" />
          <Row label="Take a break" hint="Pause your account for 24h+" value="Set up" />
          <Row label="Self-exclude" hint="Easy to start, hard to undo" value="Set up" />
        </Card>
      </View>

      <View>
        <SectionHeader title="Fairness" />
        <Card style={styles.group}>
          <Row label="Your client seed" hint="Change it any time" value="Edit" />
          <Row label="Verify past rounds" hint="Check any result yourself" value="Open" />
        </Card>
      </View>

      <View>
        <SectionHeader title="Account" />
        <Card style={styles.group}>
          <Row label="Email" value="alex@example.com" />
          <Row label="Notifications" />
          <Row label="Sound effects" />
          <Row label="Support" value="Contact" />
        </Card>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  identity: { alignItems: 'center', gap: spacing.xs, paddingVertical: spacing.xl },
  avatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.gold.default,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  group: { padding: 0 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacing.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.surface.border,
    minHeight: 60,
  },
  rowLeft: { gap: 2, flex: 1 },
});
