/**
 * The coin store.
 *
 * In a social casino this file is the business. There is no house edge revenue —
 * coins are not money, so the RTP does not earn anything. Revenue is entirely
 * coin sales, and the RTP's job is to control how fast a player burns through a
 * balance and therefore how often they come back to this screen.
 *
 * PRICING PRINCIPLES
 *
 * 1. Value per dollar rises with pack size. Every tier must be better value than
 *    the one below it, or the tier is pointless and players notice instantly.
 *    Enforced by a test.
 *
 * 2. Anchor high. The largest pack exists partly to make the mid tiers look
 *    reasonable. Most revenue comes from the middle, but only because the top
 *    exists.
 *
 * 3. A cheap entry point. The first purchase is the hard one — converting a
 *    player from free to paying at all is the single biggest step. $1.99 with a
 *    large first-time bonus exists to clear that hurdle, not to make money.
 *
 * 4. Prices end in .99 and match the platform tiers Apple and Google actually
 *    offer. You cannot charge $2.00 through in-app purchase.
 */

import { minor, type Minor } from '@juwa/money';

export interface CoinPack {
  id: string;
  name: string;
  /** Price in USD cents. Must be an Apple/Google price tier. */
  priceUsd: Minor;
  /** Base coins granted. */
  coins: Minor;
  /** Extra coins shown as a "+X% BONUS" flash on the tile. */
  bonusPercent: number;
  /** At most one pack should carry this — it's the visual anchor. */
  popular?: boolean;
  bestValue?: boolean;
}

export const COIN_PACKS: CoinPack[] = [
  {
    id: 'pack_starter',
    name: 'Starter',
    priceUsd: minor(199),
    coins: minor(20_000),
    bonusPercent: 0,
  },
  {
    id: 'pack_handful',
    name: 'Handful',
    priceUsd: minor(499),
    coins: minor(60_000),
    bonusPercent: 20,
  },
  {
    id: 'pack_stack',
    name: 'Stack',
    priceUsd: minor(999),
    coins: minor(130_000),
    bonusPercent: 30,
    popular: true,
  },
  {
    id: 'pack_pile',
    name: 'Pile',
    priceUsd: minor(1999),
    coins: minor(290_000),
    bonusPercent: 45,
  },
  {
    id: 'pack_vault',
    name: 'Vault',
    priceUsd: minor(4999),
    coins: minor(800_000),
    bonusPercent: 60,
  },
  {
    id: 'pack_fortune',
    name: 'Fortune',
    priceUsd: minor(9999),
    coins: minor(1_750_000),
    bonusPercent: 75,
    bestValue: true,
  },
];

/**
 * First purchase gets double coins, once, ever.
 *
 * This is the highest-leverage promotion in the entire product. The gap between
 * "never paid" and "paid once" is far wider than any gap after it.
 */
export const FIRST_PURCHASE_MULTIPLIER = 2;

export function coinsPerDollar(pack: CoinPack): number {
  return pack.coins / (pack.priceUsd / 100);
}

/** What a player actually receives, accounting for the first-purchase doubler. */
export function coinsGranted(pack: CoinPack, isFirstPurchase: boolean): Minor {
  return minor(isFirstPurchase ? pack.coins * FIRST_PURCHASE_MULTIPLIER : pack.coins);
}

export function getPack(id: string): CoinPack {
  const pack = COIN_PACKS.find((p) => p.id === id);
  if (!pack) throw new Error(`Unknown coin pack: ${id}`);
  return pack;
}

/**
 * Platform fees. Worth staring at, because they change which channel you push.
 *
 * Apple and Google take 30% (15% for the first $1M/year under their small
 * business programmes). Stripe takes roughly 2.9% + 30c. On a $9.99 pack that
 * is about $3.00 to Apple versus about $0.59 to Stripe — the web store keeps
 * roughly 34% more revenue per sale.
 *
 * You may not link to the web store from inside an iOS app in most
 * jurisdictions. The usual play is email and push notifications to existing
 * players, which is legal and effective.
 */
export const PLATFORM_FEES = {
  appleStandard: 0.3,
  appleSmallBusiness: 0.15,
  googleStandard: 0.3,
  googleSmallBusiness: 0.15,
  stripePercent: 0.029,
  stripeFixedCents: 30,
} as const;

export type SalesChannel = 'apple' | 'google' | 'stripe';

/** Net revenue in USD cents after platform fees. */
export function netRevenue(
  pack: CoinPack,
  channel: SalesChannel,
  smallBusinessRate = true,
): Minor {
  const gross = pack.priceUsd;
  switch (channel) {
    case 'apple':
    case 'google': {
      const rate = smallBusinessRate
        ? PLATFORM_FEES.appleSmallBusiness
        : PLATFORM_FEES.appleStandard;
      return minor(Math.floor(gross * (1 - rate)));
    }
    case 'stripe':
      return minor(
        Math.floor(gross * (1 - PLATFORM_FEES.stripePercent)) - PLATFORM_FEES.stripeFixedCents,
      );
  }
}
