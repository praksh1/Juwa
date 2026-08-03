import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { colors, motion, radius, spacing } from '@juwa/ui';
import { format, minor } from '@juwa/money';
import { betOptions, suggestedBet } from '@juwa/economy';
import { Button, Card, Txt } from '../components/primitives';
import { Reel } from '../components/Reel';
import {
  PlayApiError,
  createPlayApi,
  type PlayApi,
  type RoundResponse,
  type SlotsState,
  USE_DEMO_API,
} from '../api/client';

const GAME_ID = 'juwa-classic-slots';
const MIN_BET = minor(20);
const MAX_BET = minor(50_000);
const REELS = 5;

const IDLE_GRID: string[][] = Array.from({ length: REELS }, () => [
  'CHERRY',
  'BAR',
  'LEMON',
]);

/**
 * The slot machine.
 *
 * THE IMPORTANT PART: this screen decides nothing. It sends a stake, receives a
 * finished result from the server, and animates it. The reels are already
 * spinning while the response is in flight, so the network round trip hides
 * inside the animation the player would be watching anyway — the spin *feels*
 * instant even though the outcome was computed 200ms away.
 *
 * If the request fails, the reels stop on the previous grid and the error is
 * shown. They never stop on a guess.
 */
export function SlotsScreen() {
  const api = useRef<PlayApi>(createPlayApi()).current;

  const [balance, setBalance] = useState(minor(0));
  const [bet, setBet] = useState(minor(2_000));
  const [spinning, setSpinning] = useState(false);
  const [round, setRound] = useState<RoundResponse | null>(null);
  const [grid, setGrid] = useState<string[][]>(IDLE_GRID);
  const [error, setError] = useState<string | null>(null);
  const spinToken = useRef(0);

  useEffect(() => {
    let alive = true;
    api
      .getBalance()
      .then((result) => {
        if (!alive) return;
        const current = minor(result.balance);
        setBalance(current);
        setBet(suggestedBet(current, MIN_BET, MAX_BET));
      })
      .catch(() => setError('Could not load your balance'));
    return () => {
      alive = false;
    };
  }, [api]);

  const options = useMemo(() => betOptions(balance, MIN_BET, MAX_BET), [balance]);

  const settlement = round?.settlement;
  const slots = round?.state as SlotsState | undefined;
  const winningRows = useMemo(() => {
    if (spinning || !slots) return [];
    // The payline index doubles as a row index for the three straight lines;
    // richer zig-zag highlighting arrives with the win-line overlay.
    return slots.baseSpin.lineWins.map((win) => win.line).filter((line) => line < 3);
  }, [slots, spinning]);

  const spin = useCallback(async () => {
    if (spinning) return;
    if (bet > balance) {
      setError('Not enough coins for that bet');
      return;
    }

    const token = ++spinToken.current;
    setError(null);
    setRound(null);
    setSpinning(true);

    // Optimistic debit so the balance reacts on the tap rather than after the
    // round trip. The server's authoritative figure overwrites it below.
    setBalance((current) => minor(current - bet));

    try {
      const result = await api.placeBet({
        gameId: GAME_ID,
        stake: bet,
        // Unique per attempt, so a retry after a timeout is recognised as the
        // same bet rather than charged again.
        idempotencyKey: `${Date.now()}-${token}`,
      });
      if (token !== spinToken.current) return; // superseded by a newer spin

      const state = result.state as SlotsState;

      // Hold until the reels have finished their run, so the result appears
      // when the animation lands rather than the instant the network replies.
      const settleAfter = motion.reelSpin + motion.reelStagger * (REELS - 1);
      setTimeout(() => {
        if (token !== spinToken.current) return;
        setGrid(state.baseSpin.grid);
        setRound(result);
        setBalance(minor(result.balance));
        setSpinning(false);
      }, settleAfter);
    } catch (caught) {
      if (token !== spinToken.current) return;
      setSpinning(false);
      // The optimistic debit never happened as far as the server is concerned.
      setBalance((current) => minor(current + bet));
      setError(
        caught instanceof PlayApiError ? caught.message : 'Something went wrong. Try again.',
      );
    }
  }, [api, balance, bet, spinning]);

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <View>
          <Txt variant="caption" color={colors.text.muted}>
            BALANCE
          </Txt>
          <Txt variant="money" color={colors.gold.default}>
            {format(balance, 'GC')}
          </Txt>
        </View>
        {/*
          Not a <Badge>: Badge renders dark text for a light chip, which on a
          dark chip is unreadable. This is a muted informational pill instead.
        */}
        <View style={styles.rtpPill}>
          <Txt variant="caption" color={colors.text.secondary}>
            RTP 96.25%
          </Txt>
        </View>
      </View>

      <Card style={styles.machine}>
        <View style={styles.reels}>
          {Array.from({ length: REELS }, (_, i) => (
            <Reel
              key={i}
              index={i}
              spinning={spinning}
              result={grid[i] ?? IDLE_GRID[i]!}
              winningRows={winningRows}
            />
          ))}
        </View>

        <View style={styles.readout} accessibilityLiveRegion="polite">
          {spinning ? (
            <Txt variant="bodySmall" color={colors.text.muted}>
              Spinning…
            </Txt>
          ) : error ? (
            <Txt variant="bodySmall" color={colors.feedback.error}>
              {error}
            </Txt>
          ) : settlement && settlement.payout > 0 ? (
            <Txt variant="h3" color={colors.feedback.winBright}>
              WIN {format(minor(settlement.payout), 'GC')}
              {settlement.multiplier >= 10 ? '  🔥' : ''}
            </Txt>
          ) : settlement ? (
            <Txt variant="bodySmall" color={colors.text.muted}>
              No win — spin again
            </Txt>
          ) : (
            <Txt variant="bodySmall" color={colors.text.muted}>
              Pick a bet and spin
            </Txt>
          )}
        </View>
      </Card>

      <View style={styles.betRow}>
        {options.map((option) => {
          const active = option === bet;
          const affordable = option <= balance;
          return (
            <Pressable
              key={option}
              onPress={() => setBet(option)}
              disabled={spinning || !affordable}
              accessibilityRole="button"
              accessibilityState={{ selected: active, disabled: !affordable }}
              style={[
                styles.chip,
                active && styles.chipActive,
                !affordable && styles.chipDisabled,
              ]}
            >
              <Txt
                variant="caption"
                color={active ? colors.text.inverse : colors.text.secondary}
              >
                {format(option, 'GC')}
              </Txt>
            </Pressable>
          );
        })}
      </View>

      <Button
        label={spinning ? 'Spinning…' : `Spin ${format(bet, 'GC')}`}
        onPress={spin}
        disabled={spinning || bet > balance}
        loading={spinning}
        style={styles.spin}
      />

      <Txt variant="caption" color={colors.text.muted} style={styles.fairness}>
        {USE_DEMO_API
          ? '⚠️ Demo mode — outcomes are generated on-device and are not the real game.'
          : round
            ? `Fair: ${round.fairness.serverSeedHash.slice(0, 16)}… · nonce ${round.fairness.nonce}`
            : 'Every result is provably fair.'}
      </Txt>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.surface.base,
    padding: spacing.lg,
    gap: spacing.lg,
    justifyContent: 'center',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  rtpPill: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
    backgroundColor: colors.surface.overlay,
    borderWidth: 1,
    borderColor: colors.surface.border,
  },
  machine: { gap: spacing.md, borderColor: colors.gold.dark },
  reels: { flexDirection: 'row', gap: spacing.xs },
  readout: { minHeight: 32, alignItems: 'center', justifyContent: 'center' },
  betRow: { flexDirection: 'row', gap: spacing.sm, justifyContent: 'center', flexWrap: 'wrap' },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.surface.raised,
    borderWidth: 1,
    borderColor: colors.surface.border,
    minWidth: 64,
    alignItems: 'center',
  },
  chipActive: { backgroundColor: colors.gold.default, borderColor: colors.gold.default },
  chipDisabled: { opacity: 0.35 },
  spin: { minHeight: 56 },
  fairness: { textAlign: 'center' },
});
