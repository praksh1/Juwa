/**
 * The bonus, made visible before you have ever won one.
 *
 * ## The problem, stated properly
 *
 * Measured over 40,000 spins per model, a bonus round fires about once in 95
 * to 187 spins on most machines here, and once in 53 on Triple Bar. Those are
 * ordinary rates — real slots sit in the same band, and lowering them would
 * make the bonus worth less every time it landed. The problem is not the
 * frequency. It is that for the first hundred spins there was NO EVIDENCE THE
 * BONUS EXISTED.
 *
 * The founder played several games and reported, separately and correctly:
 * that Triple Bar's wheel is pointless because nothing explains why it is
 * there, and that they had never seen a free-spins round in any game. Both are
 * the same defect. A feature a player cannot see is a feature the game does
 * not have, however faithfully it is implemented underneath, and a paytable
 * behind a button is not a substitute — it is the thing you read after you
 * already suspect there is something to read about.
 *
 * ## What this shows
 *
 * A permanent panel beside the reels, on every machine that has a bonus,
 * carrying three facts in the order a player needs them:
 *
 *   what you are collecting  — SCATTERS
 *   how close you are        — three lamps, filling as they land
 *   what you get             — "3 = 10 FREE SPINS", or "3 = BONUS WHEEL"
 *
 * The reward is spelled out rather than implied by an icon. "0/3" under a
 * picture of a wheel was the previous attempt and it is what prompted "I don't
 * understand the concept of the wheel, why is it there, what is the point" —
 * which is the correct reaction to a progress bar towards an unnamed prize.
 *
 * ## The lamps are per SPIN, not cumulative
 *
 * Because that is what the rule actually is: three scatters together on one
 * spin, not three collected over an evening. A meter that appeared to save
 * progress would be a more attractive lie than the silence it replaced, and a
 * player would catch it resetting within a dozen spins.
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

/** What landing the scatters actually gets you. */
export type BonusReward =
  | { kind: 'wheel'; segments: number[] }
  | { kind: 'free-spins'; spins: number; multiplier: number };

export interface BonusMeterProps {
  reward: BonusReward;
  /** Scatters on the current spin, 0 upward. */
  scatters: number;
  /** How many are needed. Three, for every game in the catalogue today. */
  trigger: number;
  /** True while the bonus is actually running — the meter steps aside. */
  active: boolean;
}

export function BonusMeter({ reward, scatters, trigger, active }: BonusMeterProps) {
  const reduced = usePrefersReducedMotion();
  const spin = useRef(new Animated.Value(0)).current;
  const glow = useRef(new Animated.Value(0)).current;
  const armed = scatters >= trigger - 1 && !active;

  /**
   * A slow idle rotation, for the wheel games only.
   *
   * The whole point is to read as a WHEEL rather than as an icon, and nothing
   * says wheel like turning. Slow enough to be scenery — it must never compete
   * with the reels, which are the thing being watched.
   */
  useEffect(() => {
    if (reduced || reward.kind !== 'wheel') return undefined;
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
  }, [reduced, spin, reward.kind]);

  /** One scatter short: the badge pulses, because it is nearly happening. */
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

  /**
   * The reward, in the fewest words that are still specific.
   *
   * "BONUS" would fit more easily and says nothing. The number is the part
   * that makes it worth watching for, so the number stays even when the label
   * has to lose a word.
   */
  const rewardLabel =
    reward.kind === 'wheel' ? 'BONUS\nWHEEL' : `${reward.spins}\nFREE SPINS`;

  return (
    <View
      style={[styles.wrap, armed && styles.wrapArmed]}
      accessibilityRole="text"
      accessibilityLabel={
        `Bonus: land ${trigger} scatters for ` +
        (reward.kind === 'wheel' ? 'the bonus wheel' : `${reward.spins} free spins`) +
        `. ${scatters} of ${trigger} on this spin.`
      }
    >
      <Animated.View style={{ transform: [{ scale }] }}>
        {reward.kind === 'wheel' ? (
          <Animated.View style={{ transform: [{ rotate }] }}>
            <MiniWheel segments={reward.segments} />
          </Animated.View>
        ) : (
          <ScatterBadge />
        )}
      </Animated.View>

      <View style={styles.lamps}>
        {Array.from({ length: trigger }, (_, i) => (
          <View key={i} style={[styles.lamp, i < scatters && styles.lampLit]} />
        ))}
      </View>

      {/*
        Two lines, always present, so the panel never changes height as the
        state changes — a meter that grows and shrinks beside a spinning reel
        reads as a glitch.
      */}
      <Txt variant="caption" color={colors.text.muted} style={styles.collect}>
        {active ? 'RUNNING' : armed ? 'ONE MORE!' : `${scatters}/${trigger} SCATTER`}
      </Txt>
      <Txt
        variant="caption"
        color={armed ? colors.gold.light : colors.text.secondary}
        style={styles.reward}
      >
        {rewardLabel}
      </Txt>
    </View>
  );
}

