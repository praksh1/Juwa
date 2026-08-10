/**
 * The controls a slot machine is played with.
 *
 * Every game had the same full-width "Spin 2,000 GC" button with a row of bet
 * chips above it. That is a form, not a cabinet, and it is most of why a
 * three-reel fruit machine and a 720-ways diamond felt like the same game — the
 * thing your hand does is identical in both.
 *
 * Two clusters here, chosen per game in `api/cabinets`:
 *
 *   THE LEVER, for the machines pretending to be mechanical. A handle beside
 *   the reels that you pull down. It is the single control that makes a
 *   three-reeler feel like a three-reeler, and it costs one component.
 *
 *   THE CONSOLE, for the video slots. Bet stepper on the left, the win in the
 *   middle, balance and auto-spin beside a round spin button on the right —
 *   the layout every modern cabinet uses, and the one a player coming from
 *   another app will already know how to read.
 */

import React, { useRef } from 'react';
import { Animated, Easing, Pressable, StyleSheet, View } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { colors, radius, spacing, typography } from '@juwa/ui';
import { format, type Minor } from '@juwa/money';
import { Txt } from './primitives';
import { usePrefersReducedMotion } from '../motion';

export interface SlotControlsProps {
  bet: Minor;
  balance: Minor;
  /** What the last completed spin paid. */
  win: number;
  options: readonly Minor[];
  onBet: (next: Minor) => void;
  onSpin: () => void;
  spinning: boolean;
  /** Auto-spin is running; the spin control becomes a stop control. */
  auto: boolean;
  onToggleAuto: () => void;
  compact?: boolean;
  /**
   * The game spins from a lever instead.
   *
   * The console still carries the bet, the win and the balance — a lever with
   * no way to change your stake is a museum piece, not a machine — it just
   * gives up the round button.
   */
  hideSpin?: boolean;
}

/* ------------------------------------------------------------------ lever */

/**
 * A pull handle.
 *
 * Pressing it drives the knob down its slot and releases it, and the spin is
 * dispatched at the BOTTOM of the travel rather than on the press — so the
 * reels start when the handle reaches the end of its throw, which is the whole
 * reason a lever feels like it did something.
 */
export function SpinLever({
  onSpin,
  spinning,
  disabled,
  height,
}: {
  onSpin: () => void;
  spinning: boolean;
  disabled?: boolean;
  height: number;
}) {
  const pull = useRef(new Animated.Value(0)).current;
  const reduceMotion = usePrefersReducedMotion();
  const travel = height * 0.42;

  const handle = () => {
    if (disabled || spinning) return;
    if (reduceMotion) {
      onSpin();
      return;
    }
    Animated.sequence([
      Animated.timing(pull, {
        toValue: 1,
        duration: 170,
        easing: Easing.in(Easing.quad),
        useNativeDriver: true,
      }),
      // Snap back under spring tension, as a real handle does once released.
      Animated.timing(pull, {
        toValue: 0,
        duration: 420,
        easing: Easing.out(Easing.back(2.5)),
        useNativeDriver: true,
      }),
    ]).start();
    // Fired at the bottom of the throw, not on the press.
    setTimeout(onSpin, 170);
  };

  return (
    <Pressable
      onPress={handle}
      disabled={disabled || spinning}
      accessibilityRole="button"
      accessibilityLabel={spinning ? 'Spinning' : 'Pull the lever to spin'}
      style={[styles.leverArea, { height }, (disabled || spinning) && styles.leverDim]}
    >
      <View style={[styles.leverSlot, { height: height * 0.72 }]} />
      <Animated.View
        style={[
          styles.leverKnob,
          { transform: [{ translateY: pull.interpolate({ inputRange: [0, 1], outputRange: [0, travel] }) }] },
        ]}
      >
        <Svg width={34} height={34} viewBox="0 0 34 34">
          <Defs>
            <LinearGradient id="lever-knob" x1="0" y1="0" x2="0.4" y2="1">
              <Stop offset="0" stopColor="#FF6B6B" />
              <Stop offset="0.45" stopColor="#C0182B" />
              <Stop offset="1" stopColor="#6B0713" />
            </LinearGradient>
          </Defs>
          <Circle cx={17} cy={17} r={15} fill="url(#lever-knob)" stroke="#2A0409" strokeWidth={2} />
          <Circle cx={12} cy={11} r={4} fill="#FFFFFF" opacity={0.32} />
        </Svg>
      </Animated.View>
    </Pressable>
  );
}

/* ---------------------------------------------------------------- console */

