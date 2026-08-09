import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { colors, radius, shadows, spacing, titleMetal, typography } from '@juwa/ui';
import { Badge, Txt } from './primitives';
import { hasTileArt } from './GameArt';
import { TileTitle } from './TileTitle';
import { TILE_BANNERS } from '../api/tile-banners.generated';
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
  const banner = hasTileArt(game.id) ? TILE_BANNERS[game.id] : undefined;
  /**
   * Where the name goes, and what it is written in.
   *
   * `banner` means the artwork has a real blank sign and the name is set into
   * it, undimmed, with the metal chosen from the tile's own measured colour.
   *
   * `plate` means it does not. Four tiles are painted edge to edge — a carved
   * frieze under a panther's headdress, a Vegas skyline, a temple in full sun,
   * an open fire — and squeezing a name into the least busy strip of a painting
   * is what made those titles look dropped on by accident rather than designed
   * in. Those get a plate of their own along the bottom, which is honest about
   * being a label and always legible.
   */
  const plaque = banner
    ? {
        placement: banner.placement,
        // The detector reports a tight band; text needs a little more room than
        // the flattest few rows of a sign, so the box is centred on the band
        // rather than being the band.
        top: `${Math.max(0, (banner.top + banner.height / 2) * 100 - 5.5)}%`,
        metal: titleMetal(banner.hue, banner.placement === 'plate' ? 0.1 : banner.luminance),
      }
    : undefined;
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
        {plaque?.placement === 'banner' ? null : (
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
          <TileTitle
            name={game.name}
            metal={plaque.metal}
            style={
              plaque.placement === 'banner'
                ? [styles.plaque, { top: plaque.top as never }]
                : styles.platePlaque
            }
          />
        ) : null}

        <View style={styles.overlay}>
          {/* Pushed clear of the sign, but only when there IS one up there —
              on a plate tile the top corner is free and a badge floating a
              fifth of the way down looks like a mistake. */}
          <View style={[styles.topRow, plaque?.placement === 'banner' && styles.topRowBelowSign]}>
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
  },
  // Clear of the plaque. The badge used to sit in the top-left corner, which
  // is exactly where the banner is, so "HOT" landed on top of "Juwa Classic".
  topRowBelowSign: {
    marginTop: '20%',
  },
  /**
   * Sits over the painted banner rather than drawing one.
   *
   * Positioned as a fraction of the card so it tracks the artwork at any tile
   * size — the banner is part of the image, so a fixed offset would drift off
   * it on a wider phone.
   */
  /**
   * Sits over the painted banner rather than drawing one.
   *
   * Inset well past the ends of the signs. Every one of these banners is an
   * ornate frame with a blank middle, and a name that runs the full width of
   * the tile collides with the scrollwork at both ends — which is what
   * "MIDNIGHT GOLD" and "PHARAOH'S VAULT" were doing. The inset is generous
   * rather than tight because the signs are not all the same width, and the
   * cost of a wide margin is a couple of points of size on the longest names
   * only: everything shorter is limited by the height of the band, not by this.
   */
  plaque: {
    position: 'absolute',
    left: '16%',
    right: '16%',
    height: '11%',
  },
  /**
   * The name's own sign, for the tiles the artist painted right to the edges.
   *
   * Along the bottom rather than the top, because the bottom of these four
   * tiles is the least interesting part of each of them — the top is where the
   * subject is, which is exactly why there was nowhere to write. It sits inside
   * the existing bottom gradient, so it needs no slab of its own.
   */
  platePlaque: {
    position: 'absolute',
    left: '9%',
    right: '9%',
    bottom: '6%',
    height: '13%',
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
