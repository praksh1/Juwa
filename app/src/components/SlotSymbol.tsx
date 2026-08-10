/**
 * Slot machine symbols.
 *
 * These were emoji — 🍒 🍋 🎰 ⭐ — rendered at 32pt. Emoji are drawn by the
 * operating system, so they changed shape between iOS, Android and Chrome, they
 * carried the wrong visual weight next to each other, and they are the single
 * clearest signal that nobody designed the machine. A slot's symbols are its
 * face; there is no version of this that works as a font fallback.
 *
 * Drawn instead as vectors, on one shared grammar so a reel reads as a set:
 *   - 100x100 viewBox, subject inset to ~14 units of padding.
 *   - Every symbol has a dark outline and one internal highlight, so it holds
 *     up against both the dark reel and the gold win-highlight behind it.
 *   - Jewel tones and metal, no pastels. The palette is deliberately narrower
 *     than the app's, because five reels of competing colour reads as noise.
 */

import React from 'react';
import { Image } from 'react-native';
import Svg, { Circle, Defs, Ellipse, G, LinearGradient, Path, Rect, Stop } from 'react-native-svg';
import { symbolDisplayName, symbolImage } from '../art/symbol-art';

const uid = (symbol: string, name: string) => `sym-${symbol}-${name}`;

/** Shared metal gradient, used by every gold element so they match exactly. */
function GoldDef({ id }: { id: string }) {
  return (
    <LinearGradient id={id} x1="0" y1="0" x2="0" y2="1">
      <Stop offset="0" stopColor="#FFF0B8" />
      <Stop offset="0.42" stopColor="#F5C542" />
      <Stop offset="0.7" stopColor="#D19A1E" />
      <Stop offset="1" stopColor="#8A5F0A" />
    </LinearGradient>
  );
}

const OUTLINE = '#1A1206';
const OUTLINE_W = 3;

function Seven() {
  const s = 'seven';
  return (
    <>
      <Defs>
        <GoldDef id={uid(s, 'gold')} />
      </Defs>
      <Path
        d="M28,18 H76 L48,86 H30 L54,34 H28 Z"
        fill={`url(#${uid(s, 'gold')})`}
        stroke={OUTLINE}
        strokeWidth={OUTLINE_W}
        strokeLinejoin="round"
      />
      <Path d="M33,23 H68 L64,31 H33 Z" fill="#FFFFFF" opacity={0.35} />
    </>
  );
}

function Diamond() {
  const s = 'diamond';
  return (
    <>
      <Defs>
        <LinearGradient id={uid(s, 'body')} x1="0" y1="0" x2="0.4" y2="1">
          <Stop offset="0" stopColor="#BEF3FF" />
          <Stop offset="0.45" stopColor="#3EC8F0" />
          <Stop offset="1" stopColor="#0C6E97" />
        </LinearGradient>
      </Defs>
      <Path
        d="M50,88 L14,44 L28,18 H72 L86,44 Z"
        fill={`url(#${uid(s, 'body')})`}
        stroke={OUTLINE}
        strokeWidth={OUTLINE_W}
        strokeLinejoin="round"
      />
      {/* Facets. Straight lines only — a gem reads as cut, not as a blob. */}
      <Path d="M14,44 H86" stroke={OUTLINE} strokeWidth={2} opacity={0.55} />
      <Path d="M28,18 L38,44 L50,88 L62,44 L72,18" stroke={OUTLINE} strokeWidth={2} fill="none" opacity={0.55} />
      <Path d="M28,18 H72 L62,44 H38 Z" fill="#FFFFFF" opacity={0.28} />
    </>
  );
}

function Bell() {
  const s = 'bell';
  return (
    <>
      <Defs>
        <GoldDef id={uid(s, 'gold')} />
      </Defs>
      <Path
        d="M50,14 C30,14 26,34 26,52 C26,64 20,68 20,72 H80 C80,68 74,64 74,52 C74,34 70,14 50,14 Z"
        fill={`url(#${uid(s, 'gold')})`}
        stroke={OUTLINE}
        strokeWidth={OUTLINE_W}
        strokeLinejoin="round"
      />
      <Circle cx={50} cy={80} r={8} fill={`url(#${uid(s, 'gold')})`} stroke={OUTLINE} strokeWidth={OUTLINE_W} />
      <Path d="M38,28 C34,38 33,50 34,62" stroke="#FFFFFF" strokeWidth={5} opacity={0.4} fill="none" strokeLinecap="round" />
    </>
  );
}

