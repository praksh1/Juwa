/**
 * Profile: settings that actually do something.
 *
 * ## What was wrong with this screen
 *
 * It was a wireframe that shipped. "Daily spend limit — Not set" with no way to
 * set one; a session-reminder toggle wired to nothing; "Take a break" and
 * "Self-exclude" that were decoration; a client seed you could not change and
 * rounds you could not verify.
 *
 * A dead control is worse than a missing one, and responsible-gaming controls
 * are the worst place to have them: a player who sets a limit believes they
 * have set a limit. That is a promise the product was breaking at the exact
 * moment somebody was trying to look after themselves — and it is the first
 * thing a regulator or an acquirer opens.
 *
 * ## Where the rules live
 *
 * Not here. `set_player_limits` decides that tightening is immediate, loosening
 * waits 24 hours, and a break only ever extends; `assert_can_play` decides that
 * a capped player cannot bet. This screen collects numbers and shows what came
 * back. A limit a client could talk its way around would not be a limit.
 */

import React from 'react';
import { Linking, Pressable, StyleSheet, Switch, TextInput, View } from 'react-native';
import { colors, radius, spacing } from '@juwa/ui';
import { Button, Card, Screen, SectionHeader, Txt } from '../components/primitives';
import { PlayApiError, createPlayApi, type PlayerLimits, type Profile } from '../api/client';
import { getSession } from '../api/auth';
import { sounds } from '../sound';
import { useMuted } from '../components/SoundToggles';
import { SignOutButton } from '../components/SignOutButton';

/** Break lengths, in days. The long ones are what "self-exclude" means. */
const BREAKS = [
  { label: '24 hours', days: 1 },
  { label: '7 days', days: 7 },
  { label: '30 days', days: 30 },
  { label: '6 months', days: 182 },
];

const REMINDERS = [15, 30, 60, 120];

const coins = (value: number) => Math.round(value).toLocaleString('en-US');

function Row({
  label,
  hint,
  value,
  switchValue,
  onToggle,
  onPress,
}: {
  label: string;
  hint?: string;
  value?: string;
  switchValue?: boolean;
  onToggle?: (next: boolean) => void;
  onPress?: () => void;
}) {
  const body = (
    <View style={styles.row}>
      <View style={styles.rowLeft}>
        <Txt variant="bodySmall">{label}</Txt>
        {hint ? (
          <Txt variant="caption" color={colors.text.muted}>
            {hint}
          </Txt>
        ) : null}
      </View>
      {onToggle ? (
        <Switch
          value={switchValue ?? false}
          onValueChange={(next) => onToggle(next)}
          accessibilityLabel={label}
        />
      ) : (
        <Txt variant="bodySmall" color={onPress ? colors.neon.cyan : colors.text.secondary}>
          {value ?? ''}
        </Txt>
      )}
    </View>
  );

  if (!onPress) return body;
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={label}>
      {body}
    </Pressable>
  );
}

