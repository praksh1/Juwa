# The Coin Economy

We're building a **social casino**. This document explains how it makes money,
because the answer is not what most people assume.

---

## The house edge earns nothing

In a real-money casino, revenue is the house edge. Players wager $100, the game
pays back $96.25, the casino keeps $3.75. That is the business.

In a social casino, coins are not money. A player who "loses" 10,000 Gold Coins
has transferred nothing to us — the coins were free to mint and are worthless
outside the app. **The RTP generates zero revenue.**

Revenue is coin sales, and only coin sales.

So what is the RTP for? It controls **how long a balance lasts**, and therefore
how often a player runs out and sees the store. That's the whole mechanism:

```
free coins  ->  play  ->  run out  ->  wait for more, or buy
                  ^                            |
                  +----------------------------+
```

Every number in `packages/economy` exists to tune that loop.

---

## The free economy

Giving coins away is how you make money. A player with zero coins and no way to
get more doesn't buy — they uninstall. The free economy keeps people *present*
so that the paid economy has someone to sell to.

| Grant | Amount | Purpose |
|---|---|---|
| Welcome | 100,000 GC | A genuinely good first session. First impressions decide retention. |
| Daily streak, day 1 | 5,000 GC | A reason to open the app tomorrow. |
| Daily streak, day 7 | 50,000 GC | Ten times day 1 — that steepness is what makes missing day 6 hurt. |
| Low-balance top-up | 2,500 GC, max 4/day | Relieves the dead end without replacing the store. |

**A missed day resets the streak to day 1.** Harsh, and it works. Softening it
("keep your streak with one skip") measurably reduces daily returns.

### The balance we got wrong first

The top-up was originally 5,000 coins, six times a day — 30,000 free coins
daily, against a $1.99 starter pack that grants 20,000. A player could farm more
by waiting than by paying, which makes the bottom of the store pointless.

A test now asserts that a full day of top-ups stays below the smallest pack, so
a future "let's be more generous" tweak can't quietly break conversion. It's in
`packages/economy/src/index.test.ts`.

---

## The store

Six packs, $1.99 to $99.99. Three rules govern the pricing:

**Value per dollar must rise with pack size.** If a bigger pack is worse value
it is strictly worse than the smaller one, and players notice immediately. A
test enforces this across the whole ladder.

**Anchor high.** The $99.99 pack exists partly to make $9.99 look reasonable.
Most revenue comes from the middle — but only because the top exists.

**One badge each.** Exactly one "most popular", exactly one "best value".
Badging everything is the same as badging nothing.

### First purchase doubles

The single highest-leverage promotion in the product. The gap between "never
paid" and "paid once" is far wider than any gap after it, so the starter pack
isn't there to make money — it's there to clear that hurdle.

### Where you sell matters enormously

| Channel | Fee | Net on a $9.99 pack |
|---|---|---|
| Apple / Google (standard) | 30% | $6.99 |
| Apple / Google (small business, <$1M/yr) | 15% | $8.49 |
| Stripe (web) | 2.9% + 30¢ | $9.39 |

The web store nets **34% more per sale** than in-app purchase at standard rates.
You generally may not link to it from inside an iOS app, so the play is email
and push to existing players — legal, and effective.

This is why the Expo/React Native choice mattered: the web build comes free from
the same codebase.

---

## Session length is the real lever

`npm run economy` simulates thousands of player sessions. It found a genuine
problem:

| Balance | Bet | Median session |
|---|---|---|
| 100,000 GC (welcome bonus) | 2,000 GC | ~31 minutes |
| 100,000 GC | 10,000 GC | ~2 minutes |
| 5,000 GC (day-1 bonus) | 1,000 GC | **~1 minute** |
| 5,000 GC | 200 GC | ~10 minutes |

A returning player collecting their daily bonus and being wiped out in sixty
seconds is a player who stops returning. A fixed default bet cannot serve both a
100,000-coin balance and a 5,000-coin one.

So the default stake is now a **fraction of balance** (~2.5%), snapped to round
denominations — `suggestedBet()` in `packages/economy/src/betting.ts`.

**Session length is far more sensitive to bet size than to RTP**, and unlike RTP
it costs nothing to change and needs no re-certification. Reach for it first.

---

## VIP: status earned by playing, not paying

Players earn XP by wagering, not by spending. That keeps free players climbing
and returning, while the people who climb fastest are naturally the ones buying
coins to keep wagering.

Six tiers, Bronze to Royal. Rewards are all soft — a bigger daily bonus, a
shorter top-up timer, a badge. None convert to anything, and they cost the
business nothing, because coins are free to mint.

---

## Where the coins come from

Free coins are minted from a **promo account** and moved to the player, so the
double-entry ledger still balances — no coins appear from nowhere. The promo
account runs negative by design, and its balance is exactly the total ever given
away.

That number is worth a dashboard. If free grants start dwarfing purchases, you
see it in the ledger before you see it in revenue.

---

## What the schema enforces

`db/migrations/0002_social_economy.sql` makes the decision structural rather
than a matter of remembering:

- **Sweeps Coins are dropped.** The redeemable currency for the sweepstakes model
  we didn't take no longer exists, so nothing can start issuing it by accident.
- **Withdrawals raise an exception.** A database trigger rejects any withdrawal
  payment intent. If someone later writes a cash-out feature by mistake, it fails
  loudly instead of quietly changing the company's legal position.
- **`assertRedeemable()` in `@juwa/money` always throws.** Same guard, in the
  application layer.
- **Purchases are verified server-side.** A unique constraint on the platform
  transaction id stops a replayed receipt from granting coins twice — the most
  common fraud against an in-app purchase flow.

All of it is tested against a real Postgres: `db/test/run.sh`.

---

## The numbers to watch after launch

| Metric | Healthy |
|---|---|
| Day-1 retention | 35%+ |
| Day-30 retention | 8%+ |
| Share of players who ever pay | 1.5–3% |
| Average revenue per paying user, monthly | $25–80 |
| Median session length | 15–30 min |
| Sessions per day, active players | 2–4 |

Social casino revenue is famously concentrated: a very small number of players
generate most of it. That makes two things matter more than anything else —
retention of the many, and responsible-gaming safeguards for the few. The
deposit limits and self-exclusion controls in the schema aren't only compliance;
with revenue this concentrated they are how you avoid building a business that
depends on harming somebody.
