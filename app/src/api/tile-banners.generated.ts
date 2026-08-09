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
  'juwa-classic-slots': { top: 0.0345, height: 0.0575, luminance: 0.787 },
  'slot-aurora-borealis': { top: 0.092, height: 0.0575, luminance: 0.607 },
  'slot-carnival-row': { top: 0.1092, height: 0.0575, luminance: 0.603 },
  'slot-city-lights': { top: 0.2126, height: 0.0575, luminance: 0.512 },
  'slot-desert-mirage': { top: 0, height: 0.0575, luminance: 0.628 },
  'slot-dragons-hoard': { top: 0.3563, height: 0.0575, luminance: 0.513 },
  'slot-emerald-nights': { top: 0.1667, height: 0.0575, luminance: 0.881 },
  'slot-frost-peak': { top: 0.0632, height: 0.0575, luminance: 0.547 },
  'slot-fruit-stand': { top: 0.0747, height: 0.0575, luminance: 0.274 },
  'slot-jade-temple': { top: 0.2471, height: 0.0575, luminance: 0.533 },
  'slot-jungle-run': { top: 0, height: 0.0632, luminance: 0.529 },
  'slot-lucky-sevens': { top: 0.2989, height: 0.0575, luminance: 0.547 },
  'slot-midnight-gold': { top: 0.069, height: 0.0575, luminance: 0.781 },
  'slot-neon-alley': { top: 0.2471, height: 0.069, luminance: 0.562 },
  'slot-ocean-drift': { top: 0.2184, height: 0.0575, luminance: 0.692 },
  'slot-pharaohs-vault': { top: 0.0575, height: 0.0575, luminance: 0.789 },
  'slot-royal-flush': { top: 0.1207, height: 0.0575, luminance: 0.462 },
  'slot-spice-market': { top: 0.1092, height: 0.0575, luminance: 0.643 },
  'slot-storm-chaser': { top: 0.1839, height: 0.0575, luminance: 0.691 },
  'slot-sunset-strip': { top: 0.069, height: 0.0575, luminance: 0.301 },
  'slot-supernova': { top: 0.0747, height: 0.0575, luminance: 0.736 },
  'slot-triple-bar': { top: 0.1034, height: 0.0575, luminance: 0.711 },
  'slot-vault-breaker': { top: 0.0747, height: 0.0632, luminance: 0.695 },
};
