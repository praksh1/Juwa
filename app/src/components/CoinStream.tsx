/**
 * The win, carried into the balance as coins.
 *
 * ## What the founder asked for, in their words
 *
 * > "the 'Win' next to the Bet shows the number of GC wins — which is good.
 * > Then, take a few seconds, convert that GC to gold coins animations and load
 * > the coins to the 'Balance' and show the Balance going up!"
 *
 * That is a real mechanic and not decoration. Until now the balance simply
 * became a larger number at some point during the celebration — the player was
 * told they won 800 GC in one place and separately observed a different figure
 * change in another, and nothing on the screen connected the two. A cabinet
 * connects them physically: the coins come out of the machine and go into your
 * tray, and you watch them do it.
 *
 * So: coins leave the WIN readout, arc up to the BALANCE, and the balance
 * climbs while they arrive. One event, with a cause you can see.
 *
 * ## Why the coins arrive before the number finishes
 *
 * The first coin lands about a fifth of the way through the stream, and the
 * balance starts climbing then rather than when the last one does. A counter
 * that waits for the animation to finish and then jumps is two events again,
 * which is the fault this component exists to fix. `onFirstArrival` is what the
 * screen hangs the roll-up on.
 *
 * ## Why one loop rather than N animations
 *
 * Same reason as `Fireworks`: twenty `Animated.Value`s with their own drivers
 * is twenty JS animations on a phone mid-game. This is one `requestAnimationFrame`
 * writing one tree of images, and the flight paths are closed-form — position
 * is a function of time, so nothing integrates and nothing drifts.
 *
 * Nothing here is on the money path. The balance it is drawn beside is set from
 * the server's own figure; this draws the journey, it does not decide the
 * destination.
 */

