/**
 * Layout decisions that depend on how much screen there actually is.
 *
 * A phone held sideways is not a small tablet — it is about 320 points tall,
 * and Safari's chrome, an app header and a tab bar can eat 40% of that before
 * the game gets any. The slot machine ran off the bottom and the spin button
 * was unreachable, which is the whole of "I cannot play in landscape".
 *
 * The fix is to stop spending height on things that are not the game.
 */

import { useWindowDimensions } from 'react-native';

/**
 * Below this, height is the scarce resource and decoration has to go.
 *
 * 520 rather than a strict orientation check: a small phone in portrait with a
 * large accessibility text size has the same problem as a large phone in
 * landscape, and asking "is there room" answers both. Checking width > height
 * would fix one and leave the other.
 */
export const COMPACT_HEIGHT = 520;

export function useCompactLayout(): boolean {
  const { height } = useWindowDimensions();
  return height < COMPACT_HEIGHT;
}
