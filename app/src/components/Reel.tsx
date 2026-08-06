import React, { useEffect, useRef, useState } from 'react';
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
/**
 * How tall one symbol is, in portrait.
 *
 * A default rather than a constant, because a phone held sideways has about
 * 200 points of usable height once the browser chrome and the tab bar are
 * accounted for — and three rows at 58 plus a spin button does not fit in it.
 * The machine shrinks instead of being scrolled past.
 */
export const SYMBOL_SIZE = 58;
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
  /**
   * The cells lit right now, as `reel,row` keys.
   *
   * Cells rather than rows, because a payline is not a row: a zig-zag visits a
   * different row on each reel, and a three-of-a-kind on a five-reel line pays
   * three cells rather than five. Highlighting whole rows lit up symbols that
   * had not paid and left the ones that had unlit on any line that was not
   * straight — which is to say, on most of them.
   *
   * The set is shared with the overlay that draws the connecting line, so the
   * lit symbols and the drawn line can never disagree.
   */
  litCells?: Set<string>;
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
  /**
   * This reel could still complete the bonus, and is being made to say so.
   *
   * Set on every reel that has not yet stopped once enough scatters are
   * already showing for one more to trigger the round. It is the moment a slot
   * machine is actually about — the player can see it coming — and a reel that
   * stops on schedule with no signal throws it away.
   *
   * The glow runs only while this reel is still moving, so it travels across
   * the machine reel by reel rather than lighting the whole grid at once.
   */
  anticipating?: boolean;
  /** Symbol height in points. Shrinks on short screens; see `SYMBOL_SIZE`. */
  size?: number;
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
  litCells,
  size = SYMBOL_SIZE,
  anticipating = false,
  celebrating = false,
  round = 0,
  family,
  onLanded,
}: ReelProps) {
  const offset = useRef(new Animated.Value(0)).current;
  const loopFiller = useRef<string[]>(randomFiller(LOOP_SYMBOLS)).current;
  const landingFiller = useRef<string[]>(randomFiller(LANDING_FILLER)).current;

  /**
   * Whether this reel is still in motion.
   *
   * Not the same as `phase`: during `landing` every reel is in the landing
   * phase, but they stop one after another. The glow has to follow the reel
   * that is actually still spinning, so it is cleared by this reel's own stop
   * rather than by the machine's phase.
   */
  const [moving, setMoving] = useState(phase !== 'idle');
  const glow = useRef(new Animated.Value(0)).current;

  // Held in a ref: it changes identity on every parent render, and depending on
  // it would restart the animation mid-spin.
  const landedRef = useRef(onLanded);
  landedRef.current = onLanded;

  const spinning = phase === 'spinning';
  const landing = phase === 'landing';

  useEffect(() => {
    if (phase !== 'idle') setMoving(true);
  }, [phase, round]);

  /**
   * The pulse.
   *
   * Runs only while this reel is both anticipating and moving, so it costs
   * nothing on the overwhelming majority of spins. `useNativeDriver` keeps it
   * off the JS thread, which matters here more than usual: the reel positions
   * are being computed every frame in JS on the same thread, and a glow that
   * stutters in time with the reels reads as the machine struggling.
   */
  useEffect(() => {
    if (!anticipating || !moving) {
      glow.setValue(0);
      return;
    }
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.timing(glow, { toValue: 1, duration: 340, useNativeDriver: true }),
        Animated.timing(glow, { toValue: 0.35, duration: 340, useNativeDriver: true }),
      ]),
    );
    pulse.start();
    return () => pulse.stop();
  }, [anticipating, moving, glow]);

  // The loop strip is duplicated so translating by exactly one cycle height
  // returns an identical image, which is what makes the repeat invisible.
  const loopStrip = [...loopFiller, ...loopFiller];
  const loopSpan = LOOP_SYMBOLS * size;

  const landingStrip = [...landingFiller, ...result];
  const landingTravel = LANDING_FILLER * size;

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
      const travelled = elapsed * LOOP_SYMBOLS_PER_SECOND * size;
      // Modulo keeps the value bounded; without it the transform grows without
      // limit and eventually loses precision.
      offset.setValue(((phaseOffset - travelled) % loopSpan) + loopSpan);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spinning, index, loopSpan, size]);

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
        setMoving(false);
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
    <View style={[styles.window, { height: size * rows }]}>
      <Animated.View style={{ transform: [{ translateY: offset }] }}>
        {strip.map((symbol, i) => {
          const resultRow = i - resultStart;
          const onWinningLine =
            phase === 'idle' && resultRow >= 0 && (litCells?.has(`${index},${resultRow}`) ?? false);
          // Only dim once there is something to dim FOR. Outside a celebration
          // every symbol is equal, and a permanently faded grid just looks
          // broken.
          const dimmed = celebrating && phase === 'idle' && resultRow >= 0 && !onWinningLine;

          return (
            <View
              key={`${symbol}-${i}`}
              style={[
                styles.cell,
                { height: size },
                onWinningLine && styles.cellWinning,
                dimmed && styles.cellDimmed,
              ]}
            >
              <SlotSymbol
                name={symbol}
                size={onWinningLine ? size - 4 : size - 12}
                {...(family ? { family } : {})}
              />
            </View>
          );
        })}
      </Animated.View>

      {anticipating ? (
        <Animated.View
          pointerEvents="none"
          style={[styles.anticipation, { opacity: glow }]}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        />
      ) : null}
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
  /**
   * Magenta rather than cyan on purpose. The palette reserves cyan for "press
   * this" and magenta for bonus moments, and this is precisely a bonus moment
   * — a cyan column here would read as an invitation to tap the reel.
   */
  anticipation: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: radius.sm,
    borderWidth: 2,
    borderColor: colors.neon.magenta,
    backgroundColor: 'rgba(255, 61, 138, 0.16)',
    shadowColor: colors.neon.magenta,
    shadowOpacity: 0.9,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 0 },
  },
});
