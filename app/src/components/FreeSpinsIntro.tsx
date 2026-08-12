/**
 * "8 FREE SPINS" — the card that stops the machine before the round starts.
 *
 * ## Why this exists
 *
 * The founder landed three scatters on Juwa Classic, eight free spins ran, and
 * they did not realise it had happened. Their recording starts mid-round
 * because there was nothing earlier worth catching. The announcement was a
 * seventeen-point caption in the readout strip under the reels, held for 1.8
 * seconds, while the reels behind it carried on looking like reels.
 *
 * That is the rarest thing in the base game — measured at one round in 95 to
 * 187 spins — announced more quietly than a bet confirmation.
 *
 * So it is now an overlay: it covers the machine, it is the size of the win
 * banner, and it is held for four seconds before a reel moves. A player cannot
 * miss it, which is the entire specification.
 *
 * ## Why it borrows the win card's clothes
 *
 * Same slam-in, same chasing lamps, same gradient. Not laziness — a player has
 * learned by now that a card with bulbs round it means something good just
 * happened, and spending that association on the bonus trigger is exactly what
 * it is for. What differs is the colour: magenta, which is the free-spin
 * palette the whole round is themed in.
 */

import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { colors, radius, spacing } from '@juwa/ui';
import { Txt } from './primitives';
import { ChaseLights } from './ChaseLights';
import { usePrefersReducedMotion } from '../motion';

export function FreeSpinsIntro({
  spins,
  /** The multiplier every win in the round carries, if any. */
  multiplier,
}: {
  spins: number;
  multiplier?: number;
}) {
  const enter = useRef(new Animated.Value(0)).current;
  const reduced = usePrefersReducedMotion();

  useEffect(() => {
    enter.setValue(0);
    const animation = reduced
      ? Animated.timing(enter, { toValue: 1, duration: 1, useNativeDriver: true })
      : Animated.spring(enter, { toValue: 1, friction: 5.5, tension: 110, useNativeDriver: true });
    animation.start();
    return () => animation.stop();
  }, [enter, reduced, spins]);

  // Arrives oversized and settles, exactly as the win banner does — the two
  // are the same kind of event and should land the same way.
  const scale = enter.interpolate({ inputRange: [0, 1], outputRange: [1.4, 1] });

  return (
    <View style={styles.layer} pointerEvents="none">
      <Animated.View style={[styles.card, { opacity: enter, transform: [{ scale }] }]}>
        <LinearGradient
          colors={['#FF3D8A', '#7C3AED', '#0B0718']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
        <ChaseLights count={28} size={7} duration={1_400} inset={6} />

        {/*
          The count is the biggest thing on the card, and the word under it is
          what the count means. A single line reading "8 FREE SPINS" at one
          size makes the number and the noun compete; stacked, the eye takes
          the number first and the label confirms it.
        */}
        <Txt variant="h1" color="#FFFFFF" style={styles.count}>
          {spins}
        </Txt>
        <Txt variant="h3" color="#FFFFFF" style={styles.label}>
          FREE SPINS
        </Txt>
        {multiplier && multiplier > 1 ? (
          <Txt variant="bodySmall" color="rgba(255,255,255,0.85)" style={styles.multiplier}>
            EVERY WIN {multiplier}×
          </Txt>
        ) : null}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  layer: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 12,
  },
  card: {
    minWidth: 300,
    maxWidth: '94%',
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.xl,
    borderRadius: radius.lg,
    borderWidth: 2,
    borderColor: '#FF9AC6',
    alignItems: 'center',
    overflow: 'hidden',
  },
  count: {
    fontSize: 72,
    lineHeight: 78,
    fontWeight: '900',
    textShadowColor: 'rgba(0,0,0,0.55)',
    textShadowOffset: { width: 0, height: 3 },
    textShadowRadius: 10,
  },
  label: {
    fontSize: 26,
    lineHeight: 30,
    letterSpacing: 4,
    fontWeight: '900',
    textShadowColor: 'rgba(0,0,0,0.55)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 8,
  },
  multiplier: { marginTop: spacing.sm, letterSpacing: 2, fontWeight: '800' },
});
