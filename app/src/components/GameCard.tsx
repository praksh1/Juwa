import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { colors, radius, shadows, spacing, typography } from '@juwa/ui';
import { Badge, Txt } from './primitives';
import { hasTileArt } from './GameArt';
import { GameArt } from './GameArt';
import { slotDetails, type GameSummary } from '../api/games';

/**
 * A game tile in the lobby.
 *
 * The tile is the advert. A player picks what to play from about a centimetre
 * of colour and shape, so the art fills the tile and the name sits on top of it
 * rather than in a separate strip underneath — that strip cost a fifth of the
 * tile's height and carried two lines of small grey text.
 *
 * RTP is deliberately NOT on the face any more. It was the second thing on
 * every tile, in a lobby where the whole job is to make six games look
 * different from each other, and "97.30%" makes them all look the same. It is a
 * genuine trust signal, so it moves to the game screen and stays in the
 * accessibility label, where a player who wants it can find it and a player who
 * doesn't isn't reading a spreadsheet.
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
  // Only the photographic tiles carry a painted banner to write into.
  const plaque = hasTileArt(game.id);
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
        { transform: [{ scale: pressed ? 0.96 : 1 }], opacity: playable ? 1 : 0.62 },
      ]}
    >
      <View style={styles.art}>
        <View style={StyleSheet.absoluteFill}>
          <GameArt gameId={game.id} accent={game.accent} theme={slotDetails(game.id)?.theme} />
        </View>

        {/* The name sits over the art, so it needs the art dimmed underneath it
            or a light drawing will swallow white text. */}
        {/* Only needed behind bottom-left white text. A tile whose name sits
            in its own plaque should show its artwork undimmed. */}
        {plaque ? null : (
          <LinearGradient
            colors={['transparent', 'rgba(7, 12, 28, 0.55)', 'rgba(7, 12, 28, 0.94)']}
            locations={[0.45, 0.72, 1]}
            style={StyleSheet.absoluteFill}
            pointerEvents="none"
          />
        )}

        {/*
          The title goes IN the plaque.

          Every generated tile was drawn with an ornate banner across the top
          and deliberately left empty, waiting for the name. Putting the name at
          the bottom in plain white left that banner reading as a blank sign —
          the tile looked unfinished in a way that is hard to name until you see
          the two side by side.

          A SIBLING OF THE OVERLAY, not a child of the badge row. Percentages
          resolve against the nearest positioned ancestor, and nested inside the
          row they resolved against a twenty-point strip: the text was clipped
          to about two pixels and the plaque stayed as empty as before.

          Dark text, because the plaque is light gold and white on it vanishes.
        */}
        {plaque ? (
          <View style={styles.plaque} pointerEvents="none">
            <Txt variant="caption" numberOfLines={1} style={styles.plaqueText}>
              {game.name}
            </Txt>
          </View>
        ) : null}

        <View style={styles.overlay}>
          <View style={styles.topRow}>
            {game.tag ? <Badge label={game.tag} color={game.accent} /> : <View />}
          </View>

          {!playable ? (
            <View style={styles.soon}>
              <Txt variant="caption" color={colors.text.primary}>
                {game.multiplayer ? 'MULTIPLAYER · SOON' : 'COMING SOON'}
              </Txt>
            </View>
          ) : null}

          {plaque ? (
            <View />
          ) : (
            <Txt variant="bodySmall" numberOfLines={1} style={styles.name}>
              {game.name}
            </Txt>
          )}
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    flex: 1,
    borderRadius: radius.lg,
    backgroundColor: colors.surface.raised,
    borderWidth: 1,
    borderColor: colors.surface.border,
    overflow: 'hidden',
    ...shadows.card,
  },
  art: {
    aspectRatio: 0.92,
  },
  overlay: {
    flex: 1,
    padding: spacing.sm,
    justifyContent: 'space-between',
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'flex-start',
    // Clear of the plaque. The badge used to sit in the top-left corner, which
    // is exactly where the banner is, so "HOT" landed on top of "Juwa Classic".
    marginTop: '20%',
  },
  /**
   * Sits over the painted banner rather than drawing one.
   *
   * Positioned as a fraction of the card so it tracks the artwork at any tile
   * size — the banner is part of the image, so a fixed offset would drift off
   * it on a wider phone.
   */
  plaque: {
    position: 'absolute',
    left: '13%',
    right: '13%',
    // The banners sit between roughly 2% and 25% down depending on the tile;
    // this band overlaps all of them.
    top: '6%',
    height: '12%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  plaqueText: {
    fontWeight: '800',
    color: '#3A2A08',
    letterSpacing: 0.2,
    textAlign: 'center',
  },
  soon: {
    alignSelf: 'center',
    backgroundColor: 'rgba(7, 12, 28, 0.82)',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
  },
  name: {
    fontWeight: '700',
    // A hard shadow rather than a soft one: at 13pt a blurred shadow just makes
    // the text look smudged.
    textShadowColor: 'rgba(0,0,0,0.85)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
    lineHeight: typography.bodySmall.lineHeight,
  },
});