function Bar() {
  const s = 'bar';
  return (
    <>
      <Defs>
        <GoldDef id={uid(s, 'gold')} />
        <LinearGradient id={uid(s, 'plate')} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#2C2C34" />
          <Stop offset="1" stopColor="#101015" />
        </LinearGradient>
      </Defs>
      {[0, 1, 2].map((i) => (
        <G key={i}>
          <Rect
            x={16}
            y={20 + i * 22}
            width={68}
            height={17}
            rx={4}
            fill={`url(#${uid(s, 'plate')})`}
            stroke={OUTLINE}
            strokeWidth={OUTLINE_W}
          />
          <Rect x={20} y={23 + i * 22} width={60} height={5} rx={2.5} fill={`url(#${uid(s, 'gold')})`} />
        </G>
      ))}
    </>
  );
}

function Cherry() {
  const s = 'cherry';
  return (
    <>
      <Defs>
        <LinearGradient id={uid(s, 'fruit')} x1="0.3" y1="0" x2="0.7" y2="1">
          <Stop offset="0" stopColor="#FF5C6E" />
          <Stop offset="0.5" stopColor="#D6203A" />
          <Stop offset="1" stopColor="#7A0A1C" />
        </LinearGradient>
      </Defs>
      <Path
        d="M50,20 C60,32 74,34 80,42 M50,20 C42,34 30,40 26,52"
        stroke="#2F7D32"
        strokeWidth={5}
        fill="none"
        strokeLinecap="round"
      />
      <Path d="M44,16 C54,10 66,12 72,20 C62,24 50,22 44,16 Z" fill="#3E9142" stroke={OUTLINE} strokeWidth={2} />
      <Circle cx={30} cy={66} r={17} fill={`url(#${uid(s, 'fruit')})`} stroke={OUTLINE} strokeWidth={OUTLINE_W} />
      <Circle cx={72} cy={58} r={14} fill={`url(#${uid(s, 'fruit')})`} stroke={OUTLINE} strokeWidth={OUTLINE_W} />
      <Ellipse cx={24} cy={60} rx={5} ry={3.5} fill="#FFFFFF" opacity={0.5} transform="rotate(-30 24 60)" />
      <Ellipse cx={67} cy={53} rx={4} ry={2.8} fill="#FFFFFF" opacity={0.45} transform="rotate(-30 67 53)" />
    </>
  );
}

function Plum() {
  const s = 'plum';
  return (
    <>
      <Defs>
        <LinearGradient id={uid(s, 'fruit')} x1="0.3" y1="0" x2="0.7" y2="1">
          <Stop offset="0" stopColor="#C89CFF" />
          <Stop offset="0.5" stopColor="#7B3FC4" />
          <Stop offset="1" stopColor="#3B0F63" />
        </LinearGradient>
      </Defs>
      <Path d="M52,26 C56,16 66,10 76,12" stroke="#2F7D32" strokeWidth={5} fill="none" strokeLinecap="round" />
      <Path d="M52,22 C62,14 76,16 82,24 C70,30 56,28 52,22 Z" fill="#3E9142" stroke={OUTLINE} strokeWidth={2} />
      <Circle cx={48} cy={58} r={28} fill={`url(#${uid(s, 'fruit')})`} stroke={OUTLINE} strokeWidth={OUTLINE_W} />
      <Path d="M48,32 C42,44 42,72 48,86" stroke={OUTLINE} strokeWidth={2.5} fill="none" opacity={0.5} />
      <Ellipse cx={37} cy={47} rx={7} ry={5} fill="#FFFFFF" opacity={0.4} transform="rotate(-35 37 47)" />
    </>
  );
}

function Lemon() {
  const s = 'lemon';
  return (
    <>
      <Defs>
        <LinearGradient id={uid(s, 'fruit')} x1="0.3" y1="0" x2="0.7" y2="1">
          <Stop offset="0" stopColor="#FFF07A" />
          <Stop offset="0.5" stopColor="#F2C21B" />
          <Stop offset="1" stopColor="#9A6B05" />
        </LinearGradient>
      </Defs>
      <G transform="rotate(-18 50 54)">
        <Path
          d="M18,54 C18,36 32,26 50,26 C68,26 82,36 82,54 C82,72 68,82 50,82 C32,82 18,72 18,54 Z"
          fill={`url(#${uid(s, 'fruit')})`}
          stroke={OUTLINE}
          strokeWidth={OUTLINE_W}
        />
        <Path d="M82,54 C88,52 90,50 92,48" stroke={OUTLINE} strokeWidth={5} strokeLinecap="round" fill="none" />
        <Ellipse cx={38} cy={42} rx={10} ry={6} fill="#FFFFFF" opacity={0.45} transform="rotate(-25 38 42)" />
      </G>
      <Path d="M60,22 C66,14 76,12 82,14" stroke="#3E9142" strokeWidth={4.5} fill="none" strokeLinecap="round" />
    </>
  );
}

