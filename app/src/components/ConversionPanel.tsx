/**
 * The Casino Cash panel: two balances, the rate, and the two conversions.
 *
 * ## Why this is one component and not two
 *
 * GC -> CC and CC -> GC are the same transaction read in opposite directions,
 * and a player deciding between them is comparing one against the other. Two
 * separate cards would put the comparison on two screens and force them to
 * remember a number while they scrolled.
 *
 * ## The rule this whole screen exists to make legible
 *
 * A conversion is a REQUEST. Nothing moves when the player presses the button;
 * their agent has to approve it, and until then both balances are exactly what
 * they were. Every state of this panel says so, because the alternative — a
 * button that appears to spend coins and then does not — is the same class of
 * fault as a win chime that fires before the win.
 *
 * ## What is deliberately absent
 *
 * No currency symbol on CC, ever. It is not dollars and it is not redeemable
 * for dollars, and the moment it is drawn as though it were, every claim this
 * product makes about being a social casino stops being true. `format(x, 'CC')`
 * is used everywhere, exactly as `format(x, 'GC')` is.
 *
 * There is also no "convert to cash", no withdrawal, and no way to send CC to
 * another player. Those are not missing features.
 */

import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { colors, radius, spacing } from '@juwa/ui';
import { format, minor } from '@juwa/money';
import { Button, Card, Txt } from './primitives';
import { PlayApiError, type ConversionRequest, type WalletResponse } from '../api/client';

/** How a status reads to the person waiting on it. */
const STATUS_LABEL: Record<ConversionRequest['status'], string> = {
  pending: 'Waiting for your agent',
  approved: 'Approved',
  rejected: 'Declined',
  cancelled: 'Cancelled',
};

const STATUS_COLOUR: Record<ConversionRequest['status'], string> = {
  pending: colors.gold.default,
  approved: colors.feedback.win,
  rejected: colors.text.muted,
  cancelled: colors.text.muted,
};

export interface ConversionPanelProps {
  data: WalletResponse;
  busy: boolean;
  onRequest: (direction: 'gc_to_cc' | 'cc_to_gc', amount: number) => Promise<void>;
  onCancel: (requestId: string) => Promise<void>;
}

