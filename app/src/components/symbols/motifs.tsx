/**
 * Symbols that belong to ONE game.
 *
 * ## Why this exists
 *
 * Twenty-three games were dealing from eight painted sets, and six of them —
 * Neon Alley, Frost Peak, Carnival Row, City Lights, Aurora and Supernova —
 * shared a single set of abstract medallions. Frost Peak, a frozen mountain
 * cavern, dealt a flame and a boiled sweet. Ocean Drift, a mermaid on its own
 * lobby tile, dealt a pirate's hat and a cannon borrowed from a mining game.
 * Emerald Nights, a moonlit emerald mine, dealt a tiger and a gorilla.
 *
 * The attempted fix before this one made it worse rather than better: it put
 * the card royals A, K and Q underneath, which is what a real cabinet does —
 * except a real cabinet puts them under four or five PAINTED characters, and
 * here there were none, so the royals were not the floor of the set, they were
 * the whole of it. Every game got the same three letterforms. The one thing
 * that made a game its own was replaced by the one thing they could all share.
 *
 * ## Why these are drawn rather than painted
 *
 * A painted set is five images a game and nobody has forty of them. A drawn
 * set is a few paths, ships in the bundle at no download cost, stays sharp at
 * any size, and — the part that matters here — takes the GAME's palette, so
 * Frost Peak's are cut from glacier and Carnival Row's from painted tin.
 *
 * These are not a substitute for painted heroes; `docs/art-manifest.md` still
 * lists what should eventually be commissioned. They are the difference
 * between a game that looks like itself and a game that looks like five others.
 *
 * ## The grammar every motif follows
 *
 * The same one the existing vector symbols use, because a reel has to read as
 * a set: a 100x100 viewBox, the subject inset by about 12 units, one dark
 * outline heavy enough to hold against both a dark reel and the gold win
 * highlight behind it, and a single bright accent. Bold silhouettes above
 * detail — at 70 points on a moving reel, detail is noise and the outline is
 * the whole symbol.
 */

import React from 'react';
import {
  Circle,
  Defs,
  Ellipse,
  G,
  LinearGradient,
  Path,
  Polygon,
  Rect,
  Stop,
} from 'react-native-svg';

/** What a game's motifs are coloured with. */
export interface MotifPalette {
  /** Unique per game — gradient ids must not collide between two cabinets. */
  id: string;
  light: string;
  mid: string;
  deep: string;
  /** Heavy outline, so the shape survives a busy room behind it. */
  outline: string;
  /** One bright detail per symbol: a gem, a filament, a spark. */
  accent: string;
}

/** The gradient every motif fills with. Emitted once per symbol. */
export function MotifDefs({ p }: { p: MotifPalette }) {
  return (
    <Defs>
      <LinearGradient id={`m-${p.id}`} x1="0" y1="0" x2="0" y2="1">
        <Stop offset="0" stopColor={p.light} />
        <Stop offset="0.48" stopColor={p.mid} />
        <Stop offset="1" stopColor={p.deep} />
      </LinearGradient>
      <LinearGradient id={`m-${p.id}-a`} x1="0" y1="0" x2="0" y2="1">
        <Stop offset="0" stopColor={p.accent} />
        <Stop offset="1" stopColor={p.mid} />
      </LinearGradient>
    </Defs>
  );
}

const face = (p: MotifPalette) => `url(#m-${p.id})`;
const bright = (p: MotifPalette) => `url(#m-${p.id}-a)`;

/** A filled shape with the standard outline. */
function S({ d, p, fill }: { d: string; p: MotifPalette; fill?: string }) {
  return (
    <Path
      d={d}
      fill={fill ?? face(p)}
      stroke={p.outline}
      strokeWidth={4.5}
      strokeLinejoin="round"
      strokeLinecap="round"
    />
  );
}

