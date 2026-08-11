/**
 * A wheel you can see before you win one.
 *
 * ## The problem this exists for
 *
 * Triple Bar's lobby tile is a large jewelled prize wheel. Tap it and you get a
 * three-reel machine with a lever and no wheel anywhere — the wheel is a bonus
 * that fires when three scatters land, which even at its new rate is once in
 * about fifty spins. The founder played it three separate times and reported,
 * three separate times, that the game has no wheel. They were describing the
 * experience accurately: a feature you cannot see is a feature the game does
 * not appear to have.
 *
 * Making it fire more often helped and was not enough on its own, because the
 * first forty-nine spins still show no evidence the wheel exists.
 *
 * ## What this shows
 *
 * The wheel itself, small, beside the reels, all the time — with the three
 * scatter lamps under it filling in as scatters land on the current spin.
 *
 * The lamps are per SPIN, not cumulative, because that is what the rule
 * actually is: three scatters together, not three collected over time. A meter
 * that appeared to save progress between spins would be a more attractive lie
 * than the silence it replaced, and a player would notice it resetting.
 *
 * Two lamps lit is a near miss, and being able to SEE a near miss is most of
 * what makes a bonus feel reachable rather than theoretical.
 */

import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import Svg, { Circle, G, Path, Defs, LinearGradient, Stop } from 'react-native-svg';
import { colors, radius, spacing } from '@juwa/ui';
import { Txt } from './primitives';
import { usePrefersReducedMotion } from '../motion';

export interface WheelMeterProps {
  /** The wheel's real face, so the preview is the wheel they will get. */
  segments: number[];
  /** Scatters on the current spin, 0 upward. */
  scatters: number;
  /** How many are needed. Three, for every game that has one today. */
  trigger: number;
  /** True while the bonus is actually running — the meter steps aside. */
  active: boolean;
}

export function WheelMeter({ segments, scatters, trigger, active }: WheelMeterProps) {
  const reduced = usePrefersReducedMotion();
  const spin = useRef(new Animated.Value(0)).current;
  const glow = useRef(new Animated.Value(0)).current;
  const armed = scatters >= trigger - 1 && !active;

  /**
   * A slow idle rotation.
   *
   * The whole point is to read as a WHEEL rather than as an icon, and nothing
   * says wheel like turning. Slow enough to be scenery — it must never compete
   * with the reels, which are the thing being watched.
   */
  useEffect(() => {
    if (reduced) return undefined;
    const loop = Animated.loop(
      Animated.timing(spin, {
        toValue: 1,
        duration: 14_000,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [reduced, spin]);

  /** One scatter short: the wheel pulses, because it is nearly happening. */
  useEffect(() => {
    if (!armed || reduced) {
      glow.setValue(0);
      return undefined;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(glow, { toValue: 1, duration: 420, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.timing(glow, { toValue: 0, duration: 420, easing: Easing.in(Easing.quad), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [armed, reduced, glow]);

  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  const scale = glow.interpolate({ inputRange: [0, 1], outputRange: [1, 1.09] });

  return (
    <View style={[styles.wrap, armed && styles.wrapArmed]}>
      <Animated.View style={{ transform: [{ scale }] }}>
        <Animated.View style={{ transform: [{ rotate }] }}>
          <MiniWheel segments={segments} />
        </Animated.View>
      </Animated.View>

      <View style={styles.lamps}>
        {Array.from({ length: trigger }, (_, i) => (
          <View key={i} style={[styles.lamp, i < scatters && styles.lampLit]} />
        ))}
      </View>

      <Txt variant="caption" color={armed ? colors.gold.light : colors.text.muted} style={styles.label}>
        {active ? 'SPINNING' : armed ? 'ONE MORE!' : `${scatters}/${trigger}`}
      </Txt>
    </View>
  );
}

/**
 * The wheel's face, drawn from the real segments.
 *
 * Small enough that the numbers would be unreadable, so it does not try: what
 * carries at this size is the alternating wedges and the gold rim, which is
 * what makes it recognisable as the same object that fills the screen when it
 * fires.
 */
function MiniWheel({ segments }: { segments: number[] }) {
  const count = Math.max(4, segments.length);
  const R = 21;
  const wedges = Array.from({ length: count }, (_, i) => {
    const from = (i / count) * Math.PI * 2 - Math.PI / 2;
    const to = ((i + 1) / count) * Math.PI * 2 - Math.PI / 2;
    const x1 = 24 + R * Math.cos(from);
    const y1 = 24 + R * Math.sin(from);
    const x2 = 24 + R * Math.cos(to);
    const y2 = 24 + R * Math.sin(to);
    // The biggest prize gets the bright wedge, so the eye lands on the thing
    // worth wanting rather than on an arbitrary slice.
    const best = segments[i] === Math.max(...segments);
    return (
      <Path
        key={i}
        d={`M24 24 L${x1} ${y1} A${R} ${R} 0 0 1 ${x2} ${y2} Z`}
        fill={best ? '#F5D06A' : i % 2 === 0 ? '#7A1428' : '#4A0C1A'}
        stroke="#2A0409"
        strokeWidth={0.6}
      />
    );
  });

  return (
    <Svg width={48} height={48} viewBox="0 0 48 48">
      <Defs>
        <LinearGradient id="wm-rim" x1="0" y1="0" x2="0.3" y2="1">
          <Stop offset="0" stopColor="#F7E6A8" />
          <Stop offset="0.5" stopColor="#C8A44D" />
          <Stop offset="1" stopColor="#6E5210" />
        </LinearGradient>
      </Defs>
      <Circle cx={24} cy={24} r={23} fill="url(#wm-rim)" />
      <G>{wedges}</G>
      <Circle cx={24} cy={24} r={4.5} fill="url(#wm-rim)" stroke="#2A0409" strokeWidth={0.8} />
    </Svg>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: 'center',
    gap: 3,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.xs,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  wrapArmed: {
    borderColor: colors.gold.default,
    backgroundColor: 'rgba(200,164,77,0.12)',
  },
  lamps: { flexDirection: 'row', gap: 3 },
  lamp: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: 'rgba(255,255,255,0.16)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.22)',
  },
  lampLit: { backgroundColor: colors.gold.default, borderColor: colors.gold.light },
  label: { fontWeight: '900', letterSpacing: 0.5 },
});
