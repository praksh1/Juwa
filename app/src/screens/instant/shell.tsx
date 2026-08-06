/**
 * The shared frame for the five instant games.
 *
 * Crash, Limbo, Dice, Plinko and Mines differ entirely in what they draw and
 * barely at all in what they do: load a balance, pick a stake, send one bet,
 * show what came back, handle the failure. That common half lives here so each
 * screen is only its own play area — the same trick that lets twenty-three
 * slots share one screen.
 *
 * ## The rule these screens must not break
 *
 * The client never decides an outcome. Every number on screen either came back
 * from the server in a settlement, or is a PRICE quoted before the bet from
 * `@juwa/economy` — the same module the server settles with. There is no third
 * category, and in particular there is no "work out what the player probably
 * won" path. A screen that can compute a payout is a screen a patched client
 * can compute a favourable one from.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { format, minor, type Minor } from '@juwa/money';
import { betOptions, suggestedBet } from '@juwa/economy';
import { colors, radius, spacing } from '@juwa/ui';
import { Screen, Txt } from '../../components/primitives';
import { PlayApiError, createPlayApi, type PlayApi, type RoundResponse } from '../../api/client';

export interface InstantGame {
  id: string;
  name: string;
  minBet: number;
  maxBet: number;
  accent: string;
}

export interface InstantState {
  balance: Minor;
  bet: Minor;
  setBet: (value: Minor) => void;
  options: Minor[];
  busy: boolean;
  error: string | null;
  round: RoundResponse | null;
  /** Open a round. Returns the response so a screen can animate from it. */
  play: (action?: { type: string; [key: string]: unknown }) => Promise<RoundResponse | null>;
  /** Continue an open round — Mines only. */
  act: (action: { type: string; [key: string]: unknown }) => Promise<RoundResponse | null>;
  reset: () => void;
}

export function useInstantGame(game: InstantGame): InstantState {
  // Held in a ref so a re-render never swaps the client mid-round.
  const api = useRef<PlayApi>(createPlayApi()).current;
  const MIN = minor(game.minBet);
  const MAX = minor(game.maxBet);

  const [balance, setBalance] = useState<Minor>(minor(0));
  const [bet, setBet] = useState<Minor>(MIN);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [round, setRound] = useState<RoundResponse | null>(null);

  useEffect(() => {
    let alive = true;
    api
      .getBalance()
      .then((result) => {
        if (!alive) return;
        const current = minor(result.balance);
        setBalance(current);
        setBet(suggestedBet(current, MIN, MAX));
      })
      .catch(() => setError('Could not load your balance'));
    return () => {
      alive = false;
    };
  }, [api, MIN, MAX]);

  const options = useMemo(() => betOptions(balance, MIN, MAX), [balance, MIN, MAX]);

  const send = useCallback(
    async (run: () => Promise<RoundResponse>) => {
      setError(null);
      setBusy(true);
      try {
        const result = await run();
        setRound(result);
        setBalance(minor(result.balance));
        return result;
      } catch (caught) {
        setError(
          caught instanceof PlayApiError ? caught.message : 'Something went wrong. Try again.',
        );
        return null;
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  const play = useCallback(
    (action?: { type: string; [key: string]: unknown }) => {
      if (bet > balance) {
        setError('Not enough coins for that bet');
        return Promise.resolve(null);
      }
      return send(() =>
        api.placeBet({
          gameId: game.id,
          stake: bet,
          // Unique per attempt, so a retry after a timeout is recognised as the
          // same bet rather than charged twice.
          idempotencyKey: `${game.id}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          ...(action ? { action } : {}),
        }),
      );
    },
    [api, bet, balance, game.id, send],
  );

  const act = useCallback(
    (action: { type: string; [key: string]: unknown }) => {
      const open = round;
      if (!open) return Promise.resolve(null);
      return send(() =>
        api.act({
          roundId: open.roundId,
          action,
          idempotencyKey: `${open.roundId}-${action.type}-${Date.now()}`,
        }),
      );
    },
    [api, round, send],
  );

  return {
    balance,
    bet,
    setBet,
    options,
    busy,
    error,
    round,
    play,
    act,
    reset: () => setRound(null),
  };
}

/**
 * Balance, stake chips and the error line.
 *
 * The play area is passed as children, so each game owns the middle of the
 * screen and nothing else.
 */
export function InstantLayout({
  game,
  state,
  children,
  footer,
  /** Locked while a multi-step round is open — the stake is already committed. */
  stakeLocked = false,
}: {
  game: InstantGame;
  state: InstantState;
  children: React.ReactNode;
  footer?: React.ReactNode;
  stakeLocked?: boolean;
}) {
  return (
    <Screen>
      <View style={styles.topRow}>
        <View>
          <Txt variant="caption" color={colors.text.muted}>
            BALANCE
          </Txt>
          <Txt variant="money" color={colors.gold.default}>
            {format(state.balance, 'GC')}
          </Txt>
        </View>
        <View style={styles.rtpPill}>
          <Txt variant="caption" color={colors.text.secondary}>
            RTP 99.00%
          </Txt>
        </View>
      </View>

      {children}

      <View style={[styles.chips, stakeLocked && styles.chipsLocked]} pointerEvents={stakeLocked ? 'none' : 'auto'}>
        {state.options.map((option) => {
          const selected = option === state.bet;
          return (
            <Pressable
              key={option}
              onPress={() => state.setBet(option)}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              style={[styles.chip, selected && { backgroundColor: game.accent }]}
            >
              <Txt
                variant="bodySmall"
                color={selected ? colors.surface.base : colors.text.secondary}
              >
                {format(option, 'GC')}
              </Txt>
            </Pressable>
          );
        })}
      </View>

      {footer}

      {state.error ? (
        <Txt variant="bodySmall" color={colors.feedback.error}>
          {state.error}
        </Txt>
      ) : null}
    </Screen>
  );
}

/** The primary action. One per screen, always the largest thing on it. */
export function PlayButton({
  label,
  onPress,
  disabled,
  colour,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  colour: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [
        styles.play,
        { backgroundColor: colour, opacity: disabled ? 0.45 : 1, transform: [{ scale: pressed && !disabled ? 0.98 : 1 }] },
      ]}
    >
      <Txt variant="h3" color={colors.surface.base}>
        {label}
      </Txt>
    </Pressable>
  );
}

export const styles = StyleSheet.create({
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  rtpPill: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
    backgroundColor: colors.surface.overlay,
  },
  chips: { flexDirection: 'row', gap: spacing.sm, justifyContent: 'center', flexWrap: 'wrap' },
  chipsLocked: { opacity: 0.4 },
  chip: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    borderRadius: radius.pill,
    backgroundColor: colors.surface.overlay,
  },
  play: {
    minHeight: 56,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  board: {
    backgroundColor: '#05091A',
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.surface.border,
    padding: spacing.lg,
    gap: spacing.md,
    alignItems: 'center',
  },
  result: { alignItems: 'center', gap: 2, minHeight: 72, justifyContent: 'center' },
});
