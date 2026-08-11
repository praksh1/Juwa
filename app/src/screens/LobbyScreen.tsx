import React, { useEffect, useMemo, useState } from 'react';
import { useNavigation } from '@react-navigation/native';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { colors, radius, spacing } from '@juwa/ui';
import { format } from '@juwa/money';
import { VIP_TIERS, dailyBonus } from '@juwa/economy';
import { usePlayer } from '../api/usePlayer';
import { createPlayApi } from '../api/client';
import { Badge, Button, Card, Screen, SectionHeader, Txt } from '../components/primitives';
import { GameCard } from '../components/GameCard';
import { InstallPrompt } from '../components/InstallPrompt';
import { LegalFooter } from '../components/LegalFooter';
import { SignOutButton } from '../components/SignOutButton';
import { sounds } from '../sound';
import {
  CATEGORIES,
  PLAYABLE,
  gamesInCategory,
  type GameCategory,
  type GameSummary,
} from '../api/games';
import { LOBBY_BED, useAmbientBed } from '../ambience';

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
  const { balance, dailyStreak, vipLevel, bonusClaimedToday, claimDaily } = usePlayer();
  // The room the player is standing in. See ambience.ts.
  useAmbientBed(LOBBY_BED);
  const [bonusMessage, setBonusMessage] = useState<string | null>(null);
  const [username, setUsername] = useState<string | null>(null);
  /**
   * Who to ask for more coins.
   *
   * The + on the balance used to be decoration. Coins now arrive from an agent,
   * so the honest answer to "how do I get more" is their agent's name — and
   * when there isn't one, saying so plainly beats a button that does nothing.
   */
  const [agentName, setAgentName] = useState<string | null>(null);
  const [topUpNote, setTopUpNote] = useState<string | null>(null);
  const api = React.useRef(createPlayApi()).current;

  useEffect(() => {
    // Greet the player by the name they chose, not the placeholder left over
    // from the wireframe.
    api
      .getProfile()
      .then((profile) => {
        setUsername(profile.username ?? null);
        setAgentName(profile.agentName ?? null);
      })
      .catch(() => {});
  }, [api]);

  const vip = VIP_TIERS[vipLevel] ?? VIP_TIERS[0]!;
  // The amount shown comes from @juwa/economy, so tuning the economy moves the
  // UI with it rather than leaving a stale number on screen.
  const bonus = dailyBonus(Math.max(1, dailyStreak + 1), vip.dailyBonusMultiplier);

  const collect = async () => {
    if (bonusClaimedToday) return;
    const result = await claimDaily();
    setBonusMessage(
      result.granted
        ? 'Collected. Come back tomorrow for more.'
        : (result.reason ?? 'Come back tomorrow'),
    );
  };
  const games = useMemo(() => gamesInCategory(category), [category]);

  /** Two per row, so the grid can be plain Views. */
  const gameRows = useMemo(() => {
    const rows: GameSummary[][] = [];
    for (let i = 0; i < games.length; i += 2) rows.push(games.slice(i, i + 2));
    return rows;
  }, [games]);

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
          onPress={() => {
            sounds.tap();
            setTopUpNote(
              agentName
                ? `Contact ${agentName} for more coins.`
                : 'Coins come from your agent. Ask whoever set up your account.',
            );
          }}
          accessibilityRole="button"
          accessibilityLabel={`Balance ${format(balance, 'GC')}. Tap to find out how to get more coins.`}
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

      {topUpNote ? (
        <Pressable onPress={() => setTopUpNote(null)} accessibilityRole="button">
          <Card style={styles.topUpNote}>
            <Txt variant="bodySmall" color={colors.gold.light}>
              {topUpNote}
            </Txt>
            <Txt variant="caption" color={colors.text.muted}>
              Tap to dismiss
            </Txt>
          </Card>
        </Pressable>
      ) : null}

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
              {bonusClaimedToday ? 'Collected today' : `Collect ${format(bonus, 'GC')}`}
            </Txt>
            <Txt variant="caption" color={colors.text.primary} style={styles.heroSub}>
              {bonusMessage ??
                (bonusClaimedToday
                  ? 'Log in again tomorrow for more free coins'
                  : `${vip.name} bonus applied`)}
            </Txt>
          </View>
          {/*
            Disabled once it is gone, rather than pressable and refusing.
            A button that accepts a press and then says "already claimed today"
            teaches the player it lies, and they keep pressing it every session
            because nothing on screen ever said otherwise.
          */}
          <Button
            label={bonusClaimedToday ? 'Collected' : 'Collect'}
            onPress={collect}
            disabled={bonusClaimedToday}
          />
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
      {/*
        A plain grid, NOT a FlatList.

        A `<FlatList scrollEnabled={false}>` inside the screen's ScrollView
        renders as a container with `touch-action: none`, and that container is
        as tall as the whole grid — around 3,600px here, which is nearly the
        entire lobby. `touch-action: none` tells the browser not to pan for any
        touch starting inside it, so on iOS Safari dragging anywhere over the
        game tiles scrolled nothing at all. The lobby was stuck showing two and
        a half rows with no way to reach the rest.

        It survived testing because Chromium is far more forgiving about
        handing the gesture to an ancestor scroller, and because automated
        checks scroll programmatically rather than by dragging. It took a
        screen recording from a real phone to see it.

        Nothing is lost by dropping the FlatList: with `scrollEnabled={false}`
        it never virtualised, so it was already rendering all thirty-odd cards.
        This renders the same cards through the ScrollView that was always
        meant to be doing the scrolling.
      */}
      <View style={styles.grid}>
        {gameRows.map((row, index) => (
          <View key={index} style={styles.gridRow}>
            {row.map((item) => (
              <GameCard
                key={item.id}
                game={item}
                playable={PLAYABLE.has(item.id)}
                onPress={openGame}
              />
            ))}
            {/* Keeps a lone card on the last row at half width rather than
                letting it stretch across both columns. */}
            {row.length === 1 ? <View style={styles.gridSpacer} /> : null}
          </View>
        ))}
      </View>

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

      <SignOutButton />
      <LegalFooter />
    </Screen>
  );
}

const styles = StyleSheet.create({
  topUpNote: {
    gap: 2,
    borderWidth: 1,
    borderColor: colors.gold.default,
    backgroundColor: 'rgba(200,164,77,0.10)',
  },
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
  gridRow: { flexDirection: 'row', gap: spacing.md },
  gridSpacer: { flex: 1 },
  fairness: { gap: spacing.md },
  fairnessBody: { marginBottom: spacing.xs },
  disclosure: { textAlign: 'center' },
});