/** A stroked shape, for the motifs that are line drawings — frost, aurora. */
function L({ d, p, w = 7, color }: { d: string; p: MotifPalette; w?: number; color?: string }) {
  return (
    <>
      <Path
        d={d}
        fill="none"
        stroke={p.outline}
        strokeWidth={w + 4.5}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <Path
        d={d}
        fill="none"
        stroke={color ?? p.light}
        strokeWidth={w}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </>
  );
}

export type Motif = (p: MotifPalette) => React.ReactElement;

/* ------------------------------------------------------------ frost peak */

const icePeak: Motif = (p) => (
  <G>
    <S p={p} d="M8,88 L36,24 L52,52 L64,32 L92,88 Z" />
    <S p={p} fill={p.light} d="M36,24 L27,44 L34,40 L40,48 L46,41 L52,52 Z" />
    <S p={p} fill={p.light} d="M64,32 L57,47 L63,44 L69,51 L75,45 Z" />
  </G>
);

const snowflake: Motif = (p) => (
  <G>
    <L p={p} d="M50,12 V88 M20,29 L80,71 M20,71 L80,29" />
    <L p={p} w={5} d="M50,28 L40,20 M50,28 L60,20 M50,72 L40,80 M50,72 L60,80" />
    <L p={p} w={5} d="M33,38 L22,38 M67,62 L78,62 M33,62 L22,62 M67,38 L78,38" />
    <Circle cx={50} cy={50} r={9} fill={bright(p)} stroke={p.outline} strokeWidth={4} />
  </G>
);

const iceCrystal: Motif = (p) => (
  <G>
    <S p={p} d="M26,32 L36,48 L33,84 L19,84 L17,50 Z" />
    <S p={p} d="M74,36 L83,52 L81,84 L67,84 L65,52 Z" />
    <S p={p} d="M50,10 L66,42 L61,86 L39,86 L34,42 Z" />
    <Path d="M50,20 L57,44 L54,78" stroke={p.light} strokeWidth={4} fill="none" opacity={0.75} />
  </G>
);

const icicles: Motif = (p) => (
  <G>
    <S p={p} d="M12,16 H88 V32 H12 Z" />
    <S p={p} d="M22,30 H36 L29,76 Z" />
    <S p={p} d="M44,30 H60 L52,92 Z" />
    <S p={p} d="M66,30 H80 L73,64 Z" />
    <Path d="M50,38 L50,74" stroke={p.accent} strokeWidth={3.5} opacity={0.8} />
  </G>
);

const frostFern: Motif = (p) => (
  <G>
    <L p={p} d="M50,92 V16" />
    <L p={p} w={5} d="M50,30 L30,16 M50,30 L70,16 M50,50 L26,36 M50,50 L74,36 M50,70 L30,58 M50,70 L70,58" />
    <Circle cx={50} cy={14} r={7} fill={bright(p)} stroke={p.outline} strokeWidth={4} />
  </G>
);

/* ----------------------------------------------------------- ocean drift */

const mermaidTail: Motif = (p) => (
  <G>
    <S p={p} d="M50,8 C60,26 62,40 57,54 L43,54 C38,40 40,26 50,8 Z" />
    <S
      p={p}
      d="M50,48 C33,58 17,76 22,94 C36,89 47,76 50,64 C53,76 64,89 78,94 C83,76 67,58 50,48 Z"
    />
    <Path d="M50,60 L50,88" stroke={p.accent} strokeWidth={3.5} opacity={0.8} />
  </G>
);

/*
 * A scallop opens UPWARD from a small hinge, and its top edge is lobed — that
 * wavy edge is the whole silhouette. Drawn once as a smooth dome with faint
 * ribs, it read as a shield.
 */
