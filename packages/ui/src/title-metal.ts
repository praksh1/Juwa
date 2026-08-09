/**
 * The ink a lobby tile's name is written in.
 *
 * Every tile in the catalogue was drawn with a blank sign on it, and for a long
 * time all 23 names were set in the same bold sans in one of two colours: black
 * if the sign was light, cream if it was dark. That is legibility, and it is
 * the whole of what a contrast check can tell you. It is not what a name on a
 * slot cabinet looks like. Cabinet lettering is *cast*: a bright top edge where
 * the light hits, a saturated body, a dark underside, and a hard rim that keeps
 * it off the background. Two flat colours cannot do any of that.
 *
 * So each name is given a metal, and the metal comes from the tile's own
 * dominant colour — measured off the artwork at build time, not guessed. A
 * jade temple gets emerald lettering, a snowfield gets ice, a dragon's hoard
 * gets copper. The lobby stops looking like one template filled in 23 times.
 *
 * ## Why the hue is snapped rather than used directly
 *
 * A measured hue is a real number and most of them do not look like a metal.
 * Set a name in hsl(83°) at the saturation this needs and it reads as green
 * plastic; hsl(310°) reads as a highlighter pen. Real metals occupy a handful
 * of narrow bands, so the measured hue picks the NEAREST of seven and takes
 * that band's own saturation with it. The tile still chooses its colour; it
 * just cannot choose one that stops looking like metal.
 *
 * ## Why brightness flips the whole ramp rather than one colour
 *
 * On a dark sign the lettering is polished metal catching light — pale at the
 * top, deep at the bottom. On a bright gold sign that same lettering is
 * invisible, and the answer is not "make it darker": it is that the letters are
 * now *engraved into* the plaque rather than sitting on it, which is a dark
 * body with a light rim, the reverse ramp. Both are metallic; which one is
 * correct is decided by the sign underneath.
 */

import { hslToHex, mix } from './cabinet.js';

export interface TitleMetal {
  /** Gradient stop at the top of the letterforms. */
  top: string;
  /** Gradient stop across the middle — the body colour of the metal. */
  mid: string;
  /** Gradient stop at the baseline. */
  bottom: string;
  /** Outline stroke, drawn under the fill so it reads as an edge not a border. */
  rim: string;
  /** Soft halo behind the word, separating it from a busy sign. */
  halo: string;
  /** Which metal was chosen. Exposed for tests and for debugging a tile. */
  name: MetalName;
}

export type MetalName = 'copper' | 'gold' | 'emerald' | 'teal' | 'ice' | 'violet' | 'rose';

/**
 * The metals, as hue and the saturation that hue looks metallic at.
 *
 * Saturation is per-metal rather than one constant because the eye does not
 * treat the wheel evenly: gold survives — needs — a saturation that would make
 * the same lightness of blue look like a cartoon.
 */
const METALS: readonly { name: MetalName; hue: number; sat: number }[] = [
  { name: 'copper', hue: 24, sat: 0.72 },
  { name: 'gold', hue: 43, sat: 0.85 },
  { name: 'emerald', hue: 150, sat: 0.6 },
  { name: 'teal', hue: 183, sat: 0.58 },
  { name: 'ice', hue: 208, sat: 0.55 },
  { name: 'violet', hue: 275, sat: 0.52 },
  { name: 'rose', hue: 348, sat: 0.66 },
];

/** Shortest distance between two hues, going whichever way round is closer. */
function hueGap(a: number, b: number): number {
  const d = Math.abs(((a - b) % 360 + 360) % 360);
  return Math.min(d, 360 - d);
}

export function nearestMetal(hue: number): (typeof METALS)[number] {
  let best = METALS[0]!;
  for (const metal of METALS) {
    if (hueGap(hue, metal.hue) < hueGap(hue, best.hue)) best = metal;
  }
  return best;
}

