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
 * ## There was a heap here, and it is gone
 *
 * A previous version let the coins LAND: they came to rest on a height map along the
 * bottom of the cabinet and built a mound, copied from the founder's reference
 * video of a physical machine whose coins fall into a tray. On a phone it read
 * as, in their words, the coins "just laying down" — two hundred motionless
 * sprites resting on the floor for several seconds after the celebration ended,
 * still there behind the next spin's reels. A real tray has depth and specular
 * highlights and coins that shift; a stack of static PNGs has none of that and
 * reads as debris.
 *
 * The thing the heap was FOR — showing that money arrived rather than merely
 * fell — is done properly now by `CoinStream`, which carries the win out of the
 * readout and into the balance where it actually goes. So everything here falls
 * through and leaves, which is what it did before the heap and what it does
 * again.
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
export const COIN_FRAMES = [
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
  /**
   * Erupt coins TOWARD THE PLAYER.
   *
   * The one the founder actually asked for: coins that fly out of the screen
   * into your face, not a trickle that settles politely on the floor. Each
   * coin starts small at the centre and rushes outward, growing as it comes,
   * so the burst reads as depth rather than as sprites sliding around a plane.
   */
  blast: (power: number) => void;
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
   * How fast this coin is coming at the camera, in radii per second.
   *
   * Zero for everything that lives in the plane — the fountain and the rain.
   * Positive for a blast coin, which grows as it travels and never lands: it
   * leaves through the front of the screen, which is the whole effect.
   */
  approach: number;
  /**
   * Seconds still to wait before this particle exists.
   *
   * A blast used to launch every coin on one frame, which is a single pop —
   * whatever it does afterwards, the eye has already taken it in as one event.
   * Staggering the launches over half a second turns the same coins into a
   * stream coming at you, and it is the difference the founder asked for when
   * they said the burst was "really good" but to "slow it down so that the
   * player can see".
   *
   * A delayed particle is not stepped and not drawn. It costs a comparison.
   */
  delay: number;
  /**
   * Points per second squared pulling this particle down.
   *
   * Per particle rather than global because the two effects want different
   * worlds: a fountain thrown upward needs real weight or the arc reads as a
   * balloon, while coins raining from above the top edge want to DRIFT — at
   * full gravity they cross a 500-point cabinet in under a second, which is
   * the "come in like a robot" complaint in physics form.
   */
  gravity: number;
}

/** Gravity, in points per second squared. Tuned by eye against a 300pt board. */
const GRAVITY = 900;
/** The rain's own, low enough that a coin takes over a second to cross. */
const RAIN_GRAVITY = 320;
/** Air drag per second. Without it the arcs are parabolas and read as cheap. */
const DRAG = 0.86;

/**
 * The ceiling on live particles.
 *
 * React Native Web draws each of these as a positioned <img>, and a phone
 * running a game underneath has a budget. Past this the OLDEST are dropped,
 * which is the change nobody can see: everything here fades out over its own
 * lifetime, so the oldest particles are also the faintest.
 */
const MAX_PARTICLES = 240;

