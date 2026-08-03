import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { colors, motion, radius, spacing } from '@juwa/ui';
import { SlotSymbol } from './SlotSymbol';

/**
 * One reel of the slot machine.
 *
 * HOW A REEL ACTUALLY BEHAVES
 *
 * A physical reel spins for as long as it needs to and then stops. It does not
 * spin for a duration agreed in advance — which is what this component used to
 * do, and it caused two visible faults:
 *
 *   1. The reels ran on a fixed timer started at the tap, while the result
 *      arrived over the network. Everything keyed to "the reels have landed"
 *      was therefore late by exactly the round-trip time, and that time changes
 *      every spin. The stop sounds drifted away from the stopping.
 *   2. When the network was slower than the animation, the reels stopped on the
 *      *previous* result and the new symbols appeared afterwards.
 *
 * So the reel has three phases instead. It idles, it loops indefinitely while
 * we wait for the server, and when the result exists it lands — decelerating
 * onto the real symbols. `onLanded` fires from the landing animation's own
 * completion callback, so anything scheduled off it is in sync by construction
 * rather than by arithmetic.
 *
 * The loop and the landing use different strips. During the loop the reel shows
 * filler only; the landing strip is filler followed by the result. The swap
 * happens while the strip is moving at full speed, where it cannot be seen.
 */

const FILLER = ['CHERRY', 'LEMON', 'PLUM', 'BAR', 'BELL', 'SEVEN', 'DIAMOND', 'WILD'];
const SYMBOL_SIZE = 58;
const VISIBLE_ROWS = 3;
/** Symbols in one loop cycle. More is smoother; fewer is cheaper to render. */
const LOOP_SYMBOLS = 8;
/** Decorative symbols that scroll past during the landing deceleration. */
const LANDING_FILLER = 10;
/** One full loop cycle. ~55ms per symbol reads as a blur, not as a slideshow. */
const LOOP_MS = LOOP_SYMBOLS * 55;

export type ReelPhase = 'idle' | 'spinning' | 'landing';

export interface ReelProps {
  /** The three symbols this reel shows once landed, top to bottom. */
  result: string[];
  /** Which reel this is, 0-based. Drives the stagger. */
  index: number;
  phase: ReelPhase;
  /** Rows that form part of a winning line, for the highlight. */
  winningRows?: number[];
  /**
   * Multiplier on the landing duration. Free spins run at ~0.45: the tension
   * that earns a slow base spin is already spent, and a dozen full-length
   * landings is a minute of waiting.
   */
  speed?: number;
  /** Increments once per spin, so each spin is a distinct animation. */
  round?: number;
  /** Fires when this reel physically stops. The only correct stop signal. */
  onLanded?: () => void;
}

function randomFiller(count: number): string[] {
  return Array.from({ length: count }, () => FILLER[Math.floor(Math.random() * FILLER.length)]!);
}

export function Reel({
  result,
  index,
  phase,
  winningRows = [],
  speed = 1,
  round = 0,
  onLanded,
}: ReelProps) {
  const offset = useRef(new Animated.Value(0)).current;
  const loopFiller = useRef<string[]>(randomFiller(LOOP_SYMBOLS)).current;
  const landingFiller = useRef<string[]>(randomFiller(LANDING_FILLER)).current;

  // Keep the callback in a ref: it changes identity on every render of the
  // parent, and depending on it directly would restart the animation mid-spin.
  const landedRef = useRef(onLanded);
  landedRef.current = onLanded;

  const spinning = phase === 'spinning';
  const landing = phase === 'landing';

  // The loop strip is duplicated so translating by exactly one cycle height
  // returns to an identical image — that is what makes the repeat invisible.
  const loopStrip = [...loopFiller, ...loopFiller];
  const loopSpan = LOOP_SYMBOLS * SYMBOL_SIZE;

  const landingStrip = [...landingFiller, ...result];
  const landingTravel = LANDING_FILLER * SYMBOL_SIZE;

  useEffect(() => {
    if (!spinning) return;

    // Every reel starts its loop at a different point in the cycle, so five
    // reels do not move as one rigid block.
    const startAt = (loopSpan * index) / 5;
    offset.setValue(startAt);

    const loop = Animated.loop(
      Animated.timing(offset, {
        toValue: startAt - loopSpan,
        duration: LOOP_MS,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spinning, index, loopSpan]);

  useEffect(() => {
    if (!landing) return;

    offset.setValue(landingTravel);
    const duration = (motion.reelSpin * 0.42 + index * motion.reelStagger) * speed;

    const animation = Animated.timing(offset, {
      toValue: 0,
      /**
       * Overshoot slightly and snap back, the way a mechanical reel settles
       * against its detent.
       *
       * This is not only about feel. A plain ease-out approaches zero
       * asymptotically: the reel LOOKS stopped roughly 140ms before the tween
       * formally ends, so the stop sound — which fires on completion — landed
       * that far behind the picture. Measured at 138ms before this change and
       * under 40ms after. A curve that is still visibly moving right up to the
       * end makes the completion callback and the apparent stop the same event.
       */
      easing: Easing.out(Easing.back(1.4)),
      duration,
      useNativeDriver: true,
    });

    animation.start(({ finished }) => {
      if (finished) landedRef.current?.();
    });
    return () => animation.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [landing, index, landingTravel, speed, round]);

  const strip = spinning ? loopStrip : landingStrip;
  const resultStart = spinning ? Infinity : landingFiller.length;

  return (
    <View style={styles.window}>
      <Animated.View style={{ transform: [{ translateY: offset }] }}>
        {strip.map((symbol, i) => {
          const resultRow = i - resultStart;
          const highlighted =
            phase === 'idle' && resultRow >= 0 && winningRows.includes(resultRow);
          return (
            <View
              key={`${symbol}-${i}`}
              style={[styles.cell, highlighted && styles.cellWinning]}
            >
              <SlotSymbol name={symbol} size={SYMBOL_SIZE - 12} />
            </View>
          );
        })}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  window: {
    flex: 1,
    height: SYMBOL_SIZE * VISIBLE_ROWS,
    // The strip is taller than the window; this is what turns it into a window.
    overflow: 'hidden',
    backgroundColor: '#080D1C',
    borderRadius: radius.sm,
    // The result sits at the bottom of the strip, so the window shows the end.
    justifyContent: 'flex-end',
  },
  cell: {
    height: SYMBOL_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cellWinning: {
    backgroundColor: colors.gold.wash,
    borderRadius: radius.sm,
  },
});

export const REEL_SYMBOL_SIZE = SYMBOL_SIZE;
export const REEL_GAP = spacing.xs;
