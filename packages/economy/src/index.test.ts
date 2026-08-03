import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { minor } from '@juwa/money';
import {
  COIN_PACKS,
  FIRST_PURCHASE_MULTIPLIER,
  coinsGranted,
  coinsPerDollar,
  getPack,
  netRevenue,
} from './packs.js';
import {
  MAX_STREAK_DAY,
  TOP_UP,
  canTopUp,
  dailyBonus,
  evaluateClaim,
} from './bonuses.js';
import { VIP_TIERS, nextTier, progressToNextTier, tierForXp, xpForWager } from './vip.js';
import { betOptions, suggestedBet } from './betting.js';

// ------------------------------------------------------------------ packs

test('every pack is better value than the one below it', () => {
  // If a bigger pack is worse value, it is strictly worse than the smaller one
  // and no informed player buys it. This is the core pricing invariant.
  for (let i = 1; i < COIN_PACKS.length; i++) {
    const prev = COIN_PACKS[i - 1]!;
    const curr = COIN_PACKS[i]!;
    assert.ok(curr.priceUsd > prev.priceUsd, `${curr.id} must cost more than ${prev.id}`);
    assert.ok(
      coinsPerDollar(curr) > coinsPerDollar(prev),
      `${curr.id} gives ${coinsPerDollar(curr).toFixed(0)} coins/$ but ` +
        `${prev.id} gives ${coinsPerDollar(prev).toFixed(0)} — bigger must be better`,
    );
  }
});

test('prices are real app store tiers', () => {
  // Apple and Google sell fixed price points. You cannot charge $2.00.
  for (const pack of COIN_PACKS) {
    assert.equal(pack.priceUsd % 100, 99, `${pack.id} priced at ${pack.priceUsd} cents`);
    assert.ok(pack.priceUsd >= 99 && pack.priceUsd <= 99_99, `${pack.id} out of tier range`);
  }
});

test('exactly one pack is flagged popular and one best value', () => {
  // More than one "best value" badge is noise and destroys the anchor.
  assert.equal(COIN_PACKS.filter((p) => p.popular).length, 1);
  assert.equal(COIN_PACKS.filter((p) => p.bestValue).length, 1);
});

test('pack ids are unique and lookups work', () => {
  assert.equal(new Set(COIN_PACKS.map((p) => p.id)).size, COIN_PACKS.length);
  assert.equal(getPack('pack_stack').name, 'Stack');
  assert.throws(() => getPack('pack_nope'), /Unknown coin pack/);
});

test('first purchase doubles the coins, once', () => {
  const pack = getPack('pack_starter');
  assert.equal(coinsGranted(pack, false), pack.coins);
  assert.equal(coinsGranted(pack, true), pack.coins * FIRST_PURCHASE_MULTIPLIER);
});

test('the web store nets meaningfully more than in-app purchase', () => {
  // This is the number that justifies building a web store at all.
  const pack = getPack('pack_stack'); // $9.99
  const apple = netRevenue(pack, 'apple', false);
  const stripe = netRevenue(pack, 'stripe');
  assert.ok(stripe > apple, 'Stripe should net more than Apple at standard rate');
  const uplift = (stripe - apple) / apple;
  assert.ok(uplift > 0.3, `web uplift only ${(uplift * 100).toFixed(1)}%`);
  // Sanity: nobody nets more than they charged.
  for (const channel of ['apple', 'google', 'stripe'] as const) {
    assert.ok(netRevenue(pack, channel) < pack.priceUsd);
    assert.ok(netRevenue(pack, channel) > 0);
  }
});

// ---------------------------------------------------------------- bonuses

test('the daily ladder always climbs, then plateaus', () => {
  for (let day = 2; day <= MAX_STREAK_DAY; day++) {
    assert.ok(
      dailyBonus(day) > dailyBonus(day - 1),
      `day ${day} must beat day ${day - 1}`,
    );
  }
  // Past the end of the ladder it holds flat rather than growing forever.
  assert.equal(dailyBonus(MAX_STREAK_DAY + 1), dailyBonus(MAX_STREAK_DAY));
  assert.equal(dailyBonus(999), dailyBonus(MAX_STREAK_DAY));
  assert.throws(() => dailyBonus(0), RangeError);
  assert.throws(() => dailyBonus(1.5), RangeError);
});

test('day 7 is worth enough to make day 6 hurt to miss', () => {
  // The whole streak mechanic depends on this ratio being steep.
  assert.ok(dailyBonus(MAX_STREAK_DAY) >= dailyBonus(1) * 8);
});

test('VIP multiplies the daily bonus', () => {
  assert.equal(dailyBonus(1, 2), dailyBonus(1) * 2);
  // Rounding stays integral — coins are whole numbers.
  assert.ok(Number.isInteger(dailyBonus(3, 1.5)));
});

test('streaks advance, block same-day, and reset on a gap', () => {
  assert.deepEqual(evaluateClaim(null, 100, 0), { canClaim: true, newStreak: 1 });
  assert.deepEqual(evaluateClaim(100, 100, 3), { canClaim: false, newStreak: 3 });
  assert.deepEqual(evaluateClaim(100, 101, 3), { canClaim: true, newStreak: 4 });
  assert.deepEqual(evaluateClaim(100, 103, 5), { canClaim: true, newStreak: 1 });
  // Streak cannot exceed the ladder.
  assert.deepEqual(evaluateClaim(100, 101, MAX_STREAK_DAY), {
    canClaim: true,
    newStreak: MAX_STREAK_DAY,
  });
});

