# Juwa — Game Inventory

A complete inventory of every game in this repository: what it is, which files
define it, and the configuration that drives it. Everything below was read out
of the source, not from the docs — where the two disagree, that is noted at the
end.

**Scope note on game types.** The task asked for slot / keno / fish / table.
This project has **slots**, **table** games and a category it calls **instant**
(the "originals": Crash, Limbo, Dice, Plinko, Mines). There is **no keno game
and no fish game** anywhere in the codebase. Keno appears only as a worked
example in `docs/04-adding-a-game.md` and as a roadmap line in
`docs/02-roadmap.md`; fish games are explicitly ruled out in
`docs/11-instant-games.md:54` as licensed content. Three further tiles
(Texas Hold'em, Jacks or Better, Golden Scratch) exist in the lobby as greyed-out
placeholders with no engine behind them.

---

## 1. At a glance

| Category | Count | Playable | Where the engine lives |
|---|---|---|---|
| Slots | 23 themes over 8 maths models | ✅ | `packages/engine/src/games/slots.ts` + `slot-catalogue.ts` + `slot-math.ts` |
| Table | 2 (Blackjack, European Roulette) | ✅ | `blackjack.ts`, `roulette.ts` |
| Instant / "originals" | 5 (Crash, Limbo, Dice, Plinko, Mines) | ✅ | `crash.ts`, `dice.ts`, `plinko.ts`, `mines.ts` + `instant-math.ts` |
| Poker | 2 tiles | ❌ placeholder | none |
| Instant (scratch) | 1 tile | ❌ placeholder | none |
| Keno | 0 | — | not implemented |
| Fish / arcade shooter | 0 | — | explicitly out of scope |

**30 games are registered on the server** (23 slots + 2 table + 5 instant).
Registration happens in one place: `packages/engine/src/games/registry.ts:47-57`.

Key architectural facts that apply to every game:

- Every engine implements `GameEngine` (`packages/engine/src/games/types.ts:104`)
  and is **server-only**. The app deliberately does not depend on `@juwa/engine`.
- Engines are **pure**: no clock, no `Math.random()`, no module state. All
  randomness arrives through an injected `RngStream`
  (`packages/engine/src/rng.ts:73`) built from HMAC-SHA256 over
  `serverSeed / clientSeed / nonce`, so any round can be replayed from its seeds.
- Multi-step engines must draw **all** their randomness in `init` — `act` runs on
  a fresh stream rebuilt from the same seed and would otherwise replay the same
  bytes. Blackjack shuffles the whole shoe up front; Mines shuffles all 25 tiles
  up front.
- `RoundState.private` (the rest of the shoe, the mine positions) is stripped by
  `toClientView()` (`types.ts:150`) before anything is serialised.

---

## 2. Slots

### 2.1 The files

| File | Role |
|---|---|
| `packages/engine/src/games/slot-catalogue.ts` | **The data.** 8 maths models (`SLOT_MODELS`, line 246) and 23 themed games (`SLOT_CATALOGUE`, line 420). |
| `packages/engine/src/games/slot-math.ts` | **The evaluator.** Strip generation, line evaluation, ways evaluation, cascades. Shared by all 23 games. |
| `packages/engine/src/games/slots.ts` | `SlotsEngine` — wraps a catalogue entry as a `GameEngine`; resolves base spin + free spins in one call. |
| `packages/engine/src/games/registry.ts` | Registers `allSlotEngines()`. |
| `app/src/api/slot-games.generated.ts` | Generated lobby copy of the catalogue (the app can't import the engine). |
| `scripts/generate-game-catalogue.mjs` | Generates the above from `SLOT_CATALOGUE`. |
| `app/src/screens/SlotsScreen.tsx` | The one renderer used by all 23 slots. |
| `app/src/api/cabinets.ts` | Per-game cabinet styling (lever/console, frame, background art). Presentation only. |

There is **one slot engine**, not 23. A new slot is a data entry in
`SLOT_CATALOGUE`; it cannot introduce a settlement bug because it carries no
settlement code.

### 2.2 The 8 maths models

`SLOT_MODELS` — `packages/engine/src/games/slot-catalogue.ts:246`

| Model | Reels | Rows | Paylines / ways | RTP (measured) | Volatility | Strip length | `payoutScale` | Scatter pays (× total bet) | Free spins | FS multiplier | Cascade |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `classic-20` | 5 | 3 | 20 lines | **0.9604** | low | 30 (hand-authored strips) | — (1.0) | 3→3, 4→15, 5→75 | 3→8, 4→12, 5→20 | ×3 | — |
| `lines-10` | 5 | 3 | 10 lines | **0.9500** | medium | 32 | 0.7384 | 3→4, 4→18, 5→90 | 3→10, 4→15, 5→25 | ×3 | — |
| `lines-25` | 5 | 3 | 25 lines | **0.9592** | medium | 34 | 0.9048 | 3→3, 4→14, 5→70 | 3→8, 4→14, 5→22 | ×3 | — |
| `high-vol` | 5 | 3 | 20 lines | **0.9500** | very-high | 36 | 0.5985 | 3→5, 4→25, 5→150 | 3→12, 4→18, 5→30 | ×5 | — |
| `ways-diamond` | 5 | **3-4-5-4-3** | **720 ways** | **0.9578** | low | 36 | 0.1186 | 3→3, 4→15, 5→75 | 3→8, 4→12, 5→20 | ×2 | — |
| `tumble-20` | 5 | 3 | 20 lines | **0.9437** | high | 32 | 1.0991 | none | none | ×1 | ladder `[2,3,5,10]`, max 8 drops |
| `classic-3x3` | 3 | 3 | 5 lines | **0.9480** | medium | 26 | 0.8107 | none | none | ×1 | — |
| `classic-3` | 3 | 1 | 1 line | **0.9479** | high | 24 | 0.7409 | none | none | ×1 | — |

`payoutScale` is a single calibration multiplier applied to every payout
(`slot-math.ts:414`). It sets the *level* of the return; the paytable sets the
*shape*. Each value was derived as `target ÷ measured`, not guessed.

**Payline shapes** (`slot-catalogue.ts:32-57`), given as a row index per reel:

- `LINES_20` — the 20 standard 5×3 patterns, starting `[1,1,1,1,1]` (centre),
  `[0,0,0,0,0]` (top), `[2,2,2,2,2]` (bottom), then V/zig-zag variants.
- `LINES_10` = the first 10 of those. `LINES_25` = those 20 plus 5 more.
- `LINES_5` (3×3) = `[1,1,1] [0,0,0] [2,2,2] [0,1,2] [2,1,0]`.
- `LINES_1` (3×1) = `[0,0,0]`.
- `ways-diamond` has **no paylines at all** — `paylines: 'ways'`.

### 2.3 Symbol list

Nine symbol shapes exist in total (`slot-math.ts:28`):
`WILD`, `SCATTER`, `SEVEN`, `DIAMOND`, `BELL`, `BAR`, `CHERRY`, `PLUM`, `LEMON`.
A model may use any subset. `PAYING_SYMBOL_LIST` (`slots.ts:141`) is the seven
non-special ones.

Which models use which:

| Model(s) | Symbols used |
|---|---|
| `classic-20` | all 9 |
| `lines-10`, `lines-25`, `high-vol` | all 9 |
| `ways-diamond` | all 9 (WILD pays nothing of its own) |
| `tumble-20` | 8 — **no WILD** (a wild surviving a cascade compounds unboundedly) |
| `classic-3x3`, `classic-3` | 7 — **no SCATTER** (hence no bonus round) |

### 2.4 Payout tables

All figures are **per-line multipliers** unless stated. `evaluateGrid` sums line
wins and divides by the payline count (`payDivisor`, `slot-math.ts:156`), so a
20× line win on a 20-line game returns 1× the total stake. Ways games divide by
1 — the player buys all 720 ways at once.

#### `classic-20` — hand-authored, `payoutScale` 1.0

| Symbol | Kind | Weights (per reel) | 3 | 4 | 5 |
|---|---|---|---|---|---|
| WILD | wild | 1,1,1,1,1 | 65 | 400 | 2500 |
| SCATTER | scatter | 1,1,1,1,1 | — | — | — |
| SEVEN | normal | 2,2,2,2,2 | 50 | 250 | 1250 |
| DIAMOND | normal | 2,2,2,2,2 | 40 | 160 | 650 |
| BELL | normal | 3,3,3,3,3 | 25 | 100 | 400 |
| BAR | normal | 4,4,4,4,4 | 15 | 50 | 200 |
| CHERRY | normal | 6,6,6,6,6 | 9 | 30 | 100 |
| PLUM | normal | 6,6,6,6,6 | 8 | 20 | 60 |
| LEMON | normal | 6,6,6,6,6 | 5 | 15 | 50 |

This is the only model with **explicit reel strips** (`CLASSIC_STRIPS`,
`slot-catalogue.ts:75`) — 30 positions per reel, written out by hand and kept
verbatim so the published figure doesn't move. Its `weights` are informational.

#### The five-reel family — `fiveReelSymbols(spread)`, `slot-catalogue.ts:111`

Payouts are generated: `3 = base`, `4 = round(base × 4 × spread)`,
`5 = round(base × 18 × spread)`. Weights are shared across the three models.

| Symbol | Weights | base | `lines-10` (spread 1.15) | `lines-25` (spread 1.05) | `high-vol` (spread 1.6) |
|---|---|---|---|---|---|
| WILD | 2,4,5,4,2 | 60 | 60 / 276 / 1242 | 60 / 252 / 1134 | 60 / 384 / 1728 |
| SCATTER | 3,3,3,3,3 | — | 0 | 0 | 0 |
| SEVEN | 6,6,6,6,5 | 45 | 45 / 207 / 931 | 45 / 189 / 851 | 45 / 288 / 1296 |
| DIAMOND | 8,8,8,8,7 | 35 | 35 / 161 / 725 | 35 / 147 / 662 | 35 / 224 / 1008 |
| BELL | 11×5 | 22 | 22 / 101 / 455 | 22 / 92 / 416 | 22 / 141 / 634 |
| BAR | 14×5 | 14 | 14 / 64 / 290 | 14 / 59 / 265 | 14 / 90 / 403 |
| CHERRY | 17×5 | 9 | 9 / 41 / 186 | 9 / 38 / 170 | 9 / 58 / 259 |
| PLUM | 19×5 | 7 | 7 / 32 / 145 | 7 / 29 / 132 | 7 / 45 / 202 |
| LEMON | 20×5 | 5 | 5 / 23 / 103 | 5 / 21 / 95 | 5 / 32 / 144 |

Note WILD's weights `[2,4,5,4,2]` — scarcest on reels one and five, which is what
makes near-misses common and full lines rare. Each model then multiplies every
payout by its own `payoutScale` (0.7384 / 0.9048 / 0.5985).

#### `ways-diamond` — `waysSymbols()`, `slot-catalogue.ts:146`

| Symbol | Weights | 3 | 4 | 5 |
|---|---|---|---|---|
| WILD | **0,1,1,1,0** | 0 | 0 | 0 |
| SCATTER | 3,3,3,3,3 | — | — | — |
| SEVEN | 8×5 | 3 | 9 | 30 |
| DIAMOND | 9×5 | 2.2 | 6.6 | 22 |
| BELL | 11×5 | **0** | 4.5 | 18 |
| BAR | 12×5 | **0** | 3 | 12 |
| CHERRY | 13×5 | **0** | 2 | 8 |
| PLUM | 14×5 | **0** | 1.5 | 6 |
| LEMON | 15×5 | **0** | 1.1 | 4.4 |

Two deliberate departures, both documented in the source: only the top two
symbols pay from three reels (everything else needs four — otherwise 93% of
spins "win" less than the stake, a *loss disguised as a win*), and WILD pays
nothing of its own because on a ways grid it substitutes for every symbol
simultaneously. After `payoutScale` 0.1186 these are small numbers — correct,
because a ways win is quoted against the whole stake and multiplied by the
number of ways (up to 3×4×5×4×3 = 720).

#### `tumble-20` — `tumbleSymbols()`, `slot-catalogue.ts:201`

`3 = base`, `4 = base × 5`, `5 = base × 20`; `payoutScale` 1.0991. No WILD.

| Symbol | Weights | 3 | 4 | 5 |
|---|---|---|---|---|
| SCATTER | 3×5 | — | — | — |
| SEVEN | 7×5 | 40 | 200 | 800 |
| DIAMOND | 9×5 | 30 | 150 | 600 |
| BELL | 12×5 | 20 | 100 | 400 |
| BAR | 15×5 | 13 | 65 | 260 |
| CHERRY | 18×5 | 8 | 40 | 160 |
| PLUM | 20×5 | 6 | 30 | 120 |
| LEMON | 22×5 | 4 | 20 | 80 |

#### `classic-3x3` and `classic-3` — `THREE_REEL_SYMBOLS`, `slot-catalogue.ts:216`

Three-of-a-kind only (there is no fourth reel). No SCATTER, so no free spins.

| Symbol | Weights | 3 |
|---|---|---|
| WILD | 2,2,2 | 400 |
| SEVEN | 4,4,3 | 200 |
| BAR | 8,8,8 | 60 |
| BELL | 10,10,10 | 40 |
| CHERRY | 14,14,14 | 20 |
| PLUM | 16,16,16 | 12 |
| LEMON | 18,18,18 | 8 |

`payoutScale`: 0.8107 for `classic-3x3`, 0.7409 for `classic-3`.

### 2.5 The 23 games

`SLOT_CATALOGUE` — `packages/engine/src/games/slot-catalogue.ts:420`

| # | Name | Game id | Model | RTP | Reels × rows | Lines/ways | Min bet | Max bet | Art family | Tag |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | **Juwa Classic** | `juwa-classic-slots` | `classic-20` | 0.9604 | 5×3 | 20 lines | 20 | 50,000 | fruit | hot |
| 2 | Emerald Nights | `slot-emerald-nights` | `classic-20` | 0.9604 | 5×3 | 20 lines | 20 | 50,000 | jungle | |
| 3 | Royal Fortune | `slot-royal-flush` | `classic-20` | 0.9604 | 5×3 | 20 lines | 20 | 50,000 | myth | |
| 4 | Ocean Drift | `slot-ocean-drift` | `ways-diamond` | 0.9578 | 5× 3-4-5-4-3 | 720 ways | 10 | 10,000 | pirate | |
| 5 | Sunset Strip | `slot-sunset-strip` | `classic-20` | 0.9604 | 5×3 | 20 lines | 20 | 50,000 | wildwest | |
| 6 | Midnight Gold | `slot-midnight-gold` | `lines-10` | 0.9500 | 5×3 | 10 lines | 20 | 50,000 | wildwest | |
| 7 | Neon Alley | `slot-neon-alley` | `lines-10` | 0.9500 | 5×3 | 10 lines | 20 | 50,000 | orb | new |
| 8 | Desert Mirage | `slot-desert-mirage` | `lines-10` | 0.9500 | 5×3 | 10 lines | 20 | 50,000 | egypt | |
| 9 | Frost Peak | `slot-frost-peak` | `lines-10` | 0.9500 | 5×3 | 10 lines | 10 | 10,000 | orb | |
| 10 | Jade Temple | `slot-jade-temple` | `ways-diamond` | 0.9578 | 5× 3-4-5-4-3 | 720 ways | 20 | 50,000 | asian | |
| 11 | Carnival Row | `slot-carnival-row` | `lines-25` | 0.9592 | 5×3 | 25 lines | 20 | 50,000 | orb | |
| 12 | Jungle Run | `slot-jungle-run` | `lines-25` | 0.9592 | 5×3 | 25 lines | 20 | 50,000 | jungle | |
| 13 | City Lights | `slot-city-lights` | `tumble-20` | 0.9437 | 5×3 | 20 lines + cascade | 20 | 50,000 | orb | |
| 14 | Spice Market | `slot-spice-market` | `lines-25` | 0.9592 | 5×3 | 25 lines | 10 | 10,000 | asian | |
| 15 | Aurora | `slot-aurora-borealis` | `ways-diamond` | 0.9578 | 5× 3-4-5-4-3 | 720 ways | 20 | 50,000 | orb | |
| 16 | Dragon's Hoard | `slot-dragons-hoard` | `high-vol` | 0.9500 | 5×3 | 20 lines | 100 | 200,000 | asian | mega |
| 17 | Vault Breaker | `slot-vault-breaker` | `high-vol` | 0.9500 | 5×3 | 20 lines | 100 | 200,000 | pirate | |
| 18 | Supernova | `slot-supernova` | `tumble-20` | 0.9437 | 5×3 | 20 lines + cascade | 20 | 50,000 | orb | new |
| 19 | Pharaoh's Vault | `slot-pharaohs-vault` | `high-vol` | 0.9500 | 5×3 | 20 lines | 100 | 200,000 | egypt | |
| 20 | Storm Chaser | `slot-storm-chaser` | `tumble-20` | 0.9437 | 5×3 | 20 lines + cascade | 20 | 50,000 | myth | |
| 21 | Lucky Sevens | `slot-lucky-sevens` | `classic-3` | 0.9479 | 3×1 | 1 line | 10 | 10,000 | fruit | |
| 22 | Triple Bar | `slot-triple-bar` | `classic-3x3` | 0.9480 | 3×3 | 5 lines | 10 | 10,000 | fruit | |
| 23 | Fruit Stand | `slot-fruit-stand` | `classic-3x3` | 0.9480 | 3×3 | 5 lines | 10 | 10,000 | fruit | |

Bet limits come from three presets (`slot-catalogue.ts:410`): `LOW` 10–10,000,
`DEFAULT` 20–50,000, `HIGH` 100–200,000, all in coins (integer minor units).
Each game also carries a three-colour theme (primary/secondary/accent) used for
the cabinet, the reel bay and the symbol tint.

### 2.6 How a slot result is computed

1. **Strips.** Built once per engine at registration (`slots.ts:78`).
   `buildStrip` (`slot-math.ts:222`) turns per-reel weights into a real strip:
   each symbol instance gets a fractional position `(i + 0.5) / count`, and the
   strip is the sort of those positions — spread evenly rather than clumped,
   with ties broken by symbol id so the strip is identical on every machine.
   `classic-20` skips this and uses its hand-written strips.
2. **Spin.** For each reel, `rng.nextInt(stripLength)` picks a stop position and
   the window is that many *consecutive* strip positions (`spinReel`,
   `slot-math.ts:260`). Consecutive matters — it preserves the vertical
   correlation a physical reel has, which is what makes a near-miss feel like one.
3. **Line evaluation** (`evaluateLine`, `slot-math.ts:291`). Count matching
   symbols from the leftmost reel inward; a run must be ≥ 3. Wilds substitute for
   everything except scatters. If a line opens with wilds, both readings are
   scored — the wild's own line win, and the wild standing in for the symbol that
   follows — and **the better one is paid**.
4. **Ways evaluation** (`evaluateWays`, `slot-math.ts:352`), for `ways-diamond`
   only. A symbol pays if it appears at least once on each of the first N reels;
   the win is the rate × the product of its occurrences per reel.
5. **Scatters.** Counted anywhere on the grid, paid from `scatterPays` as a
   multiple of the **total** bet, and independent of any line.
6. **Total.** `sum(line wins) ÷ payDivisor + scatterMultiplier`, everything
   already multiplied by `payoutScale` and the current win multiplier
   (`evaluateGrid`, `slot-math.ts:392`).
7. **Cascades** (`tumble-20` only, `resolveSpin`, `slot-math.ts:480`). Winning
   cells are cleared, survivors fall, fresh symbols drop in from the top drawn
   one at a time, and the grid is re-evaluated. Each successive drop pays at the
   next rung of `[2, 3, 5, 10]`, up to 8 drops, stopping as soon as a grid pays
   nothing. Scatters are counted on the first grid only — no retriggering.
8. **Free spins** (`slots.ts:91`). `freeSpinsAwarded[scatterCount]` spins are
   resolved **immediately, in the same call**, each at the model's
   `freeSpinMultiplier`. Scatters landing during free spins do not retrigger.
   The round returns `status: 'settled'` with the entire bonus round already
   decided; the client's job is to show it, not to play it.

Payout = `stake × totalMultiplier`, floored to whole coins.

---

## 3. Table games

### 3.1 Blackjack

**File:** `packages/engine/src/games/blackjack.ts` · **id** `juwa-blackjack` ·
**category** `table` · **screen** `app/src/screens/BlackjackScreen.tsx`

| Setting | Value |
|---|---|
| Decks | 6 (312 cards), Fisher-Yates shuffled in `init` |
| Dealer | Stands on all 17s, **including soft 17** |
| Blackjack pays | **3:2** (`mul(stake, 2.5)` — 3:2 plus the returned stake) |
| Ordinary win | 2× stake returned |
| Push | stake returned |
| Splits | up to 4 hands; split aces get exactly one card each and stand; no re-splitting aces |
| Double | on any two cards, doubles the hand's stake and draws one |
| Insurance / surrender | not offered |
| Declared RTP | 0.995 (~99.5% under basic strategy) |
| Bet limits | 100 – 100,000 |

Multi-step: `init` returns `awaiting-action` with `hit`/`stand`/`double`/`split`
as available. A natural on either side settles before the player can act. The
shoe and the hole card live in `private`. Splits and doubles raise exposure
mid-hand, and the play path charges the difference at settlement so the ledger's
`stake` matches what was actually risked (`play.ts:251`).

### 3.2 European Roulette

**File:** `packages/engine/src/games/roulette.ts` · **id** `juwa-roulette-eu` ·
**category** `table` · **screen** `app/src/screens/RouletteScreen.tsx`

| Setting | Value |
|---|---|
| Pockets | **37** (0–36), single zero |
| RTP | **36/37 ≈ 0.9730** — mathematically exact for every bet type |
| Bet limits | 50 – 500,000 (checked against the *sum* of all bets) |
| Red numbers | 1,3,5,7,9,12,14,16,18,19,21,23,25,27,30,32,34,36 |

Payout table (`ODDS`, `roulette.ts:39`), quoted "to 1"; the stake is returned on
top:

| Bet | Covers | Pays |
|---|---|---|
| straight | 1 number | 35:1 |
| split | 2 | 17:1 |
| street | 3 | 11:1 |
| corner | 4 | 8:1 |
| line | 6 | 5:1 |
| column | 12 | 2:1 |
| dozen | 12 | 2:1 |
| red / black / odd / even / low (1–18) / high (19–36) | 18 | 1:1 |

Roulette needs its bet layout before the wheel turns, so `init` opens an empty
table with one available action, `place-bets`; the API applies it in the same
request. Selection sizes are validated per bet type (`validateBet`, line 90).

---

## 4. Instant games (the "originals")

All five share **one house edge: 1%** (`DEFAULT_HOUSE_EDGE`,
`packages/economy/src/instant-odds.ts:73`), so all five publish **RTP 0.99**, and
all five default to bet limits **50 – 500,000**.

The maths lives in `packages/economy/src/instant-odds.ts` — deliberately in the
economy package, not the engine, because the app needs those payout figures to
label a Dice slider or a Plinko board *before* any bet exists. The engine's
`instant-math.ts` re-exports it and adds the three functions that consume
randomness. Every multiplier obeys `m = (1 − houseEdge) / p`, and multipliers are
**truncated, never rounded** — so the player is never paid less than the number
they were shown and the edge is never smaller than configured.

Screens: `app/src/screens/instant/games.tsx` (all five) with shared
bet/act plumbing in `app/src/screens/instant/shell.tsx`.

### 4.1 Crash — `juwa-crash`

`packages/engine/src/games/crash.ts:127`

- Player commits an **auto-cash-out target before the round**; it settles
  instantly. Deliberately *not* a live shared curve — a pure engine has no clock,
  a live cash-out can't be replayed from seeds, and over a network the winner of
  a close cash-out is whoever has the better connection.
- Crash point: `(1 − h) / (1 − r)` with `r` uniform in [0,1), truncated to two
  decimals, clamped to `[1, 1_000_000]` (`crashPoint`, `instant-math.ts:60`).
- Win condition `crashPoint >= target`; payout `stake × target`.
- Target range **1.01× – 1,000,000×**, at most two decimal places.
- Expected return is `1 − h` for *every* target — a player chasing 1000× faces
  the same edge as one taking 1.01×.

### 4.2 Limbo — `juwa-limbo`

`packages/engine/src/games/crash.ts:188`

The identical random variable, printed as a number instead of animated as a
curve. Same generator, same targets, same 1% edge. Kept as a separate engine so
lobby tiles and bet history distinguish the two.

### 4.3 Dice — `juwa-dice`

`packages/engine/src/games/dice.ts:45`

- Roll is one of **10,000 equally likely outcomes**, displayed 0.00–99.99
  (`diceRoll` = `rng.nextInt(10000) / 100`).
- Player picks a target (two decimals) and a direction, `over` or `under`.
- Winning outcomes counted *discretely*: `over` wins on `9999 − ticks` outcomes,
  `under` on `ticks`. The target itself loses both ways.
- Multiplier `truncate4((1 − h) / p)`, e.g. ~1.98× at 50/50.
- **Minimum multiplier 1.01×** — bets that would pay 1.00× are rejected outright
  rather than clamped, because they are a trap with no upside.
- Bets that cannot win, or cannot lose, are rejected.

### 4.4 Plinko — `juwa-plinko`

`packages/engine/src/games/plinko.ts:53`

- Player sets **rows** (8, 10, 12, 14 or 16) and **risk** (low / medium / high) —
  **15 tables in all**, each derived to hold exactly the same 1% edge.
- The ball is simulated peg by peg: `rng.nextInt(2)` per row, and the **whole
  L/R path** is returned so the client animates the real path and a player can
  replay it from the seed.
- Bucket multipliers (`plinkoTable`, `instant-odds.ts:395`) are *derived*, not
  copied: bucket probability is binomial `C(n,i)/2ⁿ`; raw weight is `(1/pᵢ)^α`
  with α = **0.32 / 0.62 / 0.88** for low / medium / high; the table is then
  scaled so EV is exactly `1 − h`, truncated to two decimals, and topped back up
  in **mirror pairs** (so the board is left-right symmetric) until EV reaches
  the target.
- **No losing bucket** — the worst outcome returns part of the stake, so the
  payout is always positive.

### 4.5 Mines — `juwa-mines`

`packages/engine/src/games/mines.ts:86`

- **5×5 grid, 25 tiles**; player chooses **1–24 mines**.
- `init` shuffles all 25 tile indices into a permutation stored in `private`; the
  mines are the first N entries of it once the player configures the count. No
  randomness is drawn in `act` at all.
- Actions: `configure` → `reveal` (repeatedly) → `cashout`.
- Multiplier after `k` safe reveals: survival probability is
  `C(25−m, k) / C(25, k)`, and the multiplier is `truncate4((1 − h) / p)`
  (`minesMultiplier`, `instant-odds.ts:273`). Every cash-out point carries the
  same 1% edge — there is no clever exit.
- Four-decimal precision is deliberate: at two decimals, cashing out after one
  tile returned 98.6% while going deep returned 99%, which a patient player could
  exploit.
- The round auto-settles at `minesMaxReveals(mines)` — the deepest rung the
  1,000,000× cap can honour — rather than short-paying a won bet. Mine positions
  are copied into `public` only once the round is settled.

---

## 5. Placeholder tiles (no engine)

Defined only in `app/src/api/games.ts:145` and excluded from `PLAYABLE`
(line 306). They render greyed out in the lobby so the shape of the finished
product is visible; the server's `GET /games` (served from the engine registry)
does not list them.

| Tile | id | Category | Advertised RTP | Note |
|---|---|---|---|---|
| Texas Hold'em | `juwa-holdem` | poker | 0.97 | flagged `multiplayer` — parked |
| Jacks or Better | `juwa-video-poker` | poker | 0.9954 | not built |
| Golden Scratch | `juwa-scratch` | instant | 0.95 | not built |

---

## 6. RTP: how it is set and checked

- Slots RTP is **measured, not declared**. It emerges from reel strips ×
  paytable; changing one symbol on one strip moves it.
- `npm run rtp` (`packages/engine/src/tools/rtp.ts`) simulates 2,000,000 spins of
  the flagship game and reports the real return, hit frequency and volatility.
- `npm run rtp:catalogue -- --write` (`tools/catalogue-rtp.ts`) measures every
  model and writes the figures back into `SLOT_MODELS`.
- CI enforces both: `slot-catalogue.test.ts:92` re-measures every model over
  60,000 spins and fails if any drifts beyond the sampling error of that run
  (min ±2%); it also asserts no model pays ≥ 100%. `games.test.ts:82` pins the
  flagship inside a 95–97.5% band over 200,000 spins.
- RTP lives on the **model**, not the game — 23 themes share 8 models, so there
  are 8 true values rather than 23 numbers that can disagree.
- Table and instant RTPs are exact arithmetic rather than simulations: 36/37 for
  roulette, 1 − 0.01 for the instant games, and a stated ~99.5% for blackjack
  under basic strategy.

## 7. Operator overrides

`packages/api/src/game-config.ts` — a `game_configs` table
(`db/migrations/0007_operators.sql:70`) lets an operator set, per game id:
`enabled`, `maxWinMultiplier`, `minBet`, `maxBet`. It is read at the *start of
each bet* and cached for 30 seconds, so changes apply to new rounds only and a
round in flight settles on the terms it started on. A missing row means engine
defaults, **not** disabled.

The max-win ceiling is applied to the engine's answer *outside* the engine
(`capPayout`, `packages/server/src/play.ts:286`) so the engine stays pure and
replayable, and when a cap bites it is recorded on the round as `appliedConfig`
— what was paid and what would have been paid — so a shortpaid round can still
be explained a year later.

---

## 8. How a single spin works, in plain English

Take Juwa Classic, a 2,000-coin bet. The player taps SPIN.

**1. The reels start turning immediately — before anything has been decided.**
`SlotsScreen.spin()` (`app/src/screens/SlotsScreen.tsx:470`) unlocks audio, plays
the spin sound, sets the reels to `spinning`, and optimistically subtracts the
bet from the on-screen balance so the machine reacts on the tap. Nothing about
the outcome exists yet. The network round trip is about to hide inside an
animation the player was going to watch anyway.

**2. The client asks the server to play the round.** `POST /bet` with just three
things: the game id, the stake, and an idempotency key. It never sends an
outcome, and the server trusts nothing else from it.

**3. The server checks the player may play.** `assert_can_play` in Postgres
(`db/migrations/0004_accounts.sql:105`) refuses anyone unregistered, unverified
for age, or currently self-excluded. Then operator config: is this game enabled,
is the stake inside the operator's min/max (`packages/api/src/server.ts:406`).

**4. A nonce is claimed — before any money moves.** `reserveNonce` hands back the
player's current seed pair and increments the counter
(`packages/server/src/play.ts:128`). Deliberately first: it moves no money, so a
crash here burns a nonce and nothing else. The server seed was committed by hash
before play began, so the outcome is already locked in and cannot be chosen after
seeing the bet.

**5. The engine runs, purely.** An `RngStream` is built from
`HMAC-SHA256(serverSeed, clientSeed:nonce:cursor)` and handed to
`SlotsEngine.init`. Five stop positions are drawn, one per reel; each reel's
window is three consecutive positions on its strip. The 20 paylines are read
left to right, wilds substituting and the better reading paid; scatters are
counted anywhere on the grid; the line total is divided by 20 and the scatter
multiplier added. If three or more scatters landed, the whole free-spin round —
8, 12 or 20 spins, each at 3× — is resolved right there in the same call. On a
tumbling game, the cascade chain is resolved here too. The engine returns a
finished result: the grid, the winning cells, and one `totalMultiplier`.

**6. The operator's ceiling is applied outside the engine,** if one is set, and
recorded on the round alongside what the engine would otherwise have paid.

**7. Money moves once, atomically.** `playInstantRound` debits the stake, credits
the payout and records the round in a single database transaction
(`play.ts:167`). Either all of it happens or none of it does — there is no window
where a stake is taken and a payout lost. The double-entry ledger refuses any
transaction whose entries don't sum to zero.

**8. The response comes back** with the round id, the *public* state only
(`toClientView` has stripped anything private), the settlement, the new
authoritative balance, and the fairness triple: the server-seed hash, the client
seed and the nonce.

**9. The reels land on the real result.** If the answer arrived while the reels
were still accelerating, the client waits out `MIN_LOOP_SECONDS` first —
otherwise the machine would begin decelerating before it had reached speed, which
reads as a fault rather than a fast spin. Then each reel is scheduled to stop in
turn, 0.27s apart, with every stop sound booked in advance against the same audio
clock. A reel that could still complete a scatter trigger holds 0.6s longer, and
a rising tone plays through the gap — that is the anticipation build, and it is
driven by the real grid, so the machine never builds tension it cannot pay off.

**10. The show, in order.** Winning cells light up. On a tumbling game each drop
is played out one at a time with the ladder rung shown, because a cascade shown
only in its final state is just a large win with no explanation. Then the win
counter rolls up, and the celebration tier (win / burst / big / mega) picks the
sound and the overlay. If free spins were awarded, the cabinet crossfades to the
bonus palette and the spins play out one by one at 45% speed with a running
total — the money is already settled, so this is purely showing the player what
they won rather than depositing it silently.

**11. The authoritative balance is applied last,** once the whole sequence has
finished, so the number on screen and the number in the balance agree at every
moment.

**If anything fails,** the reels stop on the previous grid, the optimistic debit
is reversed, and an error is shown. They never stop on a guess.

**Afterwards, the round is provable.** Once the seed pair is rotated the server
seed is revealed; the player hashes it against the commitment they held *before*
they played, rebuilds the same RNG stream from `(serverSeed, clientSeed, nonce)`,
and re-runs the spin themselves. `verifyRound` (`play.ts:464`) does exactly this
server-side and reports whether the recorded payout matches the replay.

Blackjack and Mines differ only in that they stop at step 5 with
`status: 'awaiting-action'` and each subsequent `POST /act` re-enters the engine
with the stored state — which is why those engines must draw all their randomness
up front, since `act` rebuilds the stream from the same seed and nonce and would
otherwise replay the same bytes. Roulette, Crash, Limbo, Dice and Plinko take
their one decision (bet layout, target, direction, rows/risk) as an action sent
alongside the opening bet, and settle in that same request.

---

## 9. Discrepancies worth knowing

These are inconsistencies found while reading; none of them is a settlement bug,
but each is a place where a reader could be misled.

1. **"Five models" is stale.** The header comment in `slot-catalogue.ts:11` and
   the note in `slot-math.ts:59` both say the catalogue is built from *five*
   maths models. There are **eight** (`SLOT_MODELS` has `classic-20`,
   `lines-10`, `lines-25`, `high-vol`, `classic-3x3`, `ways-diamond`,
   `tumble-20`, `classic-3`). The comments also say "twenty-plus" and
   "twenty-three" games in different places; 23 is correct.

2. **96.25% vs 96.04%.** The README (line 65), `docs/00-START-HERE.md`,
   `docs/05-coin-economy.md`, `packages/economy/src/betting.ts:26`,
   `app/src/api/client.ts:11` and `SlotsScreen.tsx:200` all publish the flagship
   slot at **96.25%**. The value actually in the catalogue and served to clients
   is **0.9604** (`slot-catalogue.ts:250`). The CI band (95–97.5%) accepts both,
   so nothing fails, but the marketing figure and the shipped figure differ by
   0.21 points.

3. **The lobby hard-codes non-slot game data.** Slots are generated from the
   engine catalogue, but blackjack, roulette and the five instant games are typed
   out by hand in `app/src/api/games.ts:145`. They currently match the engines;
   nothing keeps them matching.

4. **Placeholder tiles advertise RTP figures** (0.97, 0.9954, 0.95) for games
   with no engine behind them.