export function Fireworks({
  width,
  height,
  controller,
}: {
  width: number;
  height: number;
  /** Filled in by this component so a parent can fire it. */
  controller: React.MutableRefObject<FireworksHandle | null>;
}) {
  const [particles, setParticles] = useState<Particle[]>([]);
  const frame = useRef(0);
  const last = useRef(0);
  const live = useRef<Particle[]>([]);
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
        /*
         * Bigger than they were.
         *
         * These were 14 to 26 points across, and on a 390-point phone that is
         * confetti: the founder's word for the result was "tiny". At 20 to 52
         * a coin is an object you can see the milling on rather than a fleck
         * of spilled glitter.
         */
        r: (ribbon ? 8 : 10) + Math.random() * (6 + p * 10),
        art: ribbon ? CONFETTI : COIN_FRAMES[Math.floor(Math.random() * COIN_FRAMES.length)]!,
        spin: (Math.random() - 0.5) * (ribbon ? 900 : 420),
        angle: Math.random() * 360,
        approach: 0,
        delay: 0,
        gravity: GRAVITY,
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
        live.current = [...live.current, ...next];
        start();
      },

      blast: (power: number) => {
        if (reduced) return;
        const p = Math.max(0, Math.min(1, power));
        /*
         * Fewer coins than the fountain, and each one an event.
         *
         * A blast at sixty particles is a swarm of specks; at twenty-six, each
         * coin is large enough by the time it passes the edge to be a coin
         * rather than a texture. The count is the one thing that must NOT
         * scale up with the win — the SIZE does.
         */
        const count = Math.round(20 + p * 14);
        const next: Particle[] = [];
        for (let i = 0; i < count; i += 1) {
          /*
           * Radially outward, evenly spaced then jittered — the same reason
           * the firework sparks are: random angles clump, and a burst with
           * bald patches reads as a scatter rather than as something coming
           * at you.
           */
          const step = (Math.PI * 2) / count;
          const angle = step * i + (Math.random() - 0.5) * step * 0.9;
          // Slow across the plane, fast toward the camera. A coin that mostly
          // travels sideways is being thrown past the player, not at them.
          const v = (44 + Math.random() * 56) * (0.6 + p * 0.7);
          const coin = make(p, width / 2, height * 0.5, Math.cos(angle) * v, Math.sin(angle) * v);
          next.push({
            ...coin,
            // Starts SMALL, because it is far away. The growth is the depth
            // cue and it does not work if the coin begins at its final size.
            r: coin.r * 0.34,
            /*
             * HALF THE SPEED, THE SAME FINAL SIZE.
             *
             * Approach and lifetime multiply: a coin ends up (1 + approach ×
             * ttl) times its starting size, so 3.4 radii/second for one second
             * and 1.7 for two seconds both finish at roughly 4.4×. The founder
             * liked where these coins got to and asked only that they take
             * long enough to be seen getting there, so the product is held and
             * the rate is halved.
             */
            approach: 1.3 + Math.random() * 0.8 + p * 0.6,
            ttl: 1.7 + Math.random() * 0.7,
            spin: coin.spin * 0.45,
            /*
             * Launched over half a second rather than all on one frame.
             *
             * Evenly spaced, then jittered, so it is a stream rather than
             * three ranks of coins arriving in step.
             */
            delay: (i / count) * 0.5 + Math.random() * 0.06,
          });
        }
        live.current = [...live.current, ...next];
        start();
      },

      pour: (power: number, seconds: number) => {
        if (reduced) return;
        const p = Math.max(0, Math.min(1, power));
        pouring.current = {
          left: seconds,
          /*
           * 10 coins a second at the bottom of the scale, 32 at the top.
           *
           * Down from 14–46. Each coin now falls for over a second instead of
           * under one, so the same rate leaves three times as many on screen —
           * and a screen packed edge to edge with coins is a texture, which is
           * the state the founder described as "just laying down". Fewer,
           * slower, individually visible.
           */
          rate: 10 + p * 22,
          power: p,
        };
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
          const drop = make(
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
              (Math.random() - 0.5) * 60,
              // Down from 120–240. A coin entering at walking pace under a
              // third of gravity drifts through the cabinet over about a
              // second and a half; at the old numbers it was gone in half of
              // that and read as a dropped object rather than as falling money.
              70 + Math.random() * 70,
            );
          drop.gravity = RAIN_GRAVITY;
          // Long enough to cross the whole cabinet and leave through the
          // bottom, rather than ageing out somewhere over the reels.
          drop.ttl = 2.4 + Math.random() * 0.8;
          live.current.push(drop);
        }
      } else {
        owed = 0;
      }

      const drag = Math.pow(DRAG, dt);
      const next: Particle[] = [];

      for (const particle of live.current) {
        // Waiting its turn in a staggered blast. It exists, it is simply not
        // in the world yet — no ageing, no motion, and nothing drawn.
        if (particle.delay > 0) {
          next.push({ ...particle, delay: particle.delay - dt });
          continue;
        }

        const life = particle.life + dt;
        /*
         * A coin coming at the camera GROWS, and its apparent speed across the
         * screen grows with it — that is what perspective does, and leaving it
         * out is what makes a scaling sprite look like a scaling sprite. One
         * multiplier drives both.
         */
        const near = particle.approach > 0 ? 1 + particle.approach * life : 1;
        const vx = particle.approach > 0 ? particle.vx : particle.vx * drag;
        const vy =
          particle.approach > 0
            ? particle.vy
            : particle.vy * drag + particle.gravity * dt;
        const x = particle.x + vx * near * dt;
        const y = particle.y + vy * near * dt;

        // Everything leaves. A blast coin goes out through the front of the
        // screen, a poured one falls past the bottom edge, and both simply age
        // out — there is no floor here any more. See the note at the top.
        if (life >= particle.ttl) continue;
        next.push({ ...particle, life, vx, vy, x, y });
      }

      /*
       * The budget. The OLDEST go first, which is the change nobody can see:
       * every particle fades over its own lifetime, so the oldest on screen are
       * also the faintest.
       */
      if (next.length > MAX_PARTICLES) {
        live.current = next
          .slice()
          .sort((a, b) => a.life / a.ttl - b.life / b.ttl)
          .slice(0, MAX_PARTICLES);
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
  }, [width, height, reduced]);

  if (!particles.length) return null;

  return (
    <View style={[StyleSheet.absoluteFill, styles.layer]} pointerEvents="none">
      {particles.map((particle, i) => {
        // Queued behind the coins ahead of it in the blast. Drawing it at its
        // launch point would put the whole burst on screen as a tight knot of
        // motionless coins, which is the single-pop look the stagger exists
        // to remove.
        if (particle.delay > 0) return null;
        // Fades out over the last third of its life, so a burst thins rather
        // than vanishing all at once.
        const t = particle.life / particle.ttl;
        const opacity = t > 0.7 ? 1 - (t - 0.7) / 0.3 : 1;
        const near = particle.approach > 0 ? 1 + particle.approach * particle.life : 1;
        const size = particle.r * 2 * near;
        const rotation = particle.angle + particle.spin * particle.life;
        return (
          <Image
            key={i}
            source={{ uri: particle.art }}
            style={{
              position: 'absolute',
              left: particle.x - size / 2,
              top: particle.y - size / 2,
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
