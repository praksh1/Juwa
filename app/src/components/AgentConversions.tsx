/**
 * The agent's side of Casino Cash: the queue, the CC balance, and restocking.
 *
 * ## Why the queue is the first thing here
 *
 * A pending request is somebody waiting. Everything else on the agent desk is
 * work the agent chose to start; this is the only part where a player has asked
 * for something and cannot proceed until the agent answers. So it sorts to the
 * top of its own card and says how many there are, and settled requests are
 * collapsed underneath rather than mixed in.
 *
 * ## Why approving shows the arithmetic
 *
 * The agent is agreeing to a number that came from a rate they may not have
 * looked at today, in a direction that changes which of their two balances
 * pays. "Approve" on a row that says only "10 CC" is a button pressed on trust.
 * Each row states both sides, the rate it was priced at, and — for the direction
 * that spends inventory — whether the inventory covers it, BEFORE the agent
 * presses anything.
 *
 * ## The refusal the server will make anyway
 *
 * `approve_conversion` re-checks the inventory inside the transaction that
 * moves the coins, so an agent who is short is refused there regardless of what
 * this component thinks. The check here exists to turn that refusal into
 * something visible in advance, not to be the control.
 */

import React, { useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { colors, radius, spacing } from '@juwa/ui';
import { format, minor } from '@juwa/money';
import { Button, Card, Txt } from './primitives';
import type { AgentConversions as Queue, ConversionRequest } from '../api/client';

export interface AgentConversionsProps {
  data: Queue;
  onDecide: (
    requestId: string,
    decision: 'approve' | 'reject',
  ) => Promise<{ ok: boolean; message?: string }>;
  onRedeem: (ccAmount: number) => Promise<{ ok: boolean; gcAmount?: number; message?: string }>;
  /** False while the agent is pending or suspended: they may look, not act. */
  canAct: boolean;
}

export function AgentConversions({ data, onDecide, onRedeem, canAct }: AgentConversionsProps) {
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ text: string; good: boolean } | null>(null);
  const [redeemUnits, setRedeemUnits] = useState(1);

  const pending = data.requests.filter((r) => r.status === 'pending');
  const settled = data.requests.filter((r) => r.status !== 'pending').slice(0, 8);

  const decide = useCallback(
    async (request: ConversionRequest, decision: 'approve' | 'reject') => {
      setBusy(request.id);
      setNotice(null);
      const result = await onDecide(request.id, decision);
      setBusy(null);
      setNotice(
        result.ok
          ? {
              text:
                decision === 'approve'
                  ? `Approved. ${request.username ?? 'The player'} now has ${
                      request.direction === 'gc_to_cc'
                        ? format(minor(request.ccAmount), 'CC')
                        : format(minor(request.gcAmount), 'GC')
                    } more.`
                  : 'Request declined. Nothing moved.',
              good: true,
            }
          : { text: result.message ?? 'Could not settle that request', good: false },
      );
    },
    [onDecide],
  );

  const redeem = useCallback(async () => {
    setBusy('redeem');
    setNotice(null);
    const result = await onRedeem(redeemUnits);
    setBusy(null);
    setNotice(
      result.ok
        ? {
            text: `Redeemed ${format(minor(redeemUnits), 'CC')} for ${format(
              minor(result.gcAmount ?? 0),
              'GC',
            )} of inventory.`,
            good: true,
          }
        : { text: result.message ?? 'Could not redeem that', good: false },
    );
    if (result.ok) setRedeemUnits(1);
  }, [onRedeem, redeemUnits]);

  return (
    <Card style={styles.card}>
      {/*
        Two balances, side by side, and labelled so they cannot be confused.

        An agent holds GC inventory and CC, and they buy each other. Showing
        one without the other is how an agent approves a conversion they cannot
        fund and finds out from an error message.
      */}
      <View style={styles.balances}>
        <View style={styles.balance}>
          <Txt variant="caption" color={colors.text.muted}>
            GC INVENTORY
          </Txt>
          <Txt variant="h3" color={colors.gold.light}>
            {format(minor(data.wallet.gc), 'GC')}
          </Txt>
        </View>
        <View style={styles.balance}>
          <Txt variant="caption" color={colors.text.muted}>
            CASINO CASH
          </Txt>
          <Txt variant="h3" color={colors.gold.light}>
            {format(minor(data.wallet.cc), 'CC')}
          </Txt>
        </View>
      </View>

      <View style={styles.rates}>
        <Txt variant="caption" color={colors.text.muted}>
          With players 1 CC = {format(minor(data.rates.playerAgent), 'GC')}
        </Txt>
        <Txt variant="caption" color={colors.text.muted}>
          With the operator 1 CC = {format(minor(data.rates.agentOperator), 'GC')}
        </Txt>
      </View>

      {notice ? (
        <Txt
          variant="caption"
          color={notice.good ? colors.feedback.winBright : colors.feedback.loss}
        >
          {notice.text}
        </Txt>
      ) : null}

      {/* --------------------------------------------------------- the queue */}

      <Txt variant="caption" color={colors.text.muted} style={styles.heading}>
        {pending.length
          ? `${pending.length} WAITING FOR YOU`
          : 'NOTHING WAITING'}
      </Txt>

      {pending.map((request) => (
        <Request
          key={request.id}
          request={request}
          inventory={data.wallet.gc}
          cc={data.wallet.cc}
          busy={busy === request.id}
          disabled={!canAct || busy !== null}
          onDecide={(decision) => void decide(request, decision)}
        />
      ))}

      {/* ------------------------------------------------------ restocking */}

      <View style={styles.restock}>
        <Txt variant="caption" color={colors.text.muted} style={styles.heading}>
          BUY INVENTORY WITH CC
        </Txt>
        <Txt variant="caption" color={colors.text.muted}>
          Your Casino Cash converts to Gold Coin inventory at the operator rate. This is how you
          restock when a player conversion has emptied you out.
        </Txt>
        <View style={styles.stepper}>
          <Step
            label="−"
            onPress={() => setRedeemUnits((n) => Math.max(1, n - 1))}
            disabled={redeemUnits <= 1 || busy !== null}
          />
          <View style={styles.amount}>
            <Txt variant="money" color={colors.gold.light}>
              {format(minor(redeemUnits), 'CC')}
            </Txt>
            <Txt variant="caption" color={colors.text.muted}>
              buys {format(minor(redeemUnits * data.rates.agentOperator), 'GC')}
            </Txt>
          </View>
          <Step
            label="+"
            onPress={() => setRedeemUnits((n) => Math.min(Math.max(1, data.wallet.cc), n + 1))}
            disabled={redeemUnits >= data.wallet.cc || busy !== null}
          />
        </View>
        <Button
          label={busy === 'redeem' ? 'Redeeming…' : 'Redeem for inventory'}
          variant="secondary"
          onPress={() => void redeem()}
          disabled={!canAct || busy !== null || data.wallet.cc < redeemUnits}
        />
      </View>

      {/* --------------------------------------------------------- history */}

      {settled.length ? (
        <View style={styles.history}>
          <Txt variant="caption" color={colors.text.muted} style={styles.heading}>
            RECENTLY SETTLED
          </Txt>
          {settled.map((request) => (
            <View key={request.id} style={styles.settledRow}>
              <View style={styles.rowLeft}>
                <Txt variant="caption">
                  {request.username ?? 'Player'} — {describe(request)}
                </Txt>
                <Txt
                  variant="caption"
                  color={
                    request.status === 'approved' ? colors.feedback.win : colors.text.muted
                  }
                >
                  {request.status}
                  {request.reason ? ` — ${request.reason}` : ''}
                </Txt>
              </View>
            </View>
          ))}
        </View>
      ) : null}

      {data.redemptions.length ? (
        <View style={styles.history}>
          <Txt variant="caption" color={colors.text.muted} style={styles.heading}>
            YOUR OPERATOR REDEMPTIONS
          </Txt>
          {data.redemptions.slice(0, 5).map((row) => (
            <View key={row.id} style={styles.settledRow}>
              <Txt variant="caption">
                {format(minor(row.ccAmount), 'CC')} → {format(minor(row.gcAmount), 'GC')}
              </Txt>
              <Txt variant="caption" color={colors.text.muted}>
                at {format(minor(row.gcPerCc), 'GC')}
              </Txt>
            </View>
          ))}
        </View>
      ) : null}
    </Card>
  );
}

