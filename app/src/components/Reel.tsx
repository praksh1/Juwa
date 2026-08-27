import React, { useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import {
  colors,
  landBlur,
  landPosition,
  radius,
  rampBlur,
  rampDistance,
  rampPosition,
  symbolState,
} from '@juwa/ui';
import { AnimatedSymbol } from './AnimatedSymbol';
import type { SymbolTint } from './SlotSymbol';
import type { Material } from './symbols/materials';
import { usePrefersReducedMotion } from '../motion';
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

/**
 * How long the reel takes to get up to speed — including the pull-back.
 *
 * A real reel is a wheel with mass. Pressing the button engages a drive that
 * has to overcome it, and the wheel rocks BACKWARDS a fraction of a symbol
 * before it goes anywhere. It is a tiny movement, maybe a quarter of a symbol,
 * and it is most of the difference between a machine that feels mechanical and
 * one that feels like a list being scrolled: without it the reels are at full
 * speed on the first frame, which nothing with mass has ever done.
 *
 * The screen must not begin the landing before this has finished — a reel that
 * decelerates while it is still accelerating reads as a fault. See
 * `MIN_LOOP_SECONDS` in SlotsScreen.
 */
export const SPIN_UP_SECONDS = 0.42;

/**
 * Peak blur radius as a fraction of the symbol height.
 *
 * Scaled rather than fixed, because the machine shrinks to 26 points in
 * landscape and a blur tuned for a 58-point symbol turns a small one into a
 * smudge with no shape left in it at all.
 */
const BLUR_RATIO = 0.085;
/** How far the strip fades at full speed. Sells the speed on its own where
 *  `filter` is not supported, and stops the blur reading as a focus fault. */
const SPIN_FADE = 0.22;

export type ReelPhase = 'idle' | 'spinning' | 'landing';

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
  /** Which game is dealing, so it can use its own symbols. */
  gameId?: string;
  /** The metal the drawn symbols are cast in. Comes from the game's accent. */
  tint?: SymbolTint;
  /** The substance this game's low symbols are cut from. */
  material?: Material;
  /**
   * How much of its cell the symbol fills, 0 to 1.
   *
   * Separate from `size`, which is the cell. Two games can have identical cells
   * and still look different if one crowds them and the other leaves air —
   * which is the difference between a chunky fruit machine and a nineteen-cell
   * diamond that would read as a wall if its symbols touched.
   */
  fill?: number;
  /**
   * Cell height, when it differs from the symbol's width.
   *
   * Symbols are square; cells need not be. On a phone five reels fix the cell
   * WIDTH at about 64 points, and a machine three of those tall is a strip
   * rather than a cabinet — so the cell is given extra height and the square
   * artwork is centred in it, which is what a real machine looks like.
   */
  cellHeight?: number;
  /**
   * True once a win is being celebrated. Losing symbols dim so the winning
   * ones stand out — showing what DIDN'T pay at full strength is why players
   * miss small wins entirely on a busy grid.
   */
  celebrating?: boolean;
  /**
   * The win presentation has finished.
   *
   * Winners stay lit and stay large; they simply stop moving. Without this the
   * pulse and the shine run until the next spin, which is precisely the
   * "it loops forever" a player reported.
   */
  settled?: boolean;
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
  /**
   * How far the reel travels during its landing, in symbols.
   *
   * A full spin covers ten, which is what makes a landing read as a reel
   * decelerating. A cascade refill covers two: the symbols that paid have just
   * vanished and the ones above them are dropping into the hole, so a long run
   * would read as a second spin and throw away the connection between the win
   * and the symbols that replaced it.
   */
  travel?: number;
  /**
   * Seconds the reel takes to reach full speed, pull-back included.
   *
   * A prop because free spins run the whole machine at roughly half length,
   * and a spin-up that stayed at its base duration would take most of a free
   * spin on its own.
   */
  spinUp?: number;
  /** Increments once per spin, so each spin is a distinct animation. */
  round?: number;
  /** Fires when this reel physically stops. */
  onLanded?: () => void;
  /** Reports that the browser missed the normal landing animation callback. */
  onLateLanding?: (lateByMs: number) => void;
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
  travel = LANDING_FILLER,
  spinUp = SPIN_UP_SECONDS,
  anticipating = false,
  celebrating = false,
  settled = false,
  round = 0,
  family,
  gameId,
  tint,
  material,
  fill = 0.86,
  cellHeight,
  onLanded,
  onLateLanding,
}: ReelProps) {
  const offset = useRef(new Animated.Value(0)).current;
  /**
   * How fast this reel is moving right now, as a fraction of its top speed.
   *
   * Driven from the same rAF ticks that place the strip, and derived from the
   * DERIVATIVE of the position curve rather than from elapsed time. That is
   * what keeps the blur honest: it peaks exactly when the reel is fastest and
   * reaches zero exactly as it settles, including through the overshoot at the
   * end of a landing, where a time-based fade would have cleared the blur
   * while the reel was still visibly moving.
   */
  const speed = useRef(new Animated.Value(0)).current;
  const reduceMotion = usePrefersReducedMotion();
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
  /** A travelling reflection makes anticipation read as a live event. */
  const anticipationSweep = useRef(new Animated.Value(0)).current;

  // Held in a ref: it changes identity on every parent render, and depending on
  // it would restart the animation mid-spin.
  const landedRef = useRef(onLanded);
  landedRef.current = onLanded;
  const lateLandingRef = useRef(onLateLanding);
  lateLandingRef.current = onLateLanding;

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

  useEffect(() => {
    if (!anticipating || !moving || reduceMotion) {
      anticipationSweep.setValue(0);
      return;
    }
    const sweep = Animated.loop(
      Animated.timing(anticipationSweep, {
        toValue: 1,
        duration: 780,
        useNativeDriver: true,
      }),
    );
    sweep.start();
    return () => sweep.stop();
  }, [anticipating, moving, reduceMotion, anticipationSweep]);

  // The loop strip is duplicated so translating by exactly one cycle height
  // returns an identical image, which is what makes the repeat invisible.
  const cell = cellHeight ?? size;
  const loopStrip = [...loopFiller, ...loopFiller];
  const loopSpan = LOOP_SYMBOLS * cell;

  const landingStrip = [...landingFiller, ...result];
  // Clamped to what the strip can actually show: asking for more travel than
  // there is filler above the result would start the reel on empty space.
  const landingTravel = Math.min(travel, LANDING_FILLER) * cell;

  // ------------------------------------------------------------------- loop
  useEffect(() => {
    if (!spinning) return;

    // Each reel starts at a different point in the cycle so five reels do not
    // move as one rigid block.
    const phaseOffset = (loopSpan * index) / 5;
    const startedAt = spinNow();
    let frame = 0;

    /*
     * The spin-up.
     *
     * `rate` is the strip's top speed in points per second. The ramp covers
     * `rampDistance` in `spinUp` seconds along a back-ease, which dips
     * backwards before it climbs — the pull-back — and the distance is chosen
     * so that the ramp's slope where it ends is EXACTLY the loop's rate.
     * Getting that wrong by any amount puts a velocity step at the handover,
     * and a velocity step in something that has been accelerating like a wheel
     * reads instantly as a dropped frame.
     */
    const rate = LOOP_SYMBOLS_PER_SECOND * cell;
    const ramp = rampDistance(rate, spinUp);

    const tick = () => {
      const elapsed = spinNow() - startedAt;
      let travelled: number;
      if (elapsed < spinUp) {
        const u = elapsed / spinUp;
        travelled = ramp * rampPosition(u);
        speed.setValue(rampBlur(u));
      } else {
        travelled = ramp + (elapsed - spinUp) * rate;
        speed.setValue(1);
      }
      // Modulo keeps the value bounded; without it the transform grows without
      // limit and eventually loses precision. Adding a span first keeps the
      // operand positive through the pull-back, where `travelled` is negative
      // and a bare modulo would flip the strip a whole cycle.
      offset.setValue((((phaseOffset - travelled) % loopSpan) + loopSpan) % loopSpan);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spinning, index, loopSpan, cell, spinUp]);

  // ---------------------------------------------------------------- landing
  useEffect(() => {
    if (!landing) return;

    let frame = 0;
    let done = false;

    const finish = (lateByMs = 0) => {
      if (done) return;
      done = true;
      offset.setValue(0);
      speed.setValue(0);
      setMoving(false);
      if (lateByMs > 0) lateLandingRef.current?.(lateByMs);
      landedRef.current?.();
    };

    const tick = () => {
      const u = Math.min(1, Math.max(0, (spinNow() - landFrom) / landDuration));
      offset.setValue(landingTravel * (1 - landPosition(u)));
      // Speed from the curve's own slope, normalised by its slope at the start.
      // It falls to zero exactly at u = 1, THROUGH the overshoot — a blur faded
      // on elapsed time instead would come off while the reel was still
      // visibly rocking back into its detent.
      speed.setValue(landBlur(u));

      if (u < 1) {
        frame = requestAnimationFrame(tick);
        return;
      }
      // Land exactly on zero. The eased value is within a fraction of a pixel
      // at u = 1, but "within a fraction" is not "on the payline".
      finish();
    };
    frame = requestAnimationFrame(tick);

    /*
     * Safari can occasionally stop delivering requestAnimationFrame callbacks
     * while a busy page is still otherwise interactive. The round used to wait
     * forever for the last reel in that case, leaving the symbols blurred until
     * a refresh. This timer is deliberately later than the booked landing and
     * only supplies the callback the animation should already have delivered.
     * Normal reel timing and appearance are unchanged.
     */
    const expectedAt = landFrom + landDuration;
    const watchdogDelayMs = Math.max(0, (expectedAt - spinNow()) * 1000) + 750;
    const watchdog = setTimeout(() => {
      const lateByMs = Math.max(1, (spinNow() - expectedAt) * 1000);
      finish(lateByMs);
    }, watchdogDelayMs);

    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(watchdog);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [landing, landFrom, landDuration, landingTravel, round]);

  const strip = spinning ? loopStrip : landingStrip;
  const resultStart = spinning ? Infinity : landingFiller.length;

  return (
    <View style={[styles.window, { height: cell * rows }]}>
      {/*
        The blur is a CSS filter, applied to the strip as a whole.

        react-native-web passes unrecognised style properties straight through
        to CSS, so `filter` reaches the browser; on a native build it is simply
        dropped and the reel keeps the opacity fade, which carries the speed on
        its own. That trade is deliberate now that this ships as a web app.

        It is interpolated from `speed` rather than switched on with the phase.
        A blur that appears and disappears with the spinning flag is a hard cut
        at both ends — the reel snaps into focus a third of a second before it
        stops moving — and the whole reason for deriving speed from the curve's
        slope is that the blur can come off exactly as the reel settles.

        There is no directional blur available here: CSS blur is isotropic, so
        the symbols soften sideways as well as vertically. At a twentieth of a
        symbol's height that is not visible in motion, and the alternative is an
        SVG filter chain that react-native-svg does not expose.
      */}
      <Animated.View
        style={{
          transform: [{ translateY: offset }],
          ...(reduceMotion
            ? {}
            : {
                opacity: speed.interpolate({
                  inputRange: [0, 1],
                  outputRange: [1, 1 - SPIN_FADE],
                }),
                filter: speed.interpolate({
                  inputRange: [0, 1],
                  outputRange: ['blur(0px)', `blur(${(size * BLUR_RATIO).toFixed(2)}px)`],
                }),
              }),
        }}
      >
        {strip.map((symbol, i) => {
          const resultRow = i - resultStart;
          /*
           * One answer, used by the border, the fade and the animation alike.
           *
           * These were three separate expressions over the same four inputs,
           * which is three chances for them to disagree — and a cell whose
           * border says it won while its symbol is being faded out is worse
           * than either alone. `symbolState` is a pure function in @juwa/ui
           * with the whole truth table asserted over it.
           */
          const state = symbolState({
            reelIdle: phase === 'idle',
            row: resultRow,
            paying: litCells?.has(`${index},${resultRow}`) ?? false,
            celebrating,
            settled,
          });

          return (
            <View
              key={`${symbol}-${i}`}
              style={[
                styles.cell,
                { height: cell },
                (state === 'winning' || state === 'won') && styles.cellWinning,
                state === 'dimmed' && styles.cellDimmed,
              ]}
            >
              {/*
                One fixed size, and the win expressed as a transform.

                Swapping the size prop re-measured every image in the cell to
                produce a single-frame jump. The drawn size is now constant and
                `AnimatedSymbol` scales it, which is both smooth and free.
              */}
              <AnimatedSymbol
                name={symbol}
                size={Math.round(size * fill)}
                state={state}
                // Stable per cell, so a symbol keeps its breathing phase
                // instead of restarting it on every parent render.
                seed={index * 31 + i}
                {...(family ? { family } : {})}
                {...(gameId ? { gameId } : {})}
                {...(tint ? { tint } : {})}
                {...(material ? { material } : {})}
              />
            </View>
          );
        })}
      </Animated.View>

      {/* Anticipation belongs only to a reel that is physically moving. The
          parent also clears the flag at settlement, but this local guard
          prevents a stopped reel from carrying a pink wash into the next spin
          even if a render and the settlement callback cross in one frame. */}
      {anticipating && moving ? (
        <>
          {!reduceMotion ? (
            <Animated.View
              pointerEvents="none"
              style={[
                styles.anticipationSweep,
                {
                  transform: [
                    { rotate: '-12deg' },
                    {
                      translateY: anticipationSweep.interpolate({
                        inputRange: [0, 1],
                        outputRange: [-260, 260],
                      }),
                    },
                  ],
                },
              ]}
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
            >
              <LinearGradient
                colors={['rgba(255,255,255,0)', 'rgba(255,220,242,0.72)', 'rgba(255,255,255,0)']}
                locations={[0, 0.5, 1]}
                start={{ x: 0, y: 0 }}
                end={{ x: 0, y: 1 }}
                style={StyleSheet.absoluteFill}
              />
            </Animated.View>
          ) : null}
          <Animated.View
            pointerEvents="none"
            style={[styles.anticipation, { opacity: glow }]}
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
          />
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  window: {
    flex: 1,
    // The strip is taller than the window; this is what turns it into a window.
    overflow: 'hidden',
    // Translucent, not opaque: each game now stands in a themed room drawn
    // behind the machine, and an opaque reel window covers the whole of it.
    // Dark enough that a symbol still reads on top of a bright background.
    backgroundColor: 'rgba(5, 9, 26, 0.72)',
    borderRadius: radius.sm,
    // The result sits at the bottom of the strip, so the window shows the end.
    justifyContent: 'flex-end',
  },
  cell: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  cellWinning: {
    backgroundColor: 'rgba(255, 197, 61, 0.34)',
    borderRadius: radius.sm,
    borderWidth: 2,
    borderColor: colors.gold.light,
    // A glow rather than a hard edge: the payline should look lit from behind.
    shadowColor: colors.gold.default,
    shadowOpacity: 0.9,
    shadowRadius: 20,
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
    borderWidth: 3,
    borderColor: colors.neon.magenta,
    backgroundColor: 'rgba(255, 61, 138, 0.28)',
    shadowColor: colors.neon.magenta,
    shadowOpacity: 0.9,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 0 },
  },
  anticipationSweep: {
    position: 'absolute',
    left: '-30%',
    right: '-30%',
    height: 120,
    opacity: 0.8,
  },
});
