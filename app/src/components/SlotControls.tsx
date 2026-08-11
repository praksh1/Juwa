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

import React, { useEffect, useRef } from 'react';
import {
  Animated,
  Easing,
  PanResponder,
  Pressable,
  StyleSheet,
  View,
  type ViewStyle,
} from 'react-native';
import Svg, {
  Circle,
  Defs,
  LinearGradient,
  Rect,
  Stop,
  Text as SvgText,
} from 'react-native-svg';
import { colors, radius, spacing, typography } from '@juwa/ui';
import { format, type Minor } from '@juwa/money';
import { Txt } from './primitives';
import { usePrefersReducedMotion } from '../motion';
import { sounds } from '../sound';
import type { Material } from './symbols/materials';

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
 * A pull handle you actually pull.
 *
 * The first version was a `Pressable` that played a pull animation when you
 * tapped it, and the tap target was the whole column — so the way to use it was
 * to tap the empty rail BELOW the knob. A player found it by accident and said
 * so: "it looks like the player is not pulling the lever, just tapping under
 * the lever. That's not user friendly. Kind of useless."
 *
 * They are right, and it is worse than either half. A control that looks
 * mechanical and behaves like a button teaches you nothing, and one whose hit
 * area is somewhere it does not look like is undiscoverable. So it is a drag
 * now: put your thumb on the knob, pull it down past the detent, and the reels
 * go on release. Short of the detent it springs back and nothing happens,
 * which is exactly what a real handle does.
 *
 * The knob idles with a slow bob and the rail says PULL, because an affordance
 * nobody can see is the same problem in a different costume.
 *
 * KEYBOARD AND SCREEN READERS still activate it, because a drag is not
 * available to everyone. `detail === 0` distinguishes a click synthesised by
 * assistive technology or the Enter key from a real pointer tap — so the
 * people who need a non-drag path keep one, and the tap that made this
 * confusing in the first place does nothing.
 */
/**
 * "This drag is mine, browser."
 *
 * `touchAction: 'none'` is what actually stops the page moving under the lever.
 * On the web a PanResponder is built from touch events and never calls
 * preventDefault, so the browser goes on treating the same drag as a scroll and
 * drags the page down behind the handle. No amount of responder negotiation
 * fixes that, because the browser is not a participant in it — the only way to
 * tell it is the CSS property that exists for exactly this purpose, which React
 * Native Web passes straight through.
 *
 * It is web-only and absent from ViewStyle, hence the cast.
 *
 * Scoped to the lever and never to the screen: a page that cannot be scrolled
 * would be a worse bug than the one being fixed.
 */
