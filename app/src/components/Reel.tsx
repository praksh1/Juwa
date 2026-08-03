import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import { colors, motion, radius, spacing } from '@juwa/ui';

/**
 * One spinning reel.
 *
 * HOW THIS WORKS
 *
 * A real slot machine has a physical strip of symbols that rotates past a
 * window. This does the same thing: it renders a tall column of symbols and
 * slides it upwards behind a fixed three-symbol window. The last three symbols
 * of the column are the *actual* result from the server, so when the animation
 * finishes they are exactly what is showing.
 *
 * The symbols above them are decorative filler — nobody can read them at speed,
 * which is the point.
 *
 * WHY IT IS SLOW ON PURPOSE
 *
 * 2.5 seconds is an eternity in UI terms. A snappier reel would be
 * mathematically identical and commercially worthless: the anticipation *is*
 * the product. Reels also stop left to right with a stagger so the final reel
 * lands last, which is what makes a near-miss feel like a near-miss.
 *
 * We use React Native's built-in Animated with the native driver rather than
 * Reanimated or Skia. It is a transform on a single view — the simplest thing
 * that runs at 60fps off the JS thread. Skia becomes worth its complexity when
 * we add particle effects and shaders to the win presentation, not before.
 */

const SYMBOL_GLYPHS: Record<string, string> = {
  SEVEN: '7️⃣',
  DIAMOND: '💎',
  BELL: '🔔',
  BAR: '🍫',
  CHERRY: '🍒',
  PLUM: '🍇',
  LEMON: '🍋',
  WILD: '⭐',
  SCATTER: '🎰',
};

const FILLER = ['CHERRY', 'LEMON', 'PLUM', 'BAR', 'BELL', 'SEVEN', 'DIAMOND'];
const SYMBOL_SIZE = 56;
const VISIBLE_ROWS = 3;
/** How many decorative symbols scroll past before the result lands. */
const FILLER_COUNT = 14;

export interface ReelProps {
  /** The three symbols this reel must show when it stops, top to bottom. */
  result: string[];
  /** Which reel this is, 0-based. Drives the stagger. */
  index: number;
  spinning: boolean;
  /** Rows that form part of a winning line, for the highlight. */
  winningRows?: number[];
  /**
   * Multiplier on the spin duration.
   *
   * Free spins run at ~0.45 so a run of twelve does not take a full minute.
   * The anticipation that justifies a slow base spin is already spent by then —
   * the player knows the bonus is happening and now wants to see the numbers.
   */
  speed?: number;
  /**
   * Increments once per spin.
   *
   * `spinning` alone is not enough to drive a free-spins run: it stays true for
   * the whole sequence, so the animation effect would fire once and the later
   * reels would never move. This is what makes each spin a distinct event.
   */
  round?: number;
  onStopped?: () => void;
}

export function Reel({
  result,
  index,
  spinning,
  winningRows = [],
  speed = 1,
  round = 0,
  onStopped,
}: ReelProps) {
  // Rest position is 0, which shows the result. The spin starts the strip
  // displaced downwards so the filler fills the window, then settles back to 0.
  const offset = useRef(new Animated.Value(0)).current;
  // Chosen once per mount. The strip moves far too fast for a repeat to be
  // visible mid-spin, so re-randomising every spin buys nothing.
  const filler = useRef<string[]>([]);

  if (filler.current.length === 0) {
    filler.current = Array.from(
      { length: FILLER_COUNT },
      () => FILLER[Math.floor(Math.random() * FILLER.length)]!,
    );
  }

  const strip = [...filler.current, ...result];
  const travel = filler.current.length * SYMBOL_SIZE;

  useEffect(() => {
    if (!spinning) return;

    // Jump to the top of the filler, then wind down to the result.
    offset.setValue(travel);
    const duration = (motion.reelSpin + index * motion.reelStagger) * speed;

    const animation = Animated.timing(offset, {
      toValue: 0,
      duration,
      // Starts fast and decelerates into place. A linear stop reads as a
      // glitch; the ease-out is what makes it feel mechanical.
      easing: Easing.bezier(0.15, 0.6, 0.25, 1),
      useNativeDriver: true,
    });

    animation.start(({ finished }) => {
      if (finished) onStopped?.();
    });
    return () => animation.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spinning, index, travel, speed, round]);

  return (
    <View style={styles.window}>
      <Animated.View style={{ transform: [{ translateY: offset }] }}>
        {strip.map((symbol, i) => {
          const resultRow = i - filler.current.length;
          const highlighted =
            !spinning && resultRow >= 0 && winningRows.includes(resultRow);
          return (
            <View
              key={`${symbol}-${i}`}
              style={[styles.cell, highlighted && styles.cellWinning]}
            >
              <Text style={styles.glyph}>{SYMBOL_GLYPHS[symbol] ?? '❓'}</Text>
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
    backgroundColor: colors.surface.base,
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
  glyph: { fontSize: 32, lineHeight: SYMBOL_SIZE },
});

export const REEL_SYMBOL_SIZE = SYMBOL_SIZE;
export const REEL_GAP = spacing.xs;
