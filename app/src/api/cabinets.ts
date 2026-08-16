/**
 * How each game's MACHINE is built, as data.
 *
 * The maths is already data — grid shape, pay mode, cascades — and that stopped
 * twenty-three games being one game with twenty-three paint jobs. This is the
 * other half of the same problem, and the half a player actually sees first: a
 * three-reel fruit machine and a 720-ways diamond currently arrive in the same
 * dark card with the same full-width "Spin 2,000 GC" button underneath. As the
 * player put it, "it is the same silly spin again."
 *
 * A real cabinet differs in ways that have nothing to do with the maths:
 *
 *   - A classic fruit machine has a LEVER. You pull it. That single control is
 *     most of why a three-reeler feels like a three-reeler.
 *   - A modern video slot has a CONSOLE: bet stepper on one side, the win in
 *     the middle, balance and an auto-spin beside a round spin button.
 *   - The reels sit inside a themed surround and in front of a themed room,
 *     not on a flat panel.
 *
 * So the machine is described here per game and assembled by one screen. That
 * is the same trade the maths models made: a new cabinet is a data edit rather
 * than a new screen, and no themed variant can introduce a bug of its own.
 */

/** Which control cluster the game is played with. */
export type ControlStyle =
  /**
   * A pull lever beside the reels, and a small bet stepper. For the machines
   * that are pretending to be mechanical.
   */
  | 'lever'
  /**
   * Bet stepper left, win centre, balance and auto-spin beside a round spin
   * button on the right. The modern video-slot console.
   */
  | 'console'
  /** The original: chips in a row and a full-width button. */
  | 'bar';

/** The surround drawn around the reel window. */
export type FrameStyle =
  /** Carved wood and brass — the fruit machines. */
  | 'timber'
  /** Ornate gold scrollwork — the treasure and temple games. */
  | 'gilt'
  /** Cool metal and light — ice, storms, space. */
  | 'chrome'
  /** No surround. The artwork behind is doing the work. */
  | 'none';

export interface CabinetSpec {
  controls: ControlStyle;
  frame: FrameStyle;
  /**
   * How much of its cell a symbol fills, 0 to 1.
   *
   * The second of two levers on symbol size, and the one that is art direction
   * rather than arithmetic. The first is the CELL, which comes from the grid:
   * a three-reel machine has reels nearly twice as wide as a five-reel one, so
   * its cells are far bigger before anyone chooses anything.
   *
   * This decides how much of that cell the symbol takes. A fruit machine wants
   * chunky symbols that crowd their cells; a 720-ways diamond with nineteen of
   * them on screen at once needs air between them or the grid reads as a wall.
   *
   * Only ever raised above the default, never below it — the baseline is
   * already the smallest a symbol can be and still read on a phone.
   */
  symbolFill?: number;
  /**
   * How much taller than wide a cell is.
   *
   * A NUDGE, and it is worth saying why, because this was over-turned once
   * already. Five reels across a phone fix the cell WIDTH at about 72 points
   * whatever anyone wants, and symbols are square, so every point of aspect
   * above 1 is empty space around a symbol that cannot grow into it. Set to 1.5
   * the machine did fill the screen — with a sparse grid of small pictures,
   * which is the opposite of what was asked for.
   *
   * Surplus height belongs to the top glass, not to the cells. This says only
   * how much air a cabinet wants around its symbols: a chunky three-reeler
   * almost none, a nineteen-cell diamond a little more so the shape reads.
   * Clamped to 1.0–1.34 by the screen regardless of what is written here.
   */
  rowAspect?: number;
  /**
   * Room behind the reels, from `art/backgrounds`.
   *
   * Twelve of these have been sitting in the repository referenced by nothing
   * at all. They are deliberately dark and low-contrast because a symbol has to
   * read on top of them, which is exactly why they work as a room rather than
   * as a picture competing with the game.
   */
  background?: string;
  /**
   * Portrait framing is deliberately chosen cabinet by cabinet.
   *
   * A five-reel ocean game, a three-reel fruit machine with a physical handle,
   * and a 3-4-5-4-3 video slot do not have the same usable stage.  These values
   * cap the cell size only on a narrow upright screen; desktop and landscape
   * continue to use their wider cabinet geometry.  Keeping the values here
   * makes the exceptions inspectable instead of hiding a one-size-fits-all
   * scaling rule in the screen.
   */
  portrait?: {
    /** Largest symbol cell on an upright phone, in points. */
    symbolCap: number;
    /** Lit top-glass height on an upright phone, in points. */
    glassHeight: number;
    /** Cell shape for this cabinet's portrait-only reel geometry. */
    rowAspect?: number;
    /** Width reserved inside the cabinet for a real pull handle. */
    leverWidth?: number;
  };
  /**
   * A Surface/laptop is wide but not infinitely tall.  Only cabinets that
   * actually need a shorter wide face declare this: a normal five-by-three
   * cabinet keeps its large desktop presentation rather than inheriting a
   * compromise intended for a five-row diamond game.
   */
  wide?: {
    /** Largest cell when the console moves to a side rail. */
    symbolCap: number;
    /** Wide-screen-only cell shape for this individual cabinet. */
    rowAspect?: number;
    /** Keep its top glass in proportion to the shallower wide reel face. */
    glassHeight?: number;
  };
}

