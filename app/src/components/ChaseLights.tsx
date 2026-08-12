/**
 * Lamps chasing around a border, and neon running down a rail.
 *
 * ## Why this earns its place
 *
 * The founder's reference video is a camera pointed at a physical cabinet, and
 * the single cheapest thing in it — no artwork, no model, no texture — is the
 * light. A rainbow of bulbs runs around the BIG WIN frame and strips glow down
 * both sides of the machine. That is most of what makes it read as an object
 * in a room rather than a page in a browser, and it costs one animated value.
 *
 * ## One driver, many lamps
 *
 * Every lamp reads the SAME `Animated.Value`, offset by its own position around
 * the loop. Twenty-eight lamps is twenty-eight interpolations of one number,
 * not twenty-eight animations — which matters on a phone that is also spinning
 * five reels and simulating two hundred falling coins.
 *
 * ## Why the colours are fixed and only the brightness moves
 *
 * React Native's colour interpolation works, and it is the wrong tool here: a
 * bulb that changes colour reads as a screen, and a bulb that stays one colour
 * and gets brighter reads as a bulb. The rainbow comes from the lamps being
 * different colours from each other, which is what a real cabinet does — the
 * bulbs are coloured glass and only the current changes.
 *
 * Silent under reduced motion: the lamps are still there and evenly lit, so the
 * frame keeps its shape and only the chase stops.
 */

import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { usePrefersReducedMotion } from '../motion';

/**
 * Coloured glass, in the order a cabinet's bulbs are usually set.
 *
 * Warm-cool-warm rather than a literal spectrum: a true rainbow has a green
 * that goes muddy against gold, and these sit over gold most of the time.
 */
const BULBS = ['#FFD86B', '#FF5FA8', '#5FD8FF', '#FFF6D8', '#B77BFF', '#6BFFB0'];

/** How dim a lamp goes between pulses. Never zero — an unlit bulb is still there. */
const DIM = 0.25;

/**
 * The brightness curve for a lamp sitting at `at` around a loop of length 1.
 *
 * ## Why the pulse is written out three times
 *
 * The driver runs 0 to 1 and wraps, so a lamp near either end has to be lit by
 * a pulse that is partly off the end of the range. The obvious fix — clamping
 * the keyframes into [0, 1] — collapses points on top of each other, and
 * `interpolate` requires its input range to be STRICTLY increasing; a duplicate
 * makes it throw or, worse, silently produce a lamp that never lights.
 *
 * So the pulse is emitted at `at - 1`, `at` and `at + 1`. Nothing outside [0, 1]
 * is ever reached — the driver cannot get there — but the copies shape the
 * curve at the edges, so a lamp at 0.02 is already brightening as the pulse
 * comes round. Monotonic by construction for any width under a third of a lap.
 */
function pulseCurve(at: number, width: number): { input: number[]; output: number[] } {
  const w = Math.min(0.3, Math.max(0.02, width));
  const input: number[] = [];
  const output: number[] = [];
  for (const centre of [at - 1, at, at + 1]) {
    input.push(centre - w, centre, centre + w);
    output.push(DIM, 1, DIM);
  }
  return { input, output };
}

export interface ChaseLightsProps {
  /** How many lamps around the whole perimeter. Even numbers sit better. */
  count?: number;
  /** Lamp diameter in points. */
  size?: number;
  /** One full lap, in milliseconds. Lower is more frantic. */
  duration?: number;
  /** How much of the ring is lit at once, 0..1. A short pulse reads as faster. */
  width?: number;
  /** Inset from the edge of the parent, in points. */
  inset?: number;
}

/**
 * A ring of lamps around whatever this is dropped into.
 *
 * Positioned as PERCENTAGES of the parent, so it needs no measurement and
 * re-fits itself when the parent resizes — which the win card does, because
 * its width follows the amount inside it.
 */