export function ConversionPanel({ data, busy, onRequest, onCancel }: ConversionPanelProps) {
  const [direction, setDirection] = useState<'gc_to_cc' | 'cc_to_gc'>('gc_to_cc');
  const [units, setUnits] = useState(1);
  const [error, setError] = useState<string | null>(null);

  const rate = data.rate;
  const pending = data.requests.filter((r) => r.status === 'pending');
  const settled = data.requests.filter((r) => r.status !== 'pending').slice(0, 6);
  const openInDirection = pending.find((r) => r.direction === direction);

  /*
   * The player picks a number of CC, not a number of GC, in BOTH directions.
   *
   * CC is the whole unit here — a rate of 10,000 means a player redeeming
   * 105,000 GC is asking for 10.5 CC, which does not exist. Choosing in CC
   * makes every amount on the screen exact by construction, so the server never
   * has to refuse one for being unrepresentable and the player never has to
   * work out what a valid figure would have been.
   */
  const gc = units * rate;
  const cc = units;

  const affordable = useMemo(() => {
    if (rate <= 0) return 0;
    return direction === 'gc_to_cc' ? Math.floor(data.wallet.gc / rate) : data.wallet.cc;
  }, [direction, data.wallet.gc, data.wallet.cc, rate]);

  const tooMuch = units > affordable;
  const blocked = busy || rate <= 0 || units < 1 || tooMuch || Boolean(openInDirection);

  const submit = useCallback(async () => {
    setError(null);
    try {
      await onRequest(direction, direction === 'gc_to_cc' ? gc : cc);
      setUnits(1);
    } catch (caught) {
      setError(caught instanceof PlayApiError ? caught.message : 'Could not send that request');
    }
  }, [onRequest, direction, gc, cc]);

  const cancel = useCallback(
    async (id: string) => {
      setError(null);
      try {
        await onCancel(id);
      } catch (caught) {
        setError(caught instanceof PlayApiError ? caught.message : 'Could not cancel that');
      }
    },
    [onCancel],
  );

  /*
   * No agent, no conversions — and SAY so rather than showing a dead form.
   *
   * A player who signed up directly has no agent, which is a normal state and
   * not an error. The panel still shows their CC balance, because they may hold
   * some from before a reassignment.
   */
  if (!data.agent) {
    return (
      <Card style={styles.card}>
        <Header cc={data.wallet.cc} />
        <Txt variant="bodySmall" color={colors.text.muted} style={styles.centred}>
          Casino Cash is converted through an agent, and your account is not linked to one.
        </Txt>
      </Card>
    );
  }

  return (
    <Card style={styles.card}>
      <Header cc={data.wallet.cc} />

      {/* Which way round. Two buttons rather than a swap arrow: an arrow that
          silently reverses the meaning of every number below it is the kind of
          control people press twice to check what it did. */}
      <View style={styles.toggle}>
        {(
          [
            ['gc_to_cc', 'Redeem GC'],
            ['cc_to_gc', 'Convert CC'],
          ] as const
        ).map(([value, label]) => (
          <Pressable
            key={value}
            onPress={() => {
              setDirection(value);
              setUnits(1);
              setError(null);
            }}
            accessibilityRole="button"
            accessibilityState={{ selected: direction === value }}
            style={[styles.toggleButton, direction === value && styles.toggleActive]}
          >
            <Txt
              variant="bodySmall"
              color={direction === value ? colors.surface.base : colors.text.secondary}
            >
              {label}
            </Txt>
          </Pressable>
        ))}
      </View>

      {rate <= 0 ? (
        <Txt variant="bodySmall" color={colors.text.muted} style={styles.centred}>
          No exchange rate is set up yet. Your agent can tell you when it is.
        </Txt>
      ) : (
        <>
          {/*
            The amount, in CC, with the GC it corresponds to underneath.

            A stepper rather than a text field. On a phone a numeric keyboard
            over a form is most of the screen, and the values here are small
            whole numbers — the difference between 3 CC and 4 CC is one tap, and
            there is no way to type 105,000 and be told it is not a valid
            figure.
          */}
          <View style={styles.stepper}>
            <Step label="−" onPress={() => setUnits((n) => Math.max(1, n - 1))} disabled={units <= 1} />
            <View style={styles.amount}>
              <Txt variant="moneyLarge" color={colors.gold.light}>
                {format(minor(cc), 'CC')}
              </Txt>
              <Txt variant="caption" color={colors.text.muted}>
                {direction === 'gc_to_cc' ? 'for' : 'gets you'} {format(minor(gc), 'GC')}
              </Txt>
            </View>
            <Step
              label="+"
              onPress={() => setUnits((n) => Math.min(affordable || 1, n + 1))}
              disabled={units >= affordable}
            />
          </View>

          <View style={styles.rateRow}>
            <Txt variant="caption" color={colors.text.muted}>
              RATE
            </Txt>
            <Txt variant="caption" color={colors.text.secondary}>
              1 CC = {format(minor(rate), 'GC')}
            </Txt>
          </View>

          {/* The most important sentence on the screen. */}
          <Txt variant="caption" color={colors.text.muted} style={styles.centred}>
            {direction === 'gc_to_cc'
              ? `You are asking ${data.agent.displayName} for ${format(minor(cc), 'CC')} in exchange for ${format(minor(gc), 'GC')}.`
              : `You are asking ${data.agent.displayName} for ${format(minor(gc), 'GC')} in exchange for ${format(minor(cc), 'CC')}.`}{' '}
            Nothing moves until they approve it.
          </Txt>

          {tooMuch ? (
            <Txt variant="caption" color={colors.feedback.error} style={styles.centred}>
              {direction === 'gc_to_cc'
                ? `You have ${format(minor(data.wallet.gc), 'GC')}, which is ${format(minor(affordable), 'CC')} at this rate.`
                : `You have ${format(minor(data.wallet.cc), 'CC')}.`}
            </Txt>
          ) : null}

          {openInDirection ? (
            <Txt variant="caption" color={colors.gold.default} style={styles.centred}>
              You already have a request of this kind waiting. Cancel it below to send a different one.
            </Txt>
          ) : null}

          {error ? (
            <Txt variant="caption" color={colors.feedback.error} style={styles.centred}>
              {error}
            </Txt>
          ) : null}

          <Button
            label={busy ? 'Sending…' : 'Send request'}
            onPress={() => void submit()}
            disabled={blocked}
          />
        </>
      )}

      {pending.length ? (
        <View style={styles.list}>
          <Txt variant="caption" color={colors.text.muted} style={styles.listTitle}>
            WAITING
          </Txt>
          {pending.map((request) => (
            <Row key={request.id} request={request} onCancel={() => void cancel(request.id)} />
          ))}
        </View>
      ) : null}

      {settled.length ? (
        <View style={styles.list}>
          <Txt variant="caption" color={colors.text.muted} style={styles.listTitle}>
            RECENT
          </Txt>
          {settled.map((request) => (
            <Row key={request.id} request={request} />
          ))}
        </View>
      ) : null}
    </Card>
  );
}

