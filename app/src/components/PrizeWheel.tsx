/**
 * The prize wheel.
 *
 * ## The tile is the contract
 *
 * Triple Bar's lobby tile is an ornate wheel: a deep burgundy ring carrying set
 * gems, cream and gold segments, and PICTURES for prizes — a crown, a treasure
 * chest, a ruby, stacks of coin — around a gold rosette with a pearl in the
 * middle. That tile is the advert. A player taps it because of that, and
 * whatever appears next is measured against it.
 *
 * The first version of this was a flat gold disc with "2x 5x 10x" written on
 * it. Technically a wheel; next to the tile, a pie chart. A game that promises
 * treasure on the way in and delivers a spreadsheet on the way through does not
 * get a second visit, and the honest fix is to raise the game rather than
 * lower the advert.
 *
 * So the prizes are drawn as objects, ranked the way the paytable ranks them:
 * the crown is the top segment, the chest is next, then ruby, emerald, coin
 * stack, coin. The multiplier is still printed under each one, because the
 * picture says "treasure" and only the number says how much.
 *
 * ## The angle is derived backwards from the result
 *
 * The server has already decided which segment wins, so the wheel is not spun
 * and then read: the landing angle is computed from the answer and the wheel is
 * animated to it. Doing it the other way would mean the picture decided the
 * payout, which is the one thing a client must never do.
 */

import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import Svg, {
  Circle,
  Defs,
  Ellipse,
  G,
  LinearGradient,
  Path,
  RadialGradient,
  Stop,
  Text as SvgText,
} from 'react-native-svg';
import { colors, spacing } from '@juwa/ui';
import { Txt } from './primitives';
import { usePrefersReducedMotion } from '../motion';

