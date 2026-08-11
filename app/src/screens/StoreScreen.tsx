import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { colors, radius, spacing } from '@juwa/ui';
import { format, minor } from '@juwa/money';
import {
  COIN_PACKS,
  FIRST_PURCHASE_MULTIPLIER,
  coinsGranted,
  type CoinPack,
} from '@juwa/economy';
import { Badge, Button, Card, Screen, SectionHeader, Txt } from '../components/primitives';
import { LegalFooter } from '../components/LegalFooter';
import { PlayApiError, createPlayApi } from '../api/client';
import { notifyBalanceChanged, usePlayer } from '../api/usePlayer';
import { LOBBY_BED, useAmbientBed } from '../ambience';

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
function PackTile({
  pack,
  isFirstPurchase,
  busy,
  onBuy,
}: {
  pack: CoinPack;
  isFirstPurchase: boolean;
  busy: boolean;
  onBuy: (pack: CoinPack) => void;
}) {
  const coins = coinsGranted(pack, isFirstPurchase);
  const highlighted = pack.popular || pack.bestValue;

  return (
    <Pressable
      accessibilityRole="button"
      disabled={busy}
      onPress={() => onBuy(pack)}
      accessibilityLabel={`${pack.name}, ${format(coins, 'GC')} for ${format(pack.priceUsd, 'USD')}`}
      style={({ pressed }) => [
        styles.tile,
        highlighted && styles.tileHighlighted,
        busy && styles.tileBusy,
        { transform: [{ scale: pressed && !busy ? 0.98 : 1 }] },
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
        {busy ? (
          <ActivityIndicator color={colors.text.inverse} />
        ) : (
          <Txt variant="h3" color={colors.text.inverse}>
            {format(pack.priceUsd, 'USD')}
          </Txt>
        )}
      </View>
    </Pressable>
  );
}

export function StoreScreen() {
  const api = React.useRef(createPlayApi()).current;
  const { balance } = usePlayer();
  useAmbientBed(LOBBY_BED);
  const [isFirstPurchase, setIsFirstPurchase] = useState(false);
  const [busyPack, setBusyPack] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [topUpBusy, setTopUpBusy] = useState(false);
  const [topUpNote, setTopUpNote] = useState<string | null>(null);

  /**
   * The free top-up.
   *
   * Always on screen, never behind a condition. "No purchase necessary" is a
   * claim the footer makes on every page, and a button that only appears when
   * the server happens to feel generous does not support it. When a claim is
   * refused the server says why, and that reason is shown — a disabled control
   * with no explanation reads as broken.
   */
  const claimTopUp = useCallback(async () => {
    setTopUpNote(null);
    setTopUpBusy(true);
    try {
      const result = await api.claimTopUp();
      setTopUpNote(
        result.granted
          ? `${format(minor(result.coins), 'GC')} added to your balance.`
          : (result.reason ?? 'Not available right now. Try again shortly.'),
      );
      if (result.granted) notifyBalanceChanged();
    } catch (error) {
      setTopUpNote(
        error instanceof PlayApiError ? error.message : 'Could not add coins. Try again.',
      );
    } finally {
      setTopUpBusy(false);
    }
  }, [api]);

  useEffect(() => {
    api
      .getProfile()
      .then((profile) => setIsFirstPurchase(profile.hasPurchased === false))
      .catch(() => setIsFirstPurchase(false));
  }, [api]);

  const buy = useCallback(
    async (pack: CoinPack) => {
      setMessage(null);
      setBusyPack(pack.id);
      try {
        const { checkoutUrl } = await api.startCheckout(pack.id);
        // Stripe's hosted page. Card details never touch our servers.
        if (typeof window !== 'undefined') window.location.assign(checkoutUrl);
      } catch (error) {
        setMessage(
          error instanceof PlayApiError ? error.message : 'Could not start checkout. Try again.',
        );
        setBusyPack(null);
      }
    },
    [api],
  );

  return (
    <Screen>
      <View style={styles.balanceRow}>
        <Txt variant="caption" color={colors.text.muted}>
          BALANCE
        </Txt>
        <Txt variant="money" color={colors.gold.default}>
          {format(balance, 'GC')}
        </Txt>
      </View>

      {message ? (
        <Card style={styles.message}>
          <Txt variant="bodySmall">{message}</Txt>
        </Card>
      ) : null}

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
            <PackTile
              key={pack.id}
              pack={pack}
              isFirstPurchase={isFirstPurchase}
              busy={busyPack === pack.id}
              onBuy={buy}
            />
          ))}
        </View>
      </View>

      <Card style={styles.topUp}>
        <View style={styles.topUpText}>
          <Txt variant="h3">Out of coins?</Txt>
          <Txt variant="bodySmall" color={colors.text.secondary}>
            Take some free ones. You never have to buy anything to play.
          </Txt>
          {topUpNote ? (
            <Txt variant="caption" color={colors.neon.cyan}>
              {topUpNote}
            </Txt>
          ) : null}
        </View>
        <Button
          label="Free coins"
          variant="secondary"
          onPress={claimTopUp}
          loading={topUpBusy}
          disabled={topUpBusy}
        />
      </Card>

      <Card style={styles.disclosure}>
        {/* Only what the footer does NOT already say. The footer carries the
            no-cash-value wording on every page; repeating it here left two
            near-identical paragraphs stacked on top of each other, which is how
            a disclosure stops being read. */}
        <Txt variant="caption" color={colors.text.secondary}>
          Buying coins is not gambling and buys no chance of winning money.
          Practice or success at social casino gaming does not imply future
          success at real-money gambling.
        </Txt>
      </Card>

      <LegalFooter />
    </Screen>
  );
}

const styles = StyleSheet.create({
  topUp: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderColor: colors.neon.cyan,
  },
  topUpText: { flex: 1, gap: 2 },
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
  balanceRow: { alignItems: 'center', gap: 2 },
  message: { backgroundColor: colors.surface.overlay, borderColor: colors.gold.dark },
  tileBusy: { opacity: 0.6 },
});