export function ProfileScreen() {
  const api = React.useRef(createPlayApi()).current;
  const [username, setUsername] = React.useState<string | null>(null);
  const [email, setEmail] = React.useState<string | null>(null);
  const [agentName, setAgentName] = React.useState<string | null>(null);
  const [agentStatus, setAgentStatus] = React.useState<string | null>(null);
  const [limits, setLimits] = React.useState<PlayerLimits | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [note, setNote] = React.useState<string | null>(null);

  /** Which inline editor is open. One at a time — this is a settings list. */
  const [editing, setEditing] = React.useState<'limit' | 'reminder' | 'break' | 'seed' | null>(
    null,
  );
  const [limitDraft, setLimitDraft] = React.useState('');
  const [seedDraft, setSeedDraft] = React.useState('');

  const [applying, setApplying] = React.useState(false);
  const [agentLabel, setAgentLabel] = React.useState('');
  const [applyBusy, setApplyBusy] = React.useState(false);
  const [applyProblem, setApplyProblem] = React.useState<string | null>(null);

  const [musicMuted, setMusicMuted] = useMuted('music');
  const [effectsMuted, setEffectsMuted] = useMuted('effects');

  React.useEffect(() => {
    api
      .getProfile()
      .then((profile: Profile) => {
        setUsername(profile.username ?? null);
        setAgentName(profile.agentName ?? null);
        setAgentStatus(profile.agent?.status ?? null);
        setLimits(profile.limits ?? null);
      })
      .catch(() => {});
    void getSession().then((session) => setEmail(session?.email ?? null));
  }, [api]);

  const change = async (
    changes: Parameters<typeof api.setLimits>[0],
    confirmation: string,
  ) => {
    setBusy(true);
    setNote(null);
    try {
      const next = await api.setLimits(changes);
      setLimits(next);
      setEditing(null);
      setNote(confirmation);
    } catch (error) {
      setNote(error instanceof PlayApiError ? error.message : 'Could not save that.');
    } finally {
      setBusy(false);
    }
  };

  const excluded =
    limits?.selfExcludedUntil && new Date(limits.selfExcludedUntil) > new Date()
      ? new Date(limits.selfExcludedUntil)
      : null;

  return (
    <Screen>
      <Card style={styles.identity}>
        <View style={styles.avatar}>
          <Txt variant="h1" color={colors.text.inverse}>
            {(username ?? 'P').charAt(0).toUpperCase()}
          </Txt>
        </View>
        <Txt variant="h2">{username ?? 'Player'}</Txt>
        {agentName ? (
          <Txt variant="bodySmall" color={colors.text.muted}>
            Your agent: {agentName}
          </Txt>
        ) : null}
      </Card>

      {note ? (
        <Card style={styles.note}>
          <Txt variant="bodySmall" color={colors.gold.light}>
            {note}
          </Txt>
        </Card>
      ) : null}

      {/* --------------------------------------------------- responsible play */}

      <View>
        <SectionHeader title="Play Responsibly" />
        <Card style={styles.group}>
          {excluded ? (
            <View style={styles.editor}>
              <Txt variant="bodySmall" color={colors.feedback.loss}>
                You are taking a break until {excluded.toLocaleString()}.
              </Txt>
              <Txt variant="caption" color={colors.text.muted}>
                Betting is switched off until then. A break cannot be shortened — that is what
                makes it worth setting.
              </Txt>
            </View>
          ) : null}

          <Row
            label="Daily play limit"
            hint="The most you can stake in a day"
            value={limits?.dailyWagerLimit ? `${coins(limits.dailyWagerLimit)} GC` : 'Not set'}
            onPress={() => {
              sounds.tap();
              setLimitDraft(limits?.dailyWagerLimit ? String(limits.dailyWagerLimit) : '');
              setEditing(editing === 'limit' ? null : 'limit');
            }}
          />
          {editing === 'limit' ? (
            <View style={styles.editor}>
              <TextInput
                value={limitDraft}
                onChangeText={(next) => setLimitDraft(next.replace(/[^0-9]/g, ''))}
                placeholder="Coins per day"
                placeholderTextColor={colors.text.muted}
                keyboardType="number-pad"
                inputMode="numeric"
                style={styles.input}
                accessibilityLabel="Daily play limit in coins"
              />
              <Txt variant="caption" color={colors.text.muted}>
                A lower limit starts straight away. Raising or removing one takes 24 hours, so a
                limit still means something on the night you want to ignore it.
              </Txt>
              <View style={styles.editorRow}>
                {limits?.dailyWagerLimit ? (
                  <Button
                    label="Remove"
                    variant="secondary"
                    style={styles.flex}
                    onPress={() =>
                      void change(
                        { dailyWagerLimit: null },
                        'Your limit will be removed in 24 hours.',
                      )
                    }
                  />
                ) : null}
                <Button
                  label="Save"
                  loading={busy}
                  style={styles.flex}
                  onPress={() => {
                    const amount = Number(limitDraft);
                    if (!Number.isInteger(amount) || amount <= 0) {
                      setNote('Enter a whole number of coins.');
                      return;
                    }
                    const current = limits?.dailyWagerLimit ?? null;
                    const looser = current !== null && amount > current;
                    void change(
                      { dailyWagerLimit: amount },
                      looser
                        ? `Raising your limit to ${coins(amount)} GC takes effect in 24 hours.`
                        : `Your daily limit is now ${coins(amount)} GC.`,
                    );
                  }}
                />
              </View>
            </View>
          ) : null}

          {limits?.pendingAt ? (
            <View style={styles.editor}>
              <Txt variant="caption" color={colors.gold.light}>
                {limits.pendingWagerLimit == null
                  ? 'Your limit will be removed'
                  : `Your limit changes to ${coins(limits.pendingWagerLimit)} GC`}
                {` on ${new Date(limits.pendingAt).toLocaleString()}.`}
              </Txt>
            </View>
          ) : null}

          <Row
            label="Session reminder"
            hint="A nudge after you have been playing a while"
            value={
              limits?.sessionReminderMinutes
                ? `Every ${limits.sessionReminderMinutes} min`
                : 'Off'
            }
            onPress={() => {
              sounds.tap();
              setEditing(editing === 'reminder' ? null : 'reminder');
            }}
          />
          {editing === 'reminder' ? (
            <View style={styles.editor}>
              <View style={styles.chips}>
                {REMINDERS.map((minutes) => (
                  <Pressable
                    key={minutes}
                    onPress={() =>
                      void change(
                        { sessionReminderMinutes: minutes },
                        `We will remind you every ${minutes} minutes.`,
                      )
                    }
                    accessibilityRole="button"
                    accessibilityLabel={`Remind me every ${minutes} minutes`}
                    style={[
                      styles.chip,
                      limits?.sessionReminderMinutes === minutes && styles.chipOn,
                    ]}
                  >
                    <Txt variant="caption">{minutes} min</Txt>
                  </Pressable>
                ))}
                <Pressable
                  onPress={() =>
                    void change({ sessionReminderMinutes: 0 }, 'Session reminders are off.')
                  }
                  accessibilityRole="button"
                  accessibilityLabel="Turn session reminders off"
                  style={[styles.chip, !limits?.sessionReminderMinutes && styles.chipOn]}
                >
                  <Txt variant="caption">Off</Txt>
                </Pressable>
              </View>
            </View>
          ) : null}

          <Row
            label="Take a break"
            hint="Switch betting off for a while. Cannot be undone."
            value={excluded ? 'Active' : 'Set up'}
            onPress={() => {
              sounds.tap();
              setEditing(editing === 'break' ? null : 'break');
            }}
          />
          {editing === 'break' ? (
            <View style={styles.editor}>
              <Txt variant="caption" color={colors.feedback.loss}>
                A break cannot be shortened or cancelled, by you or by support. Only pick one you
                mean.
              </Txt>
              <View style={styles.chips}>
                {BREAKS.map((option) => (
                  <Pressable
                    key={option.days}
                    onPress={() =>
                      void change(
                        { breakDays: option.days },
                        `Betting is off for ${option.label}. Look after yourself.`,
                      )
                    }
                    accessibilityRole="button"
                    accessibilityLabel={`Take a break for ${option.label}`}
                    style={[styles.chip, styles.chipDanger]}
                  >
                    <Txt variant="caption" color={colors.feedback.loss}>
                      {option.label}
                    </Txt>
                  </Pressable>
                ))}
              </View>
            </View>
          ) : null}
        </Card>
      </View>

      {/* ------------------------------------------------------------ fairness */}

      <View>
        <SectionHeader title="Fairness" />
        <Card style={styles.group}>
          <Row
            label="Your client seed"
            hint="Mixed into every result. Change it any time."
            value="Change"
            onPress={() => {
              sounds.tap();
              setSeedDraft('');
              setEditing(editing === 'seed' ? null : 'seed');
            }}
          />
          {editing === 'seed' ? (
            <View style={styles.editor}>
              <TextInput
                value={seedDraft}
                onChangeText={setSeedDraft}
                placeholder="Anything you like, or blank for a random one"
                placeholderTextColor={colors.text.muted}
                autoCapitalize="none"
                maxLength={64}
                style={styles.input}
                accessibilityLabel="New client seed"
              />
              <Txt variant="caption" color={colors.text.muted}>
                Every result is drawn from your seed and ours together. Changing yours proves we
                could not have known the outcome in advance.
              </Txt>
              <Button
                label="Use this seed"
                loading={busy}
                onPress={async () => {
                  setBusy(true);
                  setNote(null);
                  try {
                    const chosen = seedDraft.trim();
                    const next = await api.rotateSeed(chosen || undefined);
                    setEditing(null);
                    /*
                     * The response carries the seed pair being RETIRED, not the
                     * new client seed — reading `next.clientSeed` off it
                     * produced "Your client seed is now undefined". What the
                     * player cares about is what theirs is now, which is what
                     * they just typed, or a random one the server picked.
                     */
                    setNote(
                      chosen
                        ? `Your client seed is now "${chosen}". Every round from here mixes it in.`
                        : 'You have a fresh random client seed. Every round from here mixes it in.',
                    );
                  } catch (error) {
                    setNote(
                      error instanceof PlayApiError
                        ? error.message
                        : 'Could not change the seed.',
                    );
                  } finally {
                    setBusy(false);
                  }
                }}
              />
            </View>
          ) : null}
          <Row
            label="Verify past rounds"
            hint="Every spin is in your history with its proof"
            value="Wallet tab"
          />
        </Card>
      </View>

      {/* ------------------------------------------------------------- agents */}

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
                <View style={styles.editorRow}>
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

      {/* ------------------------------------------------------------ account */}

      <View>
        <SectionHeader title="Account" />
        <Card style={styles.group}>
          <Row label="Username" value={username ?? '—'} />
          {/*
            Agent-created players have a synthetic address they never chose and
            cannot receive mail at, so showing it would be noise pretending to
            be information.
          */}
          {email && !email.endsWith('.invalid') ? <Row label="Email" value={email} /> : null}
          <Row
            label="Background music"
            hint="The music bed in the lobby and in games"
            switchValue={!musicMuted}
            onToggle={(next) => setMusicMuted(!next)}
          />
          <Row
            label="Game sounds"
            hint="Reels, wins and card sounds"
            switchValue={!effectsMuted}
            onToggle={(next) => setEffectsMuted(!next)}
          />
          {agentName ? (
            <Row label="Your agent" hint="Who funds your account" value={agentName} />
          ) : null}
          {/*
            Support goes to the agent where there is one, because they are the
            person who can actually help with the two things that go wrong most
            — coins and a forgotten password — and they are in the same town.
            Everyone else gets email.
          */}
          <Row
            label="Support"
            hint={agentName ? `${agentName} looks after your account` : undefined}
            value={agentName ? 'Ask your agent' : 'Email us'}
            {...(agentName
              ? {}
              : { onPress: () => void Linking.openURL('mailto:support@juwa.app') })}
          />
        </Card>
      </View>

      <SignOutButton
        hint={
          agentName
            ? `You will need your username and password. ${agentName} can help if you are stuck.`
            : undefined
        }
      />
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
  note: {
    borderWidth: 1,
    borderColor: colors.gold.default,
    backgroundColor: 'rgba(200,164,77,0.10)',
  },
  group: { padding: 0 },
  agentCard: { gap: spacing.xs },
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
  editor: {
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
    paddingTop: spacing.sm,
  },
  editorRow: { flexDirection: 'row', gap: spacing.sm },
  flex: { flex: 1 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.surface.border,
    backgroundColor: colors.surface.overlay,
  },
  chipOn: { borderColor: colors.gold.default, backgroundColor: 'rgba(200,164,77,0.14)' },
  chipDanger: { borderColor: colors.feedback.loss },
  input: {
    backgroundColor: colors.surface.base,
    borderColor: colors.surface.border,
    borderWidth: 1,
    borderRadius: radius.md,
    color: colors.text.primary,
    fontSize: 16,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
});
