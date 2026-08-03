/**
 * VIP levels.
 *
 * Players earn XP by wagering — not by spending money. That distinction matters:
 * tying status to play rather than to purchases keeps free players climbing (and
 * therefore returning), while the people who climb fastest are, naturally, the
 * ones who buy coins to keep wagering.
 *
 * The rewards are all soft: a bigger daily bonus, a shorter top-up timer, a
 * badge. None of them can be converted to anything. They cost the business
 * nothing except coins, which are free to mint.
 */

import { minor, type Minor } from '@juwa/money';

export interface VipTier {
  level: number;
  name: string;
  /** Total lifetime coins wagered to reach this tier. */
  xpRequired: number;
  /** Applied to the daily streak bonus. */
  dailyBonusMultiplier: number;
  /** Applied to the low-balance top-up cooldown. */
  topUpCooldownMultiplier: number;
  badgeColor: string;
}

export const VIP_TIERS: VipTier[] = [
  { level: 0, name: 'Bronze',   xpRequired: 0,           dailyBonusMultiplier: 1.0, topUpCooldownMultiplier: 1.0,  badgeColor: '#8C6D1F' },
  { level: 1, name: 'Silver',   xpRequired: 500_000,     dailyBonusMultiplier: 1.2, topUpCooldownMultiplier: 0.9,  badgeColor: '#A79FB8' },
  { level: 2, name: 'Gold',     xpRequired: 2_500_000,   dailyBonusMultiplier: 1.5, topUpCooldownMultiplier: 0.8,  badgeColor: '#D4AF37' },
  { level: 3, name: 'Platinum', xpRequired: 10_000_000,  dailyBonusMultiplier: 2.0, topUpCooldownMultiplier: 0.65, badgeColor: '#00E5FF' },
  { level: 4, name: 'Diamond',  xpRequired: 50_000_000,  dailyBonusMultiplier: 3.0, topUpCooldownMultiplier: 0.5,  badgeColor: '#8B5CF6' },
  { level: 5, name: 'Royal',    xpRequired: 250_000_000, dailyBonusMultiplier: 5.0, topUpCooldownMultiplier: 0.35, badgeColor: '#FF2E88' },
];

/** XP is simply coins wagered — one coin staked is one point. */
export function xpForWager(stake: Minor): number {
  return stake;
}

export function tierForXp(xp: number): VipTier {
  let current = VIP_TIERS[0]!;
  for (const tier of VIP_TIERS) {
    if (xp >= tier.xpRequired) current = tier;
    else break;
  }
  return current;
}

export function nextTier(xp: number): VipTier | null {
  return VIP_TIERS.find((tier) => tier.xpRequired > xp) ?? null;
}

/** Fractional progress (0–1) toward the next tier, for the progress bar. */
export function progressToNextTier(xp: number): number {
  const current = tierForXp(xp);
  const next = nextTier(xp);
  if (!next) return 1;
  const span = next.xpRequired - current.xpRequired;
  return Math.min(1, Math.max(0, (xp - current.xpRequired) / span));
}

export const MIN_BET = minor(200);
