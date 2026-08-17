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
 * ## What the second version got wrong, measured from a recording
 *
 * The founder played until the bonus fired — about sixty spins — and could not
 * tell what had happened. Four faults, all visible in the video frame by frame:
 *
 *  1. **The pointer was off screen.** The overlay filled the REEL BAY, and the
 *     bay on a three-reel machine is about 300 points wide and shorter than it
 *     is wide. A 286-point wheel inside it had its top, left and right edges
 *     clipped, and the pointer lives at twelve o'clock — so the one mark that
 *     says which segment won was the first thing cut off. It is now a
 *     full-screen event, sized from the viewport it is actually given.
 *  2. **Nothing said what was won, or why.** The wheel stopped and the machine
 *     printed "WIN 2,000 GC" with no stated connection between the two. There
 *     is now a readout: the multiple, the stake, and the product, in that
 *     order, so the arithmetic is on the screen.
 *  3. **Half the numbers were upside down.** Radial text on the lower half of a
 *     wheel reads "x02". Labels below the horizontal are flipped.
 *  4. **It span itself and was over.** After sixty spins of waiting, the bonus
 *     went past in three and a half seconds with no fanfare. The player now
 *     PULLS it — there is a beat, then a button, then a spin, then confetti and
 *     a held result they dismiss themselves.
 *
 * Auto-play still cannot stall on it: if the button is not touched it spins on
 * its own, and the held result dismisses itself.
 *
 * ## The angle is derived backwards from the result
 *
 * The server has already decided which segment wins, so the wheel is not spun
 * and then read: the landing angle is computed from the answer and the wheel is
 * animated to it. Doing it the other way would mean the picture decided the
 * payout, which is the one thing a client must never do. Every button here
 * chooses only WHEN the already-decided answer is shown.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Easing, Pressable, StyleSheet, View } from 'react-native';
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
import { colors, radius, spacing } from '@juwa/ui';
import { format, minor, type Minor } from '@juwa/money';
import { Txt } from './primitives';
import { Fireworks, type FireworksHandle } from './Fireworks';
import { sounds } from '../sound';
import { usePrefersReducedMotion } from '../motion';

/** Whole turns before it starts slowing. Enough to read as a throw. */
const SPINS = 5;
const SPIN_MS = 4_200;
/**
 * The beat before the button appears.
 *
 * The wheel arrives, the player registers that something new is on the screen,
 * and only then are they asked to do something with it. A button that is
 * already there when the overlay lands gets pressed reflexively and the arrival
 * is spent.
 */
const READY_MS = 700;
/**
 * How long the wheel waits to be pulled before pulling itself.
 *
 * Auto-play is the case this exists for. A bonus that needs a finger stalls an
 * unattended session forever, which is worse than spinning without being asked.
 */
const AUTO_SPIN_MS = 5_000;
/** How long the result is held before it dismisses itself. */
const HOLD_MS = 5_000;

const AnimatedG = Animated.createAnimatedComponent(G);
const AnimatedPath = Animated.createAnimatedComponent(Path);

export interface PrizeWheelProps {
  /** Stake multiples per segment, in wheel order. */
  segments: number[];
  /** Which segment the server says won. */
  index: number;
  /** The player's total bet — what the multiple multiplies. */
  stake: Minor;
  /** The space this may fill. The whole screen, in practice. */
  width: number;
  height: number;
  onDone: () => void;
}

type Phase = 'ready' | 'spinning' | 'landed';