import React, { useEffect, useRef, useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { COIN_FRAMES } from './Fireworks';
import { sounds } from '../sound';
import { usePrefersReducedMotion } from '../motion';

export interface Point {
  x: number;
  y: number;
}

/** How big a coin is at the moment it leaves the win readout, in points. */
const START_SIZE = 34;
/** And as it drops into the balance. Smaller: it is going away from you. */
const END_SIZE = 16;
/** Ticks are throttled to this, so a fast stream is a patter and not a buzz. */
const MIN_TICK_MS = 70;

interface Flight {
  /** Milliseconds from the start of the stream until this coin launches. */
  start: number;
  /** How long it is in the air. */
  duration: number;
  /** The bezier's control point — what makes the path an arc rather than a line. */
  cx: number;
  cy: number;
  art: string;
  spin: number;
  angle: number;
  /** Scale jitter, so the stream is coins of different sizes rather than a rank. */
  size: number;
}

export function CoinStream({
  from,
  to,
  round,
  /**
   * How many coins. NOT proportional to the win — a 400,000 GC win does not
   * get four hundred thousand coins, and a stream long enough to count is a
   * stream the player is waiting out. Fifteen to twenty-six reads as "a lot"
   * at every size, which is all the number has to say.
   */
  count = 18,
  /** First launch to last arrival. The screen's balance roll-up matches it. */
  duration = 2_000,
  onFirstArrival,
  onDone,
}: {
  from: Point | null;
  to: Point | null;
  round: number;
  count?: number;
  duration?: number;
  onFirstArrival?: () => void;
  onDone?: () => void;
}) {
  const [, tick] = useState(0);
  const flights = useRef<Flight[]>([]);
  const began = useRef(0);
  const frame = useRef(0);
  const arrived = useRef(false);
  const lastTick = useRef(0);
  const reduced = usePrefersReducedMotion();

  /*
   * Held in refs and read by the loop rather than closed over.
   *
   * The stream outlives the render that started it — the WIN readout it
   * launches from can be re-laid-out mid-flight — and a loop holding the
   * points it was created with would keep drawing to a stale destination.
   */
  const source = useRef<Point | null>(from);
  const target = useRef<Point | null>(to);
  source.current = from;
  target.current = to;

  const finish = useRef(onDone);
  const arrival = useRef(onFirstArrival);
  finish.current = onDone;
  arrival.current = onFirstArrival;

  useEffect(() => {
    if (!round || !from || !to) return;

    /*
     * Under reduced motion there is no flight, but the EVENT still happens.
     *
     * The screen is waiting on `onFirstArrival` to start the balance climbing
     * and on `onDone` to release the round. Skipping the animation must not
     * skip either, or a player with reduced motion set gets a round that never
     * ends. See the note at the top of ../motion.
     */
    if (reduced) {
      arrival.current?.();
      const timer = setTimeout(() => finish.current?.(), 300);
      return () => clearTimeout(timer);
    }

    const flightTime = duration * 0.55;
    const stagger = duration - flightTime;
    flights.current = Array.from({ length: count }, (_, i) => {
      /*
       * The control point sits ABOVE and to one side of the straight line.
       *
       * A coin that travels in a straight line from the readout to the header
       * is a sprite being moved. Lifting the middle of the path and fanning
       * the lift left and right gives each coin its own trajectory, and the
       * set of them reads as a handful of coins thrown toward the tray.
       */
      const mx = (from.x + to.x) / 2;
      const my = (from.y + to.y) / 2;
      const spread = (i / Math.max(1, count - 1) - 0.5) * 2;
      return {
        start: (i / count) * stagger + Math.random() * (stagger / count),
        duration: flightTime * (0.85 + Math.random() * 0.3),
        cx: mx + spread * 110 + (Math.random() - 0.5) * 40,
        // Negative is up the screen. The arc peaks well above both ends, which
        // is what stops the stream reading as a diagonal wipe.
        cy: my - 90 - Math.random() * 70,
        art: COIN_FRAMES[Math.floor(Math.random() * COIN_FRAMES.length)]!,
        spin: (Math.random() - 0.5) * 520,
        angle: Math.random() * 360,
        size: 0.8 + Math.random() * 0.45,
      };
    });

    began.current = performance.now();
    arrived.current = false;
    lastTick.current = 0;

    const step = () => {
      const now = performance.now();
      const elapsed = now - began.current;

      /*
       * The first landing, once.
       *
       * Everything after it is a coin joining a climb that has already
       * started, which is the whole point: the number moves because coins are
       * arriving, not after they have all finished.
       */
      if (!arrived.current) {
        const first = flights.current.reduce(
          (soonest, f) => Math.min(soonest, f.start + f.duration),
          Infinity,
        );
        if (elapsed >= first) {
          arrived.current = true;
          arrival.current?.();
        }
      }

      // One click per coin dropped in the tray, throttled.
      const landing = flights.current.some(
        (f) => elapsed >= f.start + f.duration && elapsed < f.start + f.duration + 40,
      );
      if (landing && now - lastTick.current > MIN_TICK_MS) {
        lastTick.current = now;
        sounds.tick();
      }

      tick((n) => n + 1);

      if (elapsed < duration + flightTime) {
        frame.current = requestAnimationFrame(step);
      } else {
        frame.current = 0;
        flights.current = [];
        tick((n) => n + 1);
        finish.current?.();
      }
    };

    frame.current = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(frame.current);
      frame.current = 0;
      flights.current = [];
    };
    // `from`/`to` deliberately excluded: a re-measure mid-flight must not
    // restart the stream. The loop reads them from the refs above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [round, reduced, count, duration]);

  const start = source.current;
  const end = target.current;
  if (!flights.current.length || !start || !end) return null;

  const elapsed = performance.now() - began.current;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {flights.current.map((flight, i) => {
        const u = (elapsed - flight.start) / flight.duration;
        if (u < 0 || u > 1) return null;

        /*
         * A quadratic bezier, evaluated rather than integrated.
         *
         * Position is a pure function of `u`, so a dropped frame moves the
         * coin further rather than putting it behind — which is why a stream
         * of these stays in formation on a phone that is also spinning reels.
         */
        const inv = 1 - u;
        const x = inv * inv * start.x + 2 * inv * u * flight.cx + u * u * end.x;
        const y = inv * inv * start.y + 2 * inv * u * flight.cy + u * u * end.y;

        // Shrinks as it goes: it is travelling away from the player, into the
        // header. The opposite of the win blast, on purpose.
        const size = (START_SIZE + (END_SIZE - START_SIZE) * u) * flight.size;
        // Fades in off the readout and out into the balance, so neither end of
        // the path has coins popping into or out of existence.
        const opacity = u < 0.12 ? u / 0.12 : u > 0.88 ? (1 - u) / 0.12 : 1;

        return (
          <Image
            key={i}
            source={{ uri: flight.art }}
            style={{
              position: 'absolute',
              left: x - size / 2,
              top: y - size / 2,
              width: size,
              height: size,
              opacity,
              transform: [
                { rotate: `${flight.angle + flight.spin * (u * flight.duration) * 0.001}deg` },
              ],
            }}
          />
        );
      })}
    </View>
  );
}
