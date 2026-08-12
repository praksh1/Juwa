/**
 * Coins thrown from the centre of the reels.
 *
 * The brief called for a canvas particle burst. This app renders through React
 * Native Web, where there is no canvas to draw into — so the particles are
 * transformed views instead. Same result, and it composites on the GPU rather
 * than repainting a canvas every frame.
 *
 * Each coin is given a launch angle, a speed and a spin at birth, then follows
 * plain ballistics: constant horizontal velocity, gravity on the vertical. The
 * arc is what makes it read as thrown coins rather than as an expanding circle
 * of dots, and it costs four lines of arithmetic.
 *
 * Count scales with the win. Reduced motion renders nothing at all — this is
 * pure decoration, so removing it costs the player no information.
 */

import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { colors } from '@juwa/ui';
import { usePrefersReducedMotion, type WinTier } from '../motion';

const COUNT: Record<WinTier, number> = { none: 0, win: 0, burst: 18, big: 34, mega: 60, jackpot: 80 };
const DURATION: Record<WinTier, number> = { none: 0, win: 0, burst: 1100, big: 1600, mega: 2200, jackpot: 2800 };

const GRAVITY = 1400; // px per second squared
const COIN_SIZE = 14;

interface Particle {
  angle: number;
  speed: number;
  spin: number;
  size: number;
  hue: string;
  delay: number;
}

function makeParticles(count: number): Particle[] {
  const palette = [colors.gold.light, colors.gold.default, '#E08A00', colors.neon.cyan];
  return Array.from({ length: count }, (_, i) => ({
    // Biased upward: coins thrown sideways look like they were dropped.
    angle: -Math.PI / 2 + (Math.random() - 0.5) * 2.1,
    speed: 260 + Math.random() * 420,
    spin: (Math.random() - 0.5) * 1080,
    size: COIN_SIZE * (0.65 + Math.random() * 0.7),
    hue: palette[i % palette.length]!,
    delay: Math.random() * 220,
  }));
}

function Coin({ particle, duration }: { particle: Particle; duration: number }) {
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const animation = Animated.timing(progress, {
      toValue: 1,
      duration,
      delay: particle.delay,
      useNativeDriver: true,
    });
    animation.start();
    return () => animation.stop();
  }, [duration, particle.delay, progress]);

  const seconds = duration / 1000;
  const vx = Math.cos(particle.angle) * particle.speed;
  const vy = Math.sin(particle.angle) * particle.speed;

  // Position at the end of flight; Animated interpolates linearly to it, and
  // the vertical uses a second keyframe so the path bends instead of sagging.
  const translateX = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [0, vx * seconds],
  });
  const translateY = progress.interpolate({
    inputRange: [0, 0.5, 1],
    outputRange: [
      0,
      vy * seconds * 0.5 + 0.5 * GRAVITY * (seconds * 0.5) ** 2,
      vy * seconds + 0.5 * GRAVITY * seconds ** 2,
    ],
  });
  const rotate = progress.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', `${particle.spin}deg`],
  });
  const opacity = progress.interpolate({
    inputRange: [0, 0.7, 1],
    outputRange: [1, 1, 0],
  });

  return (
    <Animated.View
      style={[
        styles.coin,
        {
          width: particle.size,
          height: particle.size,
          borderRadius: particle.size / 2,
          backgroundColor: particle.hue,
          opacity,
          transform: [{ translateX }, { translateY }, { rotate }],
        },
      ]}
    />
  );
}

export function CoinBurst({ tier, round }: { tier: WinTier; round: number }) {
  const reducedMotion = usePrefersReducedMotion();
  const count = COUNT[tier];

  // Regenerated per round so two bursts in a row are not identical.
  const particles = useRef<Particle[]>([]);
  const generatedFor = useRef(-1);
  if (generatedFor.current !== round) {
    generatedFor.current = round;
    particles.current = makeParticles(count);
  }

  if (reducedMotion || count === 0) return null;

  return (
    <View style={styles.field} pointerEvents="none">
      {particles.current.map((particle, i) => (
        <Coin key={`${round}-${i}`} particle={particle} duration={DURATION[tier]} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  field: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    // Never intercepts a tap: a player must be able to hit SPIN mid-celebration.
    zIndex: 5,
  },
  coin: { position: 'absolute' },
});