const scallop: Motif = (p) => (
  <G>
    <S
      p={p}
      d="M50,92 C22,78 8,52 12,26 L24,36 L33,18 L41,32 L50,12 L59,32 L67,18 L76,36 L88,26 C92,52 78,78 50,92 Z"
    />
    <Path
      d="M50,84 L50,20 M50,84 L33,26 M50,84 L67,26 M50,84 L20,36 M50,84 L80,36"
      stroke={p.outline}
      strokeWidth={3.4}
      fill="none"
      opacity={0.6}
    />
    <Circle cx={50} cy={86} r={5} fill={p.accent} stroke={p.outline} strokeWidth={3} />
  </G>
);

const pearlOyster: Motif = (p) => (
  <G>
    <S p={p} d="M10,64 C20,88 80,88 90,64 C76,54 24,54 10,64 Z" />
    <S p={p} d="M14,58 C24,34 76,34 86,58 C72,66 28,66 14,58 Z" />
    <Circle cx={50} cy={54} r={13} fill={bright(p)} stroke={p.outline} strokeWidth={4.5} />
    <Circle cx={45} cy={49} r={4} fill={p.light} opacity={0.9} />
  </G>
);

const starfish: Motif = (p) => (
  <G>
    <Polygon
      points="50,10 59.6,36.2 87.4,36.6 65.2,54.4 73,81 50,65 27,81 34.8,54.4 12.6,36.6 40.4,36.2"
      fill={face(p)}
      stroke={p.outline}
      strokeWidth={4.5}
      strokeLinejoin="round"
    />
    <Circle cx={50} cy={48} r={5} fill={p.accent} opacity={0.85} />
    <Circle cx={38} cy={40} r={3.4} fill={p.light} opacity={0.7} />
    <Circle cx={62} cy={40} r={3.4} fill={p.light} opacity={0.7} />
  </G>
);

/*
 * Water itself, as three crests.
 *
 * This started as a branching coral and went through two drafts that both
 * failed the only test that matters at 70 points on a moving reel: the first
 * read as a tuning fork, the second as a small person with their arms up.
 * A silhouette that reads as something else is worse than a dull one — the
 * player is not studying it, they are glancing at it. Three crests cannot be
 * mistaken for anything but water.
 */
const waves: Motif = (p) => (
  <G>
    <L p={p} w={9} color={p.light} d="M8,32 C20,18 32,44 46,30 C58,18 70,42 84,28 C88,24 90,24 93,26" />
    <L p={p} w={9} color={p.mid} d="M8,56 C20,42 32,68 46,54 C58,42 70,66 84,52 C88,48 90,48 93,50" />
    <L p={p} w={9} color={p.mid} d="M8,80 C20,66 32,92 46,78 C58,66 70,90 84,76 C88,72 90,72 93,74" />
    <Circle cx={26} cy={20} r={5} fill={p.accent} opacity={0.9} />
  </G>
);

/* ---------------------------------------------------------- carnival row */

const ferrisWheel: Motif = (p) => (
  <G>
    <S p={p} d="M50,80 L26,94 H74 Z" />
    <Circle cx={50} cy={44} r={33} fill="none" stroke={p.outline} strokeWidth={9} />
    <Circle cx={50} cy={44} r={33} fill="none" stroke={p.mid} strokeWidth={5} />
    <Path
      d="M50,11 V77 M17,44 H83 M27,21 L73,67 M73,21 L27,67"
      stroke={p.outline}
      strokeWidth={4}
      fill="none"
    />
    <Circle cx={50} cy={44} r={8} fill={bright(p)} stroke={p.outline} strokeWidth={4} />
    {[
      [50, 11],
      [83, 44],
      [50, 77],
      [17, 44],
    ].map(([cx, cy]) => (
      <Circle key={`${cx}-${cy}`} cx={cx} cy={cy} r={7} fill={p.accent} stroke={p.outline} strokeWidth={3.5} />
    ))}
  </G>
);

const bigTop: Motif = (p) => (
  <G>
    <S p={p} d="M12,84 C12,50 28,24 50,24 C72,24 88,50 88,84 Z" />
    <Path
      d="M50,24 V84 M34,28 L28,84 M66,28 L72,84 M20,44 L16,84 M80,44 L84,84"
      stroke={p.outline}
      strokeWidth={4}
      fill="none"
      opacity={0.6}
    />
    <S p={p} fill={p.accent} d="M50,22 L74,12 L50,4 Z" />
    <Path d="M50,4 V24" stroke={p.outline} strokeWidth={4} />
  </G>
);

