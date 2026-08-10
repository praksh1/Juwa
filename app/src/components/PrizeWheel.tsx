/**
 * The prize wheel.
 *
 * The oldest bonus in the building and still the clearest: one spin, one
 * number, nothing to read. It belongs to the three-reel machines, which until
 * now had no bonus of any kind — and to Triple Bar in particular, whose lobby
 * tile has been showing a jewelled wheel to players who tapped it and found
 * five reels of fruit and no wheel anywhere.
 *
 * ## The angle is derived backwards from the result
 *
 * The server has already decided which segment wins. So the wheel is not spun
 * and then read; the landing angle is computed from the answer and the wheel is
 * animated to it. Doing it the other way — spinning freely and seeing where it
 * stops — would mean the picture decided the payout, which is the one thing a
 * client must never do. It is the same construction the roulette wheel uses.
 */

import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import Svg, { Circle, Defs, G, LinearGradient, Path, Stop, Text as SvgText } from 'react-native-svg';
import { colors, spacing } from '@juwa/ui';
import { Txt } from './primitives';
import { usePrefersReducedMotion } from '../motion';

/** Whole turns before it starts slowing. Enough to read as a throw. */
const SPINS = 4;
const SPIN_MS = 3_200;
/** How long the winning segment is held before the round hands back. */
const HOLD_MS = 1_600;

const AnimatedG = Animated.createAnimatedComponent(G);

export interface PrizeWheelProps {
  /** Stake multiples per segment, in wheel order. */
  segments: number[];
  /** Which segment the server says won. */
  index: number;
  onDone: () => void;
}

export function PrizeWheel({ segments, index, onDone }: PrizeWheelProps) {
  const reduced = usePrefersReducedMotion();
  const turn = useRef(new Animated.Value(0)).current;
  const count = Math.max(1, segments.length);
  const arc = 360 / count;

  /*
   * Where the wheel must stop.
   *
   * The pointer is at twelve o'clock, so the winning segment's CENTRE has to
   * finish there: rotate back by its own index, then half a segment more to
   * centre it rather than align its edge.
   */
  const landing = SPINS * 360 - (index * arc + arc / 2);

  useEffect(() => {
    if (reduced) {
      turn.setValue(landing);
      const t = setTimeout(onDone, 900);
      return () => clearTimeout(t);
    }
    turn.setValue(0);
    Animated.timing(turn, {
      toValue: landing,
      duration: SPIN_MS,
      // Fast off the mark and a long tail — a wheel coasts to a stop against
      // friction, it does not ease symmetrically into one.
      easing: Easing.out(Easing.cubic),
      // FALSE, and it has to be. The native driver can only animate view
      // transforms and opacity; this is bound to an SVG `rotation` attribute,
      // which it cannot reach — with the driver on, the animation reports
      // itself finished having moved nothing and the wheel never turns.
      useNativeDriver: false,
    }).start(({ finished }) => {
      if (finished) setTimeout(onDone, HOLD_MS);
    });
  }, [landing, reduced, turn, onDone]);


  return (
    <View style={styles.wrap}>
      <Txt variant="caption" color={colors.gold.light} style={styles.title}>
        BONUS WHEEL
      </Txt>

      <View style={styles.stage}>
        <Svg width={230} height={230} viewBox="0 0 100 100">
          <Defs>
            <LinearGradient id="wheel-rim" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor="#FFF0B8" />
              <Stop offset="1" stopColor="#8A5F0A" />
            </LinearGradient>
          </Defs>

          {/*
            `rotation` rather than a transform style: react-native-svg's <G>
            takes SVG's own rotation attribute, and an Animated value is bound
            to it directly. A style transform is silently dropped here and the
            wheel simply never turns.
          */}
          <AnimatedG rotation={turn as unknown as number} origin="50, 50">
            {segments.map((value, i) => (
              <Path
                key={i}
                d={wedge(50, 50, 44, i * arc, (i + 1) * arc)}
                fill={SEGMENT_FILL[i % SEGMENT_FILL.length]}
                stroke="#1A1206"
                strokeWidth={0.8}
              />
            ))}
            {segments.map((value, i) => {
              const mid = i * arc + arc / 2;
              const rad = ((mid - 90) * Math.PI) / 180;
              return (
                <SvgText
                  key={`t${i}`}
                  x={50 + 30 * Math.cos(rad)}
                  y={50 + 30 * Math.sin(rad) + 3}
                  fontSize={9}
                  fontWeight="900"
                  fill="#1A1206"
                  textAnchor="middle"
                >
                  {`${value}x`}
                </SvgText>
              );
            })}
          </AnimatedG>

          {/* Rim and hub sit OUTSIDE the rotating group: a wheel's frame does
              not turn with it, and rotating them betrays the whole illusion. */}
          <Circle cx={50} cy={50} r={44} fill="none" stroke="url(#wheel-rim)" strokeWidth={4} />
          <Circle cx={50} cy={50} r={7} fill="url(#wheel-rim)" stroke="#1A1206" strokeWidth={1.2} />
          {/* The pointer, at twelve o'clock — the angle above is derived to it. */}
          <Path d="M50,2 L56,14 H44 Z" fill={colors.gold.light} stroke="#1A1206" strokeWidth={1.2} />
        </Svg>
      </View>
    </View>
  );
}

/** One wedge of the wheel. Angles in degrees, 0 = twelve o'clock. */
function wedge(cx: number, cy: number, r: number, from: number, to: number): string {
  const rad = (deg: number) => ((deg - 90) * Math.PI) / 180;
  const x1 = cx + r * Math.cos(rad(from));
  const y1 = cy + r * Math.sin(rad(from));
  const x2 = cx + r * Math.cos(rad(to));
  const y2 = cy + r * Math.sin(rad(to));
  const large = to - from > 180 ? 1 : 0;
  return `M${cx},${cy} L${x1},${y1} A${r},${r} 0 ${large} 1 ${x2},${y2} Z`;
}

/**
 * Alternating segment colours.
 *
 * Alternating rather than value-coded on purpose: a wheel whose big prize is
 * the only red one tells the player where it is before it stops, and watching
 * it go past is most of what a wheel is for.
 */
const SEGMENT_FILL = ['#F5C542', '#E3B23C', '#FFF0B8', '#D19A1E'];

const styles = StyleSheet.create({
  wrap: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(6, 4, 14, 0.94)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    zIndex: 20,
  },
  title: { letterSpacing: 3, fontWeight: '900' },
  stage: { alignItems: 'center', justifyContent: 'center' },
});
