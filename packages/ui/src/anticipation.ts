/**
 * Which reels still have the bonus round live on them.
 *
 * Anticipation is the moment a slot machine is actually about. Two scatters
 * are showing, a third would trigger the round, and the remaining reels slow
 * down and light up so the player can see it coming. A machine that stops on
 * schedule with no signal has thrown away the most valuable two seconds it
 * had — the outcome is identical and the experience is not.
 *
 * This lives in the design-system package rather than in the screen because it
 * is motion policy, alongside `motion.nearMissExtension`, and because a pure
 * function here can be tested. The screen owns how LONG each reel is held; this
 * owns WHICH reels are held at all.
 */

/**
 * One flag per reel, in reel order.
 *
 * A reel anticipates when the scatters ALREADY SHOWING on the reels that stop
 * before it are enough that one more would reach the trigger. With a
 * three-scatter trigger and two showing on the first two reels, reels three,
 * four and five all light up: the tension travels across the machine instead
 * of appearing once at the end.
 *
 * It keeps going after the trigger is met, deliberately. Four scatters award
 * more spins than three, so a player already holding three has more to chase,
 * not less.
 *
 * LINE WINS ARE EXCLUDED ON PURPOSE. With wilds and twenty paylines almost
 * every spin leaves something technically live, and a machine that anticipates
 * every spin has stopped anticipating anything.
 *
 * @param grid          Reel-major: `grid[reel][row]`, as the engine deals it.
 * @param triggerCount  Scatters needed for free spins. Below 2 disables the
 *                      effect — a game with no bonus round has nothing to
 *                      anticipate, and a trigger of 1 would light the machine
 *                      on every spin that showed a single scatter.
 */
export function anticipatingReels(
  grid: readonly (readonly string[])[],
  triggerCount: number,
  scatterSymbol = 'SCATTER',
): boolean[] {
  const flags = new Array<boolean>(grid.length).fill(false);
  if (!Number.isFinite(triggerCount) || triggerCount < 2) return flags;

  let scatters = 0;
  for (let reel = 0; reel < grid.length; reel++) {
    // Decided from what is showing BEFORE this reel lands.
    //
    // Counting this reel's own symbols first would be reading the future: the
    // machine would light up for a scatter the player cannot see yet, and stay
    // dark on exactly the spins where one was genuinely still possible. Both
    // failures are visible to anyone watching closely, and the second is the
    // one that makes the effect worthless.
    if (reel > 0 && scatters >= triggerCount - 1) flags[reel] = true;
    for (const symbol of grid[reel] ?? []) if (symbol === scatterSymbol) scatters++;
  }
  return flags;
}
