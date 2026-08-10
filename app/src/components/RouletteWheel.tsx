/**
 * A roulette wheel that actually turns.
 *
 * What was here before was a 96-point circle that displayed a number, with a
 * `setInterval` flicking random numbers into it every 70ms for 2.2 seconds. A
 * player described it exactly: "there is a round spin game, but it never spins
 * in circles." The lobby tile shows a roulette wheel, so the game promises a
 * wheel and then shows a number appearing in a disc.
 *
 * ## What a wheel has to get right
 *
 * The rim turns one way and the ball runs the other. That counter-rotation is
 * the whole visual identity of roulette — a ball going the same way as the
 * wheel reads as a fairground ride, not a casino table.
 *
 * The ball must LAND IN THE POCKET THE SERVER CHOSE. Not near it, not on a
 * number that is then overwritten by a readout. The angles below are worked
 * backwards from the result, so the ball's final position and the settled
 * wheel's pocket order agree by construction — the picture cannot say 17 while
 * the ledger says 32.
 *
 * The pockets are in the real single-zero order, which is not 0-1-2-3. A
 * European wheel alternates high and low, red and black, and puts consecutive
 * numbers on opposite sides — and a player who knows roulette will notice
 * within one spin that the neighbours are wrong.
 *
 * ## Timing
 *
 * Driven from `spinNow()`, the same audio clock the reels and their stop sounds
 * use, and for the same reason: a wheel tweened on frame deltas and a sound
 * booked on the audio clock agree at the start and drift apart from there.
 */

import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import Svg, { Circle, G, Path, Text as SvgText } from 'react-native-svg';
import { colors } from '@juwa/ui';
import { spinNow } from '../sound';

/**
 * The single-zero wheel, clockwise from the top.
 *
 * Not a sequence anyone should invent: it is the physical layout of a European
 * wheel, and it is what makes "neighbours" and "sectors" mean anything.
 */
export const WHEEL_ORDER = [
  0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10,
  5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26,
] as const;

const POCKETS = WHEEL_ORDER.length;
const STEP = 360 / POCKETS;

const RED = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
const pocketColour = (n: number) =>
  n === 0 ? '#0E7A3C' : RED.has(n) ? '#B3122B' : '#141019';

/** Turns per second while the wheel is free-running. */
const WHEEL_TURNS_PER_SEC = 0.55;
/** The ball runs faster, and the other way. */
const BALL_TURNS_PER_SEC = -1.35;
/** Whole turns the wheel and ball each cover while coming to rest. */
const WHEEL_SETTLE_TURNS = 2;
const BALL_SETTLE_TURNS = 4;

/**
 * Deceleration for a wheel, which is NOT the curve the reels use.
 *
 * A reel is a detented drum: it overshoots its stop and rocks back into it, and
 * `landPosition` in @juwa/ui models that. A roulette wheel has no detents. It
 * coasts against friction and stops. Reusing the reel curve here would put a
 * visible rock-back on a wheel, which is a thing wheels do not do.
 */
function coast(u: number): number {
  const p = 1 - u;
  return 1 - p * p * p;
}

/** Positive modulo — `%` keeps the sign in JS and angles must not go backwards. */
const mod = (a: number, n: number) => ((a % n) + n) % n;

export type WheelPhase = 'idle' | 'spinning' | 'landing';

export interface RouletteWheelProps {
  size: number;
  phase: WheelPhase;
  /** The pocket the server settled on. Required before landing can begin. */
  target: number | null;
  /** Absolute time on the shared clock at which the wheel begins settling. */
  landFrom?: number;
  landDuration?: number;
  onLanded?: () => void;
}

