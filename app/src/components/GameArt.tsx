/**
 * Game tile artwork, drawn in code.
 *
 * Every tile used to be a flat colour gradient with the game's name underneath,
 * which is the visual equivalent of a spreadsheet row. A casino lobby is sold on
 * its artwork: the tile is the advert, and a player decides what to play from
 * about a centimetre of colour and shape.
 *
 * These are vector drawings rather than painted illustrations. The trade is
 * honest — they are crisp at any size, weigh nothing, need no licence and no
 * asset pipeline, but they read as graphic design rather than as an oil
 * painting. Swapping in commissioned art later means replacing the body of one
 * function per game and nothing else.
 *
 * Rules that keep these legible at tile size (~128pt square on a phone):
 *   - Bold shapes, no fine detail. Anything under ~3 units of the 100-unit
 *     viewBox disappears.
 *   - One clear focal subject per tile, roughly centred.
 *   - The background gradient carries the game's identity as much as the
 *     subject does, because at a glance colour registers before shape.
 */

import React from 'react';
import { Image, StyleSheet } from 'react-native';
import Svg, {
  Circle,
  Defs,
  Ellipse,
  G,
  LinearGradient,
  Path,
  RadialGradient,
  Rect,
  Stop,
} from 'react-native-svg';
import { colors } from '@juwa/ui';
import type { SlotGame } from '../api/games';

type SlotTheme = SlotGame['theme'];

/**
 * Gradient ids are global to the document once react-native-svg renders to real
 * SVG on the web. Two tiles both calling their gradient "bg" would collide and
 * one would silently inherit the other's colours, so every id is namespaced.
 */
const uid = (game: string, name: string) => `juwa-${game}-${name}`;

/** A wedge of a pie, for the roulette wheel. Angles in degrees, 0 = 12 o'clock. */
function wedgePath(cx: number, cy: number, r: number, from: number, to: number): string {
  const rad = (deg: number) => ((deg - 90) * Math.PI) / 180;
  const x1 = cx + r * Math.cos(rad(from));
  const y1 = cy + r * Math.sin(rad(from));
  const x2 = cx + r * Math.cos(rad(to));
  const y2 = cy + r * Math.sin(rad(to));
  const large = to - from > 180 ? 1 : 0;
  return `M${cx},${cy} L${x1},${y1} A${r},${r} 0 ${large} 1 ${x2},${y2} Z`;
}

/** Four-pointed sparkle — the cheapest way to make a tile feel celebratory. */
function Sparkle({ x, y, size, opacity = 0.9 }: { x: number; y: number; size: number; opacity?: number }) {
  return (
    <Path
      d={`M${x},${y - size} Q${x + size * 0.22},${y - size * 0.22} ${x + size},${y}
          Q${x + size * 0.22},${y + size * 0.22} ${x},${y + size}
          Q${x - size * 0.22},${y + size * 0.22} ${x - size},${y}
          Q${x - size * 0.22},${y - size * 0.22} ${x},${y - size} Z`}
      fill="#FFFFFF"
      opacity={opacity}
    />
  );
}

/** A playing card: white rounded rect with a coloured pip. */
function Card({
  x,
  y,
  rotate,
  pip,
  pipColor,
}: {
  x: number;
  y: number;
  rotate: number;
  pip: 'heart' | 'spade' | 'diamond' | 'club';
  pipColor: string;
}) {
  const pips: Record<string, string> = {
    heart: 'M0,6 C-6,0 -6,-5 -2,-5 C0,-5 0,-3 0,-2 C0,-3 0,-5 2,-5 C6,-5 6,0 0,6 Z',
    diamond: 'M0,-7 L5,0 L0,7 L-5,0 Z',
    spade: 'M0,-7 C6,-1 6,3 2,3 C1,3 0.5,2.6 0,2 L1.5,6 L-1.5,6 L0,2 C-0.5,2.6 -1,3 -2,3 C-6,3 -6,-1 0,-7 Z',
    club: 'M0,6 L-2,6 L-0.6,2 A3,3 0 1 1 -2.2,-1.4 A3,3 0 1 1 2.2,-1.4 A3,3 0 1 1 0.6,2 L2,6 Z',
  };
  return (
    <G transform={`translate(${x},${y}) rotate(${rotate})`}>
      <Rect x={-13} y={-18} width={26} height={36} rx={4} fill="#FFFFFF" />
      <Rect x={-13} y={-18} width={26} height={36} rx={4} fill="none" stroke="#00000022" strokeWidth={1} />
      <Path d={pips[pip]} fill={pipColor} transform="translate(0,1) scale(1.5)" />
    </G>
  );
}

