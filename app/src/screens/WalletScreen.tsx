import React from 'react';
import { StyleSheet, View } from 'react-native';
import { colors, spacing } from '@juwa/ui';
import { format, minor, type Minor } from '@juwa/money';
import { Button, Card, Screen, SectionHeader, Txt } from '../components/primitives';

/**
 * Wallet wireframe.
 *
 * The history list is not decoration — it is the player-facing view of the
 * double-entry ledger. Every row here corresponds to a balanced transaction in
 * the database, which is why a support question ("where did my 500 coins go?")
 * always has an answer.
 */
interface Entry {
  id: string;
  label: string;
  amount: Minor;
  at: string;
}

const HISTORY: Entry[] = [
  { id: '1', label: 'Juwa Classic — win', amount: minor(12_500), at: '2m ago' },
  { id: '2', label: 'Juwa Classic — bet', amount: minor(-2_000), at: '2m ago' },
  { id: '3', label: 'Daily bonus', amount: minor(50_000), at: '4h ago' },
  { id: '4', label: 'Blackjack — bet', amount: minor(-1_000), at: 'Yesterday' },
  { id: '5', label: 'Coin pack — 1,000,000 GC', amount: minor(1_000_000), at: '2 days ago' },
];

export function WalletScreen() {
  const balance = minor(1_250_000);

  return (
    <Screen>
      <Card style={styles.balanceCard}>
        <Txt variant="caption" color={colors.text.muted}>
          GOLD COIN BALANCE
        </Txt>
        <Txt variant="moneyLarge" color={colors.gold.default}>
          {format(balance, 'GC')}
        </Txt>
        <View style={styles.actions}>
          <Button label="Get Coins" onPress={() => {}} style={styles.action} />
          <Button label="Redeem" variant="secondary" onPress={() => {}} style={styles.action} />
        </View>
      </Card>

      <View>
        <SectionHeader title="Activity" action="Export" />
        <Card style={styles.history}>
          {HISTORY.map((entry, i) => (
            <View key={entry.id} style={[styles.row, i > 0 && styles.rowDivider]}>
              <View style={styles.rowLeft}>
                <Txt variant="bodySmall">{entry.label}</Txt>
                <Txt variant="caption" color={colors.text.muted}>
                  {entry.at}
                </Txt>
              </View>
              <Txt
                variant="money"
                color={entry.amount >= 0 ? colors.feedback.win : colors.text.secondary}
              >
                {entry.amount >= 0 ? '+' : ''}
                {format(entry.amount, 'GC')}
              </Txt>
            </View>
          ))}
        </Card>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  balanceCard: { alignItems: 'center', gap: spacing.xs, paddingVertical: spacing.xl },
  actions: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.lg },
  action: { flex: 1 },
  history: { padding: 0 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: spacing.lg,
  },
  rowDivider: { borderTopWidth: 1, borderTopColor: colors.surface.border },
  rowLeft: { gap: 2, flex: 1 },
});