function Header({ cc }: { cc: number }) {
  return (
    <View style={styles.header}>
      <Txt variant="caption" color={colors.text.muted}>
        CASINO CASH
      </Txt>
      {/* `format(x, 'CC')`, never a currency symbol. See the note at the top. */}
      <Txt variant="moneyLarge" color={colors.gold.light}>
        {format(minor(cc), 'CC')}
      </Txt>
      <Txt variant="caption" color={colors.text.muted} style={styles.centred}>
        Casino Cash converts to Gold Coins and to nothing else. It has no cash value.
      </Txt>
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
      accessibilityLabel={label === '+' ? 'Increase amount' : 'Decrease amount'}
      style={[styles.step, disabled && styles.stepDim]}
    >
      <Txt variant="h3" color={disabled ? colors.text.muted : colors.gold.default}>
        {label}
      </Txt>
    </Pressable>
  );
}

/**
 * One request, as the player sees it.
 *
 * The rate is shown per row rather than only at the top, because a settled
 * request keeps the rate it was priced at forever — and a player comparing an
 * old row against today's rate needs to see why the numbers differ.
 */
function Row({ request, onCancel }: { request: ConversionRequest; onCancel?: () => void }) {
  const outgoing = request.direction === 'gc_to_cc';
  return (
    <View style={styles.row}>
      <View style={styles.rowLeft}>
        <Txt variant="bodySmall">
          {outgoing
            ? `${format(minor(request.gcAmount), 'GC')} → ${format(minor(request.ccAmount), 'CC')}`
            : `${format(minor(request.ccAmount), 'CC')} → ${format(minor(request.gcAmount), 'GC')}`}
        </Txt>
        <Txt variant="caption" color={STATUS_COLOUR[request.status]}>
          {STATUS_LABEL[request.status]}
          {request.reason ? ` — ${request.reason}` : ''}
        </Txt>
        <Txt variant="caption" color={colors.text.muted}>
          at 1 CC = {format(minor(request.gcPerCc), 'GC')}
        </Txt>
      </View>
      {onCancel ? (
        <Pressable onPress={onCancel} accessibilityRole="button" style={styles.cancel}>
          <Txt variant="caption" color={colors.text.secondary}>
            Cancel
          </Txt>
        </Pressable>
      ) : null}
    </View>
  );
}

/** The panel's loading state, so the wallet does not jump when it arrives. */
export function ConversionPanelSkeleton() {
  return (
    <Card style={[styles.card, styles.skeleton]}>
      <ActivityIndicator color={colors.gold.default} />
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: spacing.md },
  skeleton: { minHeight: 180, alignItems: 'center', justifyContent: 'center' },
  header: { alignItems: 'center', gap: 2 },
  centred: { textAlign: 'center' },
  toggle: {
    flexDirection: 'row',
    gap: spacing.xs,
    padding: 3,
    borderRadius: radius.md,
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  toggleButton: {
    flex: 1,
    paddingVertical: spacing.sm,
    alignItems: 'center',
    borderRadius: radius.sm,
  },
  toggleActive: { backgroundColor: colors.gold.default },
  stepper: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  amount: { alignItems: 'center', gap: 2, flex: 1 },
  step: {
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.surface.border,
  },
  stepDim: { opacity: 0.4 },
  rateRow: { flexDirection: 'row', justifyContent: 'space-between' },
  list: { gap: spacing.xs },
  listTitle: { letterSpacing: 1.2 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.surface.border,
  },
  rowLeft: { gap: 2, flex: 1 },
  cancel: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.surface.border,
  },
});
