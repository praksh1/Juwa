import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { colors, radius, shadows, spacing } from '@juwa/ui';
import { Badge, Txt } from './primitives';
import type { GameSummary } from '../api/games';

/**
 * A game tile in the lobby.
 *
 * The art is a gradient placeholder keyed off the game's accent colour. Real
 * key art replaces it later — the point of Phase 1 is to get the layout,
 * hierarchy and information density right before anyone pays an illustrator.
 *
 * RTP is shown on every tile. Most casino apps bury it. Showing it is a trust
 * signal, it costs nothing, and in several markets it is required anyway.
 */
export function GameCard({
  game,
  playable,
  onPress,
}: {
  game: GameSummary;
  playable: boolean;
  onPress: (game: GameSummary) => void;
}) {
  return (
    <Pressable
      onPress={() => onPress(game)}
      disabled={!playable}
      accessibilityRole="button"
      accessibilityLabel={`${game.name}, ${(game.rtp * 100).toFixed(2)} percent return to player${
        playable ? '' : game.multiplayer ? ', multiplayer, coming soon' : ', coming soon'
      }`}
      style={({ pressed }) => [
        styles.wrapper,
        { transform: [{ scale: pressed ? 0.97 : 1 }], opacity: playable ? 1 : 0.5 },
      ]}
    >
      <View style={styles.art}>
        <LinearGradient
          colors={[game.accent, colors.surface.overlay]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFill}
        />
        <View style={styles.artOverlay}>
          {game.tag ? <Badge label={game.tag} color={game.accent} /> : <View />}
          {!playable ? (
            <View style={styles.soon}>
              <Txt variant="caption" color={colors.text.primary}>
                {game.multiplayer ? 'MULTIPLAYER · SOON' : 'COMING SOON'}
              </Txt>
            </View>
          ) : null}
        </View>
      </View>

      <View style={styles.meta}>
        <Txt variant="bodySmall" numberOfLines={1}>
          {game.name}
        </Txt>
        <Txt variant="caption" color={colors.text.muted}>
          RTP {(game.rtp * 100).toFixed(2)}%
        </Txt>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    flex: 1,
    borderRadius: radius.md,
    backgroundColor: colors.surface.raised,
    borderWidth: 1,
    borderColor: colors.surface.border,
    overflow: 'hidden',
    ...shadows.card,
  },
  art: {
    aspectRatio: 1,
    justifyContent: 'flex-end',
  },
  artOverlay: {
    flex: 1,
    padding: spacing.sm,
    justifyContent: 'space-between',
  },
  soon: {
    alignSelf: 'center',
    backgroundColor: 'rgba(10, 7, 16, 0.75)',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.sm,
  },
  meta: {
    padding: spacing.sm,
    gap: 2,
  },
});