/** Whole turns before it starts slowing. Enough to read as a throw. */
const SPINS = 4;
const SPIN_MS = 3_400;
/** How long the winning segment is held before the round hands back. */
const HOLD_MS = 1_700;

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
   * Where the wheel must stop. The pointer is at twelve o'clock, so the winning
   * segment's CENTRE has to finish there: rotate back by its own index, then
   * half a segment more to centre it rather than align its edge.
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
      // FALSE, and it has to be. The native driver only reaches view transforms
      // and opacity; this is bound to an SVG `rotation` attribute it cannot
      // touch, and with the driver on the animation reports itself finished
      // having moved nothing.
      useNativeDriver: false,
    }).start(({ finished }) => {
      if (finished) setTimeout(onDone, HOLD_MS);
    });
  }, [landing, reduced, turn, onDone]);

  return (
    <View style={styles.wrap}>
      <Txt variant="caption" color="#F5DFA0" style={styles.title}>
        BONUS WHEEL
      </Txt>

      <View style={styles.stage}>
        <Svg width={286} height={286} viewBox="0 0 100 100">
          <Defs>
            <LinearGradient id="pw-gold" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0" stopColor="#FFF3CE" />
              <Stop offset="0.42" stopColor="#E8BC4E" />
              <Stop offset="1" stopColor="#7A5210" />
            </LinearGradient>
            <LinearGradient id="pw-ring" x1="0.2" y1="0" x2="0.8" y2="1">
              <Stop offset="0" stopColor="#8E2733" />
              <Stop offset="0.5" stopColor="#611620" />
              <Stop offset="1" stopColor="#3A0B12" />
            </LinearGradient>
            {/* The lamp behind the wheel. Without it the whole thing sits on
                black and reads as a diagram rather than as a lit prop. */}
            <RadialGradient id="pw-glow" cx="50%" cy="50%" rx="50%" ry="50%">
              <Stop offset="0.55" stopColor="#FFC24A" stopOpacity="0.30" />
              <Stop offset="1" stopColor="#FFC24A" stopOpacity="0" />
            </RadialGradient>
            <LinearGradient id="pw-gloss" x1="0.15" y1="0" x2="0.45" y2="1">
              <Stop offset="0" stopColor="#FFFFFF" stopOpacity="0.42" />
              <Stop offset="0.36" stopColor="#FFFFFF" stopOpacity="0.08" />
              <Stop offset="0.52" stopColor="#FFFFFF" stopOpacity="0" />
            </LinearGradient>
            <RadialGradient id="pw-pearl" cx="38%" cy="32%" rx="70%" ry="70%">
              <Stop offset="0" stopColor="#FFFFFF" />
              <Stop offset="0.6" stopColor="#F2E4C6" />
              <Stop offset="1" stopColor="#B99A64" />
            </RadialGradient>
          </Defs>

          <Circle cx={50} cy={50} r={50} fill="url(#pw-glow)" />

          {/* ---- the face, which turns ---- */}
          <AnimatedG rotation={turn as unknown as number} origin="50, 50">
            {segments.map((value, i) => (
              <Path
                key={`seg${i}`}
                d={wedge(50, 50, 37, i * arc, (i + 1) * arc)}
                fill={i % 2 === 0 ? '#F8EDD2' : '#EFC152'}
                stroke="#8A5F19"
                strokeWidth={0.7}
              />
            ))}

            {/* Spokes: a gold rule on every division, which is most of what
                separates a wheel from a pie chart. */}
            {segments.map((_, i) => {
              const a = ((i * arc - 90) * Math.PI) / 180;
              return (
                <Path
                  key={`sp${i}`}
                  d={`M50,50 L${(50 + 37 * Math.cos(a)).toFixed(2)},${(50 + 37 * Math.sin(a)).toFixed(2)}`}
                  stroke="url(#pw-gold)"
                  strokeWidth={1.6}
                  strokeLinecap="round"
                />
              );
            })}

            {segments.map((value, i) => {
              const mid = i * arc + arc / 2;
              return (
                <G key={`p${i}`} rotation={mid} origin="50, 50">
                  {/*
                    Picture out near the rim, number in behind it. They started
                    life within six units of each other and of the hub, and
                    eight segments' worth of "2x 3x 5x" met in the middle as an
                    unreadable knot. The wheel's own geometry gives the room —
                    a segment is widest at its outer edge, which is exactly
                    where the biggest element should sit.
                  */}
                  <G x={42} y={9}>
                    <Prize value={value} />
                  </G>
                  <SvgText
                    x={50}
                    y={33}
                    fontSize={7}
                    fontWeight="900"
                    fill="#43290A"
                    textAnchor="middle"
                  >
                    {`${value}x`}
                  </SvgText>
                </G>
              );
            })}

            <Circle cx={50} cy={50} r={37} fill="url(#pw-gloss)" />
          </AnimatedG>

          {/* ---- the frame, which does not ---- */}
          <Circle cx={50} cy={50} r={43} fill="none" stroke="url(#pw-ring)" strokeWidth={12} />
          <Circle cx={50} cy={50} r={49} fill="none" stroke="#2A0810" strokeWidth={2} />
          <Circle cx={50} cy={50} r={48.2} fill="none" stroke="url(#pw-gold)" strokeWidth={2.2} />
          <Circle cx={50} cy={50} r={37.4} fill="none" stroke="url(#pw-gold)" strokeWidth={2.4} />

          {/* Stones on every spoke, a lamp between each pair — the ring is what
              the tile is selling and a bare band would give it away. */}
          {segments.map((_, i) => {
            const gem = ((i * arc - 90) * Math.PI) / 180;
            const lamp = (((i + 0.5) * arc - 90) * Math.PI) / 180;
            return (
              <G key={`j${i}`}>
                <Path
                  d={gemPath(50 + 43 * Math.cos(gem), 50 + 43 * Math.sin(gem), 3.4)}
                  fill={GEMS[i % GEMS.length]}
                  stroke="#2A0810"
                  strokeWidth={0.8}
                />
                <Circle
                  cx={50 + 43 * Math.cos(lamp)}
                  cy={50 + 43 * Math.sin(lamp)}
                  r={1.9}
                  fill="#FFF6D8"
                  stroke="#8A5F0A"
                  strokeWidth={0.6}
                />
              </G>
            );
          })}

          {/* The hub: a rosette, not a peg. */}
          <Circle cx={50} cy={50} r={11} fill="url(#pw-gold)" stroke="#4A3308" strokeWidth={1.2} />
          <Path d={rosette(50, 50, 10.4, 6.2, 8)} fill="#8A5F0A" opacity={0.55} />
          <Circle cx={50} cy={50} r={6.4} fill="url(#pw-gold)" stroke="#4A3308" strokeWidth={0.9} />
          <Circle cx={50} cy={50} r={4} fill="url(#pw-pearl)" stroke="#7A5A22" strokeWidth={0.6} />

          {/* The pointer, at twelve o'clock — the landing angle is derived to it. */}
          <Path d="M50,2.5 L56,14 H44 Z" fill="#FFD86B" stroke="#2A0810" strokeWidth={1.3} />
          <Path d="M50,4.5 L53.4,12.6 H46.6 Z" fill="#FFF6D8" opacity={0.75} />
        </Svg>
      </View>
    </View>
  );
}

