/**
 * The announcement ticker, pinned to the top of the app.
 *
 * A continuously scrolling strip of short messages. It does three jobs at once:
 * it makes the page feel live, it carries the "no cash value" line where nobody
 * can miss it, and it is the cheapest place to advertise a new game.
 *
 * IMPLEMENTATION
 *
 * The brief called for a CSS transform animation. This app renders through
 * React Native Web, where a stylesheet keyframe cannot reach the view — so it
 * is an `Animated` transform instead, which compiles to the same GPU-composited
 * `translateX` and behaves identically.
 *
 * The message list is rendered TWICE, back to back, and the animation travels
 * exactly the width of one copy before resetting. At the moment it resets, the
 * second copy is sitting precisely where the first one started, so the seam is
 * invisible and the scroll appears endless.
 *
 * It pauses on hover, and it stops entirely under `prefers-reduced-motion` —
 * a permanently moving element at the top of the viewport is a real problem for
 * motion-sensitive and dyslexic readers, and this one carries legal text.
 */

import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Platform, StyleSheet, View } from 'react-native';
import { colors, spacing, typography } from '@juwa/ui';
import { Txt } from './primitives';
import { usePrefersReducedMotion } from '../motion';

const MESSAGES = [
  'Coins are play money — no cash value, ever',
  'Daily bonus ready — collect free coins',
  'New game: Juwa Classic — 20 paylines',
  'Provably fair — verify any spin yourself',
  'No purchase necessary to play',
  '18+ — play responsibly',
];

/** Pixels per second. Slow enough to read a whole message as it passes. */
const SPEED = 42;

export function Ticker() {
  const offset = useRef(new Animated.Value(0)).current;
  const [copyWidth, setCopyWidth] = useState(0);
  const [paused, setPaused] = useState(false);
  const reducedMotion = usePrefersReducedMotion();

  useEffect(() => {
    if (!copyWidth || paused || reducedMotion) return;

    offset.setValue(0);
    const animation = Animated.loop(
      Animated.timing(offset, {
        toValue: -copyWidth,
        duration: (copyWidth / SPEED) * 1000,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    animation.start();
    return () => animation.stop();
  }, [copyWidth, paused, reducedMotion, offset]);

  const hoverProps =
    Platform.OS === 'web'
      ? ({
          onMouseEnter: () => setPaused(true),
          onMouseLeave: () => setPaused(false),
        } as object)
      : {};

  const copy = (measured: boolean) => (
    <View
      style={styles.copy}
      // Only the first copy reports its width; both are identical.
      onLayout={measured ? (e) => setCopyWidth(e.nativeEvent.layout.width) : undefined}
    >
      {MESSAGES.map((message) => (
        <View key={message} style={styles.item}>
          <View style={styles.dot} />
          <Txt variant="caption" color={colors.text.secondary} style={styles.text}>
            {message}
          </Txt>
        </View>
      ))}
    </View>
  );

  return (
    <View
      style={styles.bar}
      {...hoverProps}
      // Not a live region: it repeats forever, and announcing it on every pass
      // would make a screen reader unusable. The same messages appear as real
      // content elsewhere, so nothing here is only available in the ticker.
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Animated.View style={[styles.track, { transform: [{ translateX: offset }] }]}>
        {copy(true)}
        {copy(false)}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    height: 30,
    backgroundColor: colors.surface.raised,
    borderBottomWidth: 1,
    borderBottomColor: colors.surface.border,
    justifyContent: 'center',
    overflow: 'hidden',
  },
  track: { flexDirection: 'row' },
  copy: { flexDirection: 'row', alignItems: 'center' },
  item: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingRight: spacing.xl },
  dot: {
    width: 5,
    height: 5,
    borderRadius: 999,
    backgroundColor: colors.neon.cyan,
    marginLeft: spacing.xl,
  },
  text: {
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    lineHeight: typography.caption.lineHeight,
  },
});