const harlequinMask: Motif = (p) => (
  <G>
    <S p={p} fill={p.accent} d="M24,32 L16,10 L34,20 Z" />
    <S p={p} fill={p.accent} d="M76,32 L84,10 L66,20 Z" />
    <S p={p} d="M50,92 C26,80 18,58 21,34 C32,26 68,26 79,34 C82,58 74,80 50,92 Z" />
    <Path
      d="M32,48 C36,40 46,40 48,48 C44,54 36,54 32,48 Z M68,48 C64,40 54,40 52,48 C56,54 64,54 68,48 Z"
      fill={p.outline}
    />
    <Path d="M38,70 C44,76 56,76 62,70" stroke={p.outline} strokeWidth={4.5} fill="none" strokeLinecap="round" />
  </G>
);

const candyFloss: Motif = (p) => (
  <G>
    <S p={p} fill={p.light} d="M44,52 H56 L54,94 H46 Z" />
    <Circle cx={34} cy={42} r={19} fill={face(p)} stroke={p.outline} strokeWidth={4.5} />
    <Circle cx={66} cy={42} r={19} fill={face(p)} stroke={p.outline} strokeWidth={4.5} />
    <Circle cx={50} cy={28} r={21} fill={face(p)} stroke={p.outline} strokeWidth={4.5} />
    <Circle cx={50} cy={46} r={17} fill={face(p)} stroke={p.outline} strokeWidth={4.5} />
    <Circle cx={42} cy={24} r={5} fill={p.light} opacity={0.75} />
  </G>
);

const balloon: Motif = (p) => (
  <G>
    <Ellipse cx={50} cy={40} rx={27} ry={31} fill={face(p)} stroke={p.outline} strokeWidth={4.5} />
    <S p={p} fill={p.accent} d="M44,70 H56 L50,80 Z" />
    <Path
      d="M50,80 C58,86 42,88 50,96"
      stroke={p.outline}
      strokeWidth={4}
      fill="none"
      strokeLinecap="round"
    />
    <Ellipse cx={39} cy={30} rx={7} ry={10} fill={p.light} opacity={0.6} />
  </G>
);

/* ------------------------------------------------------------- neon alley */

const neonArrow: Motif = (p) => (
  <G>
    <S p={p} d="M18,14 H82 V50 L50,90 L18,50 Z" />
    <Path
      d="M28,24 H72 V50 L50,76 L28,50 Z"
      fill="none"
      stroke={p.accent}
      strokeWidth={5}
      strokeLinejoin="round"
    />
    {[24, 40, 56, 72].map((x) => (
      <Circle key={x} cx={x} cy={19} r={3.6} fill={p.light} />
    ))}
  </G>
);

const neonCocktail: Motif = (p) => (
  <G>
    <S p={p} d="M18,20 H82 L50,60 Z" />
    <S p={p} fill={p.light} d="M46,58 H54 L54,84 H46 Z" />
    <S p={p} d="M30,84 H70 V92 H30 Z" />
    <Circle cx={60} cy={30} r={7} fill={p.accent} stroke={p.outline} strokeWidth={3.5} />
    <Path d="M60,30 L78,12" stroke={p.outline} strokeWidth={4} strokeLinecap="round" />
  </G>
);

const neonHeart: Motif = (p) => (
  <G>
    <S
      p={p}
      d="M50,90 C20,68 12,52 12,38 C12,25 22,16 33,16 C41,16 47,21 50,28 C53,21 59,16 67,16 C78,16 88,25 88,38 C88,52 80,68 50,90 Z"
    />
    <Path
      d="M50,80 C26,62 20,50 20,39 C20,30 27,24 34,24"
      stroke={p.accent}
      strokeWidth={5}
      fill="none"
      strokeLinecap="round"
    />
  </G>
);

