/**
 * What art each game still needs, and the brief for making it.
 *
 *   node scripts/art-manifest.mjs          print it
 *   node scripts/art-manifest.mjs --write  write docs/art-manifest.md
 *
 * WHY THIS EXISTS
 *
 * Twenty-three games share eight symbol sets. Six of them — Neon Alley, Frost
 * Peak, Carnival Row, City Lights, Aurora and Supernova — share ONE set of
 * abstract medallions, so their symbols are byte-identical: Frost Peak deals a
 * flame and a candy. Ocean Drift's tile is a mermaid and its symbols are a
 * pirate's cannon and hat, borrowed from a mining game. And four of the nine
 * symbols (SEVEN, BAR, WILD, SCATTER) are not themed at all, which is why the
 * same 7 turns up in every machine.
 *
 * No amount of code fixes that. It is 23 x 9 pictures, and the only thing worth
 * automating is knowing exactly which ones are missing and what each should be
 * — so that generating them is a morning's work rather than an audit.
 *
 * The briefs below are written to be pasted into an image generator as-is. The
 * technical constraints are not decoration: `scripts/check-art.mjs` rejects
 * assets that fail them, because every one of those failures is invisible until
 * the symbol is on a moving reel on a phone.
 */

import { readdirSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { SLOT_CATALOGUE } = await import(
  resolve(root, 'packages/engine/dist/games/slot-catalogue.js')
);

/** Every symbol a game shows. All nine, not the five a theme covers today. */
const SYMBOLS = [
  ['DIAMOND', 'the top-paying picture: the game\'s hero'],
  ['BELL', 'second picture'],
  ['CHERRY', 'third picture'],
  ['PLUM', 'fourth picture'],
  ['LEMON', 'fifth picture, the commonest'],
  ['SEVEN', 'the numeral 7, built from the theme\'s material'],
  ['BAR', 'a BAR plate, built from the theme\'s material'],
  ['WILD', 'the wild, with the word WILD readable across it'],
  ['SCATTER', 'the scatter, with the word SCATTER readable across it'],
];

/**
 * What each game is ABOUT, in the words its art should answer to.
 *
 * Written per game rather than per theme family, because sharing a family is
 * precisely the problem: "Emerald Nights" and "Jungle Run" are not the same
 * place and must not deal the same animals.
 */
const BRIEFS = {
  'juwa-classic-slots': 'a classic Vegas fruit machine, chrome and cherry-red enamel, 1960s',
  'slot-emerald-nights': 'a moonlit emerald mine, green gemstones, black velvet, silver filigree',
  'slot-royal-flush': 'a royal treasury: crowns, sceptres, red velvet, heavy gold',
  'slot-ocean-drift': 'an underwater reef with a mermaid: pearls, coral, shells, sunken gold, turquoise water',
  'slot-sunset-strip': 'a neon Vegas boulevard at sunset: palm trees, convertibles, hot pink and orange',
  'slot-midnight-gold': 'a midnight bank vault of gold bars, deep navy and warm gold light',
  'slot-neon-alley': 'a rain-slick neon back alley at night: signage, cyan and magenta tubing, wet asphalt',
  'slot-desert-mirage': 'an Egyptian tomb in desert heat: pharaohs, scarabs, sandstone, turquoise inlay',
  'slot-frost-peak': 'a frozen mountain cavern: ice crystals, frost, aurora blue, snow, NOTHING warm',
  'slot-jade-temple': 'a jade temple: carved jade, red lanterns, gold dragons, incense smoke',
  'slot-carnival-row': 'a night carnival: striped tents, ferris wheel, candy floss, painted masks, string lights',
  'slot-jungle-run': 'a deep jungle: panther, orchids, waterfalls, carved stone idols, emerald green',
  'slot-city-lights': 'a skyline of glass towers at night: diamonds, champagne, chrome, cool blue',
  'slot-spice-market': 'a bazaar of spices: saffron, brass lamps, woven rugs, terracotta and gold',
  'slot-aurora-borealis': 'an arctic night under the northern lights: wolves, moon, violet and green sky',
  'slot-dragons-hoard': 'a dragon\'s cave hoard: scales, flame, piled coins, ruby and molten orange',
  'slot-vault-breaker': 'a heist on a bank vault: drills, dynamite, steel doors, diamonds, gunmetal',
  'slot-supernova': 'a star going supernova: plasma, orbiting rock, deep space violet and white heat',
  'slot-pharaohs-vault': 'a pharaoh\'s burial chamber: sarcophagus, canopic jars, lapis and gold',
  'slot-storm-chaser': 'a tornado over open plains: lightning, storm cloud, torn banknotes, electric green',
  'slot-lucky-sevens': 'a furnace of luck: fire, cast iron, molten red sevens, blacksmith\'s forge',
  'slot-triple-bar': 'a jewelled prize wheel: crowns, gems, polished brass, deep burgundy',
  'slot-fruit-stand': 'a bright market fruit stall: ripe fruit, crates, painted signage, daylight',
};

const symbolDir = join(root, 'art/symbols');
const have = new Set(
  existsSync(symbolDir) ? readdirSync(symbolDir).map((f) => f.replace(/\.[a-z0-9]+$/i, '')) : [],
);

const games = SLOT_CATALOGUE.filter((g) => g.model);
const shared = {};
for (const g of games) (shared[g.art ?? 'none'] ??= []).push(g.name);

const lines = [];
lines.push('# Art manifest');
lines.push('');
lines.push('Generated by `node scripts/art-manifest.mjs`. Do not edit by hand.');
lines.push('');
lines.push('## Why every game feels the same');
lines.push('');
lines.push(`${games.length} games share ${Object.keys(shared).length} symbol sets:`);
lines.push('');
lines.push('| Symbol set | Games dealing identical symbols |');
lines.push('| --- | --- |');
for (const [art, names] of Object.entries(shared).sort((a, b) => b[1].length - a[1].length)) {
  lines.push(`| \`${art}\` | ${names.length} — ${names.join(', ')} |`);
}
lines.push('');
lines.push(
  'On top of that, SEVEN, BAR, WILD and SCATTER are not themed by any set, so those four are identical in every game. Their COLOUR now comes from each game\'s accent, which helps, but the shapes are shared.',
);
lines.push('');
lines.push('## What a complete game needs');
lines.push('');
lines.push('Nine PNGs per game, named `<game-id>_<symbol>.png`:');
lines.push('');
for (const [id, note] of SYMBOLS) lines.push(`- \`${id}\` — ${note}`);
lines.push('');
lines.push('## Technical constraints');
lines.push('');
lines.push('`scripts/check-art.mjs` rejects assets that fail these, and every one of');
lines.push('them is invisible until the symbol is on a moving reel on a phone:');
lines.push('');
lines.push('- **Transparent background.** An opaque one shows as a grey box on a dark reel.');
lines.push('- **512x512, square,** subject centred and filling ~80% of the frame.');
lines.push('- **Consistent subject size across the set,** or symbols visibly rescale as the reel spins.');
lines.push('- **Distinct silhouettes.** Two symbols with the same outline and colour cannot be told apart at speed, and players dispute the result.');
lines.push('- **Under 200KB each.** Nine per game across 23 games is a real download.');
lines.push('- **Readable at 46 points.** That is the actual drawn size on a phone.');
lines.push('');
lines.push('## Per-game briefs');
lines.push('');
for (const game of games) {
  const brief = BRIEFS[game.id];
  const prefix = game.id.replace(/^slot-/, '').replace(/-/g, '_');
  const missing = SYMBOLS.filter(([sym]) => !have.has(`${prefix}_${sym.toLowerCase()}`));
  lines.push(`### ${game.name}`);
  lines.push('');
  lines.push(`- id: \`${game.id}\``);
  lines.push(`- currently deals: \`${game.art ?? 'vector only'}\`${shared[game.art ?? 'none']?.length > 1 ? ` — shared with ${shared[game.art ?? 'none'].length - 1} other game(s)` : ''}`);
  lines.push(`- still needed: ${missing.length} of ${SYMBOLS.length}`);
  lines.push('');
  if (brief) {
    lines.push('```');
    lines.push(
      `A set of 9 slot machine symbols for "${game.name}" — ${brief}.`,
    );
    lines.push(
      'Each symbol on its own transparent background, 512x512, centred, filling about 80% of the frame.',
    );
    lines.push(
      'Consistent art style, lighting and subject scale across all 9. Bold readable silhouettes that stay legible at 46 pixels.',
    );
    lines.push('The 9 symbols, in descending pay order:');
    for (const [sym, note] of SYMBOLS) lines.push(`  ${sym}: ${note}`);
    lines.push('```');
    lines.push('');
  }
}

const text = lines.join('\n');
if (process.argv.includes('--write')) {
  const target = join(root, 'docs/art-manifest.md');
  writeFileSync(target, `${text}\n`);
  console.log(`Wrote docs/art-manifest.md — ${games.length} games`);
} else {
  console.log(text);
}
