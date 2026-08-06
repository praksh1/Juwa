# The instant games — what bitsky.bet has that we didn't

Answering the question "their games look different from mine, can you replicate
them?"

---

## First, a caveat about how I looked

**I could not open bitsky.bet.** This build environment routes all outbound
traffic through a proxy that blocks most non-GitHub hosts, and the site is one
of them — a 403 at the CONNECT stage, before any page was fetched. The same
happened to two review sites I tried to read directly.

So what follows is assembled from **search results describing the site**, not
from the site itself. The game *categories* below are well-attested and the
maths is standard and public, so I am confident in the substance. But if you can
open it on your phone, check the category list against the one below — if it has
something I have not listed, tell me and I will look at it specifically.

---

## What it actually is

The important finding, and it reframes the whole question:

**bitsky.bet is a sweepstakes casino — the same legal model as Juwa.** Gold
Coins and Sweeps Coins, dual currency, unavailable in the same handful of
states. It is not a different kind of business. You said "it does not look like
a social casino", and that is true of how it *presents*, not of what it is.

The second finding matters more:

**It has around 2,500–3,000 games, and it did not build any of them.** That
volume is not a development achievement, it is a purchasing one. Sites at that
scale plug into a game aggregator — one integration that resells hundreds of
studios' catalogues, billed as a revenue share. The Crash-style games there are
mostly Spribe's (Aviator, Mines, Plinko) and SmartSoft's.

So "replicate the games" splits cleanly into three piles, and only one of them
is a coding problem.

---

## The three piles

### 1. Cannot be replicated — and should not be attempted

**Branded slots and live dealer.** The named slots are licensed content; their
maths, art and sound are the studio's property. Live dealer is a physical
studio with real staff, real tables and a video pipeline, at roughly $20–30k per
table per month. Neither is something to build.

**Fish games.** These are the arcade shooters Juwa's name is associated with.
Also licensed, also not buildable in a reasonable timeframe.

The honest route to any of these is an aggregator deal, which needs a licensed
operating entity, a real balance sheet and a monthly minimum. That is a
new-owner decision, not a pre-sale one.

### 2. Already had it

Slots (23 of them), blackjack, roulette. These stand up fine.

### 3. **Can be replicated — and now is**

The "originals" category — Crash, Limbo, Dice, Plinko, Mines. This is the pile
that makes a site look modern rather than like a slots app, and it is
**genuinely free to build**, because:

- The maths is public, simple, and provable in a few lines each.
- Nobody owns them. "Plinko" is a 1983 game-show pricing game; "Crash" has no
  single author. There is no licence to buy.
- They fit the architecture we already have exactly.

**All five are now built and tested.** See below.

---

## What was built

Five engines in `packages/engine/src/games/`, plus the shared maths in
`instant-math.ts`, plus 48 tests.

| Game | What the player picks | Where it lives |
|---|---|---|
| **Crash** | A cash-out multiplier, before the curve rises | `crash.ts` |
| **Limbo** | A target multiplier; the round rolls one | `crash.ts` |
| **Dice** | A line from 0.00–99.99, and over or under | `dice.ts` |
| **Plinko** | 8–16 rows, and low/medium/high risk | `plinko.ts` |
| **Mines** | How many mines, then which tiles, then when to stop | `mines.ts` |

They are registered, they appear in the lobby's **Instant** tab, and they are
marked COMING SOON because each still needs a screen to play it on. That is the
remaining work and it is presentation only — the risky half is done.

### Every one holds a 1% house edge

Slots run a 4% edge and roulette 2.7%. These run 1%, deliberately. It is the
category players *compare sites on*: they compute the edge, publish it, and
argue about it. A 4% dice game gets called out in public.

The thing that makes that claim real rather than decorative: **the player
chooses their own odds in all five games.** A slot's paytable is fixed, but here
a player picks a target, a risk level, a mine count — and the edge has to come
out the same whatever they picked. That is the entire job of `instant-math.ts`,
and every multiplier is *derived* from

```
multiplier = (1 - houseEdge) / winProbability
```

rather than copied from a competitor. A copied payout table cannot be audited.
When a buyer's technical reviewer asks why a bucket pays 5.6x, "because Stake
does" is not an answer.

---

## Four things that went wrong while building this

Recorded because each one would have shipped silently.