const streetLamp: Motif = (p) => (
  <G>
    <Circle cx={50} cy={32} r={24} fill={p.accent} opacity={0.22} />
    <S p={p} d="M28,44 L38,16 H62 L72,44 Z" />
    <S p={p} fill={p.light} d="M46,44 H54 V86 H46 Z" />
    <S p={p} d="M32,86 H68 L72,94 H28 Z" />
    <Path d="M38,26 H62" stroke={p.accent} strokeWidth={5} strokeLinecap="round" />
  </G>
);

const neonBolt: Motif = (p) => (
  <G>
    <S p={p} d="M58,8 L24,54 H46 L38,92 L76,42 H52 Z" />
    <Path
      d="M55,20 L34,50 H50"
      stroke={p.accent}
      strokeWidth={5}
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </G>
);

/* -------------------------------------------------------------- supernova */

const novaBurst: Motif = (p) => {
  const pts: string[] = [];
  for (let i = 0; i < 16; i += 1) {
    const r = i % 2 === 0 ? 42 : 15;
    const a = (Math.PI / 8) * i - Math.PI / 2;
    pts.push(`${(50 + r * Math.cos(a)).toFixed(1)},${(50 + r * Math.sin(a)).toFixed(1)}`);
  }
  return (
    <G>
      <Polygon
        points={pts.join(' ')}
        fill={face(p)}
        stroke={p.outline}
        strokeWidth={4.5}
        strokeLinejoin="round"
      />
      <Circle cx={50} cy={50} r={13} fill={bright(p)} stroke={p.outline} strokeWidth={4} />
      <Circle cx={45} cy={45} r={4} fill={p.light} opacity={0.9} />
    </G>
  );
};

const ringedPlanet: Motif = (p) => (
  <G>
    <Circle cx={50} cy={46} r={26} fill={face(p)} stroke={p.outline} strokeWidth={4.5} />
    <Path d="M34,36 C44,32 58,32 66,38" stroke={p.light} strokeWidth={4} fill="none" opacity={0.7} />
    <Path d="M30,52 C42,48 60,48 70,54" stroke={p.deep} strokeWidth={5} fill="none" opacity={0.7} />
    <G rotation={-18} origin="50, 50">
      <Ellipse
        cx={50}
        cy={50}
        rx={44}
        ry={13}
        fill="none"
        stroke={p.outline}
        strokeWidth={10}
      />
      <Ellipse cx={50} cy={50} rx={44} ry={13} fill="none" stroke={p.accent} strokeWidth={5} />
    </G>
  </G>
);

const comet: Motif = (p) => (
  <G>
    <L p={p} w={6} d="M56,42 L14,84 M64,48 L28,90 M48,34 L12,62" color={p.mid} />
    <Circle cx={68} cy={32} r={17} fill={face(p)} stroke={p.outline} strokeWidth={4.5} />
    <Circle cx={62} cy={26} r={5} fill={p.light} opacity={0.85} />
  </G>
);

const asteroid: Motif = (p) => (
  <G>
    <S p={p} d="M22,38 L44,14 L74,18 L90,44 L80,74 L52,90 L22,76 L12,52 Z" />
    <Circle cx={40} cy={42} r={8} fill={p.deep} opacity={0.75} />
    <Circle cx={64} cy={60} r={10} fill={p.deep} opacity={0.7} />
    <Circle cx={66} cy={32} r={5} fill={p.accent} opacity={0.85} />
  </G>
);

