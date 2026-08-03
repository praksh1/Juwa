# The Play Path

What happens between tapping SPIN and the coins landing. This is the part of a
casino that has to be right, so it's worth understanding even if you never read
the code.

---

## The short version

```
  app                    server                      database
   │                        │                            │
   │── "bet 2,000 on slots" ─▶                           │
   │                        │── claim a nonce ──────────▶│   (no money moves)
   │                        │◀── seed + nonce ───────────│
   │                        │                            │
   │                    run the engine                   │
   │                  (pure, server-side)                │
   │                        │                            │
   │                        │── debit + credit + record ▶│   ONE transaction
   │                        │◀── new balance ────────────│
   │◀── grid + payout ──────│                            │
   │                        │                            │
  animate the reels
```

The app sends a stake. It receives a finished result. It never decides
anything.

---

## Why the order is that way

The outcome is computed in TypeScript by the game engine, which sits *between*
reading the seed and writing the result. So it cannot all be one database call.
The sequence is chosen so that no failure can hurt a player:

| If it crashes… | What happens |
|---|---|
| After claiming the nonce | A nonce is burned. **No money moved.** |
| While the engine runs | Same — nothing has been written. |
| During the settlement transaction | Postgres rolls it back entirely. |

There is deliberately **no window in which a stake is taken but a payout is
lost**. That specific failure is the one that generates refunds, support
tickets, and players who never come back.

The debit and the credit are in a single transaction (`play_instant_round()` in
`db/migrations/0003_play.sql`). Either both happen or neither does.

---

## Stake and payout are recorded separately

A player who bets 2,000 and wins 2,500 produces **two** ledger movements, not
one net movement of 500.

Netting would be simpler and wrong. The player's history has to show both, and
the business needs gross wagered ("handle") separately from net win — they are
different numbers and both matter. You cannot recover them from a netted total.

---

## Replay protection, three layers deep

A retried request — a tap on a flaky connection, a client that gives up and
tries again — must never charge twice.

1. **Idempotency keys.** `post_transfer()` returns the original transaction if
   the key has been seen before.
2. **A unique index on `(seed_pair_id, nonce)`.** The same nonce can never
   settle twice, so even a forged request cannot double-pay.
3. **The balance check runs under a row lock.** Two simultaneous bets cannot
   both read the same balance and both succeed.

That third one is why the project uses Postgres and not Firestore. See
[Tech Stack](01-tech-stack.md).

---

## Multi-step games

Blackjack works the same way with the round left open between requests:

```
placeBet  -> stake debited, hand dealt, status "awaiting-action"
act(hit)  -> state updated, still open
act(hit)  -> bust, status "settled", payout credited
```

The full engine state — including the **hidden** half, the rest of the shoe and
the dealer's hole card — is stored server-side in `game_rounds.state`. Only
`toClientView()` output ever crosses the wire.

### One rule this forces on game engines

Between two requests, a round is just a row in a database. When `act` runs, the
server rebuilds the random-number stream from the same seed and nonce — so it
replays **the same sequence** that `init` already consumed.

Therefore a multi-step engine must draw all its randomness up front, during
`init`, and store it. Blackjack shuffles the entire 312-card shoe immediately;
`hit` pops a card rather than drawing new entropy. An engine that drew fresh
values inside `act` would silently deal the same cards again.

This is written into the `GameEngine` contract in `packages/engine`.

---

## Provable fairness, end to end

1. Before you play, the server generates a secret and stores only its SHA-256
   hash where you can see it.
2. Every spin uses an incrementing nonce, so each round maps to exactly one
   deterministic draw.
3. While the seed is live it is **never** disclosed — a player holding it could
   predict every remaining spin. `verifyRound()` returns `serverSeed: null`
   until rotation, and a test asserts that.
4. When you rotate the seed, the old one is revealed. The server replays every
   round from it and confirms the recorded payouts. You can run the same
   calculation yourself and compare.

If the operator ever changed a result after seeing a bet, the revealed seed
would not reproduce it — and the hash you were shown beforehand proves the seed
was not swapped afterwards.

---

## Making the network invisible

The reels start spinning the instant SPIN is tapped, before the server has
replied. The response typically arrives in a couple of hundred milliseconds,
well inside the 2.5-second reel animation, so the result is ready long before
the reels need it.

The player experiences an instant spin. The server still decided everything.

If the request *fails*, the reels stop on the previous grid and an error is
shown — they never stop on a guessed outcome. The optimistic balance change is
rolled back too.

---

## Running it

Unit tests need nothing:

```bash
npm test          # 61 tests
```

The play path is tested against a real Postgres, because the guarantees above
are enforced by the database and a mock would only test the mock:

```bash
createdb juwa_play
npm run test:db   # +14 tests: full bet lifecycle, overdraw, replay, fairness
```

The final test in that suite is the one worth watching: after every bet, bonus
and blackjack hand above, it asserts the ledger still sums to exactly zero per
currency and that no cached balance has drifted.