/** "100,000 GC → 10 CC", in the direction the request actually goes. */
function describe(request: ConversionRequest): string {
  return request.direction === 'gc_to_cc'
    ? `${format(minor(request.gcAmount), 'GC')} → ${format(minor(request.ccAmount), 'CC')}`
    : `${format(minor(request.ccAmount), 'CC')} → ${format(minor(request.gcAmount), 'GC')}`;
}

function Request({
  request,
  inventory,
  cc,
  busy,
  disabled,
  onDecide,
}: {
  request: ConversionRequest;
  inventory: number;
  cc: number;
  busy: boolean;
  disabled: boolean;
  onDecide: (decision: 'approve' | 'reject') => void;
}) {
  /*
   * Which of the agent's balances pays, and whether it can.
   *
   * `gc_to_cc` spends the agent's CC and takes in GC; `cc_to_gc` spends the
   * agent's GC inventory and takes in CC. Getting this backwards would show an
   * agent a green tick and then have the server refuse them, which is the worst
   * of both.
   */
  const spendsInventory = request.direction === 'cc_to_gc';
  const short = spendsInventory ? inventory < request.gcAmount : cc < request.ccAmount;

  return (
    <View style={styles.request}>
      <View style={styles.rowLeft}>
        <Txt variant="bodySmall">{request.username ?? 'Player'}</Txt>
        <Txt variant="h3" color={colors.gold.light}>
          {describe(request)}
        </Txt>
        <Txt variant="caption" color={colors.text.muted}>
          at 1 CC = {format(minor(request.gcPerCc), 'GC')} ·{' '}
          {spendsInventory
            ? `costs you ${format(minor(request.gcAmount), 'GC')} of inventory`
            : `costs you ${format(minor(request.ccAmount), 'CC')}`}
        </Txt>
        {short ? (
          <Txt variant="caption" color={colors.feedback.loss}>
            {spendsInventory
              ? `You have ${format(minor(inventory), 'GC')}. Redeem CC below to restock.`
              : `You have ${format(minor(cc), 'CC')}.`}
          </Txt>
        ) : null}
      </View>

      {busy ? (
        <ActivityIndicator color={colors.gold.default} />
      ) : (
        <View style={styles.decide}>
          <Pressable
            onPress={() => onDecide('approve')}
            disabled={disabled || short}
            accessibilityRole="button"
            accessibilityLabel={`Approve ${describe(request)} for ${request.username ?? 'player'}`}
            style={[styles.approve, (disabled || short) && styles.dim]}
          >
            <Txt variant="caption" color="#2A1B02" style={styles.decideLabel}>
              APPROVE
            </Txt>
          </Pressable>
          <Pressable
            onPress={() => onDecide('reject')}
            disabled={disabled}
            accessibilityRole="button"
            accessibilityLabel={`Decline ${describe(request)} for ${request.username ?? 'player'}`}
            style={[styles.reject, disabled && styles.dim]}
          >
            <Txt variant="caption" color={colors.text.secondary} style={styles.decideLabel}>
              DECLINE
            </Txt>
          </Pressable>
        </View>
      )}
    </View>
  );
}

