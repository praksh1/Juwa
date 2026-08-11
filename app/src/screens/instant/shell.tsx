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
import { Animated, Pressable, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { format, minor, type Minor } from '@juwa/money';
import { publishBalance } from '../../api/usePlayer';
import { betOptions, suggestedBet } from '@juwa/economy';
import { colors, radius, spacing } from '@juwa/ui';
import { Screen, Txt } from '../../components/primitives';
import { SoundToggles } from '../../components/SoundToggles';
import { HowToPlayButton } from '../../components/HowToPlay';
import { INSTANT_BED, useAmbientBed } from '../../ambience';
import { INSTANT_RULES } from './rules';
import { sounds, unlock } from '../../sound';
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
        // Keeps the lobby header honest without a refetch. See publishBalance.
        publishBalance(minor(result.balance));
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
  action,
  footer,
  /** Locked while a multi-step round is open — the stake is already committed. */
  stakeLocked = false,
}: {
  game: InstantGame;
  state: InstantState;
  children: React.ReactNode;
  /**
   * The one button that plays the game.
   *
   * A slot of its own rather than another child, because the ORDER matters and
   * the layout is what knows it: board, then stake, then the button. Passed as
   * a child it landed above the stake chips, which pushed them off the bottom
   * of a 700-point screen — so the control for choosing how much to bet was
   * below the fold on every one of these five games.
   */
  action?: React.ReactNode;
  footer?: React.ReactNode;
  stakeLocked?: boolean;
}) {
  /**
   * The room these five are in.
   *
   * They had no music at all, which made them the quietest screens in the app —
   * and they are also the ones with the least happening visually, so the
   * silence was doing real damage. `bed-deep` is the least melodic of the six
   * families, which is what a game with a rising multiplier needs: anything
   * with a tune fights the tension the number is building.
   */
  useAmbientBed(INSTANT_BED);

  return (
    <View style={styles.frame}>
    <Screen contentStyle={styles.scrollBody}>
      <View style={styles.topRow}>
        <View>
          <Txt variant="caption" color={colors.text.muted}>
            BALANCE
          </Txt>
          <Txt variant="money" color={colors.gold.default}>
            {format(state.balance, 'GC')}
          </Txt>
        </View>
        {/*
          The rules, one tap away, on every one of these five.

          These games are the only ones in the app with no physical ancestor —
          nobody has to be told how a slot machine works, and everybody has to
          be told what Limbo is. See HowToPlay.
        */}
        {INSTANT_RULES[game.id] ? (
          <HowToPlayButton
            title={game.name}
            content={INSTANT_RULES[game.id]!}
            accent={game.accent}
          />
        ) : null}
        {/* Sound, reachable without leaving the game. See SoundToggles. */}
        <SoundToggles compact />
      </View>

      {children}

      {/*
        Hidden, not dimmed, while a round is open.

        The stake is already committed at that point, so the chips are dead
        controls — and on Mines, which is the tallest of the five, the fifty
        points they occupy were pushing the CASH OUT button off the bottom of
        the screen at exactly the moment it is the only thing the player wants.
        Dimming them kept the cost and removed the use.
      */}
      <View style={styles.chips} pointerEvents="auto">
        {(stakeLocked ? [] : state.options).map((option) => {
          const selected = option === state.bet;
          return (
            <Pressable
              key={option}
              onPress={() => {
                unlock();
                sounds.tap();
                state.setBet(option);
              }}
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

      {/*
        THE DOCK.

        Measured on a 700-point phone, the tab bar floats over the bottom 69
        points — so the usable height is 631, and four of these five games put
        their one play button underneath it. The button looked present and was
        not tappable: a tap on Plinko's Drop opened the Wallet tab instead.

        Shaving each board was the first attempt and it is the wrong shape of
        fix — it has to be redone for every new viewport, and it trades away
        the play area to buy space for the control. Pinning is what roulette
        does, the founder liked it there, and it is correct by construction:
        the button cannot be below the fold because it is not in the scroll.

        The scroll reserves the matching height, so nothing is permanently
        hidden behind it.
      */}
      {action ? <View style={styles.dock}>{action}</View> : null}
    </View>
  );
}

/**
 * The play area's panel.
 *
 * Was a flat `#05091A` rectangle with a grey hairline — the same slab on all
 * five games, which is most of why they read as one unfinished screen rather
 * than five games. It is now lit: a vertical gradient so the panel has a top
 * and a bottom, a border in the game's own accent so each one is identifiably
 * itself, and a sheen across the top third.
 *
 * The accent is the single strongest per-game signal available here. These
 * games have no artwork — no reels, no felt, no cards — so colour is doing the
 * work that a painted cabinet does on a slot.
 */
export function Board({ accent, children }: { accent: string; children: React.ReactNode }) {
  return (
    <View style={[styles.boardOuter, { borderColor: `${accent}55`, shadowColor: accent }]}>
      <LinearGradient
        colors={['#111A33', '#080C1C', '#04060F']}
        locations={[0, 0.55, 1]}
        style={StyleSheet.absoluteFill}
      />
      {/* The sheen. Non-interactive, and it must say so on a plain View —
          `pointerEvents` does not reach the DOM through LinearGradient. */}
      <View style={styles.boardSheen} pointerEvents="none">
        <LinearGradient
          colors={['rgba(255,255,255,0.10)', 'rgba(255,255,255,0.02)', 'rgba(255,255,255,0)']}
          locations={[0, 0.5, 1]}
          style={StyleSheet.absoluteFill}
        />
      </View>
      <View style={styles.boardBody}>{children}</View>
    </View>
  );
}

/**
 * The primary action. One per screen, always the largest thing on it.
 *
 * Gradient rather than flat fill, with a highlight along the top edge — the
 * same treatment the roulette wheel's bezel gets, for the same reason: a flat
 * coloured pill reads as a placeholder. It also BREATHES while it is waiting
 * to be pressed, which is the cheapest way to make a static screen feel alive
 * and, more usefully, points at the one control that does anything.
 */
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
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (disabled) {
      pulse.setValue(0);
      return undefined;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 1400, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 1400, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [disabled, pulse]);

  const scale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.015] });

  return (
    <Animated.View style={{ transform: [{ scale }] }}>
      <Pressable
        onPress={() => {
          unlock();
          sounds.tap();
          onPress();
        }}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={label}
        style={({ pressed }) => [
          styles.play,
          {
            shadowColor: colour,
            opacity: disabled ? 0.4 : 1,
            transform: [{ scale: pressed && !disabled ? 0.975 : 1 }],
          },
        ]}
      >
        <LinearGradient
          colors={[lighten(colour), colour, darken(colour)]}
          locations={[0, 0.45, 1]}
          style={StyleSheet.absoluteFill}
        />
        <View style={styles.playSheen} pointerEvents="none" />
        <Txt variant="h3" color={colors.surface.base}>
          {label}
        </Txt>
      </Pressable>
    </Animated.View>
  );
}

