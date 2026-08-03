import React, { useMemo, useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import { colors, layout, radius, spacing, typography } from '@juwa/ui';
import { format } from '@juwa/money';
import { WELCOME_BONUS } from '@juwa/economy';
import { Button, Card, Screen, Txt } from '../components/primitives';

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
  }) => Promise<{ ok: boolean; message?: string }>;
}) {
  const [username, setUsername] = useState('');
  const [day, setDay] = useState('');
  const [month, setMonth] = useState('');
  const [year, setYear] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

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
      setMessage(age < 18 ? 'You must be 18 or over to play Juwa.' : 'Check the year of birth.');
      return;
    }

    setBusy(true);
    const result = await onRegister({ username: username.trim(), dateOfBirth, country: 'US' });
    setBusy(false);
    if (!result.ok) setMessage(result.message ?? 'Could not complete registration.');
  };

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

        {message ? (
          <Txt variant="bodySmall" color={colors.feedback.error}>
            {message}
          </Txt>
        ) : null}

        <Button
          label={`Start with ${format(WELCOME_BONUS, 'GC')}`}
          onPress={submit}
          loading={busy}
          disabled={busy || (age !== null && age < 18)}
        />
      </Card>

      <Txt variant="caption" color={colors.text.muted} style={styles.notice}>
        Gold Coins have no cash value and cannot be exchanged for money or prizes.
      </Txt>
    </Screen>
  );
}

const styles = StyleSheet.create({
  centered: { flexGrow: 1, justifyContent: 'center', maxWidth: 480 },
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
  dateRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.xs },
  dateBox: { width: 64, textAlign: 'center', paddingHorizontal: spacing.sm },
  yearBox: { width: 92 },
  notice: { textAlign: 'center' },
});
