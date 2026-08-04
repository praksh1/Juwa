/**
 * Motion preferences and win tiers.
 *
 * REDUCED MOTION IS NOT OPTIONAL HERE
 *
 * A casino screen is the worst case for anyone with a vestibular disorder:
 * shaking cabinets, full-screen zooms, and dozens of particles at once. The
 * operating system already knows whether the person wants that, and the whole
 * of this app asks before it moves anything.
 *
 * The rule followed everywhere: when motion is reduced, the STATE still
 * changes — the win is still announced, the counter still reaches the right
 * number, the overlay still appears — only the movement is removed. Hiding the
 * information along with the animation would be a worse bug than the animation.
 */

import { useEffect, useState } from 'react';
import { Platform } from 'react-native';

export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined' || !window.matchMedia) return;
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(query.matches);
    const listen = (event: MediaQueryListEvent) => setReduced(event.matches);
    query.addEventListener('change', listen);
    return () => query.removeEventListener('change', listen);
  }, []);

  return reduced;
}

/**
 * How big a win is, relative to the stake.
 *
 * Layering matters more than any single effect. If a 2x win gets the same
 * celebration as a 200x win then nothing is a celebration — the player learns
 * to ignore the whole vocabulary, and the one moment a slot machine exists to
 * deliver lands flat.
 */
export type WinTier = 'none' | 'win' | 'burst' | 'big' | 'mega';

/** Multiples of the stake at which each tier begins. */
export const TIER_THRESHOLDS = { burst: 6, big: 25, mega: 60 } as const;

export function winTier(payout: number, stake: number): WinTier {
  if (payout <= 0 || stake <= 0) return 'none';
  const multiple = payout / stake;
  if (multiple >= TIER_THRESHOLDS.mega) return 'mega';
  if (multiple >= TIER_THRESHOLDS.big) return 'big';
  if (multiple >= TIER_THRESHOLDS.burst) return 'burst';
  return 'win';
}

/** How long the coin counter takes to roll up, in milliseconds. */
export function rollUpDuration(tier: WinTier): number {
  switch (tier) {
    case 'mega':
      return 3200;
    case 'big':
      return 2200;
    case 'burst':
      return 1200;
    case 'win':
      return 700;
    default:
      return 0;
  }
}