/** A casino chip seen face-on. */
function Chip({ x, y, r, fill, edge }: { x: number; y: number; r: number; fill: string; edge: string }) {
  return (
    <G transform={`translate(${x},${y})`}>
      <Circle r={r} fill={fill} />
      <Circle r={r} fill="none" stroke={edge} strokeWidth={r * 0.28} strokeDasharray={`${r * 0.55} ${r * 0.42}`} />
      <Circle r={r * 0.58} fill="#FFFFFF" opacity={0.92} />
      <Circle r={r * 0.42} fill={fill} />
    </G>
  );
}

// --------------------------------------------------------------- the drawings

function ClassicSlots() {
  const g = 'slots';
  return (
    <>
      <Defs>
        <LinearGradient id={uid(g, 'bg')} x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor="#7C3AED" />
          <Stop offset="0.55" stopColor="#C026D3" />
          <Stop offset="1" stopColor="#FF3D8A" />
        </LinearGradient>
        <LinearGradient id={uid(g, 'seven')} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#FFE08A" />
          <Stop offset="0.5" stopColor="#FFC53D" />
          <Stop offset="1" stopColor="#E08A00" />
        </LinearGradient>
      </Defs>
      <Rect width={100} height={100} fill={`url(#${uid(g, 'bg')})`} />
      <Circle cx={50} cy={46} r={34} fill="#FFFFFF" opacity={0.12} />

      {/* The seven, with a drop shadow offset behind it for weight. */}
      <Path d="M32,24 H73 L51,84 H34 L55,38 H32 Z" fill="#00000033" transform="translate(2.5,3)" />
      <Path d="M32,24 H73 L51,84 H34 L55,38 H32 Z" fill={`url(#${uid(g, 'seven')})`} />

      {/* Cherries — the other symbol everyone recognises as a slot machine. */}
      <Path d="M62,58 Q70,44 78,40" stroke="#3F8F3F" strokeWidth={3} fill="none" strokeLinecap="round" />
      <Circle cx={62} cy={66} r={9} fill="#E11D48" />
      <Circle cx={59} cy={63} r={3} fill="#FFFFFF" opacity={0.5} />
      <Circle cx={79} cy={58} r={7.5} fill="#BE123C" />
      <Circle cx={77} cy={55.5} r={2.4} fill="#FFFFFF" opacity={0.45} />

      <Sparkle x={20} y={22} size={6} />
      <Sparkle x={84} y={82} size={4.5} opacity={0.75} />
      <Sparkle x={16} y={72} size={3.5} opacity={0.6} />
    </>
  );
}

function Blackjack() {
  const g = 'blackjack';
  return (
    <>
      <Defs>
        <RadialGradient id={uid(g, 'bg')} cx="50%" cy="38%" r="78%">
          <Stop offset="0" stopColor="#10B981" />
          <Stop offset="0.6" stopColor="#047857" />
          <Stop offset="1" stopColor="#043D2C" />
        </RadialGradient>
      </Defs>
      <Rect width={100} height={100} fill={`url(#${uid(g, 'bg')})`} />

      {/* Felt arc, the way a blackjack table edge is printed. */}
      <Path d="M-10,84 Q50,58 110,84" stroke="#FFE08A" strokeWidth={2.5} fill="none" opacity={0.5} />

      <G transform="translate(0,-4)">
        <Card x={36} y={52} rotate={-16} pip="spade" pipColor="#111827" />
        <Card x={62} y={50} rotate={13} pip="heart" pipColor="#E11D48" />
      </G>

      {/* 21, implied by two chips rather than spelled out — text at this size
          renders inconsistently across platforms. */}
      <Chip x={24} y={80} r={11} fill="#FF3D8A" edge="#FFFFFF" />
      <Chip x={76} y={82} r={9} fill="#22D3EE" edge="#FFFFFF" />
      <Sparkle x={82} y={22} size={5} opacity={0.8} />
    </>
  );
}

