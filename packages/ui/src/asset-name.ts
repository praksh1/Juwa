/**
 * What to call a symbol, taken from the file it is drawn from.
 *
 * A slot engine deals fixed symbol ids — LEMON, CHERRY, BELL — and a themed
 * game redraws them. Under a pirate theme the symbol the maths calls LEMON is
 * a pirate's hat. Announcing the ENGINE id then describes something that is not
 * on the screen: a win on four hats reads as "4x LEMON" over a machine with no
 * lemon anywhere on it, and a player reports that, correctly, as the machine
 * paying for symbols that were not there.
 *
 * The name comes from the asset path rather than a table written beside it.
 * `pirate_hat.png` is already the answer. A hand-kept list of names for
 * forty-five images is a second place for the truth to live, and the first time
 * an artist swaps a file the list is wrong in exactly the way this exists to
 * prevent.
 */

/**
 * @param path  Asset path, e.g. `/art/symbols/pirate_treasure_chest.png`.
 *              Undefined when the symbol has no themed art at all.
 * @param fallback  The engine id. Correct whenever it is also what is drawn —
 *              SEVEN, BAR, WILD and SCATTER are never re-skinned, and an
 *              unthemed game really does show a lemon.
 */
export function assetDisplayName(path: string | undefined, fallback: string): string {
  if (!path) return fallback;
  const file = path.split('/').pop() ?? '';
  const stem = file.replace(/\.[a-z0-9]+$/i, '');
  // Drop the family prefix: `pirate_treasure_chest` -> `TREASURE CHEST`.
  const words = stem.split('_').filter(Boolean).slice(1);
  if (words.length === 0) return fallback;
  return words.join(' ').toUpperCase();
}
