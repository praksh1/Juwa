import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { colors, radius, spacing } from '@juwa/ui';
import type { VaultRequest, WalletResponse } from '../api/client';
import { Badge, Button, Card, SectionHeader, Txt } from './primitives';

const gc = (value: number) => Math.round(value).toLocaleString('en-US');

function requestLabel(request: VaultRequest): string {
  if (request.status === 'pending') return 'Waiting for agent approval';
  if (request.status === 'saved') return `${gc(request.remainingAmount)} GC saved for later`;
  if (request.status === 'restored') return 'Returned to playable balance';
  if (request.status === 'cancelled') return 'Cancelled by you';
  return 'Returned by agent';
}

export function AgentVaultPanel({
  data,
  busy,
  onSave,
  onCancel,
}: {
  data: WalletResponse;
  busy: boolean;
  onSave: (amount: number) => Promise<void>;
  onCancel: (requestId: string) => Promise<void>;
}) {
  const [amount, setAmount] = useState('');
  const parsed = Number(amount.replace(/\D/g, ''));
  const pending = data.requests.find((request) => request.status === 'pending');
  const recent = useMemo(() => data.requests.slice(0, 6), [data.requests]);
  const valid = Number.isSafeInteger(parsed) && parsed > 0 && parsed <= data.wallet.playable;

  return (
    <View>
      <SectionHeader title="Agent Vault" />
      <Card style={styles.card}>
        <View style={styles.balanceRow}>
          <View style={styles.balanceCell}>
            <Txt variant="caption" color={colors.text.muted}>PLAYABLE</Txt>
            <Txt variant="money" color={colors.gold.light}>{gc(data.wallet.playable)} GC</Txt>
          </View>
          <View style={styles.balanceCell}>
            <Txt variant="caption" color={colors.text.muted}>PENDING</Txt>
            <Txt variant="money" color={colors.gold.default}>{gc(data.wallet.pending)} GC</Txt>
          </View>
          <View style={styles.balanceCell}>
            <Txt variant="caption" color={colors.text.muted}>SAVED</Txt>
            <Txt variant="money" color={colors.feedback.winBright}>{gc(data.wallet.saved)} GC</Txt>
          </View>
        </View>

        {data.agent ? (
          <>
            <View style={styles.agentLine}>
              <Badge label="NAMED CUSTODY" color={colors.feedback.winBright} />
              <Txt variant="bodySmall">Held with {data.agent.displayName}</Txt>
            </View>
            <Txt variant="bodySmall" color={colors.text.secondary}>
              Move GC out of play and keep it under your name for a future visit. Your agent
              cannot sell these saved coins to anyone else.
            </Txt>

            {!pending ? (
              <View style={styles.form}>
                <TextInput
                  value={amount}
                  onChangeText={(value) => setAmount(value.replace(/\D/g, ''))}
                  placeholder="GC to save"
                  placeholderTextColor={colors.text.muted}
                  keyboardType="number-pad"
                  inputMode="numeric"
                  style={styles.input}
                  accessibilityLabel="Gold Coins to save for later"
                />
                {parsed > data.wallet.playable ? (
                  <Txt variant="caption" color={colors.feedback.loss}>
                    You have {gc(data.wallet.playable)} playable GC.
                  </Txt>
                ) : null}
                <Button
                  label={valid ? `Save ${gc(parsed)} GC for later` : 'Enter an amount'}
                  disabled={!valid || busy}
                  loading={busy}
                  onPress={async () => {
                    await onSave(parsed);
                    setAmount('');
                  }}
                />
              </View>
            ) : (
              <View style={styles.pendingBox}>
                <View style={styles.pendingTop}>
                  <View>
                    <Txt variant="caption" color={colors.text.muted}>WAITING FOR AGENT</Txt>
                    <Txt variant="h3" color={colors.gold.light}>{gc(pending.amount)} GC</Txt>
                  </View>
                  <Pressable
                    accessibilityRole="button"
                    disabled={busy}
                    onPress={() => void onCancel(pending.id)}
                    style={styles.cancel}
                  >
                    <Txt variant="bodySmall" color={colors.feedback.loss}>Cancel request</Txt>
                  </Pressable>
                </View>
                <Txt variant="caption" color={colors.text.muted}>
                  These GC are reserved now. Cancelling before approval puts them straight back
                  into your playable balance.
                </Txt>
              </View>
            )}
          </>
        ) : (
          <Txt variant="bodySmall" color={colors.text.muted}>
            Agent Vault becomes available when your account is linked to an agent.
          </Txt>
        )}

        <View style={styles.notice}>
          <Txt variant="caption" color={colors.text.secondary}>
            SAVE FOR LATER — NOT CASH
          </Txt>
          <Txt variant="caption" color={colors.text.muted}>
            Saved GC have no cash value and are not a withdrawal, payout, deposit, or bank account.
          </Txt>
        </View>

        {recent.length ? (
          <View style={styles.history}>
            <Txt variant="caption" color={colors.text.muted}>RECENT VAULT ACTIVITY</Txt>
            {recent.map((request) => (
              <View key={request.id} style={styles.historyRow}>
                <View style={styles.grow}>
                  <Txt variant="bodySmall">{gc(request.amount)} GC</Txt>
                  <Txt variant="caption" color={colors.text.muted}>{requestLabel(request)}</Txt>
                </View>
                <Badge
                  label={request.status.toUpperCase()}
                  color={request.status === 'saved' ? colors.feedback.winBright : colors.text.muted}
                />
              </View>
            ))}
          </View>
        ) : null}
      </Card>
    </View>
  );
}

export function AgentVaultPanelSkeleton() {
  return (
    <View>
      <SectionHeader title="Agent Vault" />
      <Card style={styles.card}>
        <Txt variant="bodySmall" color={colors.text.muted}>Loading saved GC…</Txt>
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.lg, overflow: 'hidden' },
  balanceRow: { flexDirection: 'row', gap: spacing.xs },
  balanceCell: {
    flex: 1,
    minWidth: 0,
    padding: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.surface.border,
    backgroundColor: colors.surface.raised,
    gap: 3,
  },
  agentLine: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
  form: { gap: spacing.sm },
  input: {
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.gold.dark,
    color: colors.text.primary,
    backgroundColor: colors.surface.raised,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    fontSize: 18,
  },
  pendingBox: {
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.gold.dark,
    backgroundColor: colors.surface.raised,
    gap: spacing.sm,
  },
  pendingTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  cancel: { padding: spacing.sm },
  notice: {
    gap: 4,
    padding: spacing.md,
    borderRadius: radius.md,
    borderLeftWidth: 3,
    borderLeftColor: colors.gold.default,
    backgroundColor: colors.surface.raised,
  },
  history: { gap: spacing.sm },
  historyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.surface.border,
  },
  grow: { flex: 1 },
});
