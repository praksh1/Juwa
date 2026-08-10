/**
 * The logged-out landing page.
 *
 * Before this existed, a stranger's first screen was an email field. That is
 * the single most expensive mistake a free-to-play product can make: it asks
 * for something before it has offered anything, and most people simply leave.
 *
 * The order here is deliberate — show the promise, show that it is free, show
 * the games, and only then ask for an account. "Browse games" is offered ahead
 * of "create account" for the same reason.
 */

import React from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { colors, radius, spacing, typography } from '@juwa/ui';
import { Button, Card, Txt } from '../components/primitives';
import { Logo } from '../components/Logo';
import { LegalFooter } from '../components/LegalFooter';
import { GameArt } from '../components/GameArt';
import { GAMES, PLAYABLE } from '../api/games';
import { COIN_PACKS } from '@juwa/economy';
import { format } from '@juwa/money';

const STATS = [
  { value: `${GAMES.length}`, label: 'Games live' },
  { value: '100K', label: 'Welcome coins' },
  { value: '24/7', label: 'Support' },
  { value: 'Secure', label: 'Checkout' },
];

const STEPS = [
  {
    n: '01',
    title: 'Create an account',
    body: 'Takes a minute. You get 100,000 coins to start, free.',
  },
  {
    n: '02',
    title: 'Play the games',
    body: 'Slots, blackjack and roulette. Every result is provably fair.',
  },
  {
    n: '03',
    title: 'Top up, or wait',
    body: 'Free coins every day. Buy more only if you want to — never required.',
  },
];

