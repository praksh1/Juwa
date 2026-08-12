/**
 * The moment a win lands.
 *
 * ## What this is for
 *
 * The instant games announce a win by changing a number's colour to green.
 * That is the entire celebration, and it is why the founder described them as
 * feeling built in the 1990s — not because the layout is dated, but because
 * nothing HAPPENS. A slot machine already has a coin burst and a win overlay;
 * these five had a green digit.
 *
 * So this is a burst of particles thrown from a point, in the game's own
 * accent colour, scaled to how big the win was. It is deliberately generic —
 * five games, one celebration — because a win should feel the same wherever it
 * happens, and because five bespoke ones would be five things to maintain and
 * four of them would rot.
 *
 * ## The coins now LAND
 *
 * Added after the founder sent a reference video of a physical cabinet. The
 * single biggest difference between that and this was not the artwork: it was
 * that their coins fall onto a heap that grows under the win meter, and ours
 * fell off the bottom of the screen. A fountain that empties reads as an
 * effect; a pile that accumulates reads as money arriving.
 *
 * Opt in with `pile`. Without it the behaviour is exactly what it was, because
 * the instant games are played on a small board where a heap would cover the
 * controls.
 *
 * ## Why it is drawn rather than animated per particle
 *
 * Forty `Animated.View`s each with their own driver is forty JS-driven
 * animations on a phone that is also running a game. One `requestAnimationFrame`
 * loop writing one tree of images is one. The particles are simulated with real
 * gravity and drag so the arc reads as thrown rather than as scattered — that
 * is the difference between fireworks and a screensaver.
 *
 * Nothing here is on the money path. It draws what it is told and cannot
 * change what was paid.
 */

