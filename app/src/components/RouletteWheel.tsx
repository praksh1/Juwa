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
import { Animated, Easing, StyleSheet, View } from 'react-native';
import Svg, {
  Circle,
  Defs,
  G,
  LinearGradient,
  Path,
  RadialGradient,
  Stop,
  Text as SvgText,
} from 'react-native-svg';
import { colors } from '@juwa/ui';
import { spinNow } from '../sound';
import { usePrefersReducedMotion } from '../motion';

const AnimatedG = Animated.createAnimatedComponent(G);

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
/** Gradient ids, so every pocket is a recess with a lit floor and a dark wall. */
const pocketFill = (n: number) =>
  n === 0 ? 'url(#rw-green)' : RED.has(n) ? 'url(#rw-red)' : 'url(#rw-black)';

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
  /** Breathes on the pocket that won, once the ball is in it. */
  const winGlow = useRef(new Animated.Value(0)).current;
  const reduced = usePrefersReducedMotion();

  const landed = useRef(onLanded);
  landed.current = onLanded;

  /**
   * The winning pocket, but only once the ball is actually sitting in it.
   *
   * Gated on `idle` deliberately. `target` is set the moment the server
   * replies, which is roughly three seconds before the ball arrives — marking
   * the pocket then would show the player the answer while the wheel was still
   * turning, which is the one thing the whole landing sequence exists to avoid.
   */
  const winner =
    phase === 'idle' && target !== null
      ? WHEEL_ORDER.indexOf(target as (typeof WHEEL_ORDER)[number])
      : -1;

  useEffect(() => {
    if (winner < 0 || reduced) {
      winGlow.setValue(winner < 0 ? 0 : 1);
      return undefined;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(winGlow, { toValue: 1, duration: 620, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.timing(winGlow, { toValue: 0.35, duration: 620, easing: Easing.in(Easing.quad), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [winner, reduced, winGlow]);

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
      {/*
        THE PARTS THAT TURN.
        Everything painted on the wheel: pockets, frets, the turret. Nothing
        that belongs to the room.
      */}
      <Animated.View style={[StyleSheet.absoluteFill, { transform: [{ rotate }] }]}>
        <Svg width={size} height={size} viewBox="0 0 100 100">
          <Defs>
            <LinearGradient id="rw-gold" x1="0.1" y1="0" x2="0.7" y2="1">
              <Stop offset="0" stopColor="#FFF3CE" />
              <Stop offset="0.42" stopColor="#E8BC4E" />
              <Stop offset="1" stopColor="#7A5210" />
            </LinearGradient>
            {/*
              Pocket fills as gradients rather than flat colour.

              A pocket is a recess with a floor and a wall, so it is darker at
              the rim than at the fret. Flat fills are what made this read as a
              pie chart with numbers on it — the shape was right and the light
              was missing.
            */}
            <RadialGradient id="rw-red" cx="50%" cy="50%" rx="50%" ry="50%">
              <Stop offset="0.42" stopColor="#D01B36" />
              <Stop offset="1" stopColor="#71091B" />
            </RadialGradient>
            <RadialGradient id="rw-black" cx="50%" cy="50%" rx="50%" ry="50%">
              <Stop offset="0.42" stopColor="#241E2E" />
              <Stop offset="1" stopColor="#08060C" />
            </RadialGradient>
            <RadialGradient id="rw-green" cx="50%" cy="50%" rx="50%" ry="50%">
              <Stop offset="0.42" stopColor="#12A452" />
              <Stop offset="1" stopColor="#07542A" />
            </RadialGradient>
            {/* The cone under the turret, which is a polished dome. */}
            <RadialGradient id="rw-hub" cx="36%" cy="30%" rx="72%" ry="72%">
              <Stop offset="0" stopColor="#6E5B44" />
              <Stop offset="0.55" stopColor="#2C2118" />
              <Stop offset="1" stopColor="#120C08" />
            </RadialGradient>
          </Defs>

          <Circle cx={50} cy={50} r={49} fill="#1B1410" />

          <G>
            {WHEEL_ORDER.map((n, i) => (
              <Pocket key={n} number={n} index={i} />
            ))}
          </G>

          {/* The winning pocket, lit from underneath once the ball is in it. */}
          {winner >= 0 ? (
            <AnimatedG opacity={winGlow as unknown as number}>
              <Path
                d={pocketWedge(winner)}
                fill="#FFD86B"
                opacity={0.34}
              />
              <Path
                d={pocketWedge(winner)}
                fill="none"
                stroke="#FFF0B8"
                strokeWidth={1.1}
                strokeLinejoin="round"
              />
            </AnimatedG>
          ) : null}

          {/* The turret: a machined cone with a brass finial, not a peg. */}
          <Circle cx={50} cy={50} r={20} fill="url(#rw-hub)" />
          <Circle cx={50} cy={50} r={20} fill="none" stroke="url(#rw-gold)" strokeWidth={1.4} />
          {/* Four arms across the cone, which is what a real turret has and
              what makes the wheel's rotation legible near the middle — the
              pockets are too fine to track at this size. */}
          {[0, 45, 90, 135].map((angle) => (
            <Path
              key={angle}
              d="M50,31 L50,69"
              stroke="url(#rw-gold)"
              strokeWidth={1.1}
              opacity={0.55}
              transform={`rotate(${angle} 50 50)`}
            />
          ))}
          <Circle cx={50} cy={50} r={7.4} fill="url(#rw-gold)" stroke="#4A3308" strokeWidth={0.9} />
          <Circle cx={48.2} cy={47.8} r={2.4} fill="#FFF6D8" opacity={0.8} />
        </Svg>
      </Animated.View>

      {/*
        THE PARTS THAT DO NOT TURN.

        The bezel, the lamps around it, and — the important one — the specular
        sweep. A highlight painted inside the rotating group travels with the
        wheel, which reads as a pale streak PAINTED ON the wheel rather than as
        light falling on it. Kept still, the same shape becomes a reflection,
        and the wheel underneath it starts to look like polished wood and
        lacquer. That single separation is most of the difference between this
        and the flat disc it replaces.
      */}
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        <Svg width={size} height={size} viewBox="0 0 100 100">
          <Defs>
            <LinearGradient id="rwf-gold" x1="0.1" y1="0" x2="0.7" y2="1">
              <Stop offset="0" stopColor="#FFF3CE" />
              <Stop offset="0.42" stopColor="#E8BC4E" />
              <Stop offset="1" stopColor="#7A5210" />
            </LinearGradient>
            <LinearGradient id="rw-gloss" x1="0.12" y1="0" x2="0.5" y2="0.95">
              <Stop offset="0" stopColor="#FFFFFF" stopOpacity="0.30" />
              <Stop offset="0.34" stopColor="#FFFFFF" stopOpacity="0.07" />
              <Stop offset="0.55" stopColor="#FFFFFF" stopOpacity="0" />
            </LinearGradient>
            {/* A shadow along the bottom inside edge, so the bowl has depth
                rather than being a flat ring drawn on a flat face. */}
            <LinearGradient id="rw-bowl" x1="0.5" y1="0.45" x2="0.5" y2="1">
              <Stop offset="0" stopColor="#000000" stopOpacity="0" />
              <Stop offset="1" stopColor="#000000" stopOpacity="0.42" />
            </LinearGradient>
          </Defs>

          <Circle cx={50} cy={50} r={46.5} fill="url(#rw-bowl)" />
          <Circle cx={50} cy={50} r={46.5} fill="url(#rw-gloss)" />

          {/* The bezel: a wide gold band with a dark lip either side, which is
              what makes the rim read as machined metal at 230 points. */}
          <Circle cx={50} cy={50} r={47.6} fill="none" stroke="#1A0F06" strokeWidth={3.4} />
          <Circle cx={50} cy={50} r={47.6} fill="none" stroke="url(#rwf-gold)" strokeWidth={2.2} />
          <Circle cx={50} cy={50} r={44.6} fill="none" stroke="url(#rwf-gold)" strokeWidth={0.9} opacity={0.7} />

          {/* Lamps around the bezel. Eight, not thirty-seven: they mark the
              rim as a lit fixture without competing with the pockets, which
              are the thing being read. */}
          {Array.from({ length: 8 }, (_, i) => {
            const a = ((i * 45 - 90) * Math.PI) / 180;
            return (
              <Circle
                key={i}
                cx={50 + 47.6 * Math.cos(a)}
                cy={50 + 47.6 * Math.sin(a)}
                r={1.7}
                fill="#FFF6D8"
                stroke="#8A5F0A"
                strokeWidth={0.5}
              />
            );
          })}
        </Svg>
      </View>

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
            left: centre - ballSize / 2,
            top: centre - ballSize / 2,
            transform: [{ translateX: ballX }, { translateY: ballY }],
          },
        ]}
      >
        {/*
          Drawn rather than styled. A flat disc with a border is a dot; an
          ivory ball has a highlight up and left of centre and a terminator
          opposite it, and at nine points across that is still the difference
          between something rolling and something drawn.
        */}
        <Svg width={ballSize} height={ballSize} viewBox="0 0 10 10">
          <Defs>
            <RadialGradient id="rw-ball" cx="34%" cy="30%" rx="72%" ry="72%">
              <Stop offset="0" stopColor="#FFFFFF" />
              <Stop offset="0.45" stopColor="#F2EEE2" />
              <Stop offset="1" stopColor="#9C9382" />
            </RadialGradient>
          </Defs>
          <Circle cx={5} cy={5} r={4.7} fill="url(#rw-ball)" />
        </Svg>
      </Animated.View>
    </View>
  );
}

/** The wedge path for one pocket, in the same geometry `Pocket` uses. */
function pocketWedge(index: number): string {
  const start = index * STEP - STEP / 2 - 90;
  const end = start + STEP;
  const rad = (deg: number) => (deg * Math.PI) / 180;
  const outer = 46;
  const inner = 21;
  const p = (angle: number, r: number) =>
    `${(50 + Math.cos(rad(angle)) * r).toFixed(2)},${(50 + Math.sin(rad(angle)) * r).toFixed(2)}`;
  return (
    `M${p(start, outer)} A${outer},${outer} 0 0 1 ${p(end, outer)} ` +
    `L${p(end, inner)} A${inner},${inner} 0 0 0 ${p(start, inner)} Z`
  );
}

/**
 * One pocket: a wedge, its dividing fret, and the number.
 *
 * The fret is drawn as a separate bright line rather than as the wedge's own
 * stroke. A stroke follows the whole outline, including the arc at the rim,
 * which put a gold hoop around the outside of every pocket and turned the
 * pocket ring into a solid gold band at this size. A real wheel's frets are
 * radial only — they are the metal walls BETWEEN pockets — so that is what is
 * drawn, and the rim stays dark where the ball runs.
 */
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
        fill={pocketFill(number)}
      />
      <Path d={`M${x1},${y1} L${x4},${y4}`} stroke="url(#rw-gold)" strokeWidth={0.55} />
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
    // The drop shadow stays on the container rather than in the SVG: it is the
    // ball's shadow ON THE WHEEL, so it belongs to the space between them.
    shadowColor: '#000',
    shadowOpacity: 0.65,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1.5 },
  },
});