const starCluster: Motif = (p) => {
  const star = (cx: number, cy: number, r: number) => {
    const pts: string[] = [];
    for (let i = 0; i < 10; i += 1) {
      const rr = i % 2 === 0 ? r : r * 0.42;
      const a = (Math.PI / 5) * i - Math.PI / 2;
      pts.push(`${(cx + rr * Math.cos(a)).toFixed(1)},${(cy + rr * Math.sin(a)).toFixed(1)}`);
    }
    return pts.join(' ');
  };
  return (
    <G>
      <Polygon points={star(34, 62, 24)} fill={face(p)} stroke={p.outline} strokeWidth={4.5} strokeLinejoin="round" />
      <Polygon points={star(70, 68, 17)} fill={face(p)} stroke={p.outline} strokeWidth={4.5} strokeLinejoin="round" />
      <Polygon points={star(62, 28, 22)} fill={bright(p)} stroke={p.outline} strokeWidth={4.5} strokeLinejoin="round" />
    </G>
  );
};

/* -------------------------------------------------------- aurora borealis */

const wolfHead: Motif = (p) => (
  <G>
    <S
      p={p}
      d="M50,92 L32,74 C22,66 18,54 21,42 L14,18 L34,30 C44,24 56,24 66,30 L86,18 L79,42 C82,54 78,66 68,74 Z"
    />
    <Circle cx={38} cy={50} r={5} fill={p.accent} />
    <Circle cx={62} cy={50} r={5} fill={p.accent} />
    <Path d="M50,60 L44,68 H56 Z" fill={p.outline} />
    <Path d="M50,68 V78" stroke={p.outline} strokeWidth={4} strokeLinecap="round" />
  </G>
);

const fullMoon: Motif = (p) => (
  <G>
    <Circle cx={50} cy={42} r={31} fill={face(p)} stroke={p.outline} strokeWidth={4.5} />
    <Circle cx={38} cy={34} r={8} fill={p.deep} opacity={0.55} />
    <Circle cx={60} cy={52} r={6} fill={p.deep} opacity={0.5} />
    <Circle cx={62} cy={30} r={4} fill={p.deep} opacity={0.45} />
    <S p={p} fill={p.deep} d="M6,92 C22,74 34,82 50,72 C66,62 80,74 94,66 L94,92 Z" />
  </G>
);

const auroraWave: Motif = (p) => (
  <G>
    <L p={p} w={8} d="M10,74 C26,44 42,80 58,46 C68,26 80,38 90,26" color={p.mid} />
    <L p={p} w={6} d="M10,88 C28,60 44,92 60,60 C70,42 82,52 92,42" color={p.accent} />
    <Circle cx={78} cy={16} r={6} fill={p.light} stroke={p.outline} strokeWidth={3.5} />
  </G>
);

const pineTrees: Motif = (p) => (
  <G>
    <S p={p} fill={p.deep} d="M72,58 L84,80 H60 Z M72,72 L88,94 H56 Z" />
    <S p={p} d="M36,10 L52,38 H20 Z M36,30 L56,62 H16 Z M36,52 L60,88 H12 Z" />
    <S p={p} fill={p.light} d="M32,88 H40 V96 H32 Z" />
  </G>
);

const northStar: Motif = (p) => (
  <G>
    <S p={p} d="M50,4 L58,40 L96,50 L58,60 L50,96 L42,60 L4,50 L42,40 Z" />
    <Circle cx={50} cy={50} r={7} fill={p.accent} />
    <Path d="M20,20 L26,26 M80,74 L74,68" stroke={p.light} strokeWidth={4} strokeLinecap="round" />
  </G>
);

/* ------------------------------------------------------------ city lights */

const skyline: Motif = (p) => (
  <G>
    <S p={p} d="M12,40 H34 V94 H12 Z" />
    <S p={p} d="M66,52 H88 V94 H66 Z" />
    <S p={p} d="M38,16 H62 V94 H38 Z" />
    <Path d="M50,16 V6" stroke={p.outline} strokeWidth={4} strokeLinecap="round" />
    <Circle cx={50} cy={5} r={4} fill={p.accent} />
    {[
      [18, 50],
      [26, 50],
      [18, 64],
      [26, 64],
      [44, 28],
      [54, 28],
      [44, 44],
      [54, 44],
      [44, 60],
      [54, 60],
      [72, 62],
      [80, 62],
      [72, 76],
      [80, 76],
    ].map(([x, y]) => (
      <Rect key={`${x}-${y}`} x={x} y={y} width={5} height={7} fill={p.accent} opacity={0.8} />
    ))}
  </G>
);

