# Development Roadmap

Seven phases. Each one ends with something you can hold, show someone, and get
an opinion on. Nothing here requires you to understand the code — every phase has
a "how you'll know it worked" line that you can check yourself.

Timings assume one experienced developer (or me) working steadily. Halve nothing;
software estimates are optimistic by nature.

---

## Phase 0 — Decide what you're building *(in parallel, starts today)*

Not a coding phase, and the most important one. See
[Payments & Legal](03-payments-and-legal.md).

- [ ] Talk to a **gaming attorney** — a specialist, not a general startup lawyer
- [ ] Decide: social casino, sweepstakes, or licensed real-money
- [ ] Confirm which states/countries you'll operate in
- [ ] Register the company; open a business bank account

**How you'll know it worked:** you can say in one sentence what a player can and
cannot do with money in your app, and a lawyer has agreed with you in writing.

---

## Phase 1 — Design system & wireframes *(1–2 weeks)*

Deciding what the app looks like before writing the app.

- [x] Design tokens — colours, type, spacing, shadows *(done, `packages/ui`)*
- [x] App shell and navigation skeleton *(done)*
- [x] Home lobby wireframe *(done)*
- [ ] Wireframes for: game screen, wallet, deposit, profile
- [ ] Pick the visual direction — Vegas neon vs. modern premium
- [ ] Source sound effects and the logo

**How you'll know it worked:** you can tap through a clickable version on your
phone and understand every screen without anyone explaining it.

---

## Phase 2 — Accounts & wallet *(2–3 weeks)*

The money plumbing, with no real money in it yet.

- [x] Double-entry ledger schema *(done, `db/migrations/0001_ledger.sql`)*
- [x] Money primitives that can't drift *(done, `packages/engine/src/money.ts`)*
- [ ] Sign up, log in, password reset
- [ ] Age gate (18+ / 21+ depending on market)
- [ ] Wallet screen with balance and transaction history
- [ ] Test credits so you can play without paying
- [ ] Responsible-gaming controls: deposit limits, self-exclusion

**How you'll know it worked:** you create an account, get 10,000 free coins, and
every coin you spend shows up in a history you can read.

---

## Phase 3 — First game, end to end *(3–4 weeks)*

One game, finished properly, rather than four games half-done. Slots first: the
best revenue per unit of effort, and the most animation-heavy — so it proves the
hardest part of the UI.

- [x] Slot engine with real, measured RTP *(done — 96.25%, verified in CI)*
- [x] Blackjack engine *(done)*
- [x] European roulette engine *(done)*
- [x] Provably-fair RNG *(done)*
- [ ] Server endpoints: place bet → settle → credit wallet
- [ ] Slot reel animation with Skia — spin, stagger, anticipation, win lines
- [ ] Sound: spin loop, reel stops, win stingers, big-win fanfare
- [ ] Free-spins sequence

**How you'll know it worked:** you play a hundred spins on your phone, it feels
good, and your balance is correct to the cent afterwards.

---

## Phase 4 — The rest of the library *(4–6 weeks)*

Now the architecture pays off. Each new game is one file implementing
`GameEngine`, one line in the registry, and a renderer — see
[Adding a game](04-adding-a-game.md).

- [ ] Blackjack UI (engine is done)
- [ ] Roulette UI (engine is done)
- [ ] Texas Hold'em — the big one; needs real-time multiplayer, budget for it
- [ ] Video poker, baccarat, keno, scratch cards
- [ ] Three to five more slot themes reusing the slot renderer

**How you'll know it worked:** a friend opens the app and plays for twenty
minutes without asking you a single question.

---

## Phase 5 — Payments *(3–4 weeks)*

- [ ] Apple In-App Purchase + Google Play Billing for coin packs
- [ ] Stripe for web purchases (keeps you off the 30% platform fee)
- [ ] Purchase receipts verified **server-side** — never trust the app's word
- [ ] Redemption flow, if the legal answer in Phase 0 allows one
- [ ] KYC integration (Persona or Veriff) gating any cash-out

**How you'll know it worked:** you buy a coin pack with your own card, the coins
arrive, and the ledger balances to zero across every account.

---

## Phase 6 — Launch readiness *(3–4 weeks)*

- [ ] Load testing — can you handle 1,000 people spinning at once?
- [ ] Security review and penetration test
- [ ] Monitoring, alerting, on-call
- [ ] Nightly ledger reconciliation (`reconcile_balances()`) with alerts
- [ ] App Store and Play Store submissions, with the compliance paperwork
- [ ] Support tooling — someone will email you about a missing $5, and you'll
      need to answer with the ledger

**How you'll know it worked:** the app is live and you can prove, every morning,
that every cent is where it should be.

---

## Phase 7 — Growth

Retention beats acquisition. Daily bonuses, missions, levels, leaderboards,
tournaments, VIP tiers, live ops. This is where a casino app is actually won or
lost — and it's a permanent phase, not a finished one.

---

## Honest timeline

| Model | Ship to a real store |
|---|---|
| Social casino | **4–6 months** |
| Sweepstakes | 6–9 months + legal |
| Licensed real-money | 18–24 months, $1M+ |

The engines, ledger and fairness proof in this repo are shared across all three.
Nothing you build now is wasted if you change your mind about the model later —
that's why I built it in this order.
