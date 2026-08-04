import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { colors, layout, radius, spacing, typography } from '@juwa/ui';
import { format } from '@juwa/money';
import { RESTRICTED_STATE_MESSAGE, WELCOME_BONUS, isRestrictedState, selectableStates } from '@juwa/economy';
import { Button, Card, Screen, Txt } from '../components/primitives';
import { LegalFooter } from '../components/LegalFooter';
import { StatePicker } from '../components/StatePicker';

/**
 * One segment of the date of birth.
 *
 * ⚠️ DEFINED AT MODULE SCOPE, AND IT HAS TO BE.
 *
 * This lived inside RegisterScreen, which meant every render produced a new
 * function — a new component TYPE as far as React is concerned. React cannot
 * know it is the same component, so it unmounted the input and mounted a fresh
 * one on every keystroke, and the browser dropped focus with it.
 *
 * The symptom is precise and baffling: you type "1", the field takes it, and
 * the caret vanishes. Typing the second "1" does nothing until you tap back in,
 * so entering a date of birth means eight taps instead of one. It looks like a
 * mobile keyboard quirk rather than a bug, which is why it survived to a real
 * user's first sign-up.
 */
const DateBox = ({
  value,
  onChange,
  placeholder,
  length,
  label,
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder: string;
  length: number;
  label: string;
}) => (
  <TextInput
    style={[styles.input, styles.dateBox, length === 4 && styles.yearBox]}
    placeholder={placeholder}
    placeholderTextColor={colors.text.muted}
    keyboardType="number-pad"
    inputMode="numeric"
    maxLength={length}
    value={value}
    onChangeText={(next) => onChange(next.replace(/\D/g, ''))}
    accessibilityLabel={label}
  />
);

/**
 * The age gate.
 *
 * Deliberately a separate step from creating the account. Two reasons:
 *
 *  1. It puts one clear, unambiguous 18+ decision in the flow, rather than
 *     burying a date field among email and password where it reads as
 *     paperwork.
 *  2. If the check fails, we already have an account we can refuse and record.
 *     Failing during sign-up would leave nothing behind, so the same person
 *     could simply retype a different year and continue.
 *
 * The server re-checks all of this. Nothing here is trusted — `assert_can_play`
 * refuses every bet from an unverified profile regardless of what this screen
 * did.
 */