const champagne: Motif = (p) => (
  <G>
    <S p={p} d="M34,14 H66 L60,50 C60,58 40,58 40,50 Z" />
    <S p={p} fill={p.light} d="M46,56 H54 V82 H46 Z" />
    <S p={p} d="M32,82 H68 L72,92 H28 Z" />
    <Circle cx={44} cy={10} r={4} fill={p.accent} />
    <Circle cx={58} cy={6} r={3} fill={p.accent} />
    <Circle cx={51} cy={16} r={2.6} fill={p.accent} />
  </G>
);

const diamondRing: Motif = (p) => (
  <G>
    <Circle cx={50} cy={64} r={24} fill="none" stroke={p.outline} strokeWidth={13} />
    <Circle cx={50} cy={64} r={24} fill="none" stroke={p.mid} strokeWidth={7} />
    <S p={p} fill={bright(p)} d="M50,6 L70,26 L50,48 L30,26 Z" />
    <Path d="M30,26 H70 M50,6 L50,48" stroke={p.outline} strokeWidth={3.5} />
  </G>
);

const wristWatch: Motif = (p) => (
  <G>
    <S p={p} fill={p.deep} d="M38,6 H62 V30 H38 Z M38,70 H62 V94 H38 Z" />
    <Circle cx={50} cy={50} r={25} fill={face(p)} stroke={p.outline} strokeWidth={4.5} />
    <Circle cx={50} cy={50} r={17} fill={p.light} opacity={0.35} />
    <Path d="M50,50 V34 M50,50 L64,58" stroke={p.outline} strokeWidth={4.5} strokeLinecap="round" />
    <Circle cx={50} cy={50} r={4} fill={p.accent} />
  </G>
);

/*
 * Black tie, for the champagne-and-glass-towers game.
 *
 * Third attempt, and the two failures are the useful part. A stiletto lost its
 * heel into its sole and became a curved smear. A bow tie — two triangles
 * meeting at a knot — came out as the play/pause button on a media player,
 * because that is also two triangles meeting at a bar.
 *
 * The test is not "is it drawn well", it is "glanced at, on a moving reel, is
 * it the ONLY thing it could be". A crown on a brim is nothing but a top hat.
 */
const topHat: Motif = (p) => (
  <G>
    <S p={p} d="M34,8 H66 L69,62 H31 Z" />
    <S p={p} fill={p.accent} d="M31,44 H69 L69.6,58 H30.4 Z" />
    <S p={p} d="M10,62 H90 A7,7 0 0 1 90,78 H10 A7,7 0 0 1 10,62 Z" />
    <Path d="M40,16 V40" stroke={p.light} strokeWidth={4} opacity={0.5} strokeLinecap="round" />
  </G>
);

/* -------------------------------------------------------- emerald nights */

const emeraldGem: Motif = (p) => (
  <G>
    <S p={p} d="M32,12 H68 L88,32 V68 L68,88 H32 L12,68 V32 Z" />
    <Path
      d="M42,26 H58 L74,40 V60 L58,74 H42 L26,60 V40 Z"
      fill="none"
      stroke={p.light}
      strokeWidth={4}
      opacity={0.8}
    />
    <Path
      d="M32,12 L42,26 M68,12 L58,26 M88,32 L74,40 M88,68 L74,60 M68,88 L58,74 M32,88 L42,74 M12,68 L26,60 M12,32 L26,40"
      stroke={p.outline}
      strokeWidth={3}
      opacity={0.6}
    />
  </G>
);

