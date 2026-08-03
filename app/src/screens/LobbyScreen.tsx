import React, { useMemo, useState } from 'react';
import { FlatList, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { colors, radius, spacing } from '@juwa/ui';
import { format, minor } from '@juwa/money';
import { dailyBonus, suggestedBet, tierForXp } from '@juwa/economy';
import { Badge, Button, Card, Screen, SectionHeader, Txt } from '../components/primitives';
import { GameCard } from '../components/GameCard';
import {
  CATEGORIES,
  PLAYABLE,
  gamesInCategory,
  type GameCategory,
  type GameSummary,
} from '../api/games';

/**
 * The lobby — the screen that decides whether a player stays.
 *
 * Layout priorities, in order:
 *   1. Balance, always visible. A player must never wonder what they have.
 *   2. One hero slot for the promotion we're currently pushing.
 *   3. Games, dense enough to browse but large enough to tap comfortably.
 *
 * Everything is placeholder art. That is the point of a wireframe: get the
 * structure and hierarchy agreed before anyone commissions illustration.
 */
export function LobbyScreen() {
  const [category, setCategory] = useState<GameCategory | 'all'>('all');

  // Placeholder until Phase 2 wires up the real wallet.
  const balance = minor(1_250_000);
  const streakDay = 3;
  const vip = tierForXp(3_000_000);
  // The bonus and the default stake both come from @juwa/economy rather than
  // being typed in here, so tuning the economy moves the UI with it.
  const bonus = dailyBonus(streakDay, vip.dailyBonusMultiplier);
  const defaultBet = suggestedBet(balance, minor(200), minor(50_000));
  const games = useMemo(() => gamesInCategory(category), [category]);

  const openGame = (game: GameSummary) => {
    // Phase 3 navigates to the game screen. For now the wireframe just proves
    // the tile is reachable and correctly disabled for unshipped games.
    console.log(`open ${game.id}`);
  };

  return (
    <Screen>
      <View style={styles.header}>
        <View>
          <Txt variant="caption" color={colors.text.muted}>
            WELCOME BACK
          </Txt>
          <Txt variant="h2">Alex</Txt>
        </View>

        <Pressable
          style={styles.balancePill}
          accessibilityRole="button"
          accessibilityLabel={`Balance ${format(balance, 'GC')}. Tap to add coins.`}
        >
          <Txt variant="money" color={colors.gold.default}>
            {format(balance, 'GC')}
          </Txt>
          <View style={styles.plus}>
            <Txt variant="bodySmall" color={colors.text.inverse}>
              +
            </Txt>
          </View>
        </Pressable>
      </View>

      <Card style={styles.hero}>
        <LinearGradient
          colors={[colors.neon.violet, colors.surface.raised]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
        <View style={styles.heroBody}>
          <Badge label={`day ${streakDay} streak`} color={colors.gold.default} />
          <Txt variant="h1" style={styles.heroTitle}>
            Collect {format(bonus, 'GC')}
          </Txt>
          <Txt variant="bodySmall" color={colors.text.secondary}>
            {vip.name} bonus applied · resets in 4h 12m
          </Txt>
          <Button label="Collect" onPress={() => {}} style={styles.heroButton} />
        </View>
      </Card>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chipRow}
      >
        {CATEGORIES.map((item) => {
          const active = item.id === category;
          return (
            <Pressable
              key={item.id}
              onPress={() => setCategory(item.id)}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              style={[styles.chip, active && styles.chipActive]}
            >
              <Txt
                variant="bodySmall"
                color={active ? colors.text.inverse : colors.text.secondary}
              >
                {item.label}
              </Txt>
            </Pressable>
          );
        })}
      </ScrollView>

      <SectionHeader title={category === 'all' ? 'All Games' : 'Games'} action="See all" />

      <FlatList
        data={games}
        keyExtractor={(item) => item.id}
        numColumns={2}
        scrollEnabled={false}
        columnWrapperStyle={styles.gridRow}
        contentContainerStyle={styles.grid}
        renderItem={({ item }) => (
          <GameCard game={item} playable={PLAYABLE.has(item.id)} onPress={openGame} />
        )}
      />

      <Card style={styles.fairness}>
        <Txt variant="h3">Provably Fair</Txt>
        <Txt variant="bodySmall" color={colors.text.secondary} style={styles.fairnessBody}>
          Every result is generated from a seed we commit to before you play. You can verify
          any round yourself, at any time.
        </Txt>
        <Button label="Verify a round" variant="secondary" onPress={() => {}} />
      </Card>

      <Txt variant="caption" color={colors.text.muted} style={styles.disclosure}>
        Juwa is a free-to-play social casino. Gold Coins have no cash value and
        cannot be exchanged for money or prizes. Default stake {format(defaultBet, 'GC')}.
      </Txt>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  balancePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface.raised,
    borderWidth: 1,
    borderColor: colors.gold.dark,
    borderRadius: radius.pill,
    paddingLeft: spacing.lg,
    paddingRight: spacing.xs,
    paddingVertical: spacing.xs,
  },
  plus: {
    width: 28,
    height: 28,
    borderRadius: radius.pill,
    backgroundColor: colors.gold.default,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hero: { overflow: 'hidden', padding: 0 },
  heroBody: { padding: spacing.xl, gap: spacing.sm },
  heroTitle: { marginTop: spacing.xs },
  heroButton: { alignSelf: 'flex-start', marginTop: spacing.md },
  chipRow: { gap: spacing.sm, paddingRight: spacing.lg },
  chip: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.surface.raised,
    borderWidth: 1,
    borderColor: colors.surface.border,
  },
  chipActive: { backgroundColor: colors.gold.default, borderColor: colors.gold.default },
  grid: { gap: spacing.md },
  gridRow: { gap: spacing.md },
  fairness: { gap: spacing.md },
  fairnessBody: { marginBottom: spacing.xs },
  disclosure: { textAlign: 'center' },
});