/** The round spin button, with the bet stepper and readouts beside it. */
export function SlotConsole({
  bet,
  balance,
  win,
  options,
  onBet,
  onSpin,
  spinning,
  auto,
  onToggleAuto,
  compact,
  hideSpin = false,
}: SlotControlsProps) {
  const index = options.findIndex((value) => value === bet);
  const step = (by: number) => {
    const next = options[Math.min(options.length - 1, Math.max(0, index + by))];
    if (next !== undefined && next !== bet) onBet(next);
  };

  return (
    <View style={[styles.console, compact && styles.consoleCompact]}>
      {/* Bet, with steppers. A stepper rather than five chips: the chips took a
          whole row and two of them wrapped onto a third line on a small phone. */}
      <View style={styles.consoleBlock}>
        <Txt variant="caption" color={colors.text.muted}>TOTAL BET</Txt>
        <View style={styles.stepper}>
          <StepButton label="−" onPress={() => step(-1)} disabled={spinning || index <= 0} />
          <Txt variant="money" color={colors.gold.light}>{format(bet, 'GC')}</Txt>
          <StepButton
            label="+"
            onPress={() => step(1)}
            disabled={spinning || index >= options.length - 1}
          />
        </View>
      </View>

      {/* The win, in the middle, where every cabinet puts it. */}
      <View style={[styles.consoleBlock, styles.consoleCentre]}>
        <Txt variant="caption" color={colors.text.muted}>WIN</Txt>
        <Txt
          variant="money"
          color={win > 0 ? colors.feedback.winBright : colors.text.secondary}
        >
          {win > 0 ? format(win as Minor, 'GC') : '—'}
        </Txt>
      </View>

      {/*
        No balance here.

        The cabinets this is modelled on are landscape and have room for BET,
        WIN and BALANCE side by side. On a 390-point portrait phone the four
        blocks plus AUTO plus SPIN do not fit, and BALANCE ran into WIN. It is
        also already the largest thing in the header two inches above, so the
        console was competing with itself to repeat something.
      */}
      <View style={styles.consoleRight}>
        <Pressable
          onPress={onToggleAuto}
          accessibilityRole="button"
          accessibilityState={{ selected: auto }}
          accessibilityLabel={auto ? 'Stop auto spin' : 'Start auto spin'}
          style={[styles.autoButton, auto && styles.autoButtonOn]}
        >
          <Txt variant="caption" color={auto ? '#1A1206' : colors.text.secondary}>
            AUTO
          </Txt>
        </Pressable>

        {hideSpin ? null : (
        <Pressable
          onPress={onSpin}
          disabled={spinning && !auto}
          accessibilityRole="button"
          accessibilityLabel={
            auto ? 'Stop auto spin' : spinning ? 'Spinning' : `Spin for ${format(bet, 'GC')}`
          }
          style={({ pressed }) => [
            styles.spinRound,
            compact && styles.spinRoundCompact,
            pressed && styles.spinPressed,
            spinning && !auto && styles.spinBusy,
          ]}
        >
          <Txt variant="bodySmall" style={styles.spinLabel}>
            {auto ? 'STOP' : spinning ? '···' : 'SPIN'}
          </Txt>
        </Pressable>
        )}
      </View>

    </View>
  );
}

function StepButton({
  label,
  onPress,
  disabled,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label === '+' ? 'Increase bet' : 'Decrease bet'}
      style={[styles.step, disabled && styles.stepDim]}
    >
      <Txt variant="bodySmall" color={colors.text.primary}>{label}</Txt>
    </Pressable>
  );
}

/* ------------------------------------------------------------------ frame */

/**
 * The surround the reels sit inside.
 *
 * Drawn rather than an image so it stretches to whatever the reel window is —
 * a 3x3 and a 3-4-5-4-3 are very different shapes and one bitmap frame cannot
 * fit both without distorting the carving.
 */
export function ReelFrame({ style, children }: { style?: 'timber' | 'gilt' | 'chrome' | 'none'; children: React.ReactNode }) {
  if (!style || style === 'none') return <>{children}</>;
  const palette = FRAMES[style];
  return (
    <View style={[styles.frame, { borderColor: palette.edge, backgroundColor: palette.fill }]}>
      <Svg style={StyleSheet.absoluteFill} width="100%" height="100%">
        <Defs>
          <LinearGradient id={`frame-${style}`} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={palette.top} />
            <Stop offset="0.5" stopColor={palette.fill} />
            <Stop offset="1" stopColor={palette.bottom} />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" rx="10" fill={`url(#frame-${style})`} />
      </Svg>
      <View style={styles.frameInner}>{children}</View>
    </View>
  );
}

const FRAMES = {
  timber: { edge: '#8A5A22', fill: '#4A2C10', top: '#7A4A1C', bottom: '#2A1708' },
  gilt: { edge: '#E3B23C', fill: '#6B4E12', top: '#B8912B', bottom: '#33240A' },
  chrome: { edge: '#9FB3C8', fill: '#2A3746', top: '#5E7387', bottom: '#141C25' },
} as const;

const styles = StyleSheet.create({
  /* lever */
  leverArea: { width: 46, alignItems: 'center', justifyContent: 'flex-start', paddingTop: 6 },
  leverDim: { opacity: 0.45 },
  leverSlot: {
    position: 'absolute',
    top: 14,
    width: 8,
    borderRadius: 4,
    backgroundColor: '#1A1206',
    borderWidth: 1,
    borderColor: colors.gold.dark,
  },
  leverKnob: { alignItems: 'center' },

  /* console */
  console: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    borderRadius: radius.lg,
    backgroundColor: 'rgba(10, 8, 20, 0.86)',
    borderWidth: 1,
    borderColor: colors.gold.dark,
  },
  consoleCompact: { paddingVertical: spacing.xs },
  consoleBlock: { alignItems: 'center', gap: 2 },
  consoleCentre: { flex: 1 },
  consoleRight: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  step: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface.overlay,
    borderWidth: 1,
    borderColor: colors.surface.border,
  },
  stepDim: { opacity: 0.35 },
  autoButton: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    minHeight: 44,
    justifyContent: 'center',
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.surface.border,
    backgroundColor: colors.surface.overlay,
  },
  autoButtonOn: { backgroundColor: colors.gold.default, borderColor: colors.gold.light },
  spinRound: {
    width: 76,
    height: 76,
    borderRadius: 38,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.gold.default,
    borderWidth: 2,
    borderColor: colors.gold.light,
  },
  spinRoundCompact: { width: 60, height: 60, borderRadius: 30 },
  spinPressed: { transform: [{ scale: 0.94 }] },
  spinBusy: { opacity: 0.6 },
  spinLabel: { ...typography.bodySmall, fontWeight: '900', letterSpacing: 1, color: '#1A1206' },

  /* frame */
  frame: { borderRadius: radius.lg, borderWidth: 2, padding: spacing.xs },
  frameInner: { borderRadius: radius.md, overflow: 'hidden' },
});
