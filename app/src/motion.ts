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
export type WinTier = 'none' | 'win' | 'burst' | 'big' | 'mega' | 'jackpot';

/**
 * Where each tier begins, as a multiple of the stake.
 *
 * `burst` is global because it is the small confetti moment and 6x is common on
 * every model — measured between 1 in 24 and 1 in 66 spins. The three loud
 * tiers are NOT global: they are measured per model and arrive with the game.
 * See `SlotModelInfo.tiers`.
 */
/*
 * Two times the stake, not six.
 *
 * `burst` is the small celebration — a blast of coins, no banner — and at six
 * times the stake it fired about once in forty spins. The founder asked for
 * the coins and the meter to happen more often, and this is the tier that can
 * absorb that without an overlay interrupting anything: a win that doubles the
 * stake throws coins and nothing else.
 */
export const BURST_THRESHOLD = 2;

/** The fallback, for a game that has no measured tiers of its own. */
export const DEFAULT_TIERS = { big: 4, mega: 12, jackpot: 30 } as const;

export interface WinTiers {
  big: number;
  mega: number;
  jackpot: number;
}

/**
 * How big a win is, on THIS machine.
 *
 * The thresholds used to be constants — 25x for big, 60x for mega — and the
 * founder played over a hundred spins in auto mode and never saw either. They
 * were right to report it: measured over 60,000 spins per model, a 25x win
 * arrives about once in 280 spins, and on the 720-ways model a 60x win never
 * arrived at all because its largest win in the whole sample was 49x.
 *
 * Passing the model's own thresholds makes the tiers mean a FREQUENCY rather
 * than a multiple: a big win is roughly once in ninety spins on every machine,
 * a mega once in six hundred, a jackpot once in six thousand. Which multiple
 * that corresponds to is a property of the machine and not something a player
 * needs to hold in their head.
 */
export function winTier(payout: number, stake: number, tiers: WinTiers = DEFAULT_TIERS): WinTier {
  if (payout <= 0 || stake <= 0) return 'none';
  const multiple = payout / stake;
  if (multiple >= tiers.jackpot) return 'jackpot';
  if (multiple >= tiers.mega) return 'mega';
  if (multiple >= tiers.big) return 'big';
  if (multiple >= BURST_THRESHOLD) return 'burst';
  return 'win';
}

/** How long the coin counter takes to roll up, in milliseconds. */
export function rollUpDuration(tier: WinTier): number {
  switch (tier) {
    case 'jackpot':
      return 4200;
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

/**
 * How long a banner is held AFTER its roll-up has finished.
 *
 * Lives here rather than in `WinOverlay` because two other things are derived
 * from it — the round's own pause before it moves the money, and the gap
 * between automatic spins — and when those three disagree the celebration gets
 * interrupted by the thing that is supposed to be waiting for it. One number,
 * three readers.
 *
 * The floor under all of these is the fanfare: measured, the big-win
 * recordings run to 3.79s and the mega/jackpot ones to 7.03s, and a banner
 * that leaves before its own music is the fault this file exists to prevent.
 */
export function celebrationHold(tier: WinTier): number {
  switch (tier) {
    case 'jackpot':
      return 5_200;
    case 'mega':
      return 4_400;
    case 'big':
      /*
       * Back up from 1.8s.
       *
       * It was cut when the big-win threshold moved to about 4x — one spin in
       * eighteen — on the theory that a frequent banner should be a short one.
       * The founder's verdict on the result was to "just relax a little bit,
       * don't need to make it so rushed", which settles it: the celebration is
       * the product, and 5.2s total is still under the 3.79s fanfare plus its
       * own roll-up.
       */
      return 3_000;
    default:
      return 0;
  }
}

/**
 * Everything a tier owns of the screen: the roll-up, then the hold.
 *
 * A round waits this long before it moves the money into the balance, so the
 * banner is never talking over the transfer and the transfer is never starting
 * under the banner.
 */
export function celebrationDuration(tier: WinTier): number {
  return rollUpDuration(tier) + celebrationHold(tier);
}
