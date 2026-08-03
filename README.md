# Juwa

A **social casino**: server-authoritative game engines, provably-fair randomness,
a double-entry ledger, and a cross-platform app.

Gold Coins are bought or earned, spent on play, and never convert back to money.
No redemption, no gaming licence — enforced in both the type system and the
database schema, not just in policy.

**New here and non-technical? Read [docs/00-START-HERE.md](docs/00-START-HERE.md).**

---

## Structure

```
packages/money    Integer-minor-unit money. Shared by server and client.
packages/economy  Coin packs, bonuses, VIP, bet sizing — the business model.
packages/engine   Game engines + provably-fair RNG. SERVER ONLY.
packages/ui       Design tokens — colours, type, spacing, motion.
app/              Expo app (iOS, Android, web). A renderer, nothing more.
db/migrations/    Postgres schema: ledger, rounds, purchases, bonuses.
db/test/          Ledger invariants, run against a real Postgres.
docs/             Tech stack, roadmap, payments & legal, coin economy.
```

The app depends on `@juwa/money`, `@juwa/economy` and `@juwa/ui`. It deliberately
does **not** depend on `@juwa/engine` — game outcomes are computed on the server,
never on a device the player controls.

## Quick start

```bash
npm install
npm run build      # compile shared packages
npm test           # 61 tests
npm run rtp        # simulate 2,000,000 spins, report real payout rates
npm run economy    # simulate player sessions — how long does a balance last?

cd app && npx expo start    # run on a phone via Expo Go, or press `w` for web
```

To exercise the database rules against a real Postgres:

```bash
PGPORT=5432 db/test/run.sh
```

## What's built

| | Status |
|---|---|
| Money primitives (integer cents, exact splits) | ✅ tested |
| Provably-fair RNG (commit-reveal, chi-square verified) | ✅ tested |
| Slots — 5×3, 20 lines, wilds, scatters, free spins | ✅ **96.25% RTP, measured** |
| Blackjack — 6 decks, splits, doubles, 3:2 | ✅ tested |
| European roulette — 37 pockets, all bet types | ✅ tested |
| Double-entry ledger + RLS | ✅ **verified against real Postgres** |
| Coin economy — packs, bonuses, VIP, bet sizing | ✅ tested |
| Design tokens (WCAG AA verified) | ✅ tested |
| App shell — lobby, store, wallet, profile | ✅ builds & renders |
| Server API, animations, sound, IAP | ⬜ Phase 3+ |

## Principles

**Never trust the client.** Engines run server-side. `RoundState.private` — the
shoe, the hole card — is stripped by `toClientView()` before anything reaches a
player.

**Money is integers.** `0.1 + 0.2 !== 0.3`. Every amount is a whole number of
minor units. `packages/money` refuses anything else.

**The ledger balances or the write fails.** A database trigger rejects any
transaction whose entries don't sum to zero, per currency. Correcting an error
means posting a reversal, never editing history — the ledger is append-only by
rule.

**RTP is measured, not declared.** `npm run rtp` simulates millions of rounds
and reports what the games actually pay. The published figure is whatever the
simulation says, and CI fails if it drifts.

**Fairness is provable.** Server seed committed by hash before play, revealed
after. Players can recompute any result themselves.

**Coins are not money, structurally.** `assertRedeemable()` always throws, and a
database trigger rejects every withdrawal. A cash-out feature written by mistake
fails loudly rather than quietly changing the company's legal position.

## Testing

```bash
npm test
```

61 tests covering money arithmetic and rounding, RNG uniformity (chi-square over
3.7M draws), engine determinism, round termination, settlement arithmetic, RTP
bands, coin-pack pricing invariants, bonus balance, VIP progression, bet sizing,
and colour contrast.

Plus `db/test/run.sh`, which applies the migrations to a real Postgres and proves
the ledger refuses overdrafts, double-credits, unbalanced transactions, history
edits, and withdrawals.

> While building this, the test suite caught a real defect: `RngStream.next()`
> used a bitwise OR, which coerces to a *signed* 32-bit integer and produced
> negative "probabilities" whenever the leading byte was ≥ 128. It would have
> skewed every game that used it. See `rng.ts` and the regression test in
> `rng.test.ts`.

## The model

Juwa sells Gold Coins, which are entertainment and have no cash value. That makes
the store ordinary digital-goods commerce — Apple, Google and Stripe all process
it happily, and no gaming licence is required.

Revenue is coin sales, not the house edge: coins are free to mint, so the RTP
earns nothing directly. What it controls is how long a balance lasts, and
therefore how often a player sees the store. See
[The Coin Economy](docs/05-coin-economy.md).

Still worth a lawyer's hour: age gating, terms of service, and staying the right
side of the sweepstakes line. See
[Payments & Legal](docs/03-payments-and-legal.md).