function Roulette() {
  const g = 'roulette';
  const segments = 12;
  const wedges = Array.from({ length: segments }, (_, i) => ({
    d: wedgePath(50, 48, 33, (360 / segments) * i, (360 / segments) * (i + 1)),
    fill: i % 2 === 0 ? '#DC2626' : '#111827',
  }));
  return (
    <>
      <Defs>
        <LinearGradient id={uid(g, 'bg')} x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor="#1E3A8A" />
          <Stop offset="1" stopColor="#0B1437" />
        </LinearGradient>
        <LinearGradient id={uid(g, 'rim')} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#FFE08A" />
          <Stop offset="1" stopColor="#B8860B" />
        </LinearGradient>
      </Defs>
      <Rect width={100} height={100} fill={`url(#${uid(g, 'bg')})`} />

      <Circle cx={50} cy={48} r={38} fill={`url(#${uid(g, 'rim')})`} />
      {wedges.map((w, i) => (
        <Path key={i} d={w.d} fill={w.fill} />
      ))}
      <Circle cx={50} cy={48} r={33} fill="none" stroke="#FFE08A" strokeWidth={1.5} opacity={0.7} />
      <Circle cx={50} cy={48} r={13} fill={`url(#${uid(g, 'rim')})`} />
      <Circle cx={50} cy={48} r={6} fill="#0B1437" />

      {/* The ball, resting in a pocket. */}
      <Circle cx={50} cy={22} r={4} fill="#FFFFFF" />
      <Circle cx={48.8} cy={20.8} r={1.4} fill="#FFFFFF" />
      <Sparkle x={16} y={80} size={5} opacity={0.7} />
    </>
  );
}

function Holdem() {
  const g = 'holdem';
  return (
    <>
      <Defs>
        <LinearGradient id={uid(g, 'bg')} x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor="#A855F7" />
          <Stop offset="1" stopColor="#4C1D95" />
        </LinearGradient>
      </Defs>
      <Rect width={100} height={100} fill={`url(#${uid(g, 'bg')})`} />
      <Circle cx={50} cy={44} r={32} fill="#FFFFFF" opacity={0.1} />

      <Card x={38} y={44} rotate={-14} pip="club" pipColor="#111827" />
      <Card x={62} y={44} rotate={12} pip="diamond" pipColor="#E11D48" />

      {/* A stack, because hold'em is about the pot rather than the hand. */}
      <G>
        <Ellipse cx={50} cy={84} rx={22} ry={7} fill="#00000033" />
        <Chip x={38} y={78} r={10} fill="#FF3D8A" edge="#FFFFFF" />
        <Chip x={58} y={80} r={10} fill="#22D3EE" edge="#FFFFFF" />
        <Chip x={48} y={72} r={10} fill="#FFC53D" edge="#FFFFFF" />
      </G>
    </>
  );
}

function VideoPoker() {
  const g = 'videopoker';
  return (
    <>
      <Defs>
        <LinearGradient id={uid(g, 'bg')} x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor="#22D3EE" />
          <Stop offset="0.6" stopColor="#0E7490" />
          <Stop offset="1" stopColor="#083344" />
        </LinearGradient>
        <LinearGradient id={uid(g, 'crown')} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#FFE08A" />
          <Stop offset="1" stopColor="#E08A00" />
        </LinearGradient>
      </Defs>
      <Rect width={100} height={100} fill={`url(#${uid(g, 'bg')})`} />

      {/* A fanned royal flush. Five cards is the whole idea of the game. */}
      <G transform="translate(0,8)">
        <Card x={26} y={50} rotate={-26} pip="spade" pipColor="#111827" />
        <Card x={38} y={45} rotate={-13} pip="heart" pipColor="#E11D48" />
        <Card x={50} y={43} rotate={0} pip="diamond" pipColor="#E11D48" />
        <Card x={62} y={45} rotate={13} pip="club" pipColor="#111827" />
        <Card x={74} y={50} rotate={26} pip="heart" pipColor="#E11D48" />
      </G>

      {/* Crown — "Jacks or Better" is the royalty game. */}
      <Path
        d="M28,24 L36,32 L50,16 L64,32 L72,24 L69,40 H31 Z"
        fill={`url(#${uid(g, 'crown')})`}
      />
      <Circle cx={28} cy={22} r={3} fill="#FFE08A" />
      <Circle cx={72} cy={22} r={3} fill="#FFE08A" />
      <Circle cx={50} cy={14} r={3.4} fill="#FFE08A" />
    </>
  );
}