export function RegisterScreen({
  onRegister,
}: {
  onRegister: (details: {
    username: string;
    dateOfBirth: string;
    country: string;
    region: string;
  }) => Promise<{ ok: boolean; message?: string }>;
}) {
  const [username, setUsername] = useState('');
  const [day, setDay] = useState('');
  const [month, setMonth] = useState('');
  const [year, setYear] = useState('');
  const [region, setRegion] = useState('');
  const [confirmedAdult, setConfirmedAdult] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const states = useMemo(() => selectableStates(), []);

  const dateOfBirth = useMemo(() => {
    if (!/^\d{1,2}$/.test(day) || !/^\d{1,2}$/.test(month) || !/^\d{4}$/.test(year)) return null;
    const iso = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
    const parsed = new Date(`${iso}T00:00:00Z`);
    // Rejects 31 February and friends: JS would silently roll it to 3 March.
    if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== iso) return null;
    return iso;
  }, [day, month, year]);

  const age = useMemo(() => {
    if (!dateOfBirth) return null;
    const birth = new Date(`${dateOfBirth}T00:00:00Z`);
    const now = new Date();
    let years = now.getUTCFullYear() - birth.getUTCFullYear();
    const monthDiff = now.getUTCMonth() - birth.getUTCMonth();
    // Not had this year's birthday yet.
    if (monthDiff < 0 || (monthDiff === 0 && now.getUTCDate() < birth.getUTCDate())) years--;
    return years;
  }, [dateOfBirth]);

  const submit = async () => {
    setMessage(null);
    if (username.trim().length < 3) {
      setMessage('Pick a username of at least 3 characters.');
      return;
    }
    if (!dateOfBirth) {
      setMessage('Enter a real date of birth.');
      return;
    }
    if (age !== null && (age < 18 || age > 120)) {
      setMessage(age < 18 ? 'You must be 18 or over to play.' : 'Check the year of birth.');
      return;
    }
    if (!region) {
      setMessage('Choose the state you live in.');
      return;
    }
    // Restricted states are absent from the dropdown, so this only fires for a
    // value that did not come from it. The server checks again regardless.
    if (isRestrictedState(region)) {
      setMessage(RESTRICTED_STATE_MESSAGE);
      return;
    }
    if (!confirmedAdult) {
      setMessage('Please confirm you are 18 or over.');
      return;
    }

    setBusy(true);
    const result = await onRegister({
      username: username.trim(),
      dateOfBirth,
      country: 'US',
      region,
    });
    setBusy(false);
    if (!result.ok) setMessage(result.message ?? 'Could not complete registration.');
  };

  return (
    <Screen contentStyle={styles.centered}>
      <Card style={styles.card}>
        <Txt variant="h2">One last thing</Txt>
        <Txt variant="bodySmall" color={colors.text.secondary}>
          Pick a name, and confirm you are old enough to play.
        </Txt>

        <TextInput
          style={styles.input}
          placeholder="Username"
          placeholderTextColor={colors.text.muted}
          autoCapitalize="none"
          maxLength={24}
          value={username}
          onChangeText={setUsername}
          accessibilityLabel="Username"
        />

        <View>
          <Txt variant="caption" color={colors.text.muted}>
            DATE OF BIRTH
          </Txt>
          <View style={styles.dateRow}>
            <DateBox value={day} onChange={setDay} placeholder="DD" length={2} label="Day of birth" />
            <DateBox value={month} onChange={setMonth} placeholder="MM" length={2} label="Month of birth" />
            <DateBox value={year} onChange={setYear} placeholder="YYYY" length={4} label="Year of birth" />
          </View>
          {age !== null && age < 18 ? (
            <Txt variant="caption" color={colors.feedback.error}>
              You must be 18 or over to play.
            </Txt>
          ) : null}
        </View>

        <StatePicker states={states} value={region} onChange={setRegion} />

        {/* An explicit affirmation, separate from the date of birth. The date
            is a fact we check; this is a statement the player makes. Keeping
            them apart is what makes the record worth anything later. */}
        <Pressable
          onPress={() => setConfirmedAdult((on) => !on)}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: confirmedAdult }}
          accessibilityLabel="I confirm I am 18 or over"
          style={styles.checkRow}
        >
          <View style={[styles.checkbox, confirmedAdult && styles.checkboxOn]}>
            {confirmedAdult ? (
              <Txt variant="caption" color={colors.text.inverse}>
                ✓
              </Txt>
            ) : null}
          </View>
          <Txt variant="bodySmall" color={colors.text.secondary} style={styles.checkLabel}>
            I confirm I am 18 or over and that coins have no cash value.
          </Txt>
        </Pressable>

        {message ? (
          <Txt variant="bodySmall" color={colors.feedback.error}>
            {message}
          </Txt>
        ) : null}

        <Button
          label={`Start with ${format(WELCOME_BONUS, 'GC')}`}
          onPress={submit}
          loading={busy}
          disabled={busy || (age !== null && age < 18) || !confirmedAdult || !region}
        />
      </Card>

      <LegalFooter compact />
    </Screen>
  );
}

const styles = StyleSheet.create({
  centered: { flexGrow: 1, justifyContent: 'center', maxWidth: 480 },
  card: { gap: spacing.md },
  checkRow: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start' },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: radius.sm,
    borderWidth: 2,
    borderColor: colors.surface.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  checkboxOn: { backgroundColor: colors.neon.cyan, borderColor: colors.neon.cyan },
  checkLabel: { flex: 1 },
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
  dateRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs },
  dateBox: { width: 64, textAlign: 'center', paddingHorizontal: spacing.sm },
  yearBox: { width: 92 },
  notice: { textAlign: 'center' },
});
