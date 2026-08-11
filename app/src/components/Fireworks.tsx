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
 * ## Why it is drawn rather than animated per particle
 *
 * Forty `Animated.View`s each with their own driver is forty JS-driven
 * animations on a phone that is also running a game. One `requestAnimationFrame`
 * loop writing one SVG is one. The particles are simulated with real gravity
 * and drag so the arc reads as thrown rather than as scattered — that is the
 * difference between fireworks and a screensaver.
 *
 * Nothing here is on the money path. It draws what it is told and cannot
 * change what was paid.
 */

import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Defs, RadialGradient, Stop } from 'react-native-svg';
import { usePrefersReducedMotion } from '../motion';

export interface FireworksHandle {
  /** Throw a burst. `power` 0..1 scales count, speed and life. */
  fire: (power: number) => void;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  ttl: number;
  r: number;
  hue: string;
}

/** Gravity, in points per second squared. Tuned by eye against a 300pt board. */
const GRAVITY = 900;
/** Air drag per second. Without it the arcs are parabolas and read as cheap. */
const DRAG = 0.86;

export function Fireworks({
  accent,
  width,
  height,
  controller,
}: {
  accent: string;
  width: number;
  height: number;
  /** Filled in by this component so a parent can fire it. */
  controller: React.MutableRefObject<FireworksHandle | null>;
}) {
  const [particles, setParticles] = useState<Particle[]>([]);
  const frame = useRef(0);
  const last = useRef(0);
  const live = useRef<Particle[]>([]);
  const reduced = usePrefersReducedMotion();

  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  useEffect(() => {
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
          // Thrown UPWARD in a fan, not radially: a radial burst has as many
          // particles going down as up, and the ones going down look like
          // something falling off rather than something being celebrated.
          const angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.15;
          const v = speed * (0.45 + Math.random() * 0.55);
          next.push({
            x: width / 2 + (Math.random() - 0.5) * 40,
            y: height * 0.62,
            vx: Math.cos(angle) * v,
            vy: Math.sin(angle) * v,
            life: 0,
            ttl: 0.9 + Math.random() * (0.5 + p * 0.6),
            r: 2 + Math.random() * (2 + p * 2.5),
            hue: pick(accent, Math.random()),
          });
        }
        live.current = [...live.current, ...next];
        if (!frame.current) {
          last.current = performance.now();
          frame.current = requestAnimationFrame(step);
        }
      },
    };
    return () => {
      controller.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accent, width, height, reduced]);

  const step = (now: number) => {
    const dt = Math.min(0.05, (now - last.current) / 1000);
    last.current = now;

    const drag = Math.pow(DRAG, dt);
    const next: Particle[] = [];
    for (const particle of live.current) {
      const life = particle.life + dt;
      if (life >= particle.ttl) continue;
      next.push({
        ...particle,
        life,
        vx: particle.vx * drag,
        vy: particle.vy * drag + GRAVITY * dt,
        x: particle.x + particle.vx * dt,
        y: particle.y + particle.vy * dt,
      });
    }
    live.current = next;
    setParticles(next);

    if (next.length) {
      frame.current = requestAnimationFrame(step);
    } else {
      cancelAnimationFrame(frame.current);
      frame.current = 0;
    }
  };

  if (!particles.length) return null;

  return (
    <View style={[StyleSheet.absoluteFill, styles.layer]} pointerEvents="none">
      <Svg width={width} height={height}>
        <Defs>
          <RadialGradient id="fw-spark" cx="50%" cy="50%" rx="50%" ry="50%">
            <Stop offset="0" stopColor="#FFFFFF" stopOpacity="0.95" />
            <Stop offset="1" stopColor="#FFFFFF" stopOpacity="0" />
          </RadialGradient>
        </Defs>
        {particles.map((particle, i) => {
          // Fades out over its own lifetime, so the burst thins rather than
          // vanishing all at once.
          const t = particle.life / particle.ttl;
          const opacity = t > 0.7 ? 1 - (t - 0.7) / 0.3 : 1;
          return (
            <React.Fragment key={i}>
              {/* A soft halo under each spark: this is what makes it read as
                  light rather than as confetti. */}
              <Circle
                cx={particle.x}
                cy={particle.y}
                r={particle.r * 2.6}
                fill="url(#fw-spark)"
                opacity={opacity * 0.5}
              />
              <Circle
                cx={particle.x}
                cy={particle.y}
                r={particle.r}
                fill={particle.hue}
                opacity={opacity}
              />
            </React.Fragment>
          );
        })}
      </Svg>
    </View>
  );
}

/**
 * A spark's colour: mostly the game's accent, with gold and white mixed in.
 *
 * A single-colour burst reads as flat. Gold is in every palette in this app and
 * is what coins are, so it belongs in every celebration; white is what makes
 * the hottest sparks look hot.
 */
function pick(accent: string, roll: number): string {
  if (roll < 0.58) return accent;
  if (roll < 0.86) return '#F5D06A';
  return '#FFFFFF';
}

const styles = StyleSheet.create({
  // Above the board's own content, below nothing — the burst is the top layer
  // of the play area and must never intercept a tap.
  layer: { alignItems: 'center', justifyContent: 'center' },
});
