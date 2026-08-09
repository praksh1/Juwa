/**
 * GENERATED FILE — do not edit.
 *
 * Written by scripts/detect-tile-banners.mjs by measuring the artwork in
 * art/tiles. Re-run it after adding or replacing a tile.
 *
 * Each tile was drawn with an empty ornamental banner for the game's name, and
 * the banners are in different places on different tiles. These are the
 * measured positions, as fractions of the tile's height, plus the mean
 * luminance of the band — which is what decides whether the name is written in
 * dark or light type.
 */

export interface TileBanner {
  /** Distance from the top of the tile, as a fraction of its height. */
  top: number;
  /** Band height, as a fraction of the tile's height. */
  height: number;
  /** 0 is black, 1 is white. Above ~0.5 the name has to be dark to be read. */
  luminance: number;
}

export const TILE_BANNERS: Record<string, TileBanner> = {
  'juwa-classic-slots': { top: 0.0057, height: 0.1494, luminance: 0.756 },
  'slot-aurora-borealis': { top: 0.0517, height: 0.1264, luminance: 0.575 },
  'slot-carnival-row': { top: 0.0172, height: 0.1494, luminance: 0.476 },
  'slot-city-lights': { top: 0.1264, height: 0.1552, luminance: 0.425 },
  'slot-desert-mirage': { top: 0, height: 0.1494, luminance: 0.614 },
  'slot-dragons-hoard': { top: 0.0115, height: 0.1149, luminance: 0.268 },
  'slot-emerald-nights': { top: 0.1092, height: 0.1437, luminance: 0.865 },
  'slot-frost-peak': { top: 0, height: 0.1264, luminance: 0.524 },
  'slot-fruit-stand': { top: 0.0057, height: 0.1264, luminance: 0.229 },
  'slot-jade-temple': { top: 0.1207, height: 0.1782, luminance: 0.466 },
  'slot-jungle-run': { top: 0, height: 0.1954, luminance: 0.374 },
  'slot-lucky-sevens': { top: 0.2011, height: 0.0977, luminance: 0.329 },
  'slot-midnight-gold': { top: 0.0345, height: 0.1149, luminance: 0.729 },
  'slot-neon-alley': { top: 0.1034, height: 0.1954, luminance: 0.485 },
  'slot-ocean-drift': { top: 0.05, height: 0.14, luminance: 0.52 },
  'slot-pharaohs-vault': { top: 0, height: 0.1609, luminance: 0.706 },
  'slot-royal-flush': { top: 0.02, height: 0.17, luminance: 0.72 },
  'slot-spice-market': { top: 0.0632, height: 0.1437, luminance: 0.623 },
  'slot-storm-chaser': { top: 0.1264, height: 0.1322, luminance: 0.618 },
  'slot-sunset-strip': { top: 0.0805, height: 0.1552, luminance: 0.312 },
  'slot-supernova': { top: 0, height: 0.1724, luminance: 0.691 },
  'slot-triple-bar': { top: 0.0632, height: 0.1207, luminance: 0.644 },
  'slot-vault-breaker': { top: 0.0517, height: 0.1264, luminance: 0.628 },
};
