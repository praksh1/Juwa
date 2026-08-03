import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import { colors, motion, radius, spacing } from '@juwa/ui';

/**
 * A playing card, drawn rather than loaded.
 *
 * Fifty-two card images is an asset pipeline, a licence to check and several
 * hundred kilobytes a player waits for. Text and a border cost nothing, scale to
 * any size without blurring, and are legible at the sizes a phone actually uses.
 *
 * The deal animation is a slide plus a fade, staggered by position. Cards
 * appearing all at once reads as a table refreshing; cards arriving one after
 * another reads as a hand being dealt.
 */

export type Suit = 'S' | 'H' | 'D' | 'C';

const PIPS: Record<Suit, string> = { S: '♠', H: '♥', D: '♦', C: '♣' };

export interface PlayingCardProps {
  rank: string;
  suit: Suit;
  /** Face down — the dealer's hole card until the hand ends. */
  hidden?: boolean;
  /** Position in the hand, for the deal stagger. */
  index?: number;
  size?: 'normal' | 'small';
}

export function PlayingCard({ rank, suit, hidden, index = 0, size = 'normal' }: PlayingCardProps) {
  const entrance = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(entrance, {
      toValue: 1,
      duration: motion.cardDeal,
      delay: index * 90,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [entrance, index]);

  const small = size === 'small';
  // Hearts and diamonds red, spades and clubs near-black on white — the
  // convention every player already knows. Inventing a palette here would only
  // slow down reading a hand.
  const ink = suit === 'H' || suit === 'D' ? colors.table.red : colors.table.black;

  const animatedStyle = {
    opacity: entrance,
    transform: [
      { translateY: entrance.interpolate({ inputRange: [0, 1], outputRange: [-28, 0] }) },
      { scale: entrance.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1] }) },
    ],
  };

  if (hidden) {
    return (
      <Animated.View style={[styles.card, small && styles.cardSmall, styles.back, animatedStyle]}>
        <View style={styles.backPattern} />
      </Animated.View>
    );
  }

  return (
    <Animated.View
      style={[styles.card, small && styles.cardSmall, animatedStyle]}
      accessibilityLabel={`${rank} of ${
        { S: 'spades', H: 'hearts', D: 'diamonds', C: 'clubs' }[suit]
      }`}
    >
      <Text style={[styles.rank, small && styles.rankSmall, { color: ink }]}>{rank}</Text>
      <Text style={[styles.pip, small && styles.pipSmall, { color: ink }]}>{PIPS[suit]}</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: {
    width: 52,
    height: 74,
    borderRadius: radius.sm,
    backgroundColor: '#F7F5F0',
    borderWidth: 1,
    borderColor: '#D8D3C8',
    alignItems: 'center',
    justifyContent: 'center',
    // Cards overlap slightly, like a real hand held in one hand.
    marginRight: -14,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.35,
    shadowRadius: 4,
    elevation: 3,
  },
  cardSmall: { width: 40, height: 58, marginRight: -12 },
  rank: { fontSize: 20, fontWeight: '700', lineHeight: 22 },
  rankSmall: { fontSize: 15, lineHeight: 17 },
  pip: { fontSize: 18, lineHeight: 20 },
  pipSmall: { fontSize: 13, lineHeight: 15 },
  back: { backgroundColor: colors.surface.overlay, borderColor: colors.gold.dark },
  backPattern: {
    width: '70%',
    height: '80%',
    borderRadius: radius.sm,
    borderWidth: 2,
    borderColor: colors.gold.dark,
    backgroundColor: colors.surface.raised,
  },
});

export const CARD_GAP = spacing.md;
