import React, { useEffect, useMemo, useState } from 'react';
import { useNavigation } from '@react-navigation/native';
import { FlatList, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { colors, radius, spacing } from '@juwa/ui';
import { format } from '@juwa/money';
import { VIP_TIERS, dailyBonus } from '@juwa/economy';
import { usePlayer } from '../api/usePlayer';
import { createPlayApi } from '../api/client';
import { Badge, Button, Card, Screen, SectionHeader, Txt } from '../components/primitives';
import { GameCard } from '../components/GameCard';
import { InstallPrompt } from '../components/InstallPrompt';
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
  const navigation = useNavigation<{ navigate: (screen: string) => void }>();
  const [category, setCategory] = useState<GameCategory | 'all'>('all');

  // The real balance, from the server. Never a local guess — see usePlayer.
  const { balance, dailyStreak, vipLevel, claimDaily } = usePlayer();
  const [bonusMessage, setBonusMessage] = useState<string | null>(null);
  const [username, setUsername] = useState<string | null>(null);
  const api = React.useRef(createPlayApi()).current;

  useEffect(() => {
    // Greet the player by the name they chose, not the placeholder left over
    // from the wireframe.
    api.getProfile().then((profile) => setUsername(profile.username ?? null)).catch(() => {});
  }, [api]);

  const vip = VIP_TIERS[vipLevel] ?? VIP_TIERS[0]!;
  // The amount shown comes from @juwa/economy, so tuning the economy moves the
  // UI with it rather than leaving a stale number on screen.
  const bonus = dailyBonus(Math.max(1, dailyStreak + 1), vip.dailyBonusMultiplier);

  const collect = async () => {
    const result = await claimDaily();
    setBonusMessage(result.granted ? null : (result.reason ?? 'Come back tomorrow'));
  };
  const games = useMemo(() => gamesInCategory(category), [category]);

  const openGame = (game: GameSummary) => {
    // Only games with a shipped renderer are reachable; the rest render as
    // "coming soon" and are not pressable.
    navigation.navigate(game.id);
  };

  return (
    <Screen>
      <View style={styles.header}>
        <View>
          <Txt variant="caption" color={colors.text.muted}>
            WELCOME BACK
          </Txt>
          <Txt variant="h2">{username ?? 'Player'}</Txt>
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

      {/* The bonus is a strip, not a billboard. As a full-width stacked card it
          was 40% of the first screen and pushed every game below the fold. */}
      <Card style={styles.hero}>
        <LinearGradient
          // Deep indigo into royal blue, with gold doing the accent work. The
          // violet-into-magenta version read as a children's game rather than
          // as a casino — saturated chrome is what makes an app look cheap.
          colors={['#2A2170', '#1B3A8F']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
        <View style={styles.heroBody}>
          <View style={styles.heroText}>
            <Badge label={`day ${dailyStreak} streak`} color={colors.gold.default} />
            <Txt variant="h2" style={styles.heroTitle}>
              Collect {format(bonus, 'GC')}
            </Txt>
            <Txt variant="caption" color={colors.text.primary} style={styles.heroSub}>
              {bonusMessage ?? `${vip.name} bonus applied`}
            </Txt>
          </View>
          <Button label="Collect" onPress={collect} />
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

      {/* Games come before everything optional. They were the fourth block on
          the screen, behind a bonus card, the category chips and an install
          nag — so the one thing a player opened the app to do required a
          scroll. */}
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

      {/* Asked for after the player has seen what they'd be installing. */}
      <InstallPrompt />

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
        cannot be exchanged for money or prizes.
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
  heroBody: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.lg,
  },
  heroText: { flex: 1, gap: spacing.xs, alignItems: 'flex-start' },
  heroTitle: { marginTop: 2 },
  heroSub: { opacity: 0.85 },
  chipRow: { gap: spacing.sm, paddingRight: spacing.lg },
  chip: {
    paddingHorizontal: spacing.md,
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