const mineLantern: Motif = (p) => (
  <G>
    <Path
      d="M34,20 C34,6 66,6 66,20"
      fill="none"
      stroke={p.outline}
      strokeWidth={7}
      strokeLinecap="round"
    />
    <S p={p} fill={p.deep} d="M28,20 H72 V30 H28 Z" />
    <S p={p} d="M32,30 H68 L74,80 H26 Z" />
    <Rect x={38} y={40} width={24} height={30} rx={4} fill={p.accent} opacity={0.9} />
    <S p={p} fill={p.deep} d="M24,80 H76 V92 H24 Z" />
  </G>
);

/*
 * A pickaxe is a HANDLE and a head, at right angles. Drawn as a diagonal shaft
 * under a single crescent it read as a swoosh — the shaft disappeared behind
 * the head and all that was left was the curve. Handle upright, head across
 * the top with a sharp point at each end.
 */
const pickaxe: Motif = (p) => (
  <G>
    <S p={p} fill={p.deep} d="M44,30 H56 L59,94 H41 Z" />
    <S
      p={p}
      d="M4,50 C13,24 29,12 50,12 C71,12 87,24 96,50 C81,34 67,28 50,28 C33,28 19,34 4,50 Z"
    />
    <S p={p} fill={p.accent} d="M38,26 H62 V38 H38 Z" />
    <Path d="M50,42 V88" stroke={p.outline} strokeWidth={3} opacity={0.45} />
  </G>
);

const crescentMoon: Motif = (p) => (
  <G>
    <S
      p={p}
      d="M66,8 A38,38 0 1 0 66,92 A30,30 0 1 1 66,8 Z"
    />
    <S p={p} fill={p.accent} d="M78,20 L83,32 L95,36 L83,41 L78,54 L73,41 L61,36 L73,32 Z" />
  </G>
);

const oreChunk: Motif = (p) => (
  <G>
    <S p={p} fill={p.deep} d="M14,58 L30,24 L68,16 L90,44 L82,80 L44,92 L16,78 Z" />
    <S p={p} d="M38,38 L54,32 L62,46 L50,58 L34,52 Z" />
    <S p={p} d="M60,60 L74,56 L78,70 L64,74 Z" />
    <Circle cx={44} cy={72} r={6} fill={p.accent} stroke={p.outline} strokeWidth={3} />
  </G>
);

/**
 * Every motif, by name.
 *
 * Names are the ones a player would use, because they are also what the win
 * badge announces: a win on four of them says "4x Snowflake", not "4x LEMON".
 * Getting that wrong is the bug that had the machine paying out for lemons on
 * a reel with no lemon on it.
 */
export const MOTIFS: Record<string, Motif> = {
  ice_peak: icePeak,
  snowflake,
  ice_crystal: iceCrystal,
  icicles,
  frost_fern: frostFern,

  mermaid_tail: mermaidTail,
  scallop,
  pearl_oyster: pearlOyster,
  starfish,
  waves,

  ferris_wheel: ferrisWheel,
  big_top: bigTop,
  harlequin_mask: harlequinMask,
  candy_floss: candyFloss,
  balloon,

  neon_arrow: neonArrow,
  neon_cocktail: neonCocktail,
  neon_heart: neonHeart,
  street_lamp: streetLamp,
  neon_bolt: neonBolt,

  nova_burst: novaBurst,
  ringed_planet: ringedPlanet,
  comet,
  asteroid,
  star_cluster: starCluster,

  wolf_head: wolfHead,
  full_moon: fullMoon,
  aurora_wave: auroraWave,
  pine_trees: pineTrees,
  north_star: northStar,

  skyline,
  champagne,
  diamond_ring: diamondRing,
  wrist_watch: wristWatch,
  top_hat: topHat,

  emerald_gem: emeraldGem,
  mine_lantern: mineLantern,
  pickaxe,
  crescent_moon: crescentMoon,
  ore_chunk: oreChunk,
};

export type MotifName = keyof typeof MOTIFS;