import React, { useEffect, useRef, useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { usePrefersReducedMotion } from '../motion';

/**
 * The coin, at six rotations.
 *
 * Six is what makes a tumbling coin read as tumbling rather than as a card
 * flipping: the sequence runs face-on, through three-quarters, to edge-on, and
 * a particle picks its frame from its own spin so no two coins in a burst are
 * at the same angle.
 *
 * Loaded by URL rather than bundled through `require`, because these live in
 * `art/` which the web build copies verbatim — the same route every symbol and
 * tile in the app already takes.
 */
const COINS = [
  '/art/overlays/coin-00.png',
  '/art/overlays/coin-01.png',
  '/art/overlays/coin-02.png',
  '/art/overlays/coin-03.png',
  '/art/overlays/coin-04.png',
  '/art/overlays/coin-05.png',
];
const CONFETTI = '/art/overlays/confetti-gold.png';

export interface FireworksHandle {
  /** Throw a burst upward from the middle. `power` 0..1 scales count and speed. */
  fire: (power: number) => void;
  /**
   * Rain coins from above the top edge for `seconds`, which is what a cabinet
   * does while its win meter counts up. `power` scales the rate.
   */
  pour: (power: number, seconds: number) => void;
  /** Sweep the board immediately — a new round starting, or a screen leaving. */
  clear: () => void;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  ttl: number;
  /** Half the sprite's drawn size, in points. */
  r: number;
  /** Which sprite: a coin frame, or the confetti ribbon. */
  art: string;
  /** Degrees per second. Ribbons tumble faster than coins. */
  spin: number;
  /** Starting angle, so a burst is not a rank of identical objects. */
  angle: number;
  /**
   * Landed, and now part of the heap.
   *
   * A settled particle stops moving, stops turning, and stops ageing — its
   * `ttl` no longer applies. It leaves only when the pile is swept.
   */
  settled: boolean;
  /** Frozen at the moment of landing, so a resting coin does not keep spinning. */
  restAngle: number;
}

/** Gravity, in points per second squared. Tuned by eye against a 300pt board. */
const GRAVITY = 900;
/** Air drag per second. Without it the arcs are parabolas and read as cheap. */
const DRAG = 0.86;

/**
 * The heap, as a height map.
 *
 * Twenty-four columns across the width, each holding how deep the pile is
 * there. A coin lands on the top of its own column and raises it — and raises
 * its NEIGHBOURS by a third as much, which is the whole trick: without the
 * spill, coins landing in the same place build a tower, and a tower is the one
 * shape a pile of coins never makes.
 */
const COLUMNS = 24;
/** How much of its own diameter a landed coin adds. Under 1, so they overlap. */
const STACK_FACTOR = 0.5;
/** And to each side, so the heap slopes instead of stepping. */
const SPILL_FACTOR = 0.18;
/** The pile stops growing here, as a fraction of the board. */
const MAX_PILE = 0.34;
/**
 * The ceiling on live particles.
 *
 * React Native Web draws each of these as a positioned <img>, and a phone
 * running a game underneath has a budget. Past this the oldest settled coins
 * are dropped from the bottom of the heap, where nothing is looking.
 */
const MAX_PARTICLES = 240;
/** How long the heap is held after the last coin lands, before it fades. */
const PILE_HOLD_MS = 2_600;
const PILE_FADE_MS = 700;

export function Fireworks({
  width,
  height,
  controller,
  pile = false,
}: {
  width: number;
  height: number;
  /** Filled in by this component so a parent can fire it. */
  controller: React.MutableRefObject<FireworksHandle | null>;
  /**
   * Let coins land and accumulate instead of falling through.
   *
   * Off by default: the instant games play on a board barely taller than their
   * controls, and a heap there covers the thing the player is watching.
   */
  pile?: boolean;
}) {
  const [particles, setParticles] = useState<Particle[]>([]);
  const frame = useRef(0);
  const last = useRef(0);
  const live = useRef<Particle[]>([]);
  /** Pile depth per column, in points. Empty when nothing has landed. */
  const heights = useRef<number[]>(new Array(COLUMNS).fill(0));
  /** When the most recent coin landed, so the heap knows when to leave. */
  const lastLanding = useRef(0);
  /** 1 while the heap is held, ramping to 0 as it fades. */
  const pileAlpha = useRef(1);
  /** Remaining pour, in seconds, and the rate to pour at. */
  const pouring = useRef({ left: 0, rate: 0, power: 0 });
  const reduced = usePrefersReducedMotion();

  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  useEffect(() => {
    /** One coin or ribbon, with the shared randomisation. */
    const make = (p: number, x: number, y: number, vx: number, vy: number): Particle => {
      /*
       * Three coins to one ribbon. The ribbon is there to break the
       * regularity — a fountain of nothing but identical discs reads as a
       * texture, and one object of a different shape in every four is enough
       * to stop that without turning it into a party popper.
       */
      const ribbon = Math.random() < 0.25;
      return {
        x,
        y,
        vx,
        vy,
        life: 0,
        ttl: 0.9 + Math.random() * (0.5 + p * 0.6),
        // Coins are drawn at 14-26 points: large enough to be recognisable as
        // a coin, small enough that sixty of them are a fountain.
        r: (ribbon ? 6 : 7) + Math.random() * (4 + p * 6),
        art: ribbon ? CONFETTI : COINS[Math.floor(Math.random() * COINS.length)]!,
        spin: (Math.random() - 0.5) * (ribbon ? 900 : 420),
        angle: Math.random() * 360,
        settled: false,
        restAngle: 0,
      };
    };

    const start = () => {
      if (!frame.current) {
        last.current = performance.now();
        frame.current = requestAnimationFrame(step);
      }
    };

    const reset = () => {
      live.current = [];
      heights.current = new Array(COLUMNS).fill(0);
      pileAlpha.current = 1;
      pouring.current = { left: 0, rate: 0, power: 0 };
      setParticles([]);
    };

    controller.current = {
      fire: (power: number) => {
        if (reduced) return;
        const p = Math.max(0, Math.min(1, power));
        // 18 particles for a small win, 60 for a huge one. Below about a dozen
        // it reads as a glitch rather than as a burst.
        const count = Math.round(18 + p * 42);
        const speed = 260 + p * 340;
        const next: Particle[] = [];
        for (let i = 0; i < count; i += 1) {
          /*
           * Thrown UPWARD in a fan, not radially: a radial burst has as many
           * particles going down as up, and the ones going down look like
           * something falling off rather than something being celebrated.
           */
          const angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.15;
          const v = speed * (0.45 + Math.random() * 0.55);
          next.push(
            make(
              p,
              width / 2 + (Math.random() - 0.5) * 40,
              height * 0.62,
              Math.cos(angle) * v,
              Math.sin(angle) * v,
            ),
          );
        }
        pileAlpha.current = 1;
        live.current = [...live.current, ...next];
        start();
      },

      pour: (power: number, seconds: number) => {
        if (reduced) return;
        const p = Math.max(0, Math.min(1, power));
        pouring.current = {
          left: seconds,
          // 14 coins a second at the bottom of the scale, 46 at the top. Fast
          // enough to be a stream rather than a drip, slow enough that the
          // individual coins stay readable as coins.
          rate: 14 + p * 32,
          power: p,
        };
        pileAlpha.current = 1;
        start();
      },

      clear: reset,
    };

    /*
     * The pour's own accumulator, kept out of the loop body so a frame that
     * owes 0.6 of a coin carries the remainder to the next one — without it a
     * high rate on a slow frame rounds down and the stream stutters.
     */
    let owed = 0;

    const step = (now: number) => {
      const dt = Math.min(0.05, (now - last.current) / 1000);
      last.current = now;

      // ---- new coins from an ongoing pour
      if (pouring.current.left > 0) {
        pouring.current.left -= dt;
        owed += pouring.current.rate * dt;
        const spawn = Math.floor(owed);
        owed -= spawn;
        const p = pouring.current.power;
        for (let i = 0; i < spawn; i += 1) {
          live.current.push(
            make(
              p,
              /*
               * Biased toward the middle, so the heap is a MOUND.
               *
               * A uniform spread across the width produces an even band of
               * coins along the floor, which is what a conveyor belt looks
               * like. Averaging two random numbers gives a triangular
               * distribution — most coins near the centre, a few out to the
               * sides — and that piles up into the shape money actually makes.
               */
              width * 0.1 + ((Math.random() + Math.random()) / 2) * width * 0.8,
              // Above the top edge, so they enter already moving.
              -20 - Math.random() * 60,
              (Math.random() - 0.5) * 90,
              120 + Math.random() * 120,
            ),
          );
        }
      } else {
        owed = 0;
      }

      const drag = Math.pow(DRAG, dt);
      const floorY = height - 4;
      const maxPile = height * MAX_PILE;
      const next: Particle[] = [];
      let settledCount = 0;

      for (const particle of live.current) {
        if (particle.settled) {
          settledCount += 1;
          next.push(particle);
          continue;
        }

        const life = particle.life + dt;
        const vx = particle.vx * drag;
        const vy = particle.vy * drag + GRAVITY * dt;
        const x = particle.x + particle.vx * dt;
        const y = particle.y + particle.vy * dt;

        if (pile && vy > 0) {
          const column = Math.max(
            0,
            Math.min(COLUMNS - 1, Math.floor((x / Math.max(1, width)) * COLUMNS)),
          );
          const top = floorY - (heights.current[column] ?? 0);
          if (y + particle.r >= top) {
            /*
             * Landed. It stops here, raises its own column and spills a share
             * onto each neighbour so the heap slopes.
             *
             * A coin that lands off the sides of the board is dropped rather
             * than settled: it is outside the frame and would sit in a corner
             * nothing is looking at, holding a slot in the particle budget.
             */
            if (x < -particle.r || x > width + particle.r) continue;

            const rest = top - particle.r;
            const grow = particle.r * STACK_FACTOR;
            const spill = particle.r * SPILL_FACTOR;
            heights.current[column] = Math.min(maxPile, (heights.current[column] ?? 0) + grow);
            if (column > 0) {
              heights.current[column - 1] = Math.min(
                maxPile,
                (heights.current[column - 1] ?? 0) + spill,
              );
            }
            if (column < COLUMNS - 1) {
              heights.current[column + 1] = Math.min(
                maxPile,
                (heights.current[column + 1] ?? 0) + spill,
              );
            }
            lastLanding.current = now;
            settledCount += 1;
            next.push({
              ...particle,
              x,
              y: rest,
              vx: 0,
              vy: 0,
              life,
              settled: true,
              // Frozen where it stopped turning, so the heap is still.
              restAngle: particle.angle + particle.spin * life,
            });
            continue;
          }
        }

        // Not landed. It ages out as before — which is the whole behaviour
        // when `pile` is off.
        if (life >= particle.ttl) continue;
        next.push({ ...particle, life, vx, vy, x, y });
      }

      /*
       * The heap leaves on its own.
       *
       * Held for a beat after the last coin lands so the player sees what
       * arrived, then faded. Without this the pile is permanent and the next
       * spin happens behind a wall of coins.
       */
      const idle = pouring.current.left <= 0 && settledCount > 0;
      if (idle && now - lastLanding.current > PILE_HOLD_MS) {
        pileAlpha.current = Math.max(
          0,
          1 - (now - lastLanding.current - PILE_HOLD_MS) / PILE_FADE_MS,
        );
        if (pileAlpha.current <= 0) {
          heights.current = new Array(COLUMNS).fill(0);
          pileAlpha.current = 1;
          live.current = next.filter((p) => !p.settled);
          setParticles(live.current);
          if (live.current.length) {
            frame.current = requestAnimationFrame(step);
          } else {
            cancelAnimationFrame(frame.current);
            frame.current = 0;
          }
          return;
        }
      }

      /*
       * The budget. Settled coins at the BOTTOM of the heap go first — they
       * are the ones buried under everything else, so dropping them is the
       * change nobody can see.
       */
      if (next.length > MAX_PARTICLES) {
        const settled = next.filter((p) => p.settled).sort((a, b) => b.y - a.y);
        const drop = new Set(settled.slice(0, next.length - MAX_PARTICLES));
        live.current = next.filter((p) => !drop.has(p));
      } else {
        live.current = next;
      }
      setParticles(live.current);

      if (live.current.length || pouring.current.left > 0) {
        frame.current = requestAnimationFrame(step);
      } else {
        cancelAnimationFrame(frame.current);
        frame.current = 0;
      }
    };

    return () => {
      controller.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [width, height, reduced, pile]);

  if (!particles.length) return null;

  return (
    <View style={[StyleSheet.absoluteFill, styles.layer]} pointerEvents="none">
      {particles.map((particle, i) => {
        /*
         * A flying coin fades out over its own lifetime, so the burst thins
         * rather than vanishing all at once. A SETTLED one does not — it is
         * part of the heap, and a heap whose lower coins had faded to nothing
         * would be a ring of coins around a hole.
         */
        const t = particle.life / particle.ttl;
        const opacity = particle.settled
          ? pileAlpha.current
          : t > 0.7
            ? 1 - (t - 0.7) / 0.3
            : 1;
        const size = particle.r * 2;
        const rotation = particle.settled
          ? particle.restAngle
          : particle.angle + particle.spin * particle.life;
        return (
          <Image
            key={i}
            source={{ uri: particle.art }}
            style={{
              position: 'absolute',
              left: particle.x - particle.r,
              top: particle.y - particle.r,
              width: size,
              height: size,
              opacity,
              transform: [{ rotate: `${rotation}deg` }],
            }}
          />
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  // Above the board's own content, below nothing — the burst is the top layer
  // of the play area and must never intercept a tap.
  layer: { alignItems: 'center', justifyContent: 'center' },
});
