import React from 'react';
import { Pressable, StyleSheet, Switch, TextInput, View } from 'react-native';
import { colors, radius, spacing } from '@juwa/ui';
import { Button, Card, Screen, SectionHeader, Txt } from '../components/primitives';
import { createPlayApi, type Profile } from '../api/client';
import { isMuted, setMuted, sounds, unlock } from '../sound';

/**
 * Profile wireframe.
 *
 * Responsible-gaming controls sit at the top level, not buried three menus
 * deep. That placement is a legal requirement in licensed markets and the
 * right default everywhere else.
 */
function Row({
  label,
  hint,
  value,
  switchValue,
  onToggle,
}: {
  label: string;
  hint?: string;
  value?: string;
  switchValue?: boolean;
  onToggle?: (next: boolean) => void;
}) {
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
        <Switch
          value={switchValue ?? false}
          onValueChange={(next) => onToggle?.(next)}
          accessibilityLabel={label}
        />
      )}
    </View>
  );
}

export function ProfileScreen() {
  const api = React.useRef(createPlayApi()).current;
  const [username, setUsername] = React.useState<string | null>(null);
  /**
   * The agent who funds this player, if there is one.
   *
   * Read-only, deliberately. A player cannot change their agent and there is no
   * endpoint that would let them — reassignment is an operator action. It is
   * shown because "who gave me these coins" is the first question support gets
   * asked, and the answer should not require a support ticket to obtain.
   */
  const [agentName, setAgentName] = React.useState<string | null>(null);
  /**
   * Whether this account is, or has asked to be, an agent.
   *
   * The application form lives here rather than on the landing page because a
   * person can only apply once they have an account — an agent IS a player, and
   * there is no separate identity to create. The landing page points them at
   * sign-in; this is where they arrive afterwards.
   */
  const [agentStatus, setAgentStatus] = React.useState<string | null>(null);
  const [applying, setApplying] = React.useState(false);
  const [agentLabel, setAgentLabel] = React.useState('');
  const [applyBusy, setApplyBusy] = React.useState(false);
  const [applyProblem, setApplyProblem] = React.useState<string | null>(null);
  const [soundOn, setSoundOn] = React.useState(!isMuted());

  React.useEffect(() => {
    api
      .getProfile()
      .then((profile: Profile) => {
        setUsername(profile.username ?? null);
        setAgentName(profile.agentName ?? null);
        setAgentStatus(profile.agent?.status ?? null);
      })
      .catch(() => {});
  }, [api]);

  return (
    <Screen>
      <Card style={styles.identity}>
        <View style={styles.avatar}>
          <Txt variant="h1" color={colors.text.inverse}>
            {(username ?? 'P').charAt(0).toUpperCase()}
          </Txt>
        </View>
        <Txt variant="h2">{username ?? 'Player'}</Txt>
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

      {/*
        Becoming an agent.
        
        Hidden once they already are one — an active agent has a whole tab for
        this and does not need to be asked again — and replaced by a status line
        while an application is waiting, so nobody applies three times wondering
        whether the first one worked.
      */}
      {agentStatus === 'active' ? null : (
        <View>
          <SectionHeader title="Agents" />
          <Card style={styles.agentCard}>
            {agentStatus === 'pending' ? (
              <>
                <Txt variant="bodySmall">Your agent application is being reviewed.</Txt>
                <Txt variant="caption" color={colors.text.muted}>
                  You will get an Agent tab here once it is approved. Nothing else changes in the
                  meantime.
                </Txt>
              </>
            ) : agentStatus === 'suspended' ? (
              <Txt variant="bodySmall" color={colors.feedback.loss}>
                Your agent account is suspended. Contact support.
              </Txt>
            ) : applying ? (
              <>
                <Txt variant="bodySmall">What should your players see you as?</Txt>
                <TextInput
                  value={agentLabel}
                  onChangeText={setAgentLabel}
                  placeholder="e.g. Sunrise Gaming"
                  placeholderTextColor={colors.text.muted}
                  maxLength={64}
                  style={styles.input}
                  accessibilityLabel="Agent name"
                />
                {applyProblem ? (
                  <Txt variant="caption" color={colors.feedback.loss}>
                    {applyProblem}
                  </Txt>
                ) : null}
                <View style={styles.applyRow}>
                  <Button
                    label="Cancel"
                    variant="secondary"
                    onPress={() => setApplying(false)}
                    style={styles.flex}
                  />
                  <Button
                    label="Apply"
                    loading={applyBusy}
                    style={styles.flex}
                    onPress={async () => {
                      setApplyProblem(null);
                      if (agentLabel.trim().length < 2) {
                        setApplyProblem('Give your business a name of at least 2 characters.');
                        return;
                      }
                      setApplyBusy(true);
                      try {
                        const result = await api.applyToBeAgent(agentLabel.trim());
                        setAgentStatus(result.status);
                        setApplying(false);
                      } catch (error) {
                        setApplyProblem(
                          error instanceof Error ? error.message : 'Could not send that.',
                        );
                      } finally {
                        setApplyBusy(false);
                      }
                    }}
                  />
                </View>
              </>
            ) : (
              <>
                <Txt variant="bodySmall">Distribute coins as an agent</Txt>
                <Txt variant="caption" color={colors.text.muted}>
                  Agents hold an inventory of coins and hand it out to the players they sign up.
                  Applications are reviewed by hand.
                </Txt>
                <Pressable onPress={() => setApplying(true)} accessibilityRole="button">
                  <Txt variant="bodySmall" color={colors.neon.cyan}>
                    Apply to become an agent
                  </Txt>
                </Pressable>
              </>
            )}
          </Card>
        </View>
      )}

      <View>
        <SectionHeader title="Account" />
        <Card style={styles.group}>
          <Row label="Email" value="alex@example.com" />
          <Row label="Notifications" />
          <Row
            label="Sound effects"
            hint="Reels, wins and card sounds"
            switchValue={soundOn}
            onToggle={(next) => {
              setSoundOn(next);
              setMuted(!next);
              // Play the confirmation AFTER unmuting, so turning sound on is
              // audibly confirmed rather than silently accepted.
              if (next) {
                unlock();
                sounds.tap();
              }
            }}
          />
          {agentName ? <Row label="Your agent" hint="Who funds your account" value={agentName} /> : null}
          <Row label="Support" value="Contact" />
        </Card>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  agentCard: { gap: spacing.xs },
  applyRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs },
  flex: { flex: 1 },
  input: {
    backgroundColor: colors.surface.base,
    borderColor: colors.surface.border,
    borderWidth: 1,
    borderRadius: radius.md,
    color: colors.text.primary,
    fontSize: 16,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    marginTop: spacing.xs,
  },
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