/**
 * The threshold at which a sign counts as bright.
 *
 * Deliberately below the midpoint. The failure that matters is dark-on-dark —
 * a name that has simply vanished, which is what the player reported — and it
 * happens on mid-luminance signs where a "dark ink" ramp still technically
 * passes a contrast check against the average of a mottled background.
 */
export const BRIGHT_SIGN = 0.5;

export function titleMetal(hue: number, luminance: number): TitleMetal {
  const { name, hue: h, sat: s } = nearestMetal(hue);

  if (luminance > BRIGHT_SIGN) {
    // Engraved: dark body, light rim, on a bright plaque.
    return {
      name,
      top: hslToHex({ h, s: s * 0.85, l: 0.34 }),
      mid: hslToHex({ h, s, l: 0.21 }),
      bottom: hslToHex({ h, s, l: 0.11 }),
      rim: hslToHex({ h, s: s * 0.35, l: 0.93 }),
      halo: hslToHex({ h, s: s * 0.22, l: 0.97 }),
    };
  }

  // Raised: polished metal on a dark sign.
  return {
    name,
    top: hslToHex({ h, s: s * 0.6, l: 0.95 }),
    mid: hslToHex({ h, s, l: 0.68 }),
    bottom: hslToHex({ h, s, l: 0.44 }),
    rim: hslToHex({ h, s: s * 0.8, l: 0.07 }),
    halo: hslToHex({ h, s: s * 0.7, l: 0.05 }),
  };
}

/**
 * How strongly the halo covers whatever is behind the word.
 *
 * The halo is not a filter — it is the same word drawn once more underneath in
 * a very fat stroke, which is how WinLines makes a drawn line read as a lit
 * one. Anything glow-shaped needs a real blur, and blur filters are the part of
 * SVG that behaves differently on every renderer; a fat translucent stroke
 * looks near enough and behaves identically everywhere.
 */
export const HALO_OPACITY = 0.55;

/**
 * What the lettering is really sitting on.
 *
 * Not the sign — the sign seen through the halo. A palette judged against the
 * bare artwork is being judged against a background that is never actually
 * behind the letters, and on the mid-brightness signs (three tiles measure
 * between 0.42 and 0.53, which is the hardest case there is) that difference
 * decides whether the name reads.
 */
export function effectiveGround(ground: string, metal: TitleMetal): string {
  return mix(ground, metal.halo, HALO_OPACITY);
}

/**
 * A rough width for a word set in the display face, in multiples of its size.
 *
 * SVG has no way to ask "how wide will this be" before it is laid out, and the
 * name has to be fitted to the sign before it is drawn. So it is estimated, and
 * the estimate is deliberately generous: over-estimating sets the name a few
 * points smaller than it had to be, while under-estimating runs it off the end
 * of the plaque. One of those is invisible and the other is the bug being
 * fixed.
 *
 * The widths below are for a heavy grotesque at its NORMAL width, not the
 * condensed one the display stack asks for first. That is deliberate. Archivo
 * Black is named first and is not bundled — there is no webfont fetch in this
 * build — so what a phone actually renders is whichever heavy face it happens
 * to own, and iOS owns none of the named ones. It falls all the way through to
 * the system grotesque, which is a fifth wider than the face the first version
 * of this function was measured against. Every long name in the lobby was
 * clipped at both ends.
 *
 * Measured in a browser at 100px, as a fraction of the point size: I is 0.278,
 * W is 0.944, and an average capital is 0.70. The figures used are rounded up
 * from those, because being wrong high costs a name two points of size and
 * being wrong low cuts the first letter off it.
 */
export function displayWidth(text: string, letterSpacing = 0.06): number {
  let units = 0;
  for (const ch of text.toUpperCase()) {
    if (ch === ' ') units += 0.28;
    else if ('IJL1.,\'’!:;|'.includes(ch)) units += 0.34;
    else if ('FTZ'.includes(ch)) units += 0.62;
    else if ('MW'.includes(ch)) units += 0.98;
    else units += 0.78;
  }
  return units + letterSpacing * Math.max(0, text.length - 1);
}
