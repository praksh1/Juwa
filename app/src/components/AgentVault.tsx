import React, { useMemo, useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import { colors, radius, spacing } from '@juwa/ui';
import type { AgentVaultData, AgentVaultPlayer } from '../api/client';
import { Badge, Button, Card, Txt } from './primitives';

const gc = (value: number) => Math.round(value).toLocaleString('en-US');

export function AgentVault({
  data,
  canAct,
  onDecide,
  onRestore,
}: {
  data: AgentVaultData;
  canAct: boolean;
  onDecide: (
    requestId: string,
    decision: 'approve' | 'reject',
    reason?: string,
  ) => Promise<{ ok: boolean; message?: string }>;
  onRestore: (
    playerId: string,
    amount: number,
  ) => Promise<{ ok: boolean; message?: string }>;
}) {
  const pending = useMemo(
    () => data.requests.filter((request) => request.status === 'pending'),
    [data.requests],
  );
  const saved = useMemo(() => data.players.filter((player) => player.saved > 0), [data.players]);
  const [busy, setBusy] = useState<string | null>(null);
  const [restorePlayer, setRestorePlayer] = useState<AgentVaultPlayer | null>(null);
  const [restoreAmount, setRestoreAmount] = useState('');
  const [notice, setNotice] = useState<{ text: string; good: boolean } | null>(null);
  const parsed = Number(restoreAmount.replace(/\D/g, ''));
  const validRestore =
    restorePlayer !== null && Number.isSafeInteger(parsed) && parsed > 0 && parsed <= restorePlayer.saved;

  const decide = async (requestId: string, decision: 'approve' | 'reject') => {
    setBusy(requestId);
    setNotice(null);
    const result = await onDecide(requestId, decision);
    setBusy(null);
    setNotice({
      text: result.ok
        ? decision === 'approve'
          ? 'GC secured under the player’s name.'
          : 'Request declined and GC returned to the player.'
        : result.message ?? 'Could not update that request.',
      good: result.ok,
    });
  };

  return (
    <Card style={styles.card}>
      <View style={styles.guardrail}>
        <Badge label="PLAYER-OWNED" color={colors.feedback.winBright} />
        <Txt variant="bodySmall" color={colors.text.secondary}>
          Saved GC stay assigned to the named player. They never enter your inventory and cannot
          be sent to somebody else.
        </Txt>
      </View>

      {notice ? (
        <Txt variant="bodySmall" color={notice.good ? colors.feedback.winBright : colors.feedback.loss}>
          {notice.text}
        </Txt>
      ) : null}

      <View style={styles.section}>
        <Txt variant="caption" color={colors.text.muted}>WAITING FOR YOUR CONFIRMATION</Txt>
        {pending.length === 0 ? (
          <Txt variant="bodySmall" color={colors.text.muted}>No pending save requests.</Txt>
        ) : (
          pending.map((request) => (
            <View key={request.id} style={styles.request}>
              <View style={styles.grow}>
                <Txt variant="h3">{request.username ?? 'Player'}</Txt>
                <Txt variant="money" color={colors.gold.light}>{gc(request.amount)} GC</Txt>
                <Txt variant="caption" color={colors.text.muted}>
                  Reserved from this player’s playable balance
                </Txt>
              </View>
              <View style={styles.actions}>
                <Button
                  label="Return"
                  variant="secondary"
                  disabled={!canAct || busy !== null}
                  onPress={() => void decide(request.id, 'reject')}
                  style={styles.action}
                />
                <Button
                  label="Keep safe"
                  disabled={!canAct || busy !== null}
                  loading={busy === request.id}
                  onPress={() => void decide(request.id, 'approve')}
                  style={styles.action}
                />
              </View>
            </View>
          ))
        )}
      </View>

      <View style={styles.section}>
        <Txt variant="caption" color={colors.text.muted}>SAVED BY PLAYER</Txt>
        {saved.length === 0 ? (
          <Txt variant="bodySmall" color={colors.text.muted}>No players have saved GC yet.</Txt>
        ) : (
          saved.map((player) => (
            <View key={player.playerId} style={styles.playerRow}>
              <View style={styles.grow}>
                <Txt variant="bodySmall">{player.username}</Txt>
                <Txt variant="caption" color={colors.text.muted}>
                  Saved {gc(player.saved)} · Pending {gc(player.pending)} · Playable {gc(player.playable)} GC
                </Txt>
              </View>
              <Button
                label="Restore"
                variant="secondary"
                disabled={!canAct}
                onPress={() => {
                  setRestorePlayer(player);
                  setRestoreAmount('');
                  setNotice(null);
                }}
              />
            </View>
          ))
        )}
      </View>

      {restorePlayer ? (
        <View style={styles.restore}>
          <Txt variant="h3">Return GC to {restorePlayer.username}</Txt>
          <Txt variant="bodySmall" color={colors.text.secondary}>
            This moves saved GC back into the same player’s playable balance.
          </Txt>
          <TextInput
            value={restoreAmount}
            onChangeText={(value) => setRestoreAmount(value.replace(/\D/g, ''))}
            placeholder={`Up to ${gc(restorePlayer.saved)} GC`}
            placeholderTextColor={colors.text.muted}
            keyboardType="number-pad"
            inputMode="numeric"
            style={styles.input}
          />
          <View style={styles.actions}>
            <Button
              label="Cancel"
              variant="secondary"
              onPress={() => setRestorePlayer(null)}
              style={styles.action}
            />
            <Button
              label={validRestore ? `Restore ${gc(parsed)} GC` : 'Enter an amount'}
              disabled={!validRestore || busy !== null}
              loading={busy === `restore:${restorePlayer.playerId}`}
              onPress={async () => {
                if (!validRestore) return;
                setBusy(`restore:${restorePlayer.playerId}`);
                const result = await onRestore(restorePlayer.playerId, parsed);
                setBusy(null);
                setNotice({
                  text: result.ok
                    ? `Returned ${gc(parsed)} GC to ${restorePlayer.username}.`
                    : result.message ?? 'Could not restore those GC.',
                  good: result.ok,
                });
                if (result.ok) setRestorePlayer(null);
              }}
              style={styles.action}
            />
          </View>
        </View>
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.lg },
  guardrail: {
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    borderLeftWidth: 3,
    borderLeftColor: colors.feedback.winBright,
    backgroundColor: colors.surface.raised,
  },
  section: { gap: spacing.sm },
  request: {
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.gold.dark,
    backgroundColor: colors.surface.raised,
  },
  playerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.surface.border,
  },
  actions: { flexDirection: 'row', gap: spacing.sm },
  action: { flex: 1 },
  grow: { flex: 1 },
  restore: {
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.gold.dark,
  },
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
});