/** WILD — a medallion. The highest-value ordinary symbol, so it reads as metal. */
function Wild() {
  const s = 'wild';
  return (
    <>
      <Defs>
        <GoldDef id={uid(s, 'gold')} />
        <LinearGradient id={uid(s, 'inner')} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#7A1533" />
          <Stop offset="1" stopColor="#3A0518" />
        </LinearGradient>
      </Defs>
      <Circle cx={50} cy={50} r={38} fill={`url(#${uid(s, 'gold')})`} stroke={OUTLINE} strokeWidth={OUTLINE_W} />
      <Circle cx={50} cy={50} r={29} fill={`url(#${uid(s, 'inner')})`} stroke={OUTLINE} strokeWidth={2} />
      {/* Eight-point star — a burst without tipping into a children's sticker. */}
      <Path
        d="M50,20 L57,40 L77,33 L64,50 L77,67 L57,60 L50,80 L43,60 L23,67 L36,50 L23,33 L43,40 Z"
        fill={`url(#${uid(s, 'gold')})`}
        stroke={OUTLINE}
        strokeWidth={2}
        strokeLinejoin="round"
      />
      <Circle cx={50} cy={50} r={7} fill="#FFF0B8" opacity={0.9} />
    </>
  );
}

/** SCATTER — pays anywhere, so it is the one symbol allowed to shout. */
function Scatter() {
  const s = 'scatter';
  return (
    <>
      <Defs>
        <GoldDef id={uid(s, 'gold')} />
        <LinearGradient id={uid(s, 'star')} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#FFFFFF" />
          <Stop offset="0.5" stopColor="#FFD84D" />
          <Stop offset="1" stopColor="#E07A00" />
        </LinearGradient>
      </Defs>
      <G opacity={0.5}>
        {Array.from({ length: 8 }, (_, i) => (
          <Path key={i} d="M50,50 L46,6 L54,6 Z" fill="#FFD84D" transform={`rotate(${i * 45} 50 50)`} />
        ))}
      </G>
      <Circle cx={50} cy={50} r={32} fill={`url(#${uid(s, 'gold')})`} stroke={OUTLINE} strokeWidth={OUTLINE_W} />
      <Path
        d="M50,24 L58,43 L79,45 L63,58 L68,78 L50,67 L32,78 L37,58 L21,45 L42,43 Z"
        fill={`url(#${uid(s, 'star')})`}
        stroke={OUTLINE}
        strokeWidth={2.5}
        strokeLinejoin="round"
      />
    </>
  );
}

const SYMBOLS: Record<string, () => React.JSX.Element> = {
  SEVEN: Seven,
  DIAMOND: Diamond,
  BELL: Bell,
  BAR: Bar,
  CHERRY: Cherry,
  PLUM: Plum,
  LEMON: Lemon,
  WILD: Wild,
  SCATTER: Scatter,
};

export const SYMBOL_NAMES = Object.keys(SYMBOLS);

/**
 * One symbol on a reel.
 *
 * A themed family supplies artwork for the five picture symbols; everything
 * else falls through to the vector drawings above. The fallback is the point,
 * not a safety net — SEVEN, BAR, WILD and SCATTER are deliberately never
 * re-skinned, a game with no family assigned is meant to look like a classic
 * fruit machine, and a family delivered half-finished shows vectors for the
 * gaps instead of holes.
 */
export function SlotSymbol({
  name,
  size,
  family,
}: {
  name: string;
  size: number;
  family?: string;
}) {
  const image = symbolImage(family, name);
  if (image) {
    return (
      <Image
        source={{ uri: image }}
        style={{ width: size, height: size }}
        // `contain` so a wide subject keeps its proportions. `cover` would crop
        // a tiger's face off to fill a square cell.
        resizeMode="contain"
        // What is DRAWN, not what the engine calls it. Under a theme the
        // symbol the maths calls LEMON is a pirate's hat, and announcing
        // "lemon" describes a symbol that is not on the screen — the same
        // mistake the win badge was making out loud.
        accessibilityLabel={symbolDisplayName(family, name)}
      />
    );
  }

  const Drawing = SYMBOLS[name];
  if (!Drawing) return null;
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100">
      <Drawing />
    </Svg>
  );
}
