import React, { useMemo, useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import { colors, radius, spacing } from '@juwa/ui';
import type { AgentVaultData, AgentVaultPlayer } from '../api/client';
import { Badge, Button, Card, Txt } from './primitives';

const gc = (value: number) => Math.round(value).toLocaleString('en-US');
const day = (value: string | null) =>
  value ? new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : 'Unknown';

export function AgentVault({
  data,
  canAct,
  onDecide,
  onRestore,
  onDormantReturn,
  onCancelDormantReturn,
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
  onDormantReturn: (
    playerId: string,
    amount: number,
  ) => Promise<{ ok: boolean; message?: string }>;
  onCancelDormantReturn: (requestId: string) => Promise<{ ok: boolean; message?: string }>;
}) {
  const pending = useMemo(
    () => data.requests.filter((request) => request.status === 'pending'),
    [data.requests],
  );
  const saved = useMemo(() => data.players.filter((player) => player.saved > 0), [data.players]);
  const returnWarnings = useMemo(
    () => data.returns.filter((request) => request.status === 'warning'),
    [data.returns],
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [restorePlayer, setRestorePlayer] = useState<AgentVaultPlayer | null>(null);
  const [returnToInventory, setReturnToInventory] = useState(false);
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
          be sent to somebody else while the player is active.
        </Txt>
      </View>

      <View style={styles.warningRule}>
        <Badge label="DORMANT PLAYER RULE" color={colors.gold.light} />
        <Txt variant="bodySmall" color={colors.text.secondary}>
          After {data.policy.inactiveDays} days without player activity, you may request a return
          to your inventory. The GC remain reserved for another {data.policy.warningDays}-day
          warning period and an operator must approve it.
          If the player returns, the warning is cancelled automatically.
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
        <Txt variant="caption" color={colors.text.muted}>RETURN WARNINGS</Txt>
        {returnWarnings.length === 0 ? (
          <Txt variant="bodySmall" color={colors.text.muted}>No dormant-player returns are pending.</Txt>
        ) : (
          returnWarnings.map((request) => (
            <View key={request.id} style={styles.request}>
              <View style={styles.grow}>
                <Txt variant="h3">{request.username}</Txt>
                <Txt variant="money" color={colors.gold.light}>{gc(request.amount)} GC reserved</Txt>
                <Txt variant="caption" color={colors.text.muted}>
                  Operator may approve after {day(request.eligibleAt)}
                </Txt>
              </View>
              <Button
                label="Cancel return"
                variant="secondary"
                disabled={!canAct || busy !== null}
                loading={busy === `cancel-return:${request.id}`}
                onPress={async () => {
                  setBusy(`cancel-return:${request.id}`);
                  const result = await onCancelDormantReturn(request.id);
                  setBusy(null);
                  setNotice({
                    text: result.ok
                      ? `${gc(request.amount)} GC remain saved for ${request.username}.`
                      : result.message ?? 'Could not cancel that return.',
                    good: result.ok,
                  });
                }}
              />
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
                  Saved {gc(player.saved)} · Return warning {gc(player.returnPending)} · Playable {gc(player.playable)} GC
                </Txt>
                <Txt variant="caption" color={player.dormantEligible ? colors.gold.light : colors.text.muted}>
                  Last active {day(player.lastSeenAt)} · {player.dormantEligible
                    ? 'eligible for dormant return'
                    : `eligible ${day(player.dormantEligibleAt)}`}
                </Txt>
              </View>
              <View style={styles.rowActions}>
                <Button
                  label="To player"
                  variant="secondary"
                  disabled={!canAct}
                  onPress={() => {
                    setRestorePlayer(player);
                    setReturnToInventory(false);
                    setRestoreAmount('');
                    setNotice(null);
                  }}
                />
                {player.dormantEligible ? (
                  <Button
                    label="To inventory"
                    variant="secondary"
                    disabled={!canAct}
                    onPress={() => {
                      setRestorePlayer(player);
                      setReturnToInventory(true);
                      setRestoreAmount('');
                      setNotice(null);
                    }}
                  />
                ) : null}
              </View>
            </View>
          ))
        )}
      </View>

      {restorePlayer ? (
        <View style={styles.restore}>
          <Txt variant="h3">
            {returnToInventory ? 'Start dormant-player return' : `Return GC to ${restorePlayer.username}`}
          </Txt>
          <Txt variant="bodySmall" color={colors.text.secondary}>
            {returnToInventory
              ? `This reserves ${restorePlayer.username}’s GC for a ${data.policy.warningDays}-day warning. It does not enter your inventory until an operator approves it after the warning.`
              : 'This moves saved GC back into the same player’s playable balance.'}
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
              label={validRestore
                ? returnToInventory
                  ? `Start warning for ${gc(parsed)} GC`
                  : `Restore ${gc(parsed)} GC`
                : 'Enter an amount'}
              disabled={!validRestore || busy !== null}
              loading={busy === `restore:${restorePlayer.playerId}`}
              onPress={async () => {
                if (!validRestore) return;
                setBusy(`restore:${restorePlayer.playerId}`);
                const result = returnToInventory
                  ? await onDormantReturn(restorePlayer.playerId, parsed)
                  : await onRestore(restorePlayer.playerId, parsed);
                setBusy(null);
                setNotice({
                  text: result.ok
                    ? returnToInventory
                      ? `Started the ${data.policy.warningDays}-day warning for ${gc(parsed)} GC. An operator must approve the final return.`
                      : `Returned ${gc(parsed)} GC to ${restorePlayer.username}.`
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
  warningRule: {
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    borderLeftWidth: 3,
    borderLeftColor: colors.gold.light,
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
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.surface.border,
  },
  rowActions: { flexDirection: 'row', gap: spacing.sm, flexWrap: 'wrap' },
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