function Scratch() {
  const g = 'scratch';
  return (
    <>
      <Defs>
        <LinearGradient id={uid(g, 'bg')} x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor="#FFF0A6" />
          <Stop offset="0.42" stopColor="#D89016" />
          <Stop offset="1" stopColor="#3C1207" />
        </LinearGradient>
        <LinearGradient id={uid(g, 'coin')} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#FFE08A" />
          <Stop offset="1" stopColor="#D97706" />
        </LinearGradient>
      </Defs>
      <Rect width={100} height={100} fill={`url(#${uid(g, 'bg')})`} />

      {/* Starburst behind the coin — the "you won" flash. */}
      <G opacity={0.35}>
        {Array.from({ length: 12 }, (_, i) => (
          <Path
            key={i}
            d="M50,48 L46,4 L54,4 Z"
            fill="#FFFFFF"
            transform={`rotate(${i * 30} 50 48)`}
          />
        ))}
      </G>

      {/* The card, half scratched off. */}
      <Rect x={18} y={26} width={64} height={46} rx={6} fill="#FFFFFF" opacity={0.95} />
      <Rect x={24} y={32} width={52} height={34} rx={4} fill="#4A1608" />
      <Path d="M24,50 Q38,38 52,50 Q66,62 76,48 L76,66 L24,66 Z" fill="#D08A18" opacity={0.82} />

      <Circle cx={50} cy={49} r={15} fill={`url(#${uid(g, 'coin')})`} />
      <Circle cx={50} cy={49} r={11} fill="none" stroke="#B45309" strokeWidth={1.6} opacity={0.6} />
      <Path d="M50,40 L52.6,46 L59,46 L54,50 L56,56 L50,52 L44,56 L46,50 L41,46 L47.4,46 Z" fill="#FFF7D6" />

      <Sparkle x={84} y={20} size={6} />
      <Sparkle x={16} y={80} size={5} opacity={0.8} />
    </>
  );
}

/**
 * Themed art for a catalogue slot.
 *
 * Twenty-two of the twenty-three slots have no bespoke drawing, and twenty-two
 * identical stars would make the lobby look like a placeholder — which is what
 * a lobby full of one shape IS. So the motif is chosen from the game's id and
 * painted in the game's own palette: same construction, different result every
 * time, and a genuinely new theme is a colour triple in the catalogue.
 *
 * A hash rather than a random pick, because a tile that changes its picture on
 * every render is worse than a dull one.
 */
function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

/**
 * Six unambiguous silhouettes.
 *
 * "Unambiguous" is the whole specification. An earlier set included a horseshoe
 * and a bell whose outlines, at tile size and with no interior detail, read as
 * a lower-case "n" and as a blob respectively. A motif that has to be explained
 * is worse than a plain rectangle, because the player assumes it is meant to be
 * something and cannot tell what.
 */
const MOTIFS = [
  // Star burst
  'M50,20 L58,42 L82,42 L62,56 L70,80 L50,66 L30,80 L38,56 L18,42 L42,42 Z',
  // Gem
  'M50,84 L20,46 L32,20 H68 L80,46 Z',
  // Crown
  'M22,30 L34,42 L50,18 L66,42 L78,30 L73,72 H27 Z',
  // Ring / coin. Second subpath is the hole, via the even-odd fill rule.
  'M50,18 A32,32 0 1 1 49.9,18 Z M50,34 A16,16 0 1 0 50.1,34 Z',
  // Lightning bolt
  'M58,12 L26,58 H46 L40,88 L74,40 H54 Z',
  // Spade
  'M50,14 C76,44 76,64 58,64 C54,64 51,62 50,58 L55,86 H45 L50,58 C49,62 46,64 42,64 C24,64 24,44 50,14 Z',
];

function ThemedArt({ id, theme }: { id: string; theme: SlotTheme }) {
  const seed = hash(id);
  const motif = MOTIFS[seed % MOTIFS.length]!;
  const rotated = seed % 2 === 0;

  return (
    <>
      <Defs>
        <LinearGradient id={uid(id, 'bg')} x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor={theme.secondary} />
          <Stop offset="0.65" stopColor={theme.primary} />
          <Stop offset="1" stopColor="#05070F" />
        </LinearGradient>
        <LinearGradient id={uid(id, 'motif')} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor="#FFFFFF" />
          <Stop offset="0.35" stopColor={theme.accent} />
          <Stop offset="1" stopColor={theme.primary} />
        </LinearGradient>
      </Defs>
      <Rect width={100} height={100} fill={`url(#${uid(id, 'bg')})`} />
      <Circle cx={50} cy={48} r={36} fill="#FFFFFF" opacity={0.1} />

      {/* Scaled about the centre so the motif has margin rather than bleeding
          off the tile, where the name and badge also have to live. */}
      {/* Offset shadow copy, so the motif sits on the tile rather than in it. */}
      <G
        transform={`translate(2.5,3) translate(50,50) scale(0.82) translate(-50,-50)${
          rotated ? ' rotate(-8 50 50)' : ''
        }`}
        opacity={0.35}
      >
        <Path d={motif} fill="#000000" fillRule="evenodd" />
      </G>
      <G
        transform={`translate(50,50) scale(0.82) translate(-50,-50)${
          rotated ? ' rotate(-8 50 50)' : ''
        }`}
      >
        <Path
          d={motif}
          fill={`url(#${uid(id, 'motif')})`}
          stroke="#1A1206"
          strokeWidth={2}
          strokeLinejoin="round"
          fillRule="evenodd"
        />
      </G>

      <Sparkle x={18 + (seed % 9)} y={22} size={5} opacity={0.85} />
      <Sparkle x={84} y={74 - (seed % 11)} size={4} opacity={0.7} />
    </>
  );
}

