/**
 * The cabinet — the slot machine's frame, and what it looks like during the
 * bonus round.
 *
 * When free spins start, the whole machine changes colour. That is not
 * decoration: the bonus round is the only part of a slot where the rules are
 * different (every win multiplied, spins that cost nothing), and a player who
 * cannot tell at a glance which mode they are in will misread their own
 * balance. The colour change is the mode indicator, and it happens to be the
 * most exciting two seconds in the game.
 *
 * ## Derived from each game's own theme, not one hardcoded colour
 *
 * The obvious version paints every bonus round the same red. It works, and it
 * throws away something already paid for: twenty-three games each carry a
 * three-colour theme. Deriving the bonus cabinet from that theme means
 * Dragon's Hoard goes deep red, Frost Peak goes glacial blue and Neon Alley
 * goes violet — the same *mechanic* everywhere, a different *look* per game,
 * for no extra data and no per-game art.
 *
 * ## The constraint that makes this non-trivial
 *
 * A theme colour is chosen to look good on a lobby tile, where it is the
 * subject. Behind the reels it is the background, and a saturated violet
 * behind a purple plum symbol makes the plum disappear. So the theme colour is
 * never used raw — but it is NOT simply darkened either, which was the first
 * attempt and was wrong in a way worth recording:
 *
 * Darkening by a fixed fraction works on a bright theme and destroys a dark
 * one. Half the catalogue's themes are already near-black, so they collapsed
 * to black — and since the base cabinet is itself a dark navy, Frost Peak's
 * "bonus" cabinet came out #0a132c against a base of #0B1330. The mode change
 * was invisible on precisely the games that needed it.
 *
 * Only the HUE is taken from the theme. Lightness and saturation are forced to
 * fixed targets, so a dark theme is lifted and a bright one pulled down, and
 * every game's bonus cabinet is equally readable and equally obviously
 * different. Only the colour varies, which is the point.
 *
 * `cabinet.test.ts` sweeps the entire hue circle at several saturations and
 * asserts the contrast invariants hold for every one, and separately checks
 * the six real themes most likely to break — so neither a theme added next
 * year nor one already in the catalogue can quietly produce an unreadable or
 * indistinguishable machine.
 */

import { contrastRatio, parseHex } from './contrast.js';

export interface GameTheme {
  primary: string;
  secondary: string;
  accent: string;
}

export interface CabinetPalette {
  /** The cabinet body, behind and around the reel bay. */
  background: string;
  /** The outer frame. */
  border: string;
  /** Halo colour for the frame. */
  glow: string;
  /** The recessed well the reels sit in. Always darker than the body. */
  bay: string;
}