const OWNS_THE_DRAG = { touchAction: 'none' } as unknown as ViewStyle;

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
  const bob = useRef(new Animated.Value(0)).current;
  const reduceMotion = usePrefersReducedMotion();
  const travel = Math.max(56, height * 0.5);
  /** How far down counts as a pull. Below this it springs back unfired. */
  const detent = travel * 0.62;

  const locked = useRef(false);
  locked.current = Boolean(disabled) || spinning;

  const release = (dy: number) => {
    const pulled = dy >= detent;
    Animated.timing(pull, {
      toValue: 0,
      duration: pulled ? 420 : 220,
      easing: pulled ? Easing.out(Easing.back(2.4)) : Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start();
    if (pulled) {
      // The mechanism engaging, which is a different moment from the reels
      // going — see `sounds.lever`.
      sounds.lever();
      onSpin();
    }
  };

  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => !locked.current,
      onMoveShouldSetPanResponder: () => !locked.current,
      /*
       * CAPTURE, so the lever wins the gesture before the ScrollView above it
       * gets a chance to claim it.
       *
       * Without this the two compete: the responder tracks the drag AND the
       * scroll view scrolls, so pulling the handle dragged the whole page down
       * behind it. It worked "sometimes" because whichever view asked first won,
       * and that depended on exactly where the thumb landed.
       */
      onStartShouldSetPanResponderCapture: () => !locked.current,
      onMoveShouldSetPanResponderCapture: (_event, gesture) =>
        // Only once the drag is clearly vertical and clearly a drag. Claiming
        // on the first pixel would swallow a scroll that merely started on top
        // of the lever.
        !locked.current && Math.abs(gesture.dy) > 4 && Math.abs(gesture.dy) > Math.abs(gesture.dx),
      onPanResponderMove: (_event, gesture) => {
        if (locked.current) return;
        // Downwards only, and never past the end of the rail.
        pull.setValue(Math.max(0, Math.min(travelRef.current, gesture.dy)));
      },
      onPanResponderRelease: (_event, gesture) => {
        if (locked.current) {
          pull.setValue(0);
          return;
        }
        releaseRef.current(gesture.dy);
      },
      onPanResponderTerminate: () => pull.setValue(0),
    }),
  ).current;

  // The responder is created once; these keep it looking at current values
  // instead of the ones captured on the first render.
  const travelRef = useRef(travel);
  travelRef.current = travel;
  const releaseRef = useRef(release);
  releaseRef.current = release;

  /** The idle bob: the only thing on screen saying "this moves". */
  useEffect(() => {
    if (reduceMotion || locked.current) {
      bob.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(bob, { toValue: 1, duration: 900, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(bob, { toValue: 0, duration: 900, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.delay(1600),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [reduceMotion, spinning, disabled, bob]);

  const knobShift = Animated.add(
    pull,
    bob.interpolate({ inputRange: [0, 1], outputRange: [0, 5] }),
  );

  return (
    <Pressable
      style={[styles.leverArea, { height }]}
      accessibilityRole="button"
      accessibilityLabel={spinning ? 'Spinning' : 'Pull the lever to spin'}
      accessibilityHint="Drag the handle down, or press Enter"
      onPress={(event) => {
        /*
         * Keyboard and assistive technology only.
         *
         * A click synthesised by Enter or by a screen reader reports
         * `detail === 0`; a real pointer tap reports 1 or more. Gating on that
         * keeps a non-drag path open for the people who need one WITHOUT
         * reinstating the tap-anywhere behaviour that made this control
         * unreadable in the first place.
         */
        const detail = (event.nativeEvent as unknown as { detail?: number }).detail;
        if (detail === 0 && !locked.current) {
          sounds.lever();
          onSpin();
        }
      }}
    >
      <View style={[styles.leverSlot, { height: travel + 20 }]} />
      <Animated.View
        {...responder.panHandlers}
        style={[
          styles.leverKnob,
          (disabled || spinning) && styles.leverDim,
          { transform: [{ translateY: knobShift }] },
        ]}
      >
        <Svg width={38} height={38} viewBox="0 0 38 38">
          <Defs>
            <LinearGradient id="lever-knob" x1="0" y1="0" x2="0.4" y2="1">
              <Stop offset="0" stopColor="#FF6B6B" />
              <Stop offset="0.45" stopColor="#C0182B" />
              <Stop offset="1" stopColor="#6B0713" />
            </LinearGradient>
          </Defs>
          <Circle cx={19} cy={19} r={17} fill="url(#lever-knob)" stroke="#2A0409" strokeWidth={2} />
          <Circle cx={13} cy={12} r={4.5} fill="#FFFFFF" opacity={0.34} />
        </Svg>
      </Animated.View>

      {/* The instruction. Without it the control is a red ball on a stick. */}
      <View style={styles.leverHint} pointerEvents="none">
        <Txt variant="caption" color={colors.gold.light} style={styles.leverHintText}>
          {spinning ? '' : 'PULL'}
        </Txt>
      </View>
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
    <View style={[styles.console, compact && styles.consoleCompact, compact && styles.consoleStack]}>
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
      <View style={[styles.consoleBlock, compact ? styles.consoleCentreStack : styles.consoleCentre]}>
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

/* ------------------------------------------------------------------ glass */

/**
 * The top glass: the lit panel above the reels with the game's name on it.
 *
 * Two problems, one part. The first is that the machine did not fill the
 * screen — and the answer to that is NOT taller cells, which only spreads the
 * same symbols further apart. A real cabinet is mostly not reels: it is a
 * lit sign, a belly panel and a console, and the reel window sits in the
 * middle of them. Giving the surplus height to the sign makes the machine
 * bigger while leaving every symbol exactly as large as the width allows.
 *
 * The second is that every game arrived looking like every other game. The
 * name is cast in the game's own MATERIAL — the same ice, sandstone, jade or
 * ember its royals are cut from — so Frost Peak's glass is lit blue and
 * Dragon's Hoard's is molten, before a single symbol has been painted.
 *
 * `flex: 1` with a floor rather than a fixed height: it takes whatever the
 * screen has left over after the reels and the console have been paid, so the
 * cabinet reaches the bottom of the phone on a tall screen and quietly gives
 * up almost all of itself on a short one.
 */
export function CabinetGlass({
  name,
  material,
  height,
}: {
  name: string;
  material: Material;
  height: number;
}) {
  /*
   * Fitted by WIDTH rather than by point size.
   *
   * "Aurora Borealis" is half again the length of "Triple Bar", and one point
   * size either overflows the first or leaves the second floating in the middle
   * of an empty sign. `textLength` hands the fitting to the renderer, which
   * knows the metrics this font actually has — and is capped so a short name is
   * never stretched across the whole panel like a stadium banner.
   */
  const label = name.toUpperCase();
  const textLength = Math.min(280, label.length * 17);
  const id = `glass-${material.outline.slice(1)}`;
  const fit = { textLength, lengthAdjust: 'spacingAndGlyphs' as const };

  return (
    <View style={[styles.glass, { height, borderColor: material.outline }]}>
      {/*
        The lit panel, drawn in its own SVG so it can STRETCH.
        `preserveAspectRatio="none"` fills the sign edge to edge whatever shape
        the sign is; the lettering below must not be stretched, and one element
        cannot be both. Sharing the viewBox keeps the two in register.
      */}
      <Svg
        style={StyleSheet.absoluteFill}
        width="100%"
        height="100%"
        viewBox="0 0 300 60"
        preserveAspectRatio="none"
      >
        <Defs>
          <LinearGradient id={`${id}-lamp`} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={material.face[1]} stopOpacity={0.38} />
            <Stop offset="0.7" stopColor={material.face[2]} stopOpacity={0.22} />
            <Stop offset="1" stopColor={material.outline} stopOpacity={0.5} />
          </LinearGradient>
        </Defs>
        {/* Brightest at the top, where the tube is. */}
        <Rect x="0" y="0" width="300" height="60" fill={`url(#${id}-lamp)`} />
      </Svg>
      <Svg width="100%" height="100%" viewBox="0 0 300 60" preserveAspectRatio="xMidYMid meet">
        <Defs>
          <LinearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={material.face[0]} />
            <Stop offset="0.5" stopColor={material.face[1]} />
            <Stop offset="1" stopColor={material.face[2]} />
          </LinearGradient>
        </Defs>
        {material.halo ? (
          <SvgText {...GLASS_TEXT} {...fit} fill="none" stroke={material.halo} strokeWidth={7} strokeOpacity={0.45} strokeLinejoin="round">
            {label}
          </SvgText>
        ) : null}
        <SvgText {...GLASS_TEXT} {...fit} fill="none" stroke={material.outline} strokeWidth={5.5} strokeLinejoin="round">
          {label}
        </SvgText>
        {/* The cut edge, a shade proud of the face — the same construction the
            royals and the lobby titles use, for the same reason. */}
        <SvgText {...GLASS_TEXT} {...fit} y={GLASS_TEXT.y + 1.4} fill={material.edge}>
          {label}
        </SvgText>
        <SvgText {...GLASS_TEXT} {...fit} fill={`url(#${id})`}>
          {label}
        </SvgText>
      </Svg>
    </View>
  );
}

const GLASS_TEXT = {
  x: 150,
  y: 41,
  fontSize: 30,
  fontWeight: '900' as const,
  fontFamily: "'Archivo Black', Impact, 'Arial Narrow Bold', sans-serif",
  textAnchor: 'middle' as const,
  letterSpacing: 2,
};

/* ------------------------------------------------------------------ frame */

/**
 * The surround the reels sit inside.
 *
 * Drawn rather than an image so it stretches to whatever the reel window is —
 * a 3x3 and a 3-4-5-4-3 are very different shapes and one bitmap frame cannot
 * fit both without distorting the carving.
 */
export function ReelFrame({ style, children }: { style?: 'timber' | 'gilt' | 'chrome' | 'none'; children: React.ReactNode }) {
  /*
   * ALWAYS a flexing wrapper, even with no frame drawn.
   *
   * This sits in a row beside the lever, and a child of a row that does not
   * claim its share is sized by its content. The reels inside use `flex: 1`,
   * which in a content-sized parent collapses to the narrowest thing that
   * fits — so the entire machine shrank into the corner of its own cabinet,
   * about a third of the width it should have had, and every symbol shrank
   * with it. Returning a bare fragment for `none` was what let that happen.
   */
  if (!style || style === 'none') return <View style={styles.frameBare}>{children}</View>;
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
  leverArea: {
    width: 38,
    alignItems: 'center',
    justifyContent: 'flex-start',
    paddingTop: 4,
    ...OWNS_THE_DRAG,
  },
  leverDim: { opacity: 0.45 },
  leverSlot: {
    position: 'absolute',
    top: 18,
    width: 10,
    borderRadius: 5,
    backgroundColor: '#1A1206',
    borderWidth: 1,
    borderColor: colors.gold.dark,
  },
  leverKnob: {
    alignItems: 'center',
    // A comfortable thumb target on the KNOB itself, which is the part that
    // looks draggable. The old version's target was the empty rail below it.
    padding: 6,
    // The knob is where the thumb actually lands, so it needs the same claim
    // on the gesture as the area around it.
    ...OWNS_THE_DRAG,
  },
  leverHint: { position: 'absolute', bottom: 2, alignItems: 'center' },
  leverHintText: { fontWeight: '900', letterSpacing: 1.5 },

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
  /*
   * Beside the machine, the console is a COLUMN.
   *
   * In landscape it lives in a 190-point rail next to the reels, and a row of
   * "TOTAL BET 2,000 GC · WIN · AUTO · SPIN" needs more than twice that. It did
   * not wrap, it overflowed: the spin button was drawn off the right edge of
   * the phone and the game could not be played at all in landscape.
   */
  consoleStack: { flexDirection: 'column', alignItems: 'stretch', gap: spacing.xs },
  consoleBlock: { alignItems: 'center', gap: 2 },
  consoleCentre: { flex: 1 },
  // `flex: 1` in a column would stretch the WIN block down the whole rail.
  consoleCentreStack: { flexGrow: 0 },
  consoleRight: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.xs },
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

  /* glass */
  glass: {
    width: '100%',
    borderBottomWidth: 2,
    borderRadius: radius.sm,
    overflow: 'hidden',
    justifyContent: 'center',
  },

  /* frame */
  frame: { flex: 1, borderRadius: radius.lg, borderWidth: 2, padding: 3 },
  frameBare: { flex: 1 },
  frameInner: { borderRadius: radius.md, overflow: 'hidden' },
});
