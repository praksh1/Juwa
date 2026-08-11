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
  /** How busy the band is horizontally. Near 0 is a blank sign. */
  rough: number;
  /** The tile's own dominant colour, in degrees. Drives the title's metal. */
  hue: number;
  /**
   * 'banner' writes the name into the painted sign at `top`.
   * 'plate' means the artwork has no sign, so the name gets its own bar along
   * the bottom of the tile.
   */
  placement: 'banner' | 'plate';
}

export const TILE_BANNERS: Record<string, TileBanner> = {
  'juwa-classic-slots': { top: 0.0057, height: 0.1494, luminance: 0.756, rough: 0.0066, hue: 37, placement: 'banner' },
  'slot-aurora-borealis': { top: 0.04, height: 0.07, luminance: 0.528, rough: 0.0329, hue: 215, placement: 'banner' },
  'slot-carnival-row': { top: 0.035, height: 0.09, luminance: 0.443, rough: 0.0276, hue: 218, placement: 'banner' },
  'slot-city-lights': { top: 0.035, height: 0.09, luminance: 0.296, rough: 0.0327, hue: 215, placement: 'banner' },
  'slot-desert-mirage': { top: 0, height: 0.1494, luminance: 0.614, rough: 0.0765, hue: 39, placement: 'plate' },
  'slot-dragons-hoard': { top: 0.0115, height: 0.1149, luminance: 0.262, rough: 0.0238, hue: 10, placement: 'banner' },
  'slot-emerald-nights': { top: 0.1092, height: 0.1437, luminance: 0.865, rough: 0.0221, hue: 37, placement: 'banner' },
  'slot-frost-peak': { top: 0, height: 0.1264, luminance: 0.524, rough: 0.0033, hue: 207, placement: 'banner' },
  'slot-fruit-stand': { top: 0.0057, height: 0.1264, luminance: 0.229, rough: 0.0151, hue: 24, placement: 'banner' },
  'slot-jade-temple': { top: 0.03, height: 0.08, luminance: 0.323, rough: 0.0243, hue: 25, placement: 'banner' },
  'slot-jungle-run': { top: 0, height: 0.1954, luminance: 0.373, rough: 0.0603, hue: 28, placement: 'plate' },
  'slot-lucky-sevens': { top: 0.2011, height: 0.0977, luminance: 0.329, rough: 0.0538, hue: 11, placement: 'plate' },
  'slot-midnight-gold': { top: 0.0345, height: 0.1149, luminance: 0.729, rough: 0.0354, hue: 36, placement: 'banner' },
  'slot-neon-alley': { top: 0.1034, height: 0.1954, luminance: 0.48, rough: 0.082, hue: 35, placement: 'plate' },
  'slot-ocean-drift': { top: 0.08, height: 0.12, luminance: 0.472, rough: 0.0404, hue: 198, placement: 'banner' },
  'slot-pharaohs-vault': { top: 0.0115, height: 0.1437, luminance: 0.671, rough: 0.0277, hue: 27, placement: 'banner' },
  'slot-royal-flush': { top: 0.012, height: 0.133, luminance: 0.339, rough: 0.0225, hue: 35, placement: 'banner' },
  'slot-spice-market': { top: 0.0632, height: 0.1437, luminance: 0.623, rough: 0.036, hue: 29, placement: 'banner' },
  'slot-storm-chaser': { top: 0.03, height: 0.08, luminance: 0.361, rough: 0.0209, hue: 173, placement: 'banner' },
  'slot-sunset-strip': { top: 0.023, height: 0.088, luminance: 0.21, rough: 0.0218, hue: 20, placement: 'banner' },
  'slot-supernova': { top: 0.0402, height: 0.1264, luminance: 0.636, rough: 0.0413, hue: 23, placement: 'banner' },
  'slot-triple-bar': { top: 0.0632, height: 0.1149, luminance: 0.763, rough: 0.0187, hue: 32, placement: 'banner' },
  'slot-vault-breaker': { top: 0.0517, height: 0.1264, luminance: 0.628, rough: 0.0358, hue: 35, placement: 'banner' },
};
