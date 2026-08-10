/**
 * Which five symbols each game deals, and what colour they are.
 *
 * Keyed by GAME, never by theme family or maths model. That is the whole
 * point: sharing a family is what made Frost Peak deal a flame, and sharing a
 * model is what made two games with different names play identically. A game
 * listed here deals nothing any other game deals.
 *
 * ## Which games are here, and why only these
 *
 * The catalogue has eight painted symbol sets. Most of them are RIGHT for the
 * game using them — Desert Mirage's pharaoh, Jungle Run's tiger, Dragon's
 * Hoard's dragon — and painted art beats drawn art when it fits, so those are
 * left alone.
 *
 * These eight are the ones where the art was flatly wrong for the game:
 *
 *   - the six sharing `orb`, a set of abstract medallions. Frost Peak is a
 *     frozen cavern and was dealing a flame and a boiled sweet; Carnival Row
 *     is a fairground and was dealing a galaxy.
 *   - Ocean Drift, a mermaid on its own lobby tile, dealing a pirate's hat and
 *     a cannon borrowed from a mining game.
 *   - Emerald Nights, a moonlit emerald mine, dealing a tiger and a gorilla
 *     borrowed from Jungle Run.
 *
 * The rest of the catalogue still shares sets between two or three games and
 * that is the next thing to fix, along with the painted heroes listed in
 * `docs/art-manifest.md`. It is a smaller problem than a game dealing symbols
 * from a different genre entirely.
 *
 * ## Pay order is the paytable, not a preference
 *
 * DIAMOND pays most and LEMON least, so each set lists its five in that order
 * and the art has to agree. A cheap symbol that looks more valuable than an
 * expensive one makes players misread the paytable and feel cheated, which
 * arrives as a support ticket rather than as a style note.
 */

import type { MotifPalette } from './motifs';

/** The five engine symbols a game re-skins, richest first. */
export const PICTURE_SYMBOLS = ['DIAMOND', 'BELL', 'CHERRY', 'PLUM', 'LEMON'] as const;
export type PictureSymbol = (typeof PICTURE_SYMBOLS)[number];

export interface GameMotifs {
  palette: MotifPalette;
  symbols: Record<PictureSymbol, string>;
}

export const GAME_MOTIFS: Record<string, GameMotifs> = {
  /** A frozen mountain cavern. Nothing warm, which is what it was dealing. */
  'slot-frost-peak': {
    palette: {
      id: 'frost',
      light: '#F2FBFF',
      mid: '#8FD3F5',
      deep: '#2E7FB8',
      outline: '#062033',
      accent: '#7FF0FF',
    },
    symbols: {
      DIAMOND: 'ice_peak',
      BELL: 'snowflake',
      CHERRY: 'ice_crystal',
      PLUM: 'icicles',
      LEMON: 'frost_fern',
    },
  },

  /** A reef with a mermaid in it — which is what its own lobby tile shows. */
  'slot-ocean-drift': {
    palette: {
      id: 'reef',
      light: '#EAFFF9',
      mid: '#43CBBE',
      deep: '#0E6A63',
      outline: '#02201D',
      accent: '#FFD9A8',
    },
    symbols: {
      DIAMOND: 'mermaid_tail',
      BELL: 'scallop',
      CHERRY: 'pearl_oyster',
      PLUM: 'starfish',
      LEMON: 'waves',
    },
  },

  /** A night carnival: tents, lights, painted tin. */
  'slot-carnival-row': {
    palette: {
      id: 'carnival',
      light: '#FFF1DA',
      mid: '#F0554B',
      deep: '#8E1730',
      outline: '#2A0710',
      accent: '#FFD447',
    },
    symbols: {
      DIAMOND: 'ferris_wheel',
      BELL: 'big_top',
      CHERRY: 'harlequin_mask',
      PLUM: 'candy_floss',
      LEMON: 'balloon',
    },
  },

  /** A rain-slick neon back alley. Hollow glass and hot gas. */
  'slot-neon-alley': {
    palette: {
      id: 'alley',
      light: '#FFFFFF',
      mid: '#FF5FD2',
      deep: '#7A1A6C',
      outline: '#14031A',
      accent: '#3BF0FF',
    },
    symbols: {
      DIAMOND: 'neon_arrow',
      BELL: 'neon_cocktail',
      CHERRY: 'neon_heart',
      PLUM: 'street_lamp',
      LEMON: 'neon_bolt',
    },
  },

  /** A star going supernova: plasma, orbiting rock, deep space. */
  'slot-supernova': {
    palette: {
      id: 'nova',
      light: '#FFF3D0',
      mid: '#FF7A45',
      deep: '#66197A',
      outline: '#120429',
      accent: '#7FE7FF',
    },
    symbols: {
      DIAMOND: 'nova_burst',
      BELL: 'ringed_planet',
      CHERRY: 'comet',
      PLUM: 'asteroid',
      LEMON: 'star_cluster',
    },
  },

  /** An arctic night under the northern lights. */
  'slot-aurora-borealis': {
    palette: {
      id: 'aurora',
      light: '#EAFFF4',
      mid: '#57E39B',
      deep: '#2B4FA8',
      outline: '#04121F',
      accent: '#C89BFF',
    },
    symbols: {
      DIAMOND: 'wolf_head',
      BELL: 'full_moon',
      CHERRY: 'aurora_wave',
      PLUM: 'pine_trees',
      LEMON: 'north_star',
    },
  },

  /** Glass towers at night: chrome, champagne, cold light. */
  'slot-city-lights': {
    palette: {
      id: 'city',
      light: '#FFFFFF',
      mid: '#B9D2E8',
      deep: '#3F5B70',
      outline: '#08131B',
      accent: '#FFD86B',
    },
    symbols: {
      DIAMOND: 'skyline',
      BELL: 'champagne',
      CHERRY: 'diamond_ring',
      PLUM: 'wrist_watch',
      LEMON: 'top_hat',
    },
  },

  /** A moonlit emerald mine: green stone, silver, black velvet. */
  'slot-emerald-nights': {
    palette: {
      id: 'emerald',
      light: '#E8FFF0',
      mid: '#3FD48A',
      deep: '#0B5C3C',
      outline: '#021A10',
      accent: '#E6E9EF',
    },
    symbols: {
      DIAMOND: 'emerald_gem',
      BELL: 'mine_lantern',
      CHERRY: 'pickaxe',
      PLUM: 'crescent_moon',
      LEMON: 'ore_chunk',
    },
  },
};

/** The motif a game draws for a symbol, or nothing if it has none. */
export function motifFor(gameId: string | undefined, symbol: string): string | undefined {
  if (!gameId) return undefined;
  return GAME_MOTIFS[gameId]?.symbols[symbol as PictureSymbol];
}

export function paletteFor(gameId: string | undefined): MotifPalette | undefined {
  if (!gameId) return undefined;
  return GAME_MOTIFS[gameId]?.palette;
}

/**
 * What to CALL a motif on screen.
 *
 * Derived from the motif's own name rather than from a second table beside it.
 * The win badge announces what is DRAWN — "4x Snowflake" — because announcing
 * the engine's id produced "4x LEMON" over a reel with no lemon on it, which
 * players reported as the machine paying for symbols that were not there.
 */
export function motifDisplayName(gameId: string | undefined, symbol: string): string | undefined {
  const motif = motifFor(gameId, symbol);
  if (!motif) return undefined;
  return motif
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}