/**
 * The scatter, for machines whose bonus is free spins rather than a wheel.
 *
 * A star because that is what a scatter is on nine slots in ten, and because
 * the meter's job is to be recognised at a glance from the corner of the eye
 * while the reels are moving — not to be a second, smaller paytable.
 */
function ScatterBadge() {
  const points = Array.from({ length: 10 }, (_, i) => {
    const r = i % 2 === 0 ? 20 : 8.5;
    const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
    return `${(24 + r * Math.cos(a)).toFixed(2)},${(24 + r * Math.sin(a)).toFixed(2)}`;
  }).join(' L');

  return (
    <Svg width={48} height={48} viewBox="0 0 48 48">
      <Defs>
        <LinearGradient id="bm-star" x1="0" y1="0" x2="0.3" y2="1">
          <Stop offset="0" stopColor="#FFF3CE" />
          <Stop offset="0.45" stopColor="#F0C44E" />
          <Stop offset="1" stopColor="#7A5210" />
        </LinearGradient>
      </Defs>
      <Circle cx={24} cy={24} r={23} fill="#1A1330" stroke="#4A3A78" strokeWidth={1.4} />
      <Path d={`M${points} Z`} fill="url(#bm-star)" stroke="#5A4008" strokeWidth={0.8} />
    </Svg>
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
  const best = Math.max(...segments);
  const wedges = Array.from({ length: count }, (_, i) => {
    const from = (i / count) * Math.PI * 2 - Math.PI / 2;
    const to = ((i + 1) / count) * Math.PI * 2 - Math.PI / 2;
    const x1 = 24 + R * Math.cos(from);
    const y1 = 24 + R * Math.sin(from);
    const x2 = 24 + R * Math.cos(to);
    const y2 = 24 + R * Math.sin(to);
    // The biggest prize gets the bright wedge, so the eye lands on the thing
    // worth wanting rather than on an arbitrary slice.
    return (
      <Path
        key={i}
        d={`M24 24 L${x1} ${y1} A${R} ${R} 0 0 1 ${x2} ${y2} Z`}
        fill={segments[i] === best ? '#F5D06A' : i % 2 === 0 ? '#7A1428' : '#4A0C1A'}
        stroke="#2A0409"
        strokeWidth={0.6}
      />
    );
  });

  return (
    <Svg width={48} height={48} viewBox="0 0 48 48">
      <Defs>
        <LinearGradient id="bm-rim" x1="0" y1="0" x2="0.3" y2="1">
          <Stop offset="0" stopColor="#F7E6A8" />
          <Stop offset="0.5" stopColor="#C8A44D" />
          <Stop offset="1" stopColor="#6E5210" />
        </LinearGradient>
      </Defs>
      <Circle cx={24} cy={24} r={23} fill="url(#bm-rim)" />
      <G>{wedges}</G>
      <Circle cx={24} cy={24} r={4.5} fill="url(#bm-rim)" stroke="#2A0409" strokeWidth={0.8} />
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
    maxWidth: 78,
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
  collect: { fontWeight: '800', letterSpacing: 0.3, fontSize: 9, lineHeight: 11 },
  reward: { fontWeight: '900', letterSpacing: 0.3, fontSize: 10, lineHeight: 12, textAlign: 'center' },
});
