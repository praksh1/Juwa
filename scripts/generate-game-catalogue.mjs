/**
 * Generate the app's game list from the engine catalogue.
 *
 * The app deliberately does not depend on `@juwa/engine` — the engine computes
 * outcomes, and shipping it to a device the player controls would let a
 * modified client compute favourable ones. But the lobby still has to know what
 * games exist, and a hand-maintained second list drifts: a game gets added to
 * the server and never appears, or appears and cannot be played.
 *
 * So the list is generated at build time from the engine and committed. Engine
 * code never enters the bundle; only names, ids and theme colours do.
 *
 * Run: node scripts/generate-game-catalogue.mjs
 */

import { writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { SLOT_CATALOGUE, SLOT_MODELS } = await import(
  resolve(root, 'packages/engine/dist/games/slot-catalogue.js')
);
const { buildStrips } = await import(resolve(root, 'packages/engine/dist/games/slot-math.js'));
const { resolveRound } = await import(
  resolve(root, 'packages/engine/dist/games/slot-features.js')
);
const { RngStream } = await import(resolve(root, 'packages/engine/dist/rng.js'));

/**
 * What counts as a big win ON THIS MACHINE.
 *
 * ## Why one global threshold could not work
 *
 * The celebration tiers were fixed for the whole app: 25x the stake for a BIG
 * WIN and 60x for a MEGA WIN. Measured over 60,000 spins per model, that meant:
 *
 *   - a BIG WIN arrives about once in 280 spins, so the founder played 100
 *     spins in auto mode and correctly reported never seeing one;
 *   - a MEGA WIN is once in 1,600 to 5,000 spins on most models;
 *   - and on `ways-diamond` a MEGA WIN IS IMPOSSIBLE. Its largest win in
 *     60,000 spins was 49x against a 60x threshold, so the banner could never
 *     fire however long anybody played.
 *
 * The models are not interchangeable — their maximum wins run from 49x to 296x
 * — so a single number is either unreachable on the low-variance games or
 * constant on the high-variance ones.
 *
 * ## So the thresholds are measured, not chosen
 *
 * Each model's distribution is sampled and the thresholds are the payouts at a
 * target FREQUENCY. That makes the promise the same everywhere — a big win is
 * something you see in a session, a jackpot is something you remember — while
 * the multiple behind it differs per machine, which is exactly the fact the
 * player does not need to know.
 *
 * The frequencies are the industry's rough shape and are stated as odds rather
 * than multiples because odds are what a player experiences.
 */
/*
 * How often each tier should arrive, in spins.
 *
 * These were 90 / 600 / 6000, which put a big win at roughly 12x the stake on
 * a typical model. The founder's note: the celebrations "can happen more
 * frequently — doesn't have to be a Big Win or Mega or Jackpot ... let's say
 * if the players win 3X or 4X their bet amounts". So the frequencies come
 * down hard, and the floor below turns that into a promise rather than an
 * average: a big win is at least three times the stake and at most six,
 * whatever the model's own distribution says.
 *
 * The three tiers stay clearly apart — that was the point of measuring them
 * per model in the first place — they simply all move closer to the player.
 */
const TIER_FREQUENCY = { big: 18, mega: 140, jackpot: 1400 };
/**
 * The band a big win must land in, as a multiple of the stake.
 *
 * A frequency alone cannot promise a multiple: a low-volatility model at one
 * spin in eighteen might put its big win at 2.4x, which is not a big anything.
 * Clamped, so every machine in the catalogue announces a BIG WIN somewhere
 * between three and six times the stake and the wording means one thing.
 */
const BIG_WIN_BAND = { min: 3, max: 6 };
/** Enough that the 1-in-6000 quantile is measured rather than extrapolated. */
const TIER_SAMPLES = 60_000;

function measureTiers(model) {
  const strips = buildStrips(model.math);
  const wins = [];
  for (let i = 0; i < TIER_SAMPLES; i += 1) {
    const rng = new RngStream(`tiers-${model.id}`, 'calibration', i);
    const m = resolveRound(strips, model.math, rng).totalMultiplier;
    if (m > 0) wins.push(m);
  }
  wins.sort((a, b) => b - a);

  /*
   * The payout at "one spin in N". Taken from the sorted wins by index, so it
   * is a real observed payout rather than a curve fitted to one — and clamped
   * to the largest win actually seen, so a threshold can never be set beyond
   * what the machine can pay.
   */
  const at = (n) => {
    const index = Math.floor(TIER_SAMPLES / n);
    const value = wins[Math.min(index, wins.length - 1)] ?? 0;
    return Math.max(2, Math.round(value * 10) / 10);
  };

  const big = Math.min(BIG_WIN_BAND.max, Math.max(BIG_WIN_BAND.min, at(TIER_FREQUENCY.big)));
  // Each tier stays a clear step above the one below, so a player who has seen
  // all three can tell them apart by size as well as by banner.
  const mega = Math.max(big * 2.4, at(TIER_FREQUENCY.mega));
  const jackpot = Math.max(mega * 2.2, at(TIER_FREQUENCY.jackpot));
  return {
    big,
    mega: Math.round(mega * 10) / 10,
    jackpot: Math.round(jackpot * 10) / 10,
  };
}

/** Rows per reel, whether the model declared one number or a shape. */
const heights = (math) =>
  typeof math.rows === 'number'
    ? Array.from({ length: math.reels }, () => math.rows)
    : [...math.rows];

/**
 * How many ways there are to win, in whichever sense the model means it.
 *
 * A line game has as many as it has paylines. A ways game has the product of
 * its reel heights — that is the 720 in "720 ways", and it is the number the
 * player is shown. Reading `.length` off the string `'ways'` returns 4, which
 * is exactly the sort of wrong answer that looks plausible on a lobby tile.
 */
const wayCount = (math) =>
  math.paylines === 'ways'
    ? heights(math).reduce((product, h) => product * h, 1)
    : math.paylines.length;

const entries = SLOT_CATALOGUE.map((game) => {
  const model = SLOT_MODELS[game.model];
  return {
    id: game.id,
    name: game.name,
    category: 'slots',
    rtp: model.rtp,
    volatility: model.volatility,
    reels: model.math.reels,
    rows: heights(model.math),
    lines: wayCount(model.math),
    pays: model.math.paylines === 'ways' ? 'ways' : 'lines',
    ...(model.math.cascade ? { cascades: true } : {}),
    // Which bonus this game plays. The lobby uses it to say so on the tile and
    // the game screen uses it to know which round to draw.
    ...(model.math.feature ? { feature: model.math.feature.kind } : {}),
    minBet: game.limits.min,
    maxBet: game.limits.max,
    theme: game.theme,
    model: game.model,
    ...(game.tag ? { tag: game.tag } : {}),
    ...(game.art ? { art: game.art } : {}),
  };
});

/**
 * The paytables, one per MODEL rather than one per game.
 *
 * Twenty-three themes share five pieces of maths. Emitting a paytable per game
 * would put five facts into twenty-three places, and the first thing to go
 * wrong would be a reskin showing a paytable its own model does not pay.
 *
 * Two different units are in play and the labels below are not decoration:
 *
 *   Line pays are quoted PER LINE. `evaluateGrid` divides the sum of line wins
 *   by the payline count, so a 12x line win on a 20-line game returns 0.6x the
 *   total stake. Quoting these against the total bet would understate every
 *   row by the line count.
 *
 *   Scatter pays are quoted against the TOTAL bet — they pay from anywhere on
 *   the grid and are not attached to a line at all.
 *
 * `payoutScale` is folded in here rather than shown separately. It is a
 * calibration knob on the model, not a fact about the game, and a paytable
 * that needs the player to multiply by 0.7384 is not a paytable.
 */
const models = {};
for (const [id, model] of Object.entries(SLOT_MODELS)) {
  const scale = model.math.payoutScale ?? 1;
  /*
   * The EXACT multiplier — the same float the engine multiplies by, untouched.
   *
   * This rounded to two decimals, on the reasoning that a paytable does not
   * want a tail of digits. But the paytable does not show these numbers at
   * all: `GameRules` turns each one into coins at the player's own bet, so the
   * decimals were never on screen and rounding them only moved the coin figure
   * away from what the machine pays.
   *
   * It moved it a long way on the ways models, where the calibration scale is
   * 0.1186 and a pay of 0.3558 printed as 0.36 — a 1.18% overstatement, worth
   * 210 coins on one three-of-a-kind at the maximum stake and multiplied again
   * by every way that symbol can be read. Measured over the whole catalogue,
   * 347 paytable rows disagreed with the settlement and 190 of them promised
   * more than the machine pays.
   *
   * Not even tidied to twelve significant digits, which was the first attempt:
   * `60 * 0.477` is 28.619999999999997 and tidying it to 28.62 is a DIFFERENT
   * float, so the paytable floored to 143,100 where the engine floored to
   * 143,099. A one-coin lie is still a lie. Emitting the engine's own value
   * makes the two expressions bit-identical, which is the only way `floor` on
   * either side can be guaranteed to agree.
   *
   * The ugly tails in the generated file are the point. Nobody reads them; the
   * player reads coins.
   */
  const round = (n) => n;
  models[id] = {
    id,
    lines: wayCount(model.math),
    pays: model.math.paylines === 'ways' ? 'ways' : 'lines',
    ...(model.math.cascade ? { cascade: { ...model.math.cascade, ladder: [...model.math.cascade.ladder] } } : {}),
    symbols: model.math.symbols
      .filter((s) => s.kind !== 'scatter')
      .map((s) => ({
        id: s.id,
        kind: s.kind,
        pays: { 3: round(s.pays[3] * scale), 4: round(s.pays[4] * scale), 5: round(s.pays[5] * scale) },
      })),
    scatterPays: Object.fromEntries(
      Object.entries(model.math.scatterPays).map(([n, v]) => [n, round(v * scale)]),
    ),
    freeSpinsAwarded: { ...model.math.freeSpinsAwarded },
    freeSpinMultiplier: model.math.freeSpinMultiplier,
    // Stake multiples at which each celebration fires, measured per model.
    // See measureTiers.
    tiers: measureTiers(model),
    /*
     * The feature, in the detail the CLIENT needs to draw it.
     *
     * The wheel's face has to be exactly the model's: the server sends a
     * winning segment INDEX, so a client drawing a different set of segments
     * would stop the pointer on a number the player was not paid. Scaled like
     * every other figure here, for the same reason.
     */
    ...(model.math.feature
      ? {
          feature:
            model.math.feature.kind === 'wheel'
              ? {
                  kind: 'wheel',
                  // NOT scaled — see resolveWheel. The segment on screen is the
                  // segment that pays.
                  segments: [...model.math.feature.segments],
                }
              : model.math.feature.kind === 'hold-spin'
                ? { kind: 'hold-spin', respins: model.math.feature.respins }
                : { kind: 'expanding-wild', reels: [...model.math.feature.reels] },
        }
      : {}),
  };
}

const field = (k, v) => {
  if (typeof v === 'string') return `${k}: '${v.replace(/'/g, "\\'")}'`;
  // Arrays need brackets. Without this the ragged shapes emitted
  // `rows: 3,4,5,4,3`, which is four extra object fields and a syntax error.
  if (Array.isArray(v)) return `${k}: [${v.join(', ')}]`;
  return `${k}: ${v}`;
};

const body = entries
  .map((e) => {
    const parts = Object.entries(e).map(([k, v]) =>
      k === 'theme'
        ? `theme: { ${Object.entries(v).map(([tk, tv]) => field(tk, tv)).join(', ')} }`
        : field(k, v),
    );
    return `  { ${parts.join(', ')} },`;
  })
  .join('\n');

const output = `/**
 * GENERATED FILE — do not edit.
 *
 * Written by scripts/generate-game-catalogue.mjs from the engine's
 * SLOT_CATALOGUE. Re-run it after changing the catalogue; the build checks
 * that this file is current.
 *
 * The app cannot import @juwa/engine (see api/games.ts), so this is the
 * lobby's copy of what the server can actually deal.
 */

import type { SlotGame, SlotModelInfo } from './games';

export const SLOT_GAMES: SlotGame[] = [
${body}
];

/** Paytables by model id. See the note in the generator about the two units. */
export const SLOT_MODEL_INFO: Record<string, SlotModelInfo> = ${JSON.stringify(models, null, 2)
  .replace(/^/gm, '')};
`;

const target = resolve(root, 'app/src/api/slot-games.generated.ts');
writeFileSync(target, output);
console.log(`Wrote ${entries.length} games to app/src/api/slot-games.generated.ts`);
