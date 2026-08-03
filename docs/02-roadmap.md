# Development Roadmap

Seven phases. Each one ends with something you can hold, show someone, and get
an opinion on. Nothing here requires you to understand the code — every phase has
a "how you'll know it worked" line that you can check yourself.

Timings assume one experienced developer (or me) working steadily. Halve nothing;
software estimates are optimistic by nature.

---

## Phase 0 — Decide what you're building ✅ *decided August 2026*

**Juwa is a social casino.** Coins are bought or earned, spent on play, and never
convert back to money. See [Payments & Legal](03-payments-and-legal.md).

- [x] Decide the model — **social casino**
- [x] Currency model locked to Gold Coins, redemption disabled in code and schema
- [ ] Lawyer review: age gating, terms of service, the sweepstakes line
- [ ] Register the company; open a business bank account

**In one sentence:** a player can buy Gold Coins and play with them, and can
never turn them back into money.

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
- [x] Money primitives that can't drift *(done, `packages/money`)*
- [x] Sign up, log in via Supabase Auth *(done)*
- [x] Age gate — 18+, enforced in the database *(done, migration 0004)*
- [x] Wallet and lobby reading the real server balance *(done)*
- [ ] Password reset and email change
- [ ] Transaction history from the ledger (the list is still placeholder data)
- [ ] Test credits so you can play without paying
- [x] Free economy: welcome, daily streak, top-up *(done, `packages/economy`)*
- [ ] Responsible-gaming controls: spend limits, self-exclusion

**How you'll know it worked:** you create an account, get the 100,000 GC welcome
bonus, and every coin you spend shows up in a history you can read.

---

## Phase 3 — First game, end to end *(3–4 weeks)*

One game, finished properly, rather than four games half-done. Slots first: the
best revenue per unit of effort, and the most animation-heavy — so it proves the
hardest part of the UI.

- [x] Slot engine with real, measured RTP *(done — 96.25%, verified in CI)*
- [x] Blackjack engine *(done)*
- [x] European roulette engine *(done)*
- [x] Provably-fair RNG *(done)*
- [x] Server endpoints: place bet → settle → credit wallet *(done, `packages/server`)*
- [x] Atomic play functions + replay protection *(done, migration 0003)*
- [x] Provable fairness end to end — commit, reveal, replay *(done)*
- [x] Playable slot screen with staggered reel animation *(done)*
- [ ] Win-line overlay for zig-zag paylines (straight rows highlight today)
- [ ] Free-spins sequence — the engine awards them; the UI does not yet play them
- [ ] Sound: spin loop, reel stops, win stingers
- [ ] Blackjack and roulette screens (engines and API are already done)

Reel animation uses React Native's built-in `Animated` with the native driver
rather than Skia. It is a transform on one view and runs at 60fps; Skia earns
its complexity when we add shaders and particles to the win presentation, not
before.

**How you'll know it worked:** you play a hundred spins on your phone, it feels
good, and your balance is correct to the coin afterwards.

---

## Phase 4 — The rest of the library *(4–6 weeks)*

Now the architecture pays off. Each new game is one file implementing
`GameEngine`, one line in the registry, and a renderer — see
[Adding a game](04-adding-a-game.md).

- [ ] Blackjack UI (engine and API are done — needs a screen)
- [ ] Roulette UI (engine and API are done — needs a screen)
- [ ] Texas Hold'em — the big one; needs real-time multiplayer, budget for it
- [ ] Video poker, baccarat, keno, scratch cards
- [ ] Three to five more slot themes reusing the slot renderer

**How you'll know it worked:** a friend opens the app and plays for twenty
minutes without asking you a single question.

---

## Phase 5 — The store *(3–4 weeks)*

See [The Coin Economy](05-coin-economy.md) for the model this implements.

- [x] Coin packs, bonuses, VIP and bet sizing *(done, `packages/economy`)*
- [x] Store screen *(done)*
- [x] Schema: purchases, bonus grants, no-withdrawal guard *(done, migration 0002)*
- [ ] Apple In-App Purchase + Google Play Billing
- [ ] Stripe for web purchases (nets ~34% more per sale)
- [ ] Receipts verified **server-side** — never trust the app's word
- [ ] Daily bonus + top-up timers wired to the schema

No redemption or KYC work: there is no cash-out under the social model.

**How you'll know it worked:** you buy a coin pack with your own card, the coins
arrive, and `reconcile_balances()` returns no rows.

---

## Phase 6 — Launch readiness *(3–4 weeks)*

- [ ] Load testing — can you handle 1,000 people spinning at once?
- [ ] Security review and penetration test
- [ ] Monitoring, alerting, on-call
- [ ] Nightly ledger reconciliation (`reconcile_balances()`) with alerts
- [x] PWA — manifest, offline shell, install prompt *(done)*
- [ ] Custom domain, HTTPS, SPA fallback — see [Deploying](07-deploying.md)
- [ ] Web push for the daily bonus (weaker on iOS unless installed)
- [ ] Support tooling — someone will email you about a missing $5, and you'll
      need to answer with the ledger

**How you'll know it worked:** the app is live and you can prove, every morning,
that every coin is where it should be.

---

## Phase 7 — Growth

Retention beats acquisition. Daily bonuses, missions, levels, leaderboards,
tournaments, VIP tiers, live ops. This is where a casino app is actually won or
lost — and it's a permanent phase, not a finished one.

---

## Honest timeline

**Social casino: 4–6 months to a live app store listing.** That is the path we
are on.

For context, the roads not taken: sweepstakes would add 2–3 months and
substantial legal cost; licensed real-money is 18–24 months and $1M+.

The engines, ledger and fairness proof are shared across all three, so nothing
built so far is wasted if the model ever changes. What *would* change is the
currency model and the redemption guards — both deliberately concentrated in
`packages/money` and `db/migrations/0002_social_economy.sql` so the blast radius
is small and reviewable.