export function PrizeWheel({ segments, index, stake, width, height, onDone }: PrizeWheelProps) {
  const reduced = usePrefersReducedMotion();
  const turn = useRef(new Animated.Value(0)).current;
  const enter = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(0)).current;
  const flash = useRef(new Animated.Value(0)).current;
  const confetti = useRef<FireworksHandle | null>(null);
  const landed = useRef(false);
  const spinWatchdog = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flashLoop = useRef<Animated.CompositeAnimation | null>(null);
  const [phase, setPhase] = useState<Phase>('ready');
  const [armed, setArmed] = useState(false);

  const count = Math.max(1, segments.length);
  const arc = 360 / count;
  const multiple = segments[index] ?? 0;
  const prize = minor(Math.round(multiple * stake));
  const best = Math.max(...segments);

  /*
   * The wheel is sized from the space it is GIVEN, not from a constant.
   *
   * The constant is what put a 286-point wheel inside a 300-point reel bay and
   * cut the pointer off. Two thirds of the shorter dimension leaves room for
   * the title above and the readout below on every phone in the fleet, and the
   * cap stops it becoming a dinner plate on a tablet.
   */
  const size = Math.max(200, Math.min(340, Math.min(width - 40, height * 0.52)));

  /*
   * Where the wheel must stop. The pointer is at twelve o'clock, so the winning
   * segment's CENTRE has to finish there: rotate back by its own index, then
   * half a segment more to centre it rather than align its edge.
   */
  const landing = SPINS * 360 - (index * arc + arc / 2);

  const finished = useRef(onDone);
  finished.current = onDone;

  /** The overlay arriving, and the button being offered a beat later. */
  useEffect(() => {
    Animated.timing(enter, {
      toValue: 1,
      duration: reduced ? 1 : 260,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start();
    const t = setTimeout(() => setArmed(true), reduced ? 0 : READY_MS);
    return () => clearTimeout(t);
  }, [enter, reduced]);

  /** The button breathing while it waits, so it reads as the thing to press. */
  useEffect(() => {
    if (!armed || phase !== 'ready' || reduced) return undefined;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 620, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 620, easing: Easing.in(Easing.quad), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [armed, phase, pulse, reduced]);

  const land = useCallback(() => {
    if (landed.current) return;
    landed.current = true;
    if (spinWatchdog.current) {
      clearTimeout(spinWatchdog.current);
      spinWatchdog.current = null;
    }
    setPhase('landed');
    /*
     * Loud in proportion to the prize. The top segment on this wheel is fifty
     * times the stake and arrives about once in a hundred bonus rounds; giving
     * it the same sting as the two costs the moment nothing and buys nothing.
     */
    if (multiple >= best) sounds.megaWin();
    else sounds.bigWin();
    sounds.coins(10);
    confetti.current?.fire(Math.min(1, 0.45 + (multiple / (best || 1)) * 0.55));

    if (!reduced) {
      flash.setValue(0);
      flashLoop.current = Animated.loop(
        Animated.sequence([
          Animated.timing(flash, { toValue: 1, duration: 480, easing: Easing.inOut(Easing.sin), useNativeDriver: false }),
          Animated.timing(flash, { toValue: 0, duration: 480, easing: Easing.inOut(Easing.sin), useNativeDriver: false }),
        ]),
      );
      flashLoop.current.start();
    }
  }, [best, flash, multiple, reduced]);

  useEffect(() => () => {
    landed.current = true;
    if (spinWatchdog.current) clearTimeout(spinWatchdog.current);
    flashLoop.current?.stop();
    turn.stopAnimation();
  }, [turn]);

  /*
   * A ref, not the phase, guards the throw.
   *
   * `start` is called from a press AND from the auto-spin timer, and setting
   * state does not take effect until the next render — so two calls in the same
   * tick would both see `phase === 'ready'` and start two animations on the
   * same value. The ref closes that window; the state that follows is only for
   * what is drawn.
   */
  const thrown = useRef(false);
  const start = useCallback(() => {
    if (thrown.current) return;
    thrown.current = true;
    setPhase('spinning');

    if (reduced) {
      turn.setValue(landing);
      // The state still changes for somebody who asked for less motion — only
      // the movement is removed. See motion.ts.
      spinWatchdog.current = setTimeout(land, 400);
      return;
    }

    sounds.lever();
    turn.setValue(0);
    // SVG animation completion callbacks can be dropped by a browser tab
    // transition. The watchdog lands the already-decided server result rather
    // than leaving a wheel rotating forever with the round locked behind it.
    spinWatchdog.current = setTimeout(() => {
      turn.setValue(landing);
      land();
    }, SPIN_MS + 650);

    Animated.timing(turn, {
      toValue: landing,
      duration: SPIN_MS,
      // Fast off the mark and a long tail — a wheel coasts to a stop against
      // friction, it does not ease symmetrically into one.
      easing: Easing.out(Easing.cubic),
      // FALSE, and it has to be. The native driver only reaches view
      // transforms and opacity; this is bound to an SVG `rotation` attribute
      // it cannot touch, and with the driver on the animation reports itself
      // finished having moved nothing.
      useNativeDriver: false,
    }).start(({ finished: ok }) => {
      if (!ok) turn.setValue(landing);
      land();
    });
  }, [land, landing, reduced, turn]);

  /**
   * The click of the pin over each division.
   *
   * Driven off the animated value rather than a timer, so the ticks slow down
   * with the wheel instead of running at a constant rate under a decelerating
   * picture — which is the detail that makes a wheel sound geared rather than
   * sampled.
   */
  useEffect(() => {
    if (phase !== 'spinning' || reduced) return undefined;
    let last = -1;
    const id = turn.addListener(({ value }) => {
      const step = Math.floor(value / arc);
      if (step !== last) {
        if (last >= 0) sounds.tick();
        last = step;
      }
    });
    return () => turn.removeListener(id);
  }, [phase, arc, turn, reduced]);

  /** Spin itself if nobody pulls it, so an unattended auto-play cannot hang. */
  useEffect(() => {
    if (phase !== 'ready' || !armed) return undefined;
    const t = setTimeout(() => start(), AUTO_SPIN_MS);
    return () => clearTimeout(t);
  }, [phase, armed, start]);

  /** And dismiss itself, for the same reason. */
  useEffect(() => {
    if (phase !== 'landed') return undefined;
    const t = setTimeout(() => finished.current?.(), HOLD_MS);
    return () => clearTimeout(t);
  }, [phase]);

  const buttonScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.06] });
  const winStroke = flash.interpolate({ inputRange: [0, 1], outputRange: [1.4, 3.4] });

  return (
    <View style={styles.wrap}>
      <Animated.View style={[styles.column, { opacity: enter }]}>
        <Txt variant="caption" color="#F5DFA0" style={styles.title}>
          BONUS WHEEL
        </Txt>

        <View style={{ width: size, height: size }}>
          <Svg width={size} height={size} viewBox="0 0 100 100">
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

              {/*
                The winning wedge, lit.

                Drawn as its own overlay rather than by changing the fill of the
                wedge below, so it can pulse without the rest of the face
                pulsing with it. This is the answer to "I don't know why I won
                2,000" told in pictures; the readout underneath tells it in
                numbers, and between them there is nothing left to guess.
              */}
              {phase === 'landed' ? (
                <>
                  <Path
                    d={wedge(50, 50, 37, index * arc, (index + 1) * arc)}
                    fill="#FFFFFF"
                    opacity={0.34}
                  />
                  <AnimatedPath
                    d={wedge(50, 50, 37, index * arc, (index + 1) * arc)}
                    fill="none"
                    stroke="#FFF6D8"
                    strokeWidth={winStroke as unknown as number}
                    strokeLinejoin="round"
                  />
                </>
              ) : null}

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
                /*
                 * Labels below the horizontal are flipped.
                 *
                 * Radial text rotates with its segment, so on the bottom half of
                 * the wheel "20x" arrives as "x02" — which is most of why the
                 * recorded wheel read as jammed. Turning those labels through
                 * 180 degrees costs nothing and every number reads.
                 */
                const upsideDown = mid > 90 && mid < 270;
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
                    {/*
                      Placed and scaled so the whole icon stays INSIDE the face.

                      At x=42,y=9 the 18x18 box has corners 42 units from the
                      centre against a disc of 37 — measured off the render, and
                      it is why the crown on the 50x segment was sliced by the
                      inner rim. Centre at radius 29 and 78% scale puts the
                      farthest corner at 36.9, just inside.

                      Origin is the icon's own centre, so a flipped crown turns
                      in place rather than swinging across its neighbour.
                    */}
                    <G
                      x={42}
                      y={12}
                      scale={0.78}
                      origin="9, 9"
                      {...(upsideDown ? { rotation: 180 } : {})}
                    >
                      <Prize value={value} />
                    </G>
                    <G {...(upsideDown ? { rotation: 180, origin: '50, 31.5' } : {})}>
                      <SvgText
                        x={50}
                        y={34}
                        fontSize={7.6}
                        fontWeight="900"
                        fill="#43290A"
                        textAnchor="middle"
                      >
                        {`${value}x`}
                      </SvgText>
                    </G>
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

            {/*
              The pointer, at twelve o'clock — the landing angle is derived to it.

              Bigger and darker-edged than it was, and it now sits INSIDE the rim
              rather than perched on top of it, so it overlaps the segment it is
              selecting. The version that was clipped away was also the version
              that, when visible, only touched the outer ring.
            */}
            <Path d="M50,17 L57.5,1.5 H42.5 Z" fill="#1A0308" opacity={0.55} />
            <Path
              d="M50,15.5 L56.5,2 H43.5 Z"
              fill="url(#pw-gold)"
              stroke="#2A0810"
              strokeWidth={1.4}
              strokeLinejoin="round"
            />
            <Path d="M50,12.4 L53.6,4.2 H46.4 Z" fill="#FFF6D8" opacity={0.8} />
          </Svg>
        </View>

        {/*
          The one control, and then the one answer.

          Reserved height, so the wheel does not jump up the screen when the
          button is replaced by the readout.
        */}
        <View style={styles.tray}>
          {phase === 'landed' ? (
            <View style={styles.result}>
              {/*
                The arithmetic, spelled out.

                "WIN 2,000 GC" on its own is the fact without the reason, which
                is precisely what was reported: sixty spins to reach the bonus
                and then a number with nothing attached to it. Multiple, stake,
                product.
              */}
              <Txt variant="caption" color="#F5DFA0" style={styles.resultRule}>
                {`${multiple}x  YOUR BET OF ${format(stake, 'GC')}`}
              </Txt>
              <Txt variant="h1" color={colors.gold.light} style={styles.resultAmount}>
                {format(prize, 'GC')}
              </Txt>
              <Pressable
                onPress={() => finished.current?.()}
                accessibilityRole="button"
                accessibilityLabel={`Collect ${format(prize, 'GC')}`}
                style={styles.collect}
              >
                <Txt variant="caption" color="#2A1B02" style={styles.collectLabel}>
                  COLLECT
                </Txt>
              </Pressable>
            </View>
          ) : phase === 'spinning' ? (
            <Txt variant="caption" color={colors.text.secondary} style={styles.hint}>
              GOOD LUCK…
            </Txt>
          ) : armed ? (
            <Animated.View style={{ transform: [{ scale: buttonScale }] }}>
              <Pressable
                onPress={() => start()}
                accessibilityRole="button"
                accessibilityLabel="Spin the bonus wheel"
                style={styles.spin}
              >
                <Txt variant="h3" color="#2A1B02" style={styles.spinLabel}>
                  SPIN
                </Txt>
              </Pressable>
            </Animated.View>
          ) : (
            <Txt variant="caption" color={colors.text.secondary} style={styles.hint}>
              YOU TRIGGERED THE BONUS
            </Txt>
          )}
        </View>
      </Animated.View>

      {/* Over everything, ignoring touches — the COLLECT button is underneath. */}
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        <Fireworks width={width} height={height} controller={confetti} />
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
    zIndex: 40,
  },
  column: { alignItems: 'center', gap: spacing.sm },
  title: { letterSpacing: 3, fontWeight: '900', fontSize: 13 },
  /** Reserved, so replacing the button with the result does not move the wheel. */
  tray: { minHeight: 132, alignItems: 'center', justifyContent: 'flex-start', gap: spacing.xs },
  hint: { letterSpacing: 2, fontWeight: '800', marginTop: spacing.md },
  spin: {
    marginTop: spacing.sm,
    paddingHorizontal: spacing.xl * 1.4,
    paddingVertical: spacing.md,
    borderRadius: 999,
    backgroundColor: colors.gold.default,
    borderWidth: 2,
    borderColor: colors.gold.light,
  },
  spinLabel: { letterSpacing: 3, fontWeight: '900' },
  result: { alignItems: 'center', gap: 2 },
  resultRule: { letterSpacing: 1.6, fontWeight: '800' },
  resultAmount: { fontWeight: '900', letterSpacing: 0.5 },
  collect: {
    marginTop: spacing.sm,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.gold.default,
    borderWidth: 1,
    borderColor: colors.gold.light,
  },
  collectLabel: { letterSpacing: 2.4, fontWeight: '900' },
});
