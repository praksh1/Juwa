/**
 * A symbol on a reel, with a pulse in it.
 *
 * The symbols were static images. A landed grid was a screenshot: nothing on
 * the machine moved between one spin and the next, and a win was marked by
 * swapping the symbol's `size` prop from 46 points to 54. That swap is not an
 * animation — it is a re-layout, so the win arrived as a single-frame jump and
 * every image in the cell was measured again to produce it.
 *
 * Three things happen here instead, none of which need new artwork:
 *
 *   BREATHING. Every landed symbol scales very gently in and out, each on its
 *   own phase. It is small enough that you would not name it if asked, and its
 *   absence is exactly what makes a grid look like a picture of a slot machine
 *   rather than a slot machine.
 *
 *   THE WIN PULSE. A winning symbol springs up and then beats, on a transform
 *   rather than a size, so nothing is laid out twice and the growth is a curve
 *   instead of a step.
 *
 *   THE GLASS SHINE. A band of light sweeps diagonally across the cell while it
 *   is paying. It is a rectangle rather than a shape traced around the symbol,
 *   and that is deliberate rather than a compromise: a real cabinet has glass in
 *   front of the reels, and what you see travel across a winning symbol is a
 *   reflection ON the glass. Tracing the artwork would need a mask per symbol
 *   and would look less like a machine, not more.
 *
 * WHAT THIS IS NOT
 *
 * It is not frame animation. Making a dragon beat its wings needs a sprite
 * sheet per symbol per theme — 45 of them here — and that is an art commission,
 * not a code change. Everything above is procedural and applies to all 45
 * existing images and the nine vector drawings without touching any of them.
 */