export function RouletteWheel({
  size,
  phase,
  target,
  landFrom = 0,
  landDuration = 3.4,
  onLanded,
}: RouletteWheelProps) {
  const wheel = useRef(new Animated.Value(0)).current;
  const ballX = useRef(new Animated.Value(0)).current;
  const ballY = useRef(new Animated.Value(0)).current;

  const landed = useRef(onLanded);
  landed.current = onLanded;

  const centre = size / 2;
  /** Where the ball runs before it drops, and where it comes to rest. */
  const trackRadius = size * 0.43;
  const pocketRadius = size * 0.33;
  const ballSize = Math.max(7, size * 0.045);

  /**
   * The wheel's angle when it is at rest, kept continuous across phases.
   *
   * Held in a ref rather than recomputed, because the landing has to start from
   * wherever the free spin actually got to. Restarting from zero would jump the
   * wheel a fraction of a turn at the exact moment the player is watching it.
   */
  const angleAtHandover = useRef({ wheel: 0, ball: 0 });

  const place = (ballAngle: number, radius: number) => {
    const radians = (ballAngle * Math.PI) / 180;
    ballX.setValue(Math.sin(radians) * radius);
    ballY.setValue(-Math.cos(radians) * radius);
  };

  /**
   * Before the first spin the ball rests on the track, not at dead centre.
   *
   * Its position is only ever written by the two animations below, so without
   * this it sits on the spindle — which looks like a bearing rather than a
   * ball. Deliberately not run once a target exists: after a spin the ball
   * must stay in the pocket it landed in.
   */
  useEffect(() => {
    if (phase !== 'idle' || target !== null) return;
    place(0, trackRadius);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, target, trackRadius]);

  // ------------------------------------------------------------ free spin
  useEffect(() => {
    if (phase !== 'spinning') return;
    const startedAt = spinNow();
    let frame = 0;
    const tick = () => {
      const elapsed = spinNow() - startedAt;
      const w = elapsed * WHEEL_TURNS_PER_SEC * 360;
      const b = elapsed * BALL_TURNS_PER_SEC * 360;
      angleAtHandover.current = { wheel: w, ball: b };
      wheel.setValue(w);
      place(b, trackRadius);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, trackRadius]);

  // -------------------------------------------------------------- landing
  useEffect(() => {
    if (phase !== 'landing' || target === null) return;

    const index = WHEEL_ORDER.indexOf(target as (typeof WHEEL_ORDER)[number]);
    if (index < 0) return;

    const from = angleAtHandover.current;
    /*
     * Work backwards from the answer.
     *
     * The wheel finishes on a whole number of turns, so at rest pocket `i` sits
     * at `i * STEP` clockwise from the top. The ball is then sent forward to
     * exactly that angle, plus whole turns for the drama. Both end points are
     * derived from the result rather than approached by it, which is what makes
     * the picture and the payout the same fact.
     */
    const wheelTo = from.wheel + WHEEL_SETTLE_TURNS * 360 + mod(-from.wheel, 360);
    const pocketAngle = index * STEP;
    const ballTo = from.ball - BALL_SETTLE_TURNS * 360 - mod(from.ball - pocketAngle, 360);

    let frame = 0;
    let done = false;
    const tick = () => {
      const u = Math.min(1, Math.max(0, (spinNow() - landFrom) / landDuration));
      const e = coast(u);
      wheel.setValue(from.wheel + (wheelTo - from.wheel) * e);

      // The ball rides the outer track and only drops in over the last third,
      // which is when a real ball leaves the rim and rattles down.
      const drop = Math.max(0, (u - 0.66) / 0.34);
      const radius = trackRadius + (pocketRadius - trackRadius) * coast(Math.min(1, drop));
      place(from.ball + (ballTo - from.ball) * e, radius);

      if (u < 1) {
        frame = requestAnimationFrame(tick);
        return;
      }
      // Land exactly, not nearly: the ball must sit IN the pocket.
      wheel.setValue(wheelTo);
      place(ballTo, pocketRadius);
      if (!done) {
        done = true;
        landed.current?.();
      }
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, target, landFrom, landDuration, trackRadius, pocketRadius]);

  const rotate = wheel.interpolate({
    inputRange: [0, 360],
    outputRange: ['0deg', '360deg'],
  });

  return (
    <View style={{ width: size, height: size }} accessibilityElementsHidden>
      <Animated.View style={[StyleSheet.absoluteFill, { transform: [{ rotate }] }]}>
        <Svg width={size} height={size} viewBox="0 0 100 100">
          {/* Rim */}
          <Circle cx={50} cy={50} r={49} fill="#1B1410" stroke={colors.gold.dark} strokeWidth={2} />
          <G>
            {WHEEL_ORDER.map((n, i) => (
              <Pocket key={n} number={n} index={i} />
            ))}
          </G>
          {/* Hub */}
          <Circle cx={50} cy={50} r={20} fill="#241A12" stroke={colors.gold.dark} strokeWidth={1.5} />
          <Circle cx={50} cy={50} r={7} fill={colors.gold.default} />
        </Svg>
      </Animated.View>

      {/* The ball is OUTSIDE the rotating group: it has its own motion, and
          rotating it with the wheel would glue it to one pocket for the whole
          spin — which is precisely what a roulette ball never does. */}
      <Animated.View
        pointerEvents="none"
        style={[
          styles.ball,
          {
            width: ballSize,
            height: ballSize,
            borderRadius: ballSize / 2,
            left: centre - ballSize / 2,
            top: centre - ballSize / 2,
            transform: [{ translateX: ballX }, { translateY: ballY }],
          },
        ]}
      />
    </View>
  );
}

/** One pocket: a wedge, its dividing fret, and the number. */
function Pocket({ number, index }: { number: number; index: number }) {
  const start = index * STEP - STEP / 2 - 90;
  const end = start + STEP;
  const rad = (deg: number) => (deg * Math.PI) / 180;
  const outer = 46;
  const inner = 21;
  const x1 = 50 + Math.cos(rad(start)) * outer;
  const y1 = 50 + Math.sin(rad(start)) * outer;
  const x2 = 50 + Math.cos(rad(end)) * outer;
  const y2 = 50 + Math.sin(rad(end)) * outer;
  const x3 = 50 + Math.cos(rad(end)) * inner;
  const y3 = 50 + Math.sin(rad(end)) * inner;
  const x4 = 50 + Math.cos(rad(start)) * inner;
  const y4 = 50 + Math.sin(rad(start)) * inner;

  const mid = start + STEP / 2;
  const tx = 50 + Math.cos(rad(mid)) * 34;
  const ty = 50 + Math.sin(rad(mid)) * 34;

  return (
    <>
      <Path
        d={`M${x1},${y1} A${outer},${outer} 0 0 1 ${x2},${y2} L${x3},${y3} A${inner},${inner} 0 0 0 ${x4},${y4} Z`}
        fill={pocketColour(number)}
        stroke={colors.gold.dark}
        strokeWidth={0.4}
      />
      <SvgText
        x={tx}
        y={ty + 1.6}
        fontSize={4.6}
        fontWeight="700"
        fill="#FFFFFF"
        textAnchor="middle"
        // Numbers stand upright relative to the rim, as they are painted on a
        // real wheel — not all facing the same way off the screen.
        transform={`rotate(${mid + 90} ${tx} ${ty})`}
      >
        {number}
      </SvgText>
    </>
  );
}

const styles = StyleSheet.create({
  ball: {
    position: 'absolute',
    backgroundColor: '#F6F4EF',
    borderWidth: 1,
    borderColor: '#8A8272',
    shadowColor: '#000',
    shadowOpacity: 0.6,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
  },
});
