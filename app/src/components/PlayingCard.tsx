import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { colors, motion, radius, spacing } from '@juwa/ui';

/**
 * A playing card, drawn rather than loaded.
 *
 * Fifty-two card images is an asset pipeline, a licence to check and several
 * hundred kilobytes a player waits for. Text and a border cost nothing, scale to
 * any size without blurring, and are legible at the sizes a phone actually uses.
 *
 * The deal animation follows the motion of a card leaving a shoe: it lifts,
 * turns slightly in the dealer's hand, travels across the felt, then settles
 * with a tiny overshoot. Cards appearing all at once reads as a table refresh;
 * cards arriving one after another reads as a hand being dealt.
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
  /** Order in the physical deal, independent of where the card sits in a hand. */
  dealOrder?: number;
  /** Cards visibly travel from the dealer's shoe to their destination. */
  trajectory?: 'dealer' | 'player';
  size?: 'normal' | 'small';
}

export function PlayingCard({ rank, suit, hidden, index = 0, dealOrder = index, trajectory = 'player', size = 'normal' }: PlayingCardProps) {
  const entrance = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    entrance.setValue(0);
    Animated.timing(entrance, {
      toValue: 1,
      duration: Math.max(motion.cardDeal, 650),
      delay: dealOrder * 145,
      easing: Easing.bezier(0.2, 0.72, 0.28, 1),
      useNativeDriver: true,
    }).start();
  }, [dealOrder, entrance]);

  const small = size === 'small';
  // Hearts and diamonds red, spades and clubs near-black on white — the
  // convention every player already knows. Inventing a palette here would only
  // slow down reading a hand.
  const ink = suit === 'H' || suit === 'D' ? colors.table.red : colors.table.black;

  const sourceX = trajectory === 'dealer' ? 112 + index * 8 : 158 + index * 8;
  const sourceY = trajectory === 'dealer' ? -62 : -172;
  const animatedStyle = {
    opacity: entrance.interpolate({ inputRange: [0, 0.08, 1], outputRange: [0, 1, 1] }),
    transform: [
      { perspective: 620 },
      {
        translateX: entrance.interpolate({
          inputRange: [0, 0.28, 0.78, 1],
          outputRange: [sourceX, sourceX * 0.7, 8, 0],
        }),
      },
      {
        translateY: entrance.interpolate({
          inputRange: [0, 0.28, 0.78, 1],
          outputRange: [sourceY, sourceY * 0.78 - 8, -6, 0],
        }),
      },
      {
        rotateZ: entrance.interpolate({
          inputRange: [0, 0.36, 0.86, 1],
          outputRange: ['-9deg', '-6deg', '1deg', '0deg'],
        }),
      },
      {
        rotateY: entrance.interpolate({
          inputRange: [0, 0.5, 1],
          outputRange: ['-12deg', '-4deg', '0deg'],
        }),
      },
      {
        rotateX: entrance.interpolate({
          inputRange: [0, 0.7, 1],
          outputRange: ['7deg', '2deg', '0deg'],
        }),
      },
      {
        scale: entrance.interpolate({
          inputRange: [0, 0.72, 1],
          outputRange: [0.84, 0.985, 1],
        }),
      },
    ],
  };

  if (hidden) {
    return (
      <Animated.View style={[styles.card, small && styles.cardSmall, styles.back, animatedStyle]}>
        <LinearGradient colors={['#1B2541', '#080E1E', '#31170A']} style={StyleSheet.absoluteFill} />
        <View style={styles.backPattern}><View style={styles.backMark} /></View>
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
      <LinearGradient colors={['#FFFDF2', '#F0E6CF', '#FFFFFF']} style={StyleSheet.absoluteFill} />
      <View style={styles.faceRim} pointerEvents="none" />
      <View style={styles.cornerTop} pointerEvents="none">
        <Text style={[styles.cornerRank, small && styles.cornerRankSmall, { color: ink }]}>{rank}</Text>
        <Text style={[styles.cornerPip, small && styles.cornerPipSmall, { color: ink }]}>{PIPS[suit]}</Text>
      </View>
      <Text style={[styles.pip, small && styles.pipSmall, { color: ink }]}>{PIPS[suit]}</Text>
      <View style={styles.cornerBottom} pointerEvents="none">
        <Text style={[styles.cornerRank, small && styles.cornerRankSmall, { color: ink }]}>{rank}</Text>
        <Text style={[styles.cornerPip, small && styles.cornerPipSmall, { color: ink }]}>{PIPS[suit]}</Text>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: {
    width: 52,
    height: 74,
    borderRadius: radius.sm,
    backgroundColor: '#F7F5F0',
    borderWidth: 1.5,
    borderColor: '#C59A35',
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
  faceRim: { ...StyleSheet.absoluteFillObject, margin: 3, borderWidth: 1, borderColor: 'rgba(135,91,12,0.45)', borderRadius: 4 },
  cornerTop: { position: 'absolute', left: 6, top: 5, alignItems: 'center' },
  cornerBottom: { position: 'absolute', right: 6, bottom: 5, alignItems: 'center', transform: [{ rotate: '180deg' }] },
  cornerRank: { fontSize: 10, fontWeight: '900', lineHeight: 11 },
  cornerRankSmall: { fontSize: 8, lineHeight: 9 },
  cornerPip: { fontSize: 8, lineHeight: 9 },
  cornerPipSmall: { fontSize: 6, lineHeight: 7 },
  pip: { fontSize: 25, lineHeight: 27, textShadowColor: 'rgba(178,132,22,0.22)', textShadowRadius: 2 },
  pipSmall: { fontSize: 18, lineHeight: 20 },
  back: { backgroundColor: colors.surface.overlay, borderColor: colors.gold.light, overflow: 'hidden' },
  backPattern: {
    width: '70%',
    height: '80%',
    borderRadius: radius.sm,
    borderWidth: 2,
    borderColor: '#E8BE56',
    backgroundColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  backMark: { width: '44%', aspectRatio: 1, borderRadius: 99, borderWidth: 1.5, borderColor: '#E8BE56', transform: [{ rotate: '45deg' }] },
});

export const CARD_GAP = spacing.md;
