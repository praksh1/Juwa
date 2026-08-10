/**
 * The card royals — A, K, Q, J, 10 — cut from each game's material.
 *
 * These are the low symbols on almost every slot ever built, including the one
 * this project is being measured against: look at its Egyptian game and the
 * reels are Q, J, A, 10, K in carved sandstone, with four painted characters
 * above them. The royals are not filler. They are most of what is on the screen
 * most of the time, and rendering them in the game's own substance is most of
 * why one game does not look like the next.
 *
 * Drawn rather than painted, for a reason that is practical rather than
 * aesthetic: they are TYPOGRAPHY. A letterform is a shape, a shape is a path,
 * and a path costs nothing to ship, stays sharp at any size and can be recut in
 * a new material by changing four colours. Painting five royals for
 * twenty-three games would be 115 images that all say "A".
 *
 * What is NOT here, and must still be painted: the picture symbols. A pharaoh,
 * a dragon, a mermaid. Those carry the theme and no amount of vector drawing
 * substitutes for them.
 */

import React from 'react';
import Svg, { Defs, LinearGradient, Path, Stop, Text as SvgText } from 'react-native-svg';
import type { Material } from './materials';

/** The five glyphs, in descending pay order, as a slot deals them. */
export const ROYALS = ['A', 'K', 'Q', 'J', '10'] as const;
export type Royal = (typeof ROYALS)[number];

/**
 * A royal, cut from a material.
 *
 * Four passes, which is what makes it read as an object rather than as text:
 * a soft halo where the material has one, a deep outline, the cut edge offset
 * a shade below the face, and the graded face on top. Exactly the construction
 * the lobby titles use, for exactly the same reason.
 */
export function RoyalSymbol({
  glyph,
  material,
  size,
}: {
  glyph: Royal;
  material: Material;
  size: number;
}) {
  const id = `royal-${glyph}-${material.outline.slice(1)}`;
  // "10" is two characters and has to be set smaller or it overflows the cell
  // while every other royal sits comfortably inside it.
  const fontSize = glyph === '10' ? 56 : 68;

  const common = {
    x: 50,
    y: 71,
    fontSize,
    fontWeight: '900' as const,
    fontFamily: "'Archivo Black', Impact, 'Arial Narrow Bold', sans-serif",
    textAnchor: 'middle' as const,
  };

  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      <Defs>
        <LinearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={material.face[0]} />
          <Stop offset="0.45" stopColor={material.face[1]} />
          <Stop offset="1" stopColor={material.face[2]} />
        </LinearGradient>
      </Defs>

      {/* The plate the glyph is cut into. Without it a royal floats, and the
          reference cabinets all mount theirs on something. */}
      <Path
        d="M18,14 H82 A6,6 0 0 1 88,20 V80 A6,6 0 0 1 82,86 H18 A6,6 0 0 1 12,80 V20 A6,6 0 0 1 18,14 Z"
        fill={material.outline}
        opacity={0.34}
      />

      {material.halo ? (
        <SvgText {...common} fill="none" stroke={material.halo} strokeWidth={9} strokeOpacity={0.4} strokeLinejoin="round">
          {glyph}
        </SvgText>
      ) : null}
      <SvgText {...common} fill="none" stroke={material.outline} strokeWidth={7} strokeLinejoin="round">
        {glyph}
      </SvgText>
      {/* The cut edge, a shade proud of the face. */}
      <SvgText {...common} y={common.y + 1.6} fill={material.edge}>
        {glyph}
      </SvgText>
      <SvgText {...common} fill={`url(#${id})`}>
        {glyph}
      </SvgText>
      {/* One bright inlay: a chip of gem, a filament, a spark of turquoise. */}
      <Path
        d="M50,8 L53.4,15 L61,16 L55.5,21.4 L56.8,29 L50,25.4 L43.2,29 L44.5,21.4 L39,16 L46.6,15 Z"
        fill={material.inlay}
        opacity={0.92}
      />
    </Svg>
  );
}

/**
 * Which engine symbol each royal stands in for.
 *
 * The engine deals nine fixed ids and knows nothing about art, so the three
 * cheapest picture symbols become the three cheapest royals. Pay order is
 * preserved exactly — CHERRY outranks PLUM outranks LEMON, and A outranks K
 * outranks Q — because a paytable that ranks its symbols differently from the
 * way they look is the fastest way to make a player feel cheated.
 */
export const ROYAL_FOR_SYMBOL: Record<string, Royal> = {
  CHERRY: 'A',
  PLUM: 'K',
  LEMON: 'Q',
};