const BG = '/art/backgrounds';

/**
 * The default machine.
 *
 * Every game gets this unless it says otherwise, so a new game is playable the
 * moment it is added to the catalogue and can be dressed afterwards.
 */
export const DEFAULT_CABINET: CabinetSpec = { controls: 'console', frame: 'gilt' };

/**
 * Per-game cabinets.
 *
 * Assigned by what the game IS rather than by which maths model it runs: two
 * games sharing a model should still not share a machine, because sharing a
 * machine is the thing being fixed.
 */
export const CABINETS: Record<string, CabinetSpec> = {
  // ---- the mechanical ones: a lever, timber, and a dim back-bar room ----
  // Three reels and a full-width machine give these the biggest cells in the
  // catalogue, and they are the games that want them: a fruit machine's
  // symbols crowd their windows, they do not float in them.
  'juwa-classic-slots': { controls: 'lever', frame: 'timber', symbolFill: 1.0, rowAspect: 1.06, background: `${BG}/bg03.jpg`, portrait: { symbolCap: 70, glassHeight: 38, leverWidth: 48 } },
  'slot-triple-bar': { controls: 'lever', frame: 'timber', symbolFill: 1.0, rowAspect: 1.04, background: `${BG}/bg08.jpg`, portrait: { symbolCap: 72, glassHeight: 42, leverWidth: 50 } },
  'slot-fruit-stand': { controls: 'lever', frame: 'timber', symbolFill: 1.0, rowAspect: 1.04, background: `${BG}/bg05.jpg`, portrait: { symbolCap: 72, glassHeight: 42, leverWidth: 50 } },
  'slot-lucky-sevens': { controls: 'lever', frame: 'timber', symbolFill: 1.0, rowAspect: 1.0, background: `${BG}/bg02.jpg`, portrait: { symbolCap: 76, glassHeight: 42, leverWidth: 50 } },

  // ---- temples, tombs and hoards: gold, and a room with pillars in it ----
  'slot-desert-mirage': { controls: 'console', frame: 'gilt', symbolFill: 0.98, rowAspect: 1.14, background: `${BG}/egypt.jpg`, portrait: { symbolCap: 70, glassHeight: 38 } },
  'slot-pharaohs-vault': { controls: 'console', frame: 'gilt', symbolFill: 0.98, rowAspect: 1.14, background: `${BG}/egypt.jpg`, portrait: { symbolCap: 70, glassHeight: 38 } },
  // Five visible rows in the centre reel: this needs a materially shorter
  // portrait face than the three-row gilt cabinets above it.
  'slot-jade-temple': { controls: 'console', frame: 'gilt', symbolFill: 0.98, rowAspect: 1.2, background: `${BG}/bg09.jpg`, portrait: { symbolCap: 49, glassHeight: 30, rowAspect: 1.1 }, wide: { symbolCap: 62, rowAspect: 1.02, glassHeight: 34 } },
  'slot-dragons-hoard': { controls: 'console', frame: 'gilt', symbolFill: 1.0, rowAspect: 1.1, background: `${BG}/bg10.jpg` },
  'slot-royal-flush': { controls: 'console', frame: 'gilt', symbolFill: 0.96, rowAspect: 1.22, background: `${BG}/bg11.jpg`, portrait: { symbolCap: 68, glassHeight: 38 } },
  'slot-midnight-gold': { controls: 'console', frame: 'gilt', symbolFill: 0.96, rowAspect: 1.22, background: `${BG}/bg04.jpg`, portrait: { symbolCap: 68, glassHeight: 40 } },
  'slot-spice-market': { controls: 'console', frame: 'gilt', symbolFill: 0.98, rowAspect: 1.14, background: `${BG}/bg06.jpg`, portrait: { symbolCap: 70, glassHeight: 38 } },
  'slot-emerald-nights': { controls: 'console', frame: 'gilt', symbolFill: 0.98, rowAspect: 1.16, background: `${BG}/bg07.jpg`, portrait: { symbolCap: 68, glassHeight: 36 } },

  // ---- cold, electric and airless: metal rather than gold ----
  'slot-frost-peak': { controls: 'console', frame: 'chrome', symbolFill: 0.98, rowAspect: 1.2, background: `${BG}/bg01.jpg`, portrait: { symbolCap: 68, glassHeight: 38 } },
  'slot-storm-chaser': { controls: 'console', frame: 'chrome', symbolFill: 0.96, rowAspect: 1.26, background: `${BG}/bg01.jpg`, portrait: { symbolCap: 66, glassHeight: 36 } },
  'slot-supernova': { controls: 'console', frame: 'chrome', symbolFill: 0.96, rowAspect: 1.28, portrait: { symbolCap: 66, glassHeight: 36 } },
  // Like Ocean Drift, Aurora is a 3-4-5-4-3 diamond rather than a 3x5 grid.
  'slot-aurora-borealis': { controls: 'console', frame: 'chrome', symbolFill: 0.96, rowAspect: 1.24, portrait: { symbolCap: 49, glassHeight: 30, rowAspect: 1.1 }, wide: { symbolCap: 58, rowAspect: 1.0, glassHeight: 30 } },
  'slot-vault-breaker': { controls: 'console', frame: 'chrome', symbolFill: 0.98, rowAspect: 1.18, background: `${BG}/bg08.jpg`, portrait: { symbolCap: 68, glassHeight: 36 } },
  'slot-city-lights': { controls: 'console', frame: 'chrome', symbolFill: 0.96, rowAspect: 1.24, portrait: { symbolCap: 67, glassHeight: 36 } },

  // ---- the ones whose own artwork is the room ----
  // No surround, so the room is doing the work and the grid can afford a
  // little more air for it to show through.
  'slot-neon-alley': { controls: 'console', frame: 'none', symbolFill: 0.96, rowAspect: 1.3, portrait: { symbolCap: 66, glassHeight: 34 } },
  // The extra two centre rows need their own fit so the bonus glass remains
  // visible above the dock instead of being hidden behind SPIN.
  'slot-ocean-drift': { controls: 'console', frame: 'none', symbolFill: 0.96, rowAspect: 1.3, portrait: { symbolCap: 48, glassHeight: 30, rowAspect: 1.08 }, wide: { symbolCap: 58, rowAspect: 1.0, glassHeight: 30 } },
  'slot-sunset-strip': { controls: 'console', frame: 'none', symbolFill: 0.96, rowAspect: 1.3, portrait: { symbolCap: 66, glassHeight: 34 } },
  'slot-carnival-row': { controls: 'console', frame: 'none', symbolFill: 0.98, rowAspect: 1.26, portrait: { symbolCap: 66, glassHeight: 34 } },
  'slot-jungle-run': { controls: 'console', frame: 'none', symbolFill: 0.98, rowAspect: 1.26, portrait: { symbolCap: 66, glassHeight: 34 } },
};

/**
 * The room a game is played in.
 *
 * Defaults to THE GAME'S OWN LOBBY TILE. Every game already has a unique,
 * on-theme, hand-made image — Ocean Drift's is a mermaid underwater, Frost
 * Peak's is an ice cavern — and until now each was shown once in the lobby and
 * then thrown away the moment the player tapped it. Twenty-three distinct
 * rooms were already in the repository, being used as thumbnails.
 *
 * That is why the games all felt the same on entry: whatever the tile promised,
 * the machine behind it was the same dark panel. Standing each machine in its
 * own tile is the closest thing to a free fix this codebase has.
 *
 * A named background still wins where one is set, because a few of the rooms in
 * `art/backgrounds` are better rooms than a tile is — they were drawn as
 * backdrops, with the middle deliberately empty.
 */
export function roomFor(gameId: string, hasTile: boolean): string | undefined {
  const named = CABINETS[gameId]?.background;
  if (named) return named;
  return hasTile ? `/art/tiles/${gameId}.jpg` : undefined;
}

export function cabinetFor(gameId: string): CabinetSpec {
  return CABINETS[gameId] ?? DEFAULT_CABINET;
}