/* ----------------------------------------------------------------- prizes */

/**
 * What a segment is worth, drawn as the thing it is worth.
 *
 * Chosen by VALUE rather than by position, so the picture and the number can
 * never disagree: the crown is always the biggest prize on the wheel and the
 * single coin always the smallest. A wheel whose grandest picture sat on its
 * meanest segment would be read as a cheat, and rightly.
 *
 * Every icon is drawn inside an 18x18 box with its own origin at 0,0 — the
 * caller places and rotates it.
 */
function Prize({ value }: { value: number }) {
  if (value >= 40) return <Crown />;
  if (value >= 15) return <Chest />;
  if (value >= 8) return <Gem colour="#E23A5E" dark="#7C0F27" />;
  if (value >= 4) return <Gem colour="#2FBE71" dark="#0C5B32" />;
  return value >= 3 ? <CoinStack /> : <Coin />;
}

const OUTLINE = '#3A2408';

function Crown() {
  return (
    <G>
      <Path
        d="M1.5,13 L2.6,4 L6.4,8.2 L9,2 L11.6,8.2 L15.4,4 L16.5,13 Z"
        fill="url(#pw-gold)"
        stroke={OUTLINE}
        strokeWidth={1.1}
        strokeLinejoin="round"
      />
      <Path
        d="M1.6,13 H16.4 A1,1 0 0 1 16.4,16.6 H1.6 A1,1 0 0 1 1.6,13 Z"
        fill="url(#pw-gold)"
        stroke={OUTLINE}
        strokeWidth={1.1}
      />
      <Circle cx={9} cy={1.6} r={1.5} fill="#E23A5E" stroke={OUTLINE} strokeWidth={0.7} />
      <Circle cx={2.6} cy={3.6} r={1.2} fill="#3E8FE0" stroke={OUTLINE} strokeWidth={0.6} />
      <Circle cx={15.4} cy={3.6} r={1.2} fill="#3E8FE0" stroke={OUTLINE} strokeWidth={0.6} />
      <Circle cx={9} cy={14.8} r={1.2} fill="#2FBE71" stroke={OUTLINE} strokeWidth={0.6} />
    </G>
  );
}

function Chest() {
  return (
    <G>
      <Path
        d="M1.5,8.5 C1.5,3.6 16.5,3.6 16.5,8.5 Z"
        fill="#8E4A1C"
        stroke={OUTLINE}
        strokeWidth={1.1}
        strokeLinejoin="round"
      />
      <Path
        d="M1.5,8.5 H16.5 V16 H1.5 Z"
        fill="#A9581F"
        stroke={OUTLINE}
        strokeWidth={1.1}
        strokeLinejoin="round"
      />
      <Path d="M1.5,8.5 H16.5" stroke="url(#pw-gold)" strokeWidth={1.6} />
      <Path d="M7.4,8.5 H10.6 V16 H7.4 Z" fill="url(#pw-gold)" stroke={OUTLINE} strokeWidth={0.8} />
      <Circle cx={9} cy={11.4} r={1.5} fill="#FFF3CE" stroke={OUTLINE} strokeWidth={0.7} />
      {/* Coin spilling over the lip, which is what says the chest is full. */}
      <Circle cx={3.6} cy={7.4} r={1.5} fill="url(#pw-gold)" stroke={OUTLINE} strokeWidth={0.6} />
      <Circle cx={14.4} cy={7.4} r={1.5} fill="url(#pw-gold)" stroke={OUTLINE} strokeWidth={0.6} />
    </G>
  );
}