function clamp255(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function toHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((c) => clamp255(c).toString(16).padStart(2, '0')).join('')}`;
}

/**
 * Blend two colours. `t` of 0 returns `from`, 1 returns `to`.
 *
 * Mixed in plain sRGB rather than a perceptual space. That is the wrong choice
 * for a gradient — sRGB blends darken and desaturate through the middle — and
 * the right one here, because darkening is exactly what is wanted: these
 * blends all run toward black, and sRGB's tendency to lose saturation on the
 * way keeps a vivid theme colour from staying vivid behind the symbols.
 */
export function mix(from: string, to: string, t: number): string {
  const a = parseHex(from);
  const b = parseHex(to);
  const k = Math.max(0, Math.min(1, t));
  return toHex(a.r + (b.r - a.r) * k, a.g + (b.g - a.g) * k, a.b + (b.b - a.b) * k);
}

const BLACK = '#000000';

/** The machine outside the bonus round. Deep navy and brass, for every game. */
export const BASE_CABINET: CabinetPalette = {
  background: '#0B1330',
  border: '#7A6425',
  glow: 'rgba(200, 164, 77, 0.45)',
  bay: '#05091A',
};

// --------------------------------------------------------------------- hsl

interface Hsl {
  h: number;
  s: number;
  l: number;
}

export function hexToHsl(hex: string): Hsl {
  const { r, g, b } = parseHex(hex);
  const [rn, gn, bn] = [r / 255, g / 255, b / 255];
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  const d = max - min;
  if (d === 0) return { h: 0, s: 0, l };
  const s = d / (1 - Math.abs(2 * l - 1));
  let h: number;
  if (max === rn) h = ((gn - bn) / d) % 6;
  else if (max === gn) h = (bn - rn) / d + 2;
  else h = (rn - gn) / d + 4;
  return { h: (h * 60 + 360) % 360, s, l };
}

export function hslToHex({ h, s, l }: Hsl): string {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] =
    h < 60 ? [c, x, 0]
    : h < 120 ? [x, c, 0]
    : h < 180 ? [0, c, x]
    : h < 240 ? [0, x, c]
    : h < 300 ? [x, 0, c]
    : [c, 0, x];
  return toHex((r + m) * 255, (g + m) * 255, (b + m) * 255);
}

/**
 * How much colour a hue actually carries to the eye.
 *
 * Plain saturation is misleading at the ends of the lightness range: near-black
 * and near-white both have a hue in the arithmetic and none in practice.
 * Weighting by distance from those ends is what stops a #18181B grey being
 * treated as a colour.
 */
export function vividness(colour: string): number {
  const { s, l } = hexToHsl(colour);
  return s * (1 - Math.abs(2 * l - 1));
}

/** Below this, a colour has no hue worth building a machine out of. */
const VIVID_ENOUGH = 0.15;

/**
 * The first colour with a usable hue, in order of preference.
 *
 * ORDER, NOT MAXIMUM, and the difference is the whole identity of the feature.
 * Picking the most saturated token sounds better and collapses the catalogue:
 * most themes share `accent: '#FFC53D'`, so gold wins nearly every comparison
 * and the violet game and the red game both end up with the same gold cabinet.
 *
 * Preference order puts each game's own colour first and only falls through
 * when it genuinely has none — Vault Breaker is deliberately monochrome, so it
 * falls past its grey primary and grey secondary to its cyan accent.
 */
export function firstVivid(...colours: string[]): string {
  for (const colour of colours) {
    if (vividness(colour) >= VIVID_ENOUGH) return colour;
  }
  // Nothing usable anywhere. Take the best of a bad set rather than the first.
  let best = colours[0]!;
  let bestS = -1;
  for (const colour of colours) {
    const usable = vividness(colour);
    if (usable > bestS) {
      bestS = usable;
      best = colour;
    }
  }
  return best;
}

/**
 * Where the bonus cabinet lands, regardless of what it was built from.
 *
 * NORMALISED, NOT DARKENED, and that distinction is the whole reason this
 * function is not two calls to `mix`. Darkening by a fixed fraction works for
 * a bright theme and destroys a dark one: Dragon's Hoard starts at #450A0A and
 * lands on #160303, and Frost Peak's #1E3A8A produced #0a132c against a base
 * of #0B1330 — a "mode change" the player cannot see at all.
 *
 * Forcing a target lightness instead lifts the dark themes and pulls down the
 * bright ones, so every game's bonus cabinet is equally readable and equally
 * obviously different, and only the hue varies.
 */
const BODY = { s: 0.5, l: 0.2 };
const BAY = { s: 0.45, l: 0.075 };

/** The machine during free spins, derived from the game's own theme. */
export function bonusCabinet(theme: GameTheme): CabinetPalette {
  // Primary first: it is the game's own identity, and the accent is shared
  // across most of the catalogue.
  const { h } = hexToHsl(firstVivid(theme.primary, theme.secondary, theme.accent));
  // The frame stays vivid: it is a thin line on a dark body, so it can carry
  // the intensity, and it is what makes the mode change read at a glance.
  // Secondary first for the same reason — the accent is the fallback.
  const border = firstVivid(theme.secondary, theme.accent, theme.primary);
  return {
    background: hslToHex({ h, ...BODY }),
    border,
    glow: border,
    bay: hslToHex({ h, ...BAY }),
  };
}

/**
 * The minimum contrast a symbol needs against the surface behind it.
 *
 * Symbols are large, high-detail artwork with their own dark outlines, so the
 * 4.5:1 demanded of body text is the wrong bar. 3:1 is WCAG's large-text
 * threshold and is the right one for a 58px illustrated symbol.
 */
export const MIN_SYMBOL_CONTRAST = 3;

/**
 * Does this cabinet keep the reels readable?
 *
 * Checked against white, which is the brightest thing in the symbol set and
 * therefore the one most at risk of washing out on a light background — and
 * against the gold used for the frame and the win figures.
 */
export function cabinetIsLegible(palette: CabinetPalette): boolean {
  return (
    contrastRatio('#FFFFFF', palette.bay) >= MIN_SYMBOL_CONTRAST &&
    contrastRatio('#C8A44D', palette.bay) >= MIN_SYMBOL_CONTRAST
  );
}
