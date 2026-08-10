/**
 * What a single cell on a reel should be doing.
 *
 * Four states and four inputs, which is small enough to look obvious and
 * exactly big enough to get wrong. The failure modes are not subtle:
 *
 *   - Check "dimmed" before "winning" and the symbols that paid are the ones
 *     that fade out.
 *   - Forget that the strip is longer than the window and the filler symbols
 *     scrolling past off-screen start breathing, dimming and catching the
 *     light along with the real ones.
 *   - Forget the phase and a moving reel's symbols pulse while they fly past.
 *
 * None of those show up in a screenshot of a stationary machine, and all of
 * them are visible immediately in motion — which is the worst combination for
 * something guarded only by review. So it is a pure function with a truth
 * table over it.
 */

export type SymbolState =
  /** Landed, nothing happening. Breathes gently. */
  | 'resting'
  /** Landed and paying. Pulses and catches the light. */
  | 'winning'
  /** Landed, but something else paid. Holds still and fades back. */
  | 'dimmed'
  /** On a moving reel, or off the end of the window. Perfectly still. */
  | 'moving';

export interface SymbolStateInput {
  /** Whether the reel is turning. Only `idle` means the result is settled. */
  reelIdle: boolean;
  /**
   * Which visible row this cell is, or negative if it is filler.
   *
   * The strip carries far more symbols than the window shows. Everything above
   * the result is decoration scrolling past, and it must never take part in a
   * win presentation it is not in.
   */
  row: number;
  /** This cell is part of a win currently being shown. */
  paying: boolean;
  /** Some win is being shown somewhere on the machine. */
  celebrating: boolean;
}

export function symbolState({
  reelIdle,
  row,
  paying,
  celebrating,
}: SymbolStateInput): SymbolState {
  // A moving reel, or a symbol that is not in the window at all.
  if (!reelIdle || row < 0) return 'moving';
  // Winning is checked FIRST and unconditionally. A paying cell is never
  // dimmed, whatever else is happening.
  if (paying) return 'winning';
  // Dimming needs something to dim FOR. Outside a celebration every symbol is
  // equal, and a permanently faded grid just looks broken.
  return celebrating ? 'dimmed' : 'resting';
}
