import React, { useEffect, useRef } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { colors, radius } from '@juwa/ui';
import { SlotSymbol } from './SlotSymbol';
import { spinNow } from '../sound';

/**
 * One reel of the slot machine.
 *
 * ONE CLOCK
 *
 * The reel's position is a pure function of `spinNow()` — the same clock the
 * stop sounds are scheduled against. Every frame asks "what time is it, and
 * where should I therefore be", rather than advancing a tween by however long
 * the last frame happened to take.
 *
 * That matters because the alternative is two clocks. A tween driven by frame
 * deltas and a sound booked on the audio clock agree at the start and diverge
 * from there — a dropped frame moves the picture but not the sound. 50-300ms
 * of drift is exactly what makes a slot machine feel broken, and it is the
 * single most common defect in a web slot.
 *
 * Because position is derived rather than accumulated, a stalled tab or a
 * garbage-collection pause cannot desynchronise anything: the reel simply
 * appears where it should be for the current time, and the sound that was
 * booked for that instant still fires on the audio thread.
 *
 * REELS MUST TRAVEL
 *
 * Each landing starts by displacing the strip a fixed distance and easing back
 * to zero, and the landing strip is rebuilt from the incoming result every
 * time. The reel therefore always has ground to cover. The classic bug here is
 * a reel that lands on an absolute index and is then asked to travel to that
 * same index next spin, covering zero distance — the reels never move again
 * while every other part of the machine keeps running, so results appear
 * instantly with no animation. `landingTravel` is a non-zero constant, which is
 * what makes that impossible.
 */

const FILLER = ['CHERRY', 'LEMON', 'PLUM', 'BAR', 'BELL', 'SEVEN', 'DIAMOND', 'WILD'];
const SYMBOL_SIZE = 58;
/** Symbols in one loop cycle. */
const LOOP_SYMBOLS = 8;
/** Decorative symbols that scroll past during the landing deceleration. */
const LANDING_FILLER = 10;
/** Loop scroll rate, symbols per second. Fast enough to blur. */
const LOOP_SYMBOLS_PER_SECOND = 18;

export type ReelPhase = 'idle' | 'spinning' | 'landing';

/**
 * Fast out, hard decelerate, overshoot, settle — a reel hitting its detent.
 *
 * The overshoot is not decoration. A curve that approaches its target
 * asymptotically looks stopped well before it formally ends, so a stop sound
 * booked for the end arrives after the picture has already settled. This one is
 * still visibly moving until the last frame.
 */
function easeOutBack(u: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  const p = u - 1;
  return 1 + c3 * p * p * p + c1 * p * p;
}

export interface ReelProps {
  /** The three symbols this reel shows once landed, top to bottom. */
  result: string[];
  /** Which reel this is, 0-based. */
  index: number;
  /**
   * Visible rows. Not every game is 5x3 — the three-reel classics show a single
   * row, and a window fixed at three would reveal two filler symbols above the
   * only one that counts.
   */
  rows?: number;
  phase: ReelPhase;
  /** Absolute time on the shared clock at which this reel begins landing. */
  landFrom?: number;
  /** How long this reel's landing takes, in seconds. */
  landDuration?: number;
  /** Rows that form part of a winning line, for the highlight. */
  winningRows?: number[];
  /**
   * Theme family supplying artwork for the picture symbols.
   *
   * Optional, and absent is a real answer: the classic fruit-machine games have
   * no family and are meant to keep the vector symbols.
   */
  family?: string;
  /**
   * True once a win is being celebrated. Losing symbols dim so the winning
   * ones stand out — showing what DIDN'T pay at full strength is why players
   * miss small wins entirely on a busy grid.
   */
  celebrating?: boolean;
  /** Increments once per spin, so each spin is a distinct animation. */
  round?: number;
  /** Fires when this reel physically stops. */
  onLanded?: () => void;
}

function randomFiller(count: number): string[] {
  return Array.from({ length: count }, () => FILLER[Math.floor(Math.random() * FILLER.length)]!);
}

