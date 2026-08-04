/**
 * The full-screen BIG WIN / MEGA WIN moment.
 *
 * This is the payoff the rest of the machine exists to set up, and it is the
 * one place where being loud is correct. It only appears at 25x the stake and
 * above, which is roughly once in a long session — rarity is what makes it
 * land. An overlay a player sees every few spins is an interruption.
 *
 * It never blocks the SPIN button. A celebration a player has to wait out is a
 * celebration they resent by the third time, so this sits above the reels,
 * ignores touches, and dismisses itself.
 */

import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { colors, radius, spacing, typography } from '@juwa/ui';
import { Txt } from './primitives';
import { CoinCounter } from './CoinCounter';
import { usePrefersReducedMotion, rollUpDuration, type WinTier } from '../motion';

export function WinOverlay({
  tier,
  amount,
  round,
  onDone,
}: {
  tier: WinTier;
  amount: number;
  round: number;
  onDone?: () => void;
}) {
  const visible = tier === 'big' || tier === 'mega';
  const reducedMotion = usePrefersReducedMotion();
  const enter = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!visible) return;

    enter.setValue(0);
    const animation = reducedMotion
      ? Animated.timing(enter, { toValue: 1, duration: 1, useNativeDriver: true })
      : Animated.spring(enter, {
          toValue: 1,
          friction: 5,
          tension: 90,
          useNativeDriver: true,
        });
    animation.start();

    // Hold for the roll-up plus a beat to read the number.
    const hold = rollUpDuration(tier) + 1200;
    const timer = setTimeout(() => onDone?.(), hold);
    return () => {
      animation.stop();
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, round, tier, reducedMotion]);

  if (!visible) return null;

  const scale = enter.interpolate({ inputRange: [0, 1], outputRange: [0.55, 1] });
  const mega = tier === 'mega';

  return (
    <View style={styles.layer} pointerEvents="none">
      <Animated.View style={[styles.card, { opacity: enter, transform: [{ scale }] }]}>
        <LinearGradient
          colors={
            mega
              ? ['#FF3D8A', '#7C3AED', '#08070E']
              : [colors.gold.default, '#7A6425', '#08070E']
          }
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
        <Txt variant="display" style={styles.title}>
          {mega ? 'Mega Win' : 'Big Win'}
        </Txt>
        <CoinCounter
          amount={amount}
          tier={tier}
          color={colors.text.primary}
          style={styles.amount}
        />
      </Animated.View>
    </View>
  );
}

/**
 * The cabinet shake.
 *
 * Wraps the reels rather than the whole screen: shaking the bet controls and
 * the balance makes the app feel broken, and shaking text is the fastest way to
 * make someone put a phone down. Silent under reduced motion.
 */
export function useCabinetShake(tier: WinTier, round: number): Animated.Value {
  const offset = useRef(new Animated.Value(0)).current;
  const reducedMotion = usePrefersReducedMotion();

  useEffect(() => {
    if (reducedMotion || (tier !== 'big' && tier !== 'mega')) return;

    const amplitude = tier === 'mega' ? 9 : 5;
    const shakes = tier === 'mega' ? 8 : 5;
    const sequence = Array.from({ length: shakes }, (_, i) =>
      Animated.timing(offset, {
        toValue: (i % 2 === 0 ? 1 : -1) * amplitude * (1 - i / shakes),
        duration: 55,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    const animation = Animated.sequence([
      ...sequence,
      Animated.timing(offset, { toValue: 0, duration: 55, useNativeDriver: true }),
    ]);
    animation.start();
    return () => {
      animation.stop();
      offset.setValue(0);
    };
  }, [tier, round, reducedMotion, offset]);

  return offset;
}

const styles = StyleSheet.create({
  layer: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
  card: {
    minWidth: 260,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.xl,
    borderRadius: radius.lg,
    borderWidth: 2,
    borderColor: colors.gold.light,
    alignItems: 'center',
    gap: spacing.sm,
    overflow: 'hidden',
  },
  title: {
    color: colors.text.primary,
    letterSpacing: 1.5,
    textShadowColor: 'rgba(0,0,0,0.6)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 6,
  },
  amount: {
    fontSize: typography.moneyLarge.fontSize,
    textShadowColor: 'rgba(0,0,0,0.6)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 6,
  },
});