import React, { useEffect, useMemo, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { radius, type SymbolState } from '@juwa/ui';
import { SlotSymbol } from './SlotSymbol';
import { usePrefersReducedMotion } from '../motion';

/**
 * How much a resting symbol grows and shrinks.
 *
 * Deliberately tiny. At 6% it reads as the grid throbbing and becomes the most
 * distracting thing on the screen; at 3% you notice only that the machine looks
 * switched on.
 */
const BREATH_SCALE = 1.03;
/** One breath, in milliseconds. Slower than a resting heartbeat on purpose. */
const BREATH_MS = 2600;

/**
 * How big a winning symbol gets.
 *
 * Matches the jump the old `size` swap made — 54 points against 46 — so the
 * win reads exactly as strongly as it did. The difference is that it is now a
 * curve on a transform rather than a step in a layout.
 */
const WIN_SCALE = 1.17;
/** The settle after the initial spring, and then the beat it holds. */
const WIN_POP_MS = 260;
const WIN_BEAT_MS = 620;
/** How far the beat falls back between pulses. */
const WIN_BEAT_LOW = 1.08;

/** One pass of the shine, and the wait before the next. */
const SHINE_MS = 900;
const SHINE_GAP_MS = 700;

interface AnimatedSymbolProps {
  name: string;
  /** Cell size in points. The symbol is drawn inside it with room to grow. */
  size: number;
  family?: string;
  state: SymbolState;
  /**
   * Anything stable and per-cell. Spreads the breathing out so fifteen symbols
   * do not inhale together, which reads as the whole grid wobbling.
   */
  seed: number;
}

export function AnimatedSymbol({ name, size, family, state, seed }: AnimatedSymbolProps) {
  const reduceMotion = usePrefersReducedMotion();
  const scale = useRef(new Animated.Value(1)).current;
  const shine = useRef(new Animated.Value(0)).current;

  /** Actively celebrating: pulsing and catching the light. */
  const winning = state === 'winning';
  /**
   * Paid, and finished celebrating.
   *
   * Held at full size so the win is still marked, with nothing running. This
   * is the difference between a machine that explains a win and one a player
   * describes — accurately — as looping until they spin again.
   */
  const held = state === 'won';
  // Only landed symbols that are not being dimmed for someone else's win.
  const breathing = state === 'resting';

  /**
   * Phase offset for the breath, from the seed.
   *
   * A real number in [0, 1) rather than a random one, so a cell keeps its phase
   * across re-renders instead of jumping every time the parent updates.
   */
  const phase = useMemo(() => ((seed * 2654435761) % 1000) / 1000, [seed]);

  useEffect(() => {
    if (held || reduceMotion) {
      // Still SAY which symbol won — the win marking is information, and
      // removing it because someone asked for less movement, or because the
      // celebration is over, would take the meaning with it. It simply does
      // not move.
      scale.setValue(winning || held ? WIN_SCALE : 1);
      return;
    }

    if (winning) {
      const animation = Animated.sequence([
        // Spring past the target and settle: a win that grows linearly looks
        // like a resize, and a win that appears at full size has no moment.
        Animated.timing(scale, {
          toValue: WIN_SCALE,
          duration: WIN_POP_MS,
          easing: Easing.out(Easing.back(2.2)),
          useNativeDriver: true,
        }),
        Animated.loop(
          Animated.sequence([
            Animated.timing(scale, {
              toValue: WIN_BEAT_LOW,
              duration: WIN_BEAT_MS / 2,
              easing: Easing.inOut(Easing.quad),
              useNativeDriver: true,
            }),
            Animated.timing(scale, {
              toValue: WIN_SCALE,
              duration: WIN_BEAT_MS / 2,
              easing: Easing.inOut(Easing.quad),
              useNativeDriver: true,
            }),
          ]),
        ),
      ]);
      animation.start();
      return () => animation.stop();
    }

    if (breathing) {
      const half = BREATH_MS / 2;
      const animation = Animated.loop(
        Animated.sequence([
          Animated.timing(scale, {
            toValue: BREATH_SCALE,
            duration: half,
            easing: Easing.inOut(Easing.sin),
            useNativeDriver: true,
          }),
          Animated.timing(scale, {
            toValue: 1,
            duration: half,
            easing: Easing.inOut(Easing.sin),
            useNativeDriver: true,
          }),
        ]),
      );
      // Stagger the start so the grid does not breathe in unison.
      const timer = setTimeout(() => animation.start(), Math.round(phase * BREATH_MS));
      return () => {
        clearTimeout(timer);
        animation.stop();
      };
    }

    scale.setValue(1);
    return;
  }, [winning, held, breathing, reduceMotion, phase, scale]);

  useEffect(() => {
    if (!winning || reduceMotion) {
      shine.setValue(0);
      return;
    }
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(shine, {
          toValue: 1,
          duration: SHINE_MS,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.delay(SHINE_GAP_MS),
        // Back to the start with no visible travel: the band is off the far
        // side by now, and tweening it home would drag a second highlight
        // across the symbol in the wrong direction.
        Animated.timing(shine, { toValue: 0, duration: 0, useNativeDriver: true }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [winning, reduceMotion, shine]);

  return (
    <Animated.View style={{ transform: [{ scale }] }}>
      <View style={[styles.glass, { width: size, height: size, borderRadius: radius.sm }]}>
        <SlotSymbol name={name} size={size} {...(family ? { family } : {})} />
        {winning && !reduceMotion ? (
          <Animated.View
            pointerEvents="none"
            style={[
              styles.shine,
              {
                width: size * 0.55,
                // Taller than the cell, because it is rotated: a band exactly
                // as tall as the box leaves triangular gaps at the corners
                // once it tilts.
                height: size * 2,
                top: -size * 0.5,
                transform: [
                  { rotate: '22deg' },
                  {
                    translateX: shine.interpolate({
                      inputRange: [0, 1],
                      outputRange: [-size * 1.2, size * 1.2],
                    }),
                  },
                ],
              },
            ]}
          >
            <LinearGradient
              // Transparent at both ends so the band has no edge — an edge
              // reads as a rectangle passing over the symbol rather than as
              // light moving across glass.
              colors={['rgba(255,255,255,0)', 'rgba(255,255,255,0.5)', 'rgba(255,255,255,0)']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={StyleSheet.absoluteFill}
            />
          </Animated.View>
        ) : null}
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  /**
   * The pane the shine travels across.
   *
   * Clips, so the band never escapes its own cell — and it is a separate view
   * from the one carrying the win glow, because clipping that would cut off
   * the glow, which is drawn outside the box on purpose.
   */
  glass: {
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  shine: {
    position: 'absolute',
    left: 0,
  },
});
