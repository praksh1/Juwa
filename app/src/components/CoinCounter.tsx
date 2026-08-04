/**
 * A win total that rolls up rather than appearing.
 *
 * The roll-up is the single cheapest piece of slot-machine feel there is. A
 * number that snaps from 0 to 40,000 is information; a number that climbs is an
 * event, and the climb is why a player watches the screen instead of tapping
 * spin again. Bigger wins roll for longer — the duration is the reward.
 *
 * The ticking is deliberately sparse. A sound per frame at 60fps is a buzz, not
 * a tick, so it fires on a fixed interval and stops when the number lands.
 *
 * Under reduced motion the final figure appears immediately. The player still
 * learns exactly what they won; they are simply not made to sit through it.
 */

import React, { useEffect, useRef, useState } from 'react';
import { format, minor } from '@juwa/money';
import { Txt } from './primitives';
import { sounds } from '../sound';
import { usePrefersReducedMotion, rollUpDuration, type WinTier } from '../motion';
import type { TextStyle, StyleProp } from 'react-native';

/** Ticks per second while counting. Fast enough to feel busy, slow enough to hear. */
const TICKS_PER_SECOND = 14;

export function CoinCounter({
  amount,
  tier,
  color,
  variant = 'moneyLarge',
  style,
}: {
  amount: number;
  tier: WinTier;
  color?: string;
  variant?: 'money' | 'moneyLarge';
  style?: StyleProp<TextStyle>;
}) {
  const [shown, setShown] = useState(amount);
  const reducedMotion = usePrefersReducedMotion();
  const frame = useRef(0);
  const lastTick = useRef(0);

  useEffect(() => {
    const duration = rollUpDuration(tier);
    if (reducedMotion || duration === 0 || amount <= 0) {
      setShown(amount);
      return;
    }

    const start = performance.now();
    lastTick.current = start;
    const from = 0;

    const step = () => {
      const elapsed = performance.now() - start;
      const u = Math.min(1, elapsed / duration);
      // Ease out: the number sprints away from zero and settles into its final
      // value, which reads as "the machine is finishing counting" rather than
      // "the machine stopped".
      const eased = 1 - Math.pow(1 - u, 3);
      setShown(Math.round(from + (amount - from) * eased));

      if (performance.now() - lastTick.current >= 1000 / TICKS_PER_SECOND && u < 1) {
        lastTick.current = performance.now();
        sounds.tick();
      }

      if (u < 1) frame.current = requestAnimationFrame(step);
      else setShown(amount);
    };

    frame.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame.current);
  }, [amount, tier, reducedMotion]);

  return (
    <Txt variant={variant} color={color} style={style}>
      {format(minor(Math.max(0, shown)), 'GC')}
    </Txt>
  );
}