function Step({
  label,
  onPress,
  disabled,
}: {
  label: string;
  onPress: () => void;
  disabled: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label === '+' ? 'More Casino Cash' : 'Less Casino Cash'}
      style={[styles.step, disabled && styles.dim]}
    >
      <Txt variant="h3" color={disabled ? colors.text.muted : colors.gold.default}>
        {label}
      </Txt>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.md },
  balances: { flexDirection: 'row', gap: spacing.md },
  balance: { flex: 1, gap: 2 },
  rates: { gap: 2 },
  heading: { letterSpacing: 1.2, fontWeight: '800' },
  request: {
    gap: spacing.sm,
    paddingVertical: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.surface.border,
  },
  rowLeft: { gap: 2, flex: 1 },
  decide: { flexDirection: 'row', gap: spacing.sm },
  approve: {
    flex: 1,
    paddingVertical: spacing.sm,
    borderRadius: radius.sm,
    alignItems: 'center',
    backgroundColor: colors.gold.default,
  },
  reject: {
    flex: 1,
    paddingVertical: spacing.sm,
    borderRadius: radius.sm,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.surface.border,
  },
  decideLabel: { letterSpacing: 1.4, fontWeight: '900' },
  dim: { opacity: 0.4 },
  restock: {
    gap: spacing.sm,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.surface.border,
  },
  stepper: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  amount: { alignItems: 'center', gap: 2, flex: 1 },
  step: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.surface.border,
  },
  history: {
    gap: spacing.xs,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.surface.border,
  },
  settledRow: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm },
});
