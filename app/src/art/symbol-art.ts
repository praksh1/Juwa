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

import { assetDisplayName } from '@juwa/ui';

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
  // The classic fruit machine. Its DIAMOND is a stack of ingots rather than a
  // gem, because a fruit machine's high symbol has always been metal — and the
  // ingots stay clearly distinct from the three flat BAR plates, which are a
  // different symbol at a different value and are still drawn as vector.
  fruit: {
    DIAMOND: `${ART}/fruit_bars.png`,
    BELL: `${ART}/fruit_bell.png`,
    CHERRY: `${ART}/fruit_cherries.png`,
    PLUM: `${ART}/fruit_plum.png`,
    LEMON: `${ART}/fruit_lemon.png`,
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
 * What to CALL a symbol on screen.
 *
 * The engine deals nine fixed ids and a theme redraws five of them, so under
 * the pirate family the symbol the engine calls LEMON is a pirate's hat and
 * the one it calls CHERRY is a compass. The win badge was printing the engine
 * id, so a win on four hats announced itself as "4x LEMON" over a machine with
 * no lemon anywhere on it. A player reported it as the machine paying for
 * symbols that were not there, which is exactly what it looked like, and is
 * the single worst thing a slot can appear to do.
 *
 * The name is derived from the ASSET FILENAME rather than from a table written
 * alongside it. `pirate_hat.png` is already the answer; a hand-kept list of
 * forty-five names is just a second place for the truth to live, and the first
 * time an artist swaps an image the list is wrong in precisely the way this
 * function exists to prevent.
 *
 * Falls back to the engine id, which is correct where it is also what is drawn:
 * SEVEN, BAR, WILD and SCATTER are never re-skinned, and an unthemed game is
 * meant to look like a fruit machine and does show a lemon.
 */
export function symbolDisplayName(family: string | undefined, symbol: string): string {
  return assetDisplayName(symbolImage(family, symbol), symbol);
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
