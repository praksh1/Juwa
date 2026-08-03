# Juwa

A casino-style gaming platform: server-authoritative game engines, provably-fair
randomness, a double-entry ledger, and a cross-platform app.

**New here and non-technical? Read [docs/00-START-HERE.md](docs/00-START-HERE.md).**

---

## Structure

```
packages/money    Integer-minor-unit money. Shared by server and client.
packages/engine   Game engines + provably-fair RNG. SERVER ONLY.
packages/ui       Design tokens — colours, type, spacing, motion.
app/              Expo app (iOS, Android, web). A renderer, nothing more.
db/migrations/    Postgres schema: accounts, double-entry ledger, rounds.
docs/             Tech stack, roadmap, payments & legal, adding a game.
```

The app depends on `@juwa/money` and `@juwa/ui`. It deliberately does **not**
depend on `@juwa/engine` — game outcomes are computed on the server, never on a
device the player controls.

## Quick start

```bash
npm install
npm run build      # compile shared packages
npm test           # 41 tests
npm run rtp        # simulate 2,000,000 spins, report real payout rates

cd app && npx expo start    # run on a phone via Expo Go, or press `w` for web
```

## What's built

| | Status |
|---|---|
| Money primitives (integer cents, exact splits) | ✅ tested |
| Provably-fair RNG (commit-reveal, chi-square verified) | ✅ tested |
| Slots — 5×3, 20 lines, wilds, scatters, free spins | ✅ **96.25% RTP, measured** |
| Blackjack — 6 decks, splits, doubles, 3:2 | ✅ tested |
| European roulette — 37 pockets, all bet types | ✅ tested |
| Double-entry ledger schema + RLS | ✅ written |
| Design tokens (WCAG AA verified) | ✅ tested |
| App shell — lobby, wallet, profile | ✅ builds & renders |
| Server API, animations, sound, payments | ⬜ Phase 3+ |

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

## Testing

```bash
npm test
```

41 tests covering money arithmetic and rounding, RNG uniformity (chi-square over
3.7M draws), engine determinism, round termination, settlement arithmetic, RTP
bands, and colour contrast.

> While building this, the test suite caught a real defect: `RngStream.next()`
> used a bitwise OR, which coerces to a *signed* 32-bit integer and produced
> negative "probabilities" whenever the leading byte was ≥ 128. It would have
> skewed every game that used it. See `rng.ts` and the regression test in
> `rng.test.ts`.

## Before you take real money

Read [docs/03-payments-and-legal.md](docs/03-payments-and-legal.md) first. Zelle,
Venmo and Stripe all prohibit gambling under their terms, and real-money online
casino gaming is legal in only a handful of US states, each requiring its own
licence. There is a workable route — it's in that document — but it starts with a
gaming attorney, not with code.