export function ChaseLights({
  count = 28,
  size = 7,
  duration = 1_800,
  width = 0.22,
  inset = -3,
}: ChaseLightsProps) {
  const travel = useRef(new Animated.Value(0)).current;
  const reduced = usePrefersReducedMotion();

  useEffect(() => {
    if (reduced) return undefined;
    travel.setValue(0);
    const loop = Animated.loop(
      Animated.timing(travel, {
        toValue: 1,
        duration,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [travel, duration, reduced]);

  /*
   * Where each lamp sits, as a fraction of the way round the perimeter.
   *
   * The rectangle is walked in four runs — top, right, bottom, left — with the
   * corners shared, so the lamps are evenly spaced along the EDGE rather than
   * evenly spaced in angle. Angle spacing bunches them at the corners of a wide
   * box, which is exactly the shape this is used on.
   */
  const lamps = React.useMemo(() => {
    const perSide = Math.max(2, Math.round(count / 4));
    const out: { left: `${number}%`; top: `${number}%`; phase: number; colour: string }[] = [];
    const push = (left: number, top: number) => {
      out.push({
        left: `${left * 100}%`,
        top: `${top * 100}%`,
        phase: out.length,
        colour: BULBS[out.length % BULBS.length]!,
      });
    };
    for (let i = 0; i < perSide; i += 1) push(i / perSide, 0);
    for (let i = 0; i < perSide; i += 1) push(1, i / perSide);
    for (let i = perSide; i > 0; i -= 1) push(i / perSide, 1);
    for (let i = perSide; i > 0; i -= 1) push(0, i / perSide);
    return out;
  }, [count]);

  return (
    <View
      style={[StyleSheet.absoluteFill, { margin: inset }]}
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {lamps.map((lamp, index) => {
        const at = lamp.phase / lamps.length;
        const curve = pulseCurve(at, width);
        const brightness = reduced
          ? 0.55
          : travel.interpolate({
              inputRange: curve.input,
              outputRange: curve.output,
              extrapolate: 'clamp',
            });

        return (
          <Animated.View
            key={index}
            style={{
              position: 'absolute',
              left: lamp.left,
              top: lamp.top,
              width: size,
              height: size,
              marginLeft: -size / 2,
              marginTop: -size / 2,
              borderRadius: size / 2,
              backgroundColor: lamp.colour,
              opacity: brightness,
              // The halo. A bulb with no bloom is a dot; this is what makes it
              // read as something switched on.
              shadowColor: lamp.colour,
              shadowOpacity: 0.9,
              shadowRadius: size * 0.9,
              shadowOffset: { width: 0, height: 0 },
            }}
          />
        );
      })}
    </View>
  );
}

/**
 * A neon strip running down one edge, as on the sides of the cabinet.
 *
 * Separate from the ring because it is a different object: a rail is a
 * continuous tube with light travelling along it, not a row of bulbs. The
 * travelling highlight is one translated block behind a coloured bar.
 */
export function NeonRail({
  colour = '#5FD8FF',
  duration = 2_600,
  /**
   * Four points, not three.
   *
   * Measured on a rendered page: at three points and 34% opacity, a rail in a
   * gold-themed game sat on the cabinet's gold border and was invisible — the
   * element was there, the right size and in the right place, and simply could
   * not be seen. Thicker and brighter, and the travelling highlight is what
   * carries it when the tube's own colour is close to the frame's.
   */
  thickness = 4,
  height,
}: {
  colour?: string;
  duration?: number;
  thickness?: number;
  /** The rail's length in points, needed to translate the highlight along it. */
  height: number;
}) {
  const travel = useRef(new Animated.Value(0)).current;
  const reduced = usePrefersReducedMotion();

  useEffect(() => {
    if (reduced) return undefined;
    travel.setValue(0);
    const loop = Animated.loop(
      Animated.timing(travel, {
        toValue: 1,
        duration,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [travel, duration, reduced]);

  const slide = travel.interpolate({
    inputRange: [0, 1],
    // Starts above the rail and finishes below it, so the highlight enters and
    // leaves rather than appearing in the middle.
    outputRange: [-height * 0.4, height],
  });

  return (
    <View
      style={{
        width: thickness,
        height,
        borderRadius: thickness,
        backgroundColor: colour,
        opacity: 0.55,
        overflow: 'hidden',
        shadowColor: colour,
        shadowOpacity: 0.8,
        shadowRadius: 6,
        shadowOffset: { width: 0, height: 0 },
      }}
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {reduced ? null : (
        <Animated.View
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            height: height * 0.4,
            backgroundColor: '#FFFFFF',
            opacity: 0.85,
            transform: [{ translateY: slide }],
          }}
        />
      )}
    </View>
  );
}