test('top-up only fires for a nearly broke player, on cooldown', () => {
  assert.equal(canTopUp(minor(0), null, 0), true);
  assert.equal(canTopUp(minor(1_999), 45, 2), true);
  // Rich enough to keep playing — no handout.
  assert.equal(canTopUp(minor(50_000), null, 0), false);
  // Still on cooldown.
  assert.equal(canTopUp(minor(0), 5, 0), false);
  // Daily cap reached.
  assert.equal(canTopUp(minor(0), 999, TOP_UP.maxPerDay), false);
});

test('top-up is small enough that buying still matters', () => {
  // A full day of top-ups must not rival even the cheapest pack, or the store
  // becomes decorative.
  const maxDailyTopUp = TOP_UP.amountCoins * TOP_UP.maxPerDay;
  assert.ok(
    maxDailyTopUp < getPack('pack_starter').coins,
    `top-ups grant ${maxDailyTopUp}/day vs a ${getPack('pack_starter').coins} starter pack`,
  );
});

// -------------------------------------------------------------------- VIP

test('VIP tiers are strictly increasing in every dimension', () => {
  for (let i = 1; i < VIP_TIERS.length; i++) {
    const prev = VIP_TIERS[i - 1]!;
    const curr = VIP_TIERS[i]!;
    assert.equal(curr.level, prev.level + 1);
    assert.ok(curr.xpRequired > prev.xpRequired);
    assert.ok(curr.dailyBonusMultiplier > prev.dailyBonusMultiplier);
    assert.ok(curr.topUpCooldownMultiplier < prev.topUpCooldownMultiplier);
  }
});

test('XP maps to the right tier at and around each boundary', () => {
  assert.equal(tierForXp(0).name, 'Bronze');
  for (const tier of VIP_TIERS.slice(1)) {
    assert.equal(tierForXp(tier.xpRequired).name, tier.name, `at ${tier.xpRequired}`);
    assert.notEqual(tierForXp(tier.xpRequired - 1).name, tier.name, `just below ${tier.name}`);
  }
  // Beyond the top tier you stay at the top.
  assert.equal(tierForXp(Number.MAX_SAFE_INTEGER).name, 'Royal');
});

test('progress runs 0 to 1 and tops out', () => {
  assert.equal(progressToNextTier(0), 0);
  const silver = VIP_TIERS[1]!;
  assert.ok(progressToNextTier(silver.xpRequired / 2) > 0);
  assert.ok(progressToNextTier(silver.xpRequired / 2) < 1);
  assert.equal(nextTier(Number.MAX_SAFE_INTEGER), null);
  assert.equal(progressToNextTier(Number.MAX_SAFE_INTEGER), 1);
});

test('wagering earns XP one-for-one', () => {
  assert.equal(xpForWager(minor(2_000)), 2_000);
});

// ---------------------------------------------------------------- betting

test('the suggested bet never exceeds the balance or the table limits', () => {
  const MIN = minor(200);
  const MAX = minor(50_000);
  for (const balance of [0, 1, 199, 200, 5_000, 100_000, 10_000_000, 999_999_999]) {
    const bet = suggestedBet(minor(balance), MIN, MAX);
    assert.ok(bet >= MIN, `bet ${bet} below table minimum at balance ${balance}`);
    assert.ok(bet <= MAX, `bet ${bet} above table maximum at balance ${balance}`);
    // The only case where a bet may exceed the balance is a balance below the
    // table minimum, where no legal bet is affordable at all.
    if (balance >= MIN) {
      assert.ok(bet <= balance, `bet ${bet} exceeds balance ${balance}`);
    }
  }
});

test('the suggested bet scales with balance', () => {
  const MIN = minor(200);
  const MAX = minor(50_000);
  const small = suggestedBet(minor(5_000), MIN, MAX);
  const medium = suggestedBet(minor(100_000), MIN, MAX);
  const large = suggestedBet(minor(5_000_000), MIN, MAX);
  assert.ok(medium > small, 'a richer player should be offered a bigger default');
  assert.ok(large > medium);
  // Never so large that the balance evaporates in a handful of spins. This is
  // the regression guard for the one-minute-session problem.
  for (const balance of [5_000, 20_000, 100_000, 1_000_000]) {
    const bet = suggestedBet(minor(balance), MIN, MAX);
    assert.ok(balance / bet >= 20, `balance ${balance} lasts only ${balance / bet} spins`);
  }
});

test('bet options are ordered, legal and affordable', () => {
  const MIN = minor(200);
  const MAX = minor(50_000);
  for (const balance of [200, 5_000, 100_000, 5_000_000]) {
    const options = betOptions(minor(balance), MIN, MAX);
    assert.ok(options.length > 0, `no options at balance ${balance}`);
    for (let i = 1; i < options.length; i++) {
      assert.ok(options[i]! > options[i - 1]!, 'options must ascend');
    }
    for (const option of options) {
      assert.ok(option >= MIN && option <= MAX, `option ${option} outside limits`);
    }
  }
});

test('a nearly broke player is still offered the minimum bet', () => {
  const options = betOptions(minor(50), minor(200), minor(50_000));
  assert.deepEqual(options, [minor(200)]);
});