**1. Mines paid 19% instead of 99% on its best runs.** There is a cap on the
biggest multiplier the game will pay — a solvency control, so one bet cannot owe
more than the operator holds. Ten of Mines' ~300 cash-out points are worth more
than that cap, the largest being 5,148,297x. Clamping the payout there meant a
player could beat 1-in-5-million odds and be quietly paid a fifth of what they
had won.

The fix is the principle, not the patch: **a cap must be enforced by not
offering the bet, never by shortpaying one already won.** The game now ends the
round when the next rung would exceed the cap, and pays every coin it
advertised.

Found by enumerating all 300 cash-out points. Not findable by playing.

**2. Two decimal places was a second, hidden house edge.** Truncating a
multiplier costs a fixed 0.01 whether the multiplier is 1.17 or 1700 — so the
*relative* cost is worst where the multipliers are smallest, which is exactly
where most bets settle, because most players cash out early. Measured: the
mines ladder returned **98.28% on its most-played rungs** against 99%
everywhere else. Dice had the same defect.

Those two games now settle on a four-decimal grid; worst case is 98.990%. It
also means the client should display four decimals for them — which, for an
audience that checks these numbers against the revealed seed, reads as
confidence rather than clutter.

**3. Plinko's board was asymmetric.** The correction that lands each table on
exactly 99% works by handing back what rounding took, one bucket at a time. Done
greedily it gave a tick to whichever of two mirror-image buckets it reached
first — a board paying 1.12x on the left and 1.11x on the right. The expected
value was correct. It still reads as rigged, and "the right side pays less" is a
screenshot that travels further than any explanation. Corrections now apply to
mirror pairs.

**4. I asserted the wrong number about Crash.** I wrote a test claiming rounds
fail to clear the minimum 1.01x target at the house-edge rate of 1%. They do so
at 1.98%. Both figures are correct and they describe different things — the edge
is the expected *loss*, not the loss *rate* — and conflating them makes the game
look twice as harsh as it is. The code was right; my test was wrong.

---

## The one place ours differs from theirs, on purpose

On bitsky and its peers, **Crash is a shared multiplayer round**: one curve
rises on everyone's screen and you tap CASH OUT while it moves. Ours takes the
cash-out target *before* the round and settles instantly.

Three reasons:

1. **A live cash-out cannot be proved fair.** Its outcome depends on when your
   tap arrived, which is not derivable from the published seed. The
   provable-fairness guarantee and the live curve are mutually exclusive.
2. **A live curve is unfair over a network.** Whoever has the better connection
   wins close cash-outs. A player on hotel wifi loses bets a player on fibre
   wins, with identical timing and identical intent.
3. **A shared round needs a socket server** holding synchronised state — an
   always-on stateful service, the opposite of the stateless API this runs on,
   and a monthly bill on a project whose whole point is no monthly bill.

What is lost is watching other people bail out. What is kept is a game that
cannot be lost to lag and costs nothing to run. The client still animates the
curve rising to the crash point, so it *plays* the same.

If a new owner wants true multiplayer Crash later, it is an additive change: the
maths is unchanged, and it needs a socket service in front of the same engine.

---

## What still has to happen

1. **Five screens.** Each is 300–500 lines of React Native. Dice is the
   simplest, Mines the most engaging, Plinko the most visually distinctive.
2. **Tile art.** There are 35 unassigned tiles in `art/tiles/unassigned` — some
   will fit. Otherwise five prompts in the style of `docs/10-art-prompts-round-2.md`.
3. **A four-decimal multiplier display** for Dice and Mines specifically (see
   fault 2 above).

Nothing here is blocked. The engines are done, tested, and correct.

---

## On "use open-source resources"

You asked me to draw on public/open-source work, and I want to be straight about
what I did.

I did not copy anyone's code. For games this small, the useful public resource
is **the published maths**, not an implementation — the formulas above are
standard and documented in many places, and every payout table here is derived
from them in about forty lines.

That is also the safer route commercially. A GitHub casino implementation
carries someone's licence, and the ones that turn up in searches are
overwhelmingly GPL or unlicensed-with-no-LICENSE-file. Either would be a problem
in a sale: GPL forces you to publish the whole app's source, and no licence at
all means no rights granted. Derived-from-public-maths has neither problem, and
it is why the payout tables in `instant-math.ts` are computed at runtime rather
than pasted in.