/** Anything with neither bespoke nor themed art. Never a blank rectangle. */
function Fallback({ accent }: { accent: string }) {
  return (
    <>
      <Defs>
        <LinearGradient id={uid('fallback', 'bg')} x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor={accent} />
          <Stop offset="1" stopColor={colors.surface.base} />
        </LinearGradient>
      </Defs>
      <Rect width={100} height={100} fill={`url(#${uid('fallback', 'bg')})`} />
      <Circle cx={50} cy={50} r={26} fill="#FFFFFF" opacity={0.14} />
      <Path d="M50,30 L56,45 L72,45 L59,54 L64,70 L50,60 L36,70 L41,54 L28,45 L44,45 Z" fill="#FFFFFF" opacity={0.85} />
    </>
  );
}

const ART: Record<string, () => React.JSX.Element> = {
  'juwa-classic-slots': ClassicSlots,
  'juwa-blackjack': Blackjack,
  'juwa-roulette-eu': Roulette,
  'juwa-holdem': Holdem,
  'juwa-video-poker': VideoPoker,
  'juwa-scratch': Scratch,
};

/**
 * Games with a photographic tile in `art/tiles`.
 *
 * A hard list rather than an existence check, because the web has no way to ask
 * "is there a file at this path" without requesting it — and a request that
 * 404s renders as a broken tile for the length of the round trip. Wrong here
 * shows up immediately as a missing tile in the lobby, which is the cheapest
 * possible way to be wrong.
 */
const TILED = new Set([
  'juwa-classic-slots', 'slot-emerald-nights', 'slot-royal-flush', 'slot-ocean-drift',
  'slot-sunset-strip', 'slot-midnight-gold', 'slot-neon-alley', 'slot-desert-mirage',
  'slot-frost-peak', 'slot-jade-temple', 'slot-carnival-row', 'slot-jungle-run',
  'slot-city-lights', 'slot-spice-market', 'slot-aurora-borealis', 'slot-dragons-hoard',
  'slot-vault-breaker', 'slot-supernova', 'slot-pharaohs-vault', 'slot-storm-chaser',
  'slot-lucky-sevens', 'slot-triple-bar', 'slot-fruit-stand',
]);

/**
 * Whether this game has photographic tile artwork.
 *
 * The generated tiles were drawn with an empty ornamental plaque across the
 * top, waiting for the title. The vector fallbacks have no such plaque, so the
 * card has to know which it is looking at before deciding where to put the name.
 */
export function hasTileArt(gameId: string): boolean {
  return TILED.has(gameId);
}

export function GameArt({
  gameId,
  accent,
  theme,
}: {
  gameId: string;
  accent: string;
  theme?: SlotTheme;
}) {
  if (TILED.has(gameId)) {
    return (
      <Image
        source={{ uri: `/art/tiles/${gameId}.jpg` }}
        style={StyleSheet.absoluteFill}
        // `cover`: the tile was cropped to the card's exact aspect already, so
        // this only absorbs rounding. `contain` would letterbox on a hair's
        // difference and put grey bars down the lobby.
        resizeMode="cover"
      />
    );
  }

  const Drawing = ART[gameId];
  return (
    <Svg
      width="100%"
      height="100%"
      viewBox="0 0 100 100"
      preserveAspectRatio="xMidYMid slice"
    >
      {Drawing ? (
        <Drawing />
      ) : theme ? (
        <ThemedArt id={gameId} theme={theme} />
      ) : (
        <Fallback accent={accent} />
      )}
    </Svg>
  );
}