export function Reel({
  result,
  index,
  rows = 3,
  phase,
  landFrom = 0,
  landDuration = 1,
  winningRows = [],
  celebrating = false,
  round = 0,
  family,
  onLanded,
}: ReelProps) {
  const offset = useRef(new Animated.Value(0)).current;
  const loopFiller = useRef<string[]>(randomFiller(LOOP_SYMBOLS)).current;
  const landingFiller = useRef<string[]>(randomFiller(LANDING_FILLER)).current;

  // Held in a ref: it changes identity on every parent render, and depending on
  // it would restart the animation mid-spin.
  const landedRef = useRef(onLanded);
  landedRef.current = onLanded;

  const spinning = phase === 'spinning';
  const landing = phase === 'landing';

  // The loop strip is duplicated so translating by exactly one cycle height
  // returns an identical image, which is what makes the repeat invisible.
  const loopStrip = [...loopFiller, ...loopFiller];
  const loopSpan = LOOP_SYMBOLS * SYMBOL_SIZE;

  const landingStrip = [...landingFiller, ...result];
  const landingTravel = LANDING_FILLER * SYMBOL_SIZE;

  // ------------------------------------------------------------------- loop
  useEffect(() => {
    if (!spinning) return;

    // Each reel starts at a different point in the cycle so five reels do not
    // move as one rigid block.
    const phaseOffset = (loopSpan * index) / 5;
    const startedAt = spinNow();
    let frame = 0;

    const tick = () => {
      const elapsed = spinNow() - startedAt;
      const travelled = elapsed * LOOP_SYMBOLS_PER_SECOND * SYMBOL_SIZE;
      // Modulo keeps the value bounded; without it the transform grows without
      // limit and eventually loses precision.
      offset.setValue(((phaseOffset - travelled) % loopSpan) + loopSpan);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spinning, index, loopSpan]);

  // ---------------------------------------------------------------- landing
  useEffect(() => {
    if (!landing) return;

    let frame = 0;
    let done = false;

    const tick = () => {
      const u = Math.min(1, Math.max(0, (spinNow() - landFrom) / landDuration));
      offset.setValue(landingTravel * (1 - easeOutBack(u)));

      if (u < 1) {
        frame = requestAnimationFrame(tick);
        return;
      }
      // Land exactly on zero. The eased value is within a fraction of a pixel
      // at u = 1, but "within a fraction" is not "on the payline".
      offset.setValue(0);
      if (!done) {
        done = true;
        landedRef.current?.();
      }
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [landing, landFrom, landDuration, landingTravel, round]);

  const strip = spinning ? loopStrip : landingStrip;
  const resultStart = spinning ? Infinity : landingFiller.length;

  return (
    <View style={[styles.window, { height: SYMBOL_SIZE * rows }]}>
      <Animated.View style={{ transform: [{ translateY: offset }] }}>
        {strip.map((symbol, i) => {
          const resultRow = i - resultStart;
          const onWinningLine =
            phase === 'idle' && resultRow >= 0 && winningRows.includes(resultRow);
          // Only dim once there is something to dim FOR. Outside a celebration
          // every symbol is equal, and a permanently faded grid just looks
          // broken.
          const dimmed = celebrating && phase === 'idle' && resultRow >= 0 && !onWinningLine;

          return (
            <View
              key={`${symbol}-${i}`}
              style={[
                styles.cell,
                onWinningLine && styles.cellWinning,
                dimmed && styles.cellDimmed,
              ]}
            >
              <SlotSymbol
                name={symbol}
                size={onWinningLine ? SYMBOL_SIZE - 4 : SYMBOL_SIZE - 12}
                {...(family ? { family } : {})}
              />
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
    // The strip is taller than the window; this is what turns it into a window.
    overflow: 'hidden',
    backgroundColor: '#05091A',
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
    borderWidth: 1,
    borderColor: colors.gold.default,
    // A glow rather than a hard edge: the payline should look lit from behind.
    shadowColor: colors.gold.default,
    shadowOpacity: 0.9,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 0 },
  },
  /** ~20% opacity, per the brief. Enough to read, far enough back to ignore. */
  cellDimmed: { opacity: 0.2 },
});