function Gem({ colour, dark }: { colour: string; dark: string }) {
  return (
    <G>
      <Path
        d="M9,1.4 L16.4,7 L12.6,16.4 H5.4 L1.6,7 Z"
        fill={colour}
        stroke={OUTLINE}
        strokeWidth={1.1}
        strokeLinejoin="round"
      />
      <Path d="M9,1.4 L5.4,7 H12.6 Z" fill="#FFFFFF" opacity={0.45} />
      <Path d="M1.6,7 H16.4" stroke={dark} strokeWidth={0.9} opacity={0.8} />
      <Path d="M5.4,7 L9,16.4 L12.6,7" fill="none" stroke={dark} strokeWidth={0.8} opacity={0.7} />
    </G>
  );
}

function CoinStack() {
  return (
    <G>
      {[14.4, 10.8, 7.2].map((cy, i) => (
        <G key={cy}>
          <Ellipse
            cx={9}
            cy={cy}
            rx={7}
            ry={2.9}
            fill="url(#pw-gold)"
            stroke={OUTLINE}
            strokeWidth={1}
          />
          {i === 2 ? (
            <Ellipse cx={9} cy={cy} rx={4.2} ry={1.6} fill="#B98620" opacity={0.55} />
          ) : null}
        </G>
      ))}
    </G>
  );
}

function Coin() {
  return (
    <G>
      <Circle cx={9} cy={9} r={7.2} fill="url(#pw-gold)" stroke={OUTLINE} strokeWidth={1.1} />
      <Circle cx={9} cy={9} r={4.6} fill="none" stroke="#8A5F0A" strokeWidth={0.9} opacity={0.7} />
      {/* A struck face, not a cross — the first version put a plus sign in the
          middle of a disc, which reads as a maths symbol. */}
      <Path d="M9,5.4 L10,8 L12.8,8 L10.6,9.7 L11.4,12.4 L9,10.8 L6.6,12.4 L7.4,9.7 L5.2,8 L8,8 Z"
        fill="#8A5F0A" opacity={0.65} />
    </G>
  );
}

/* ------------------------------------------------------------------ shapes */

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
 * A cut stone: an octagonal brilliant, pointing up.
 *
 * Drawn rather than a circle because a circle set in a rim reads as a rivet.
 */
function gemPath(cx: number, cy: number, r: number): string {
  const pts: string[] = [];
  for (let i = 0; i < 8; i += 1) {
    const a = (Math.PI / 4) * i - Math.PI / 2;
    const rr = i % 2 === 0 ? r : r * 0.74;
    pts.push(`${(cx + rr * Math.cos(a)).toFixed(2)},${(cy + rr * Math.sin(a)).toFixed(2)}`);
  }
  return `M${pts.join(' L')} Z`;
}

/** The pointed rosette behind the hub — a compass star, as on the tile. */
function rosette(cx: number, cy: number, outer: number, inner: number, points: number): string {
  const pts: string[] = [];
  for (let i = 0; i < points * 2; i += 1) {
    const a = (Math.PI / points) * i - Math.PI / 2;
    const r = i % 2 === 0 ? outer : inner;
    pts.push(`${(cx + r * Math.cos(a)).toFixed(2)},${(cy + r * Math.sin(a)).toFixed(2)}`);
  }
  return `M${pts.join(' L')} Z`;
}

/** The stones set into the ring. Ruby, sapphire, emerald, amethyst, diamond. */
const GEMS = ['#E23A5E', '#3E8FE0', '#2FBE71', '#B45CE0', '#EAF4FF', '#F5C542'];

const styles = StyleSheet.create({
  wrap: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(6, 4, 14, 0.94)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    zIndex: 20,
  },
  title: { letterSpacing: 3, fontWeight: '900' },
  stage: { alignItems: 'center', justifyContent: 'center' },
});
