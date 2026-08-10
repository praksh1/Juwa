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
   * Room behind the reels, from `art/backgrounds`.
   *
   * Twelve of these have been sitting in the repository referenced by nothing
   * at all. They are deliberately dark and low-contrast because a symbol has to
   * read on top of them, which is exactly why they work as a room rather than
   * as a picture competing with the game.
   */
  background?: string;
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
  'juwa-classic-slots': { controls: 'lever', frame: 'timber', background: `${BG}/bg03.jpg` },
  'slot-triple-bar': { controls: 'lever', frame: 'timber', background: `${BG}/bg08.jpg` },
  'slot-fruit-stand': { controls: 'lever', frame: 'timber', background: `${BG}/bg05.jpg` },
  'slot-lucky-sevens': { controls: 'lever', frame: 'timber', background: `${BG}/bg02.jpg` },

  // ---- temples, tombs and hoards: gold, and a room with pillars in it ----
  'slot-desert-mirage': { controls: 'console', frame: 'gilt', background: `${BG}/egypt.jpg` },
  'slot-pharaohs-vault': { controls: 'console', frame: 'gilt', background: `${BG}/egypt.jpg` },
  'slot-jade-temple': { controls: 'console', frame: 'gilt', background: `${BG}/bg09.jpg` },
  'slot-dragons-hoard': { controls: 'console', frame: 'gilt', background: `${BG}/bg10.jpg` },
  'slot-royal-flush': { controls: 'console', frame: 'gilt', background: `${BG}/bg11.jpg` },
  'slot-midnight-gold': { controls: 'console', frame: 'gilt', background: `${BG}/bg04.jpg` },
  'slot-spice-market': { controls: 'console', frame: 'gilt', background: `${BG}/bg06.jpg` },
  'slot-emerald-nights': { controls: 'console', frame: 'gilt', background: `${BG}/bg07.jpg` },

  // ---- cold, electric and airless: metal rather than gold ----
  'slot-frost-peak': { controls: 'console', frame: 'chrome', background: `${BG}/bg01.jpg` },
  'slot-storm-chaser': { controls: 'console', frame: 'chrome', background: `${BG}/bg01.jpg` },
  'slot-supernova': { controls: 'console', frame: 'chrome' },
  'slot-aurora-borealis': { controls: 'console', frame: 'chrome' },
  'slot-vault-breaker': { controls: 'console', frame: 'chrome', background: `${BG}/bg08.jpg` },
  'slot-city-lights': { controls: 'console', frame: 'chrome' },

  // ---- the ones whose own artwork is the room ----
  'slot-neon-alley': { controls: 'console', frame: 'none' },
  'slot-ocean-drift': { controls: 'console', frame: 'none' },
  'slot-sunset-strip': { controls: 'console', frame: 'none' },
  'slot-carnival-row': { controls: 'console', frame: 'none' },
  'slot-jungle-run': { controls: 'console', frame: 'none' },
};

export function cabinetFor(gameId: string): CabinetSpec {
  return CABINETS[gameId] ?? DEFAULT_CABINET;
}
