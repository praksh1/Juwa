/**
 * Which picture stands in for which engine symbol, per theme family.
 *
 * The engine deals nine symbols — WILD, SCATTER, SEVEN, DIAMOND, BELL, BAR,
 * CHERRY, PLUM, LEMON — and knows nothing about art. A family re-skins the five
 * PICTURE symbols; the other four keep the vector drawings in `SlotSymbol.tsx`.
 *
 * WHY THOSE FOUR STAY VECTOR
 *
 * SEVEN and BAR are typography, and image generators are unreliable with
 * letterforms. WILD and SCATTER must be recognisable across every theme —
 * re-skinning them per family would mean a player relearning the two symbols
 * that decide whether a spin was interesting. All four also need to stay
 * legible at 90px on a moving reel, which is exactly where a rendered glyph
 * beats a photograph of one.
 *
 * ORDER IS THE PAYTABLE, NOT A PREFERENCE
 *
 * DIAMOND pays most and LEMON least, so each family lists its five from most
 * to least valuable and the art must agree: a pharaoh outranks a pyramid, a
 * tiger outranks an orchid. If the cheap symbol looks more lavish than the
 * expensive one, players misread the paytable and feel cheated — which arrives
 * as a support ticket, not as a style note.
 */

/** The five engine symbols a family re-skins, in descending pay order. */
export const PICTURE_SYMBOLS = ['DIAMOND', 'BELL', 'CHERRY', 'PLUM', 'LEMON'] as const;
export type PictureSymbol = (typeof PICTURE_SYMBOLS)[number];

/** Served from `app/public/art`, so these are absolute site paths. */
const ART = '/art/symbols';

export const SYMBOL_FAMILIES: Record<string, Record<PictureSymbol, string>> = {
  egypt: {
    DIAMOND: `${ART}/egypt_pharaoh.png`,
    BELL: `${ART}/egypt_anubis.png`,
    CHERRY: `${ART}/egypt_eye_of_horus.png`,
    PLUM: `${ART}/egypt_scarab.png`,
    LEMON: `${ART}/egypt_pyramid.png`,
  },
  pirate: {
    DIAMOND: `${ART}/pirate_captain.png`,
    BELL: `${ART}/pirate_treasure_chest.png`,
    CHERRY: `${ART}/pirate_compass.png`,
    PLUM: `${ART}/pirate_cannon.png`,
    LEMON: `${ART}/pirate_hat.png`,
  },
  wildwest: {
    DIAMOND: `${ART}/wildwest_sheriff.png`,
    BELL: `${ART}/wildwest_sheriff_badge.png`,
    CHERRY: `${ART}/wildwest_revolver.png`,
    PLUM: `${ART}/wildwest_cowboy_hat.png`,
    LEMON: `${ART}/wildwest_horseshoe.png`,
  },
  asian: {
    DIAMOND: `${ART}/asian_golden_dragon.png`,
    BELL: `${ART}/asian_lucky_cat.png`,
    CHERRY: `${ART}/asian_ancient_gold_coin.png`,
    PLUM: `${ART}/asian_red_lantern.png`,
    LEMON: `${ART}/asian_folding_fan.png`,
  },
  jungle: {
    DIAMOND: `${ART}/jungle_tiger.png`,
    BELL: `${ART}/jungle_gorilla.png`,
    CHERRY: `${ART}/jungle_monkey.png`,
    PLUM: `${ART}/jungle_parrot.png`,
    LEMON: `${ART}/jungle_orchid.png`,
  },
  myth: {
    DIAMOND: `${ART}/myth_zeus.png`,
    BELL: `${ART}/myth_pegasus.png`,
    CHERRY: `${ART}/myth_temple.png`,
    PLUM: `${ART}/myth_laurel.png`,
    LEMON: `${ART}/myth_lightning.png`,
  },
  // Abstract medallions, for the themes that are a mood rather than a place —
  // Aurora, Supernova, Neon Alley. A literal subject would fight the name.
  orb: {
    DIAMOND: `${ART}/orb_galaxy.png`,
    BELL: `${ART}/orb_flame.png`,
    CHERRY: `${ART}/orb_neon_knot.png`,
    PLUM: `${ART}/orb_ice_crystal.png`,
    LEMON: `${ART}/orb_candy.png`,
  },
};

export type SymbolFamily = keyof typeof SYMBOL_FAMILIES;

/**
 * The image for a symbol, or nothing.
 *
 * Nothing is a legitimate answer and the caller must handle it: a game with no
 * family assigned — the classic fruit-machine titles — is meant to keep the
 * vector art, and a family that is half-delivered should show vectors for the
 * gaps rather than holes.
 */
export function symbolImage(family: string | undefined, symbol: string): string | undefined {
  if (!family) return undefined;
  const set = SYMBOL_FAMILIES[family];
  if (!set) return undefined;
  return (set as Record<string, string>)[symbol];
}

/**
 * Every image, for preloading.
 *
 * A symbol that loads mid-spin pops in against an empty cell, which reads as a
 * glitch on the one screen where players are watching most closely.
 */
export function familyImages(family: string | undefined): string[] {
  if (!family) return [];
  const set = SYMBOL_FAMILIES[family];
  return set ? Object.values(set) : [];
}
