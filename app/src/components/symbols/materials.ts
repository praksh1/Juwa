/**
 * What a game's symbols are MADE OF.
 *
 * Real slot cabinets do not draw every symbol from scratch. Look closely at any
 * of them and the structure is the same: four or five painted picture symbols
 * carrying the theme, and beneath them the card royals — 10, J, Q, K, A —
 * rendered in whatever the game is made of. The Egyptian game's royals are
 * carved sandstone with turquoise inlay; the ice game's are cut from glacier.
 * Same five glyphs, a different substance, and nobody mistakes one game for
 * another.
 *
 * That matters here for a reason beyond authenticity. Painterly symbols have to
 * be painted, and 23 games x 9 symbols is 207 images nobody has. Royals are
 * TYPOGRAPHY, and typography can be drawn in code — so the material is defined
 * here, the letterforms are drawn once, and the two together give every game a
 * distinct set of low symbols for no art at all.
 *
 * It also cuts what actually has to be commissioned from nine symbols a game to
 * four.
 */

export interface Material {
  /** Face gradient, light to dark. */
  face: readonly [string, string, string];
  /** The cut edge of the letterform. */
  edge: string;
  /** Deep outline, so the glyph holds against a busy room behind it. */
  outline: string;
  /** A single bright accent: inlay, gem, filament. */
  inlay: string;
  /** Glow behind the glyph, or none. */
  halo?: string;
}

/**
 * The materials.
 *
 * Deliberately a small set. Two games in the same substance still differ by
 * their picture symbols, their room and their cabinet — but a material per game
 * would be twenty-three palettes nobody can hold in their head, and the point of
 * a material is that it is recognisable.
 */
export const MATERIALS: Record<string, Material> = {
  /** Glacier ice: cut, blue-white, lit from within. */
  ice: {
    face: ['#F2FBFF', '#9FD8F5', '#3E8FC4'],
    edge: '#DFF4FF',
    outline: '#0B2C46',
    inlay: '#7FF0FF',
    halo: '#39B7E8',
  },
  /** Sandstone with turquoise inlay: tombs and temples. */
  sandstone: {
    face: ['#FFE9B8', '#E0B463', '#9A6B22'],
    edge: '#FFF3D2',
    outline: '#2E1B06',
    inlay: '#37C6C0',
  },
  /** Neon tubing: hollow glass, hot gas, wet reflections. */
  neon: {
    face: ['#FFFFFF', '#FF5FD2', '#8A1E7A'],
    edge: '#FFC9F2',
    outline: '#1A0320',
    inlay: '#3BF0FF',
    halo: '#FF3DCB',
  },
  /** Carved jade with gold rims. */
  jade: {
    face: ['#DFFBEA', '#4FBF87', '#136B45'],
    edge: '#EBFFF3',
    outline: '#04231A',
    inlay: '#F5C542',
  },
  /** Cooling ember: cast iron pulled from a forge. */
  ember: {
    face: ['#FFD9A8', '#F0641F', '#7A1C06'],
    edge: '#FFE7C4',
    outline: '#240702',
    inlay: '#FFD447',
    halo: '#FF6A1F',
  },
  /** Brushed gunmetal: vaults, machinery, storms. */
  gunmetal: {
    face: ['#E8EEF4', '#8DA0B4', '#3B4A5A'],
    edge: '#F4F8FC',
    outline: '#0C1319',
    inlay: '#7FE7FF',
  },
  /** Heavy gold. The default, and the one every casino falls back on. */
  gold: {
    face: ['#FFF0B8', '#F5C542', '#8A5F0A'],
    edge: '#FFF8DC',
    outline: '#1A1206',
    inlay: '#FFFFFF',
  },
  /** Painted timber and enamel: the fruit machines. */
  enamel: {
    face: ['#FFFFFF', '#E5473C', '#7A1109'],
    edge: '#FFE3E0',
    outline: '#2A0806',
    inlay: '#F5C542',
  },
};

export type MaterialName = keyof typeof MATERIALS;

/**
 * Which material each game is cut from.
 *
 * Assigned per GAME, never per maths model or art family — sharing those is
 * exactly what made the catalogue feel like one game, and a material shared by
 * two games that also share a symbol set would put them back there.
 */
export const GAME_MATERIAL: Record<string, MaterialName> = {
  'slot-frost-peak': 'ice',
  'slot-aurora-borealis': 'ice',
  'slot-city-lights': 'ice',

  'slot-desert-mirage': 'sandstone',
  'slot-pharaohs-vault': 'sandstone',
  'slot-spice-market': 'sandstone',

  'slot-neon-alley': 'neon',
  'slot-carnival-row': 'neon',
  'slot-sunset-strip': 'neon',

  'slot-jade-temple': 'jade',
  'slot-jungle-run': 'jade',
  'slot-emerald-nights': 'jade',

  'slot-dragons-hoard': 'ember',
  'slot-lucky-sevens': 'ember',
  'slot-supernova': 'ember',

  'slot-storm-chaser': 'gunmetal',
  'slot-vault-breaker': 'gunmetal',
  'slot-ocean-drift': 'gunmetal',

  'juwa-classic-slots': 'enamel',
  'slot-fruit-stand': 'enamel',

  'slot-royal-flush': 'gold',
  'slot-midnight-gold': 'gold',
  'slot-triple-bar': 'gold',
};

export function materialFor(gameId: string): Material {
  return MATERIALS[GAME_MATERIAL[gameId] ?? 'gold'] ?? MATERIALS['gold']!;
}