/**
 * Shift a hex accent towards white or black.
 *
 * The five accents are given as hex in one table, and asking for a second and
 * third shade of each by hand would be three columns to keep in step. Mixing
 * here means a new game needs one colour and gets a lit button.
 */
function mix(hex: string, target: number, amount: number): string {
  const n = parseInt(hex.slice(1), 16);
  const channel = (shift: number) => {
    const value = (n >> shift) & 0xff;
    return Math.round(value + (target - value) * amount);
  };
  return `rgb(${channel(16)}, ${channel(8)}, ${channel(0)})`;
}
const lighten = (hex: string) => mix(hex, 255, 0.42);
const darken = (hex: string) => mix(hex, 0, 0.34);

/**
 * Play the right sound when a round settles, once per round.
 *
 * Lives here rather than in each game because all five settle the same way —
 * a payout against a stake — and five copies of this would be five chances for
 * one game to forget. Keyed on the round id so a re-render cannot replay a
 * fanfare over a result the player is already reading.
 */
export function useSettlementSound(round: RoundResponse | null): void {
  const announced = useRef<string | null>(null);

  useEffect(() => {
    if (!round || round.status !== 'settled') return;
    if (announced.current === round.roundId) return;
    announced.current = round.roundId;

    const payout = round.settlement?.payout ?? 0;
    const stake = round.settlement?.stake ?? 0;
    if (payout <= 0) {
      sounds.lose();
      return;
    }
    // Ten times the stake is the threshold the slots use for their longest
    // fanfare, and using the same one here means a big win sounds like a big
    // win everywhere in the app rather than per screen.
    if (payout >= stake * 10) sounds.bigWin();
    else sounds.win();
  }, [round]);
}

/** The pinned button (58) plus the dock's own padding, top and bottom. */
const DOCK_HEIGHT = 58 + 24;

export const styles = StyleSheet.create({
  frame: { flex: 1 },
  /** Clears the dock, which floats over this scroll view. */
  scrollBody: { paddingBottom: DOCK_HEIGHT + spacing.md },
  dock: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
    backgroundColor: colors.surface.raised,
    borderTopWidth: 1,
    borderTopColor: colors.surface.border,
  },
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
    minHeight: 58,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
    // A coloured glow under the one button that does anything.
    shadowOpacity: 0.55,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 3 },
  },
  playSheen: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    height: '46%',
    backgroundColor: 'rgba(255,255,255,0.16)',
    borderTopLeftRadius: radius.pill,
    borderTopRightRadius: radius.pill,
  },
  boardOuter: {
    borderRadius: radius.lg,
    borderWidth: 1,
    overflow: 'hidden',
    shadowOpacity: 0.3,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 4 },
  },
  boardSheen: { position: 'absolute', left: 0, right: 0, top: 0, height: '34%' },
  /*
   * Tight on purpose. Plinko's pegs and Mines' 25 tiles are the two tallest
   * play areas, and at `lg` padding with `md` gaps both pushed their own play
   * button below the fold on a 700-point screen — the exact complaint that got
   * roulette's controls pinned. Height is the scarce resource on these two and
   * nowhere is it cheaper to reclaim than in the gaps.
   */
  boardBody: { padding: spacing.md, gap: spacing.sm, alignItems: 'center' },
  /** @deprecated Use `Board`. Kept only until the last screen stops importing it. */
  board: {
    backgroundColor: '#05091A',
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.surface.border,
    padding: spacing.lg,
    gap: spacing.md,
    alignItems: 'center',
  },
  result: { alignItems: 'center', gap: 2, minHeight: 44, justifyContent: 'center' },
});