export function LandingScreen({
  onCreateAccount,
  onSignIn,
}: {
  onCreateAccount: () => void;
  onSignIn: () => void;
}) {
  const featured = GAMES.filter((g) => PLAYABLE.has(g.id)).slice(0, 4);
  const packs = COIN_PACKS.slice(0, 3);

  return (
    <View style={styles.screen}>
      <View style={styles.nav}>
        <Logo height={26} />
        <View style={styles.navActions}>
          <Button label="Sign in" variant="secondary" onPress={onSignIn} />
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.hero}>
          <LinearGradient
            colors={['#1A1030', '#08070E']}
            start={{ x: 0.2, y: 0 }}
            end={{ x: 0.8, y: 1 }}
            style={StyleSheet.absoluteFill}
          />
          <Txt variant="display" style={styles.heroTitle}>
            Play. Spin. Collect.
          </Txt>
          <Txt variant="body" color={colors.text.secondary} style={styles.heroSub}>
            A free-to-play social casino. Real games, real odds, published and
            provable — with play money that stays play money.
          </Txt>
          <View style={styles.heroButtons}>
            <Button label="Browse games" variant="secondary" onPress={onSignIn} />
            <Button label="Create account" onPress={onCreateAccount} />
          </View>
          {/*
            The agent door.
            
            Deliberately a link into the SAME sign-in the players use, not a
            second login box. Being an agent is a property of an account that
            the server checks on every request — a separate credential system
            would add two places for a password to leak and two password-reset
            flows, and would buy nothing. What an agent actually needs is a
            visible way in and a way to apply, which is what this is.
          */}
          <View style={styles.agentRow}>
            <Txt variant="caption" color={colors.text.muted}>
              Working with us as an agent?{' '}
            </Txt>
            <Pressable onPress={onSignIn} accessibilityRole="link">
              <Txt variant="caption" color={colors.neon.cyan}>
                Sign in here
              </Txt>
            </Pressable>
          </View>
        </View>

        <View style={styles.statStrip}>
          {STATS.map((stat) => (
            <View key={stat.label} style={styles.stat}>
              <Txt variant="h2" color={colors.neon.cyan} style={styles.statValue}>
                {stat.value}
              </Txt>
              <Txt variant="caption" color={colors.text.muted} style={styles.statLabel}>
                {stat.label}
              </Txt>
            </View>
          ))}
        </View>

        <Txt variant="h1" style={styles.sectionTitle}>
          The games
        </Txt>
        <View style={styles.grid}>
          {featured.map((game) => (
            <View key={game.id} style={styles.tile}>
              <View style={styles.tileArt}>
                <GameArt gameId={game.id} accent={game.accent} />
              </View>
              <Txt variant="bodySmall" numberOfLines={1} style={styles.tileName}>
                {game.name}
              </Txt>
            </View>
          ))}
        </View>

        <Txt variant="h1" style={styles.sectionTitle}>
          Coin packs
        </Txt>
        <View style={styles.packs}>
          {packs.map((pack) => (
            <Card key={pack.id} style={styles.pack}>
              <Txt variant="money" color={colors.gold.default}>
                {pack.coins.toLocaleString()} coins
              </Txt>
              <Txt variant="bodySmall" color={colors.text.secondary}>
                {format(pack.priceUsd, 'USD')}
              </Txt>
            </Card>
          ))}
        </View>
        <Txt variant="caption" color={colors.text.secondary} style={styles.packNote}>
          Buying coins is optional. Coins cannot be exchanged, redeemed or
          withdrawn, and there is a free top-up available every day.
        </Txt>

        <Txt variant="h1" style={styles.sectionTitle}>
          How it works
        </Txt>
        {STEPS.map((step) => (
          <Card key={step.n} style={styles.step}>
            <Txt variant="h2" color={colors.neon.cyan} style={styles.stepNumber}>
              {step.n}
            </Txt>
            <View style={styles.stepText}>
              <Txt variant="h3">{step.title}</Txt>
              <Txt variant="bodySmall" color={colors.text.secondary}>
                {step.body}
              </Txt>
            </View>
          </Card>
        ))}

        <View style={styles.cta}>
          <Button label="Create account" onPress={onCreateAccount} />
        </View>

        <LegalFooter />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.surface.base },
  nav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.surface.border,
  },
  navActions: { flexDirection: 'row', gap: spacing.sm },
  scroll: { paddingBottom: spacing.xl },
  hero: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing['2xl'],
    paddingBottom: spacing.xl,
    gap: spacing.md,
    overflow: 'hidden',
  },
  heroTitle: { letterSpacing: 1 },
  heroSub: { maxWidth: 460 },
  heroButtons: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm, flexWrap: 'wrap' },
  agentRow: { flexDirection: 'row', alignItems: 'center', marginTop: spacing.md, flexWrap: 'wrap' },
  statStrip: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: colors.surface.border,
    backgroundColor: colors.surface.raised,
  },
  stat: {
    flexGrow: 1,
    flexBasis: '25%',
    alignItems: 'center',
    paddingVertical: spacing.md,
    gap: 2,
  },
  statValue: { fontVariant: ['tabular-nums'] },
  statLabel: { textTransform: 'uppercase', letterSpacing: 0.8 },
  sectionTitle: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl,
    paddingBottom: spacing.md,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  tile: {
    flexGrow: 1,
    flexBasis: '44%',
    borderRadius: radius.md,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.surface.border,
    backgroundColor: colors.surface.raised,
  },
  tileArt: { aspectRatio: 1.15 },
  tileName: { padding: spacing.sm, fontWeight: '700' },
  packs: { flexDirection: 'row', gap: spacing.sm, paddingHorizontal: spacing.lg },
  pack: { flex: 1, gap: 2, padding: spacing.md },
  packNote: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    textTransform: 'none',
    lineHeight: typography.caption.lineHeight + 4,
  },
  step: {
    flexDirection: 'row',
    gap: spacing.md,
    marginHorizontal: spacing.lg,
    marginBottom: spacing.sm,
    alignItems: 'flex-start',
  },
  stepNumber: { fontVariant: ['tabular-nums'] },
  stepText: { flex: 1, gap: 2 },
  cta: { padding: spacing.lg },
});
