/**
 * Firework shells behind the win banner.
 *
 * ## Why the rays were not enough
 *
 * The celebration already turns a fan of rays behind the card, and that reads
 * as "lit from behind" — a static property of the moment. The reference video
 * has actual fireworks: things that launch, arrive, and are gone, over and
 * over, for as long as the banner is up. The difference is EVENTS. A held
 * picture with a slow rotation is one event; six shells going off is six, and
 * a player's eye is caught by each of them.
 *
 * ## A shell, not a puff
 *
 * The cheap version of this is a circle that expands and fades, and it looks
 * like a circle that expands and fades. A firework has three parts and all
 * three are needed for it to read: it RISES from somewhere, it BREAKS at the
 * top, and the sparks FALL. The rise is what makes the break feel arrived at
 * rather than switched on.
 *
 * ## No artwork, one loop
 *
 * Sparks are 3-point views with a glow. Three shells alive at once and
 * twenty-four sparks each is seventy-two positioned divs at the worst moment —
 * which lands on top of the coin rain, so both are kept deliberately small.
 * One `requestAnimationFrame` drives everything, as in `Fireworks`.
 *
 * Silent under reduced motion: renders nothing at all. This is pure decoration
 * over a result that is already on the screen, so removing it costs the player
 * no information.
 */

import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { usePrefersReducedMotion } from '../motion';

/**
 * Shell colours, one per burst.
 *
 * Saturated and few. A firework that is white in the middle and coloured at the
 * edge is a photograph; a firework that is one colour all through is what a
 * three-point dot can convincingly be.
 */
const COLOURS = ['#FFD86B', '#FF5FA8', '#5FD8FF', '#FFF6D8', '#B77BFF', '#6BFFB0'];

/** Sparks per shell. Under about sixteen it reads as a splash, not a burst. */
const SPARKS = 24;
/** How long a shell takes to rise, in seconds. */
const RISE = 0.62;
/** And how long its sparks live after the break. */
const SPARK_LIFE = 1.05;
/** Gravity on the sparks. Lighter than the coins — these are embers. */
const GRAVITY = 420;
const DRAG = 0.72;

interface Shell {
  x: number;
  /** Where it breaks. */
  apex: number;
  /** Where it launched from — the bottom edge, so it rises INTO the frame. */
  from: number;
  colour: string;
  /** Seconds until launch. Negative means it is already flying. */
  age: number;
  sparks: { vx: number; vy: number }[];
}

export function ShellBurst({
  width,
  height,
  /** A new value restarts the display; falsy stops it. */
  round,
  active,
}: {
  width: number;
  height: number;
  round: number;
  active: boolean;
}) {
  const [, setTick] = useState(0);
  const shells = useRef<Shell[]>([]);
  const frame = useRef(0);
  const last = useRef(0);
  const reduced = usePrefersReducedMotion();

  useEffect(() => {
    if (!active || reduced || width <= 0) {
      shells.current = [];
      cancelAnimationFrame(frame.current);
      frame.current = 0;
      return undefined;
    }

    /*
     * Six shells, staggered across three seconds.
     *
     * Staggered rather than simultaneous: six at once is one big flash and
     * then nothing, which is the same failure the static rays have. Spread
     * out, there is always one arriving.
     */
    shells.current = Array.from({ length: 6 }, (_, i) => {
      const angleStep = (Math.PI * 2) / SPARKS;
      return {
        // Across the middle, avoiding the very edges where a burst is half
        // off-screen and reads as a rendering fault.
        x: width * (0.18 + Math.random() * 0.64),
        apex: height * (0.12 + Math.random() * 0.3),
        from: height * 0.8,
        colour: COLOURS[i % COLOURS.length]!,
        age: -(i * 0.45 + Math.random() * 0.25),
        sparks: Array.from({ length: SPARKS }, (_, s) => {
          /*
           * Evenly spaced around the circle, then jittered.
           *
           * Purely random angles clump — a burst made of them has bald patches
           * and reads as a scatter. Even spacing with a nudge gives the ring a
           * real firework has without the regularity of a clock face.
           */
          const angle = angleStep * s + (Math.random() - 0.5) * angleStep * 0.8;
          const speed = 110 + Math.random() * 120;
          return { vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed };
        }),
      };
    });

    last.current = performance.now();
    const step = (now: number) => {
      const dt = Math.min(0.05, (now - last.current) / 1000);
      last.current = now;
      let alive = false;
      for (const shell of shells.current) {
        shell.age += dt;
        if (shell.age < RISE + SPARK_LIFE) alive = true;
      }
      // Re-render by bumping a counter; the positions themselves are read from
      // the ref during render, so nothing is copied per frame.
      setTick((n) => n + 1);
      if (alive) frame.current = requestAnimationFrame(step);
      else frame.current = 0;
    };
    frame.current = requestAnimationFrame(step);

    return () => {
      cancelAnimationFrame(frame.current);
      frame.current = 0;
    };
  }, [active, reduced, width, height, round]);

  if (!active || reduced || width <= 0) return null;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {shells.current.map((shell, index) => {
        if (shell.age < 0) return null;

        // ---- rising
        if (shell.age < RISE) {
          const t = shell.age / RISE;
          // Decelerating, so it slows as it reaches the top — a shell running
          // out of momentum, not a dot on a rail.
          const eased = 1 - (1 - t) * (1 - t);
          const y = shell.from + (shell.apex - shell.from) * eased;
          return (
            <View key={index}>
              {/* The trail: three dots behind it, dimming. */}
              {[0.12, 0.24, 0.36].map((back, i) => (
                <View
                  key={back}
                  style={[
                    styles.spark,
                    {
                      left: shell.x,
                      top: y + (shell.from - shell.apex) * back * (1 - eased) * 0.5 + back * 26,
                      backgroundColor: shell.colour,
                      opacity: 0.5 - i * 0.14,
                      width: 2,
                      height: 2,
                    },
                  ]}
                />
              ))}
              <View
                style={[
                  styles.spark,
                  { left: shell.x, top: y, backgroundColor: '#FFFFFF', shadowColor: shell.colour },
                ]}
              />
            </View>
          );
        }

        // ---- broken
        const t = (shell.age - RISE) / SPARK_LIFE;
        if (t > 1) return null;
        /*
         * Position from the closed form rather than by integrating each frame.
         *
         * The sparks are ballistic and their whole life is under a second, so
         * `v * t * drag + ½gt²` is exact enough and costs no per-frame state —
         * which means a re-render can never desynchronise them from each other.
         */
        const decay = (1 - Math.pow(DRAG, t * 4)) / (1 - DRAG) / 4;
        const fade = t < 0.55 ? 1 : 1 - (t - 0.55) / 0.45;
        return (
          <View key={index}>
            {shell.sparks.map((spark, s) => (
              <View
                key={s}
                style={[
                  styles.spark,
                  {
                    left: shell.x + spark.vx * decay,
                    top: shell.apex + spark.vy * decay + 0.5 * GRAVITY * t * t,
                    backgroundColor: shell.colour,
                    shadowColor: shell.colour,
                    opacity: fade,
                  },
                ]}
              />
            ))}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  spark: {
    position: 'absolute',
    width: 3,
    height: 3,
    borderRadius: 2,
    // The bloom is what turns a coloured square into an ember. Without it
    // these read as dust.
    shadowOpacity: 0.95,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 0 },
  },
});
