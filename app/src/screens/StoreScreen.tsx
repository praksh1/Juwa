import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { colors, radius, spacing } from '@juwa/ui';
import { format, minor } from '@juwa/money';
import {
  COIN_PACKS,
  FIRST_PURCHASE_MULTIPLIER,
  coinsGranted,
  type CoinPack,
} from '@juwa/economy';
import { Badge, Card, Screen, SectionHeader, Txt } from '../components/primitives';

/**
 * The coin store.
 *
 * In a social casino this is the only revenue screen in the product, so it gets
 * the most design attention. The layout does three jobs:
 *
 *   1. Leads with the first-purchase doubler, because converting a player from
 *      free to paying at all is the hardest and most valuable step.
 *   2. Badges exactly one pack "popular" and one "best value" — the anchors.
 *      Badging everything is the same as badging nothing.
 *   3. States plainly that coins have no cash value. This is required by both
 *      app stores for casino-themed games, and it belongs where a player is
 *      about to spend money rather than buried in a settings page.
 */
function PackTile({ pack, isFirstPurchase }: { pack: CoinPack; isFirstPurchase: boolean }) {
  const coins = coinsGranted(pack, isFirstPurchase);
  const highlighted = pack.popular || pack.bestValue;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${pack.name}, ${format(coins, 'GC')} for ${format(pack.priceUsd, 'USD')}`}
      style={({ pressed }) => [
        styles.tile,
        highlighted && styles.tileHighlighted,
        { transform: [{ scale: pressed ? 0.98 : 1 }] },
      ]}
    >
      {highlighted ? (
        <LinearGradient
          colors={[colors.gold.wash, 'transparent']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
      ) : null}

      <View style={styles.tileBody}>
        <View style={styles.tileLabels}>
          {pack.popular ? <Badge label="most popular" /> : null}
          {pack.bestValue ? <Badge label="best value" color={colors.neon.magenta} /> : null}
          {pack.bonusPercent > 0 ? (
            <Badge label={`+${pack.bonusPercent}%`} color={colors.neon.violet} />
          ) : null}
          <Txt variant="caption" color={colors.text.muted}>
            {pack.name.toUpperCase()}
          </Txt>
        </View>

        <Txt variant="moneyLarge" color={colors.gold.default}>
          {format(coins, 'GC')}
        </Txt>

        {isFirstPurchase ? (
          <Txt variant="caption" color={colors.feedback.win} numberOfLines={1}>
            {FIRST_PURCHASE_MULTIPLIER}x applied · normally {format(pack.coins, 'GC')}
          </Txt>
        ) : null}
      </View>

      <View style={styles.price}>
        <Txt variant="h3" color={colors.text.inverse}>
          {format(pack.priceUsd, 'USD')}
        </Txt>
      </View>
    </Pressable>
  );
}

export function StoreScreen() {
  // Wired to the player's purchase history in Phase 5.
  const isFirstPurchase = true;

  return (
    <Screen>
      {isFirstPurchase ? (
        <Card style={styles.hero}>
          <LinearGradient
            colors={[colors.neon.magenta, colors.surface.raised]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
          <View style={styles.heroBody}>
            <Badge label="one time only" color={colors.gold.default} />
            <Txt variant="h1">Double coins on your first purchase</Txt>
            <Txt variant="bodySmall" color={colors.text.secondary}>
              Applies to any pack below.
            </Txt>
          </View>
        </Card>
      ) : null}

      <View>
        <SectionHeader title="Coin Packs" />
        <View style={styles.grid}>
          {COIN_PACKS.map((pack) => (
            <PackTile key={pack.id} pack={pack} isFirstPurchase={isFirstPurchase} />
          ))}
        </View>
      </View>

      <Card style={styles.disclosure}>
        <Txt variant="caption" color={colors.text.muted}>
          Juwa is a free-to-play social casino. Gold Coins are for entertainment
          only. They have no cash value, cannot be exchanged for money or prizes,
          and purchasing them does not constitute gambling. Practice or success at
          social casino gaming does not imply future success at real-money
          gambling.
        </Txt>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { overflow: 'hidden', padding: 0 },
  heroBody: { padding: spacing.xl, gap: spacing.sm },
  grid: { gap: spacing.md },
  tile: {
    overflow: 'hidden',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface.raised,
    borderWidth: 1,
    borderColor: colors.surface.border,
    borderRadius: radius.lg,
    padding: spacing.lg,
    minHeight: 88,
  },
  tileHighlighted: { borderColor: colors.gold.default },
  tileBody: { flex: 1, gap: spacing.xs },
  tileLabels: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
  price: {
    backgroundColor: colors.gold.default,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    minWidth: 88,
    alignItems: 'center',
  },
  disclosure: { backgroundColor: colors.surface.overlay },
});

export const STORE_PLACEHOLDER_BALANCE = minor(1_250_000);
