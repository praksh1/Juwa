# Tech Stack — what I picked and why

You asked me to choose. Here are the choices, each with the reasoning in plain
English and the trade-off I accepted.

---

## Mobile app: React Native + Expo

**What it is:** one codebase written in TypeScript that produces a real iPhone
app, a real Android app, and a website.

**Why not Flutter?** Flutter is genuinely excellent — arguably smoother
animations out of the box. I picked Expo for three reasons that matter more to
*you* specifically:

1. **You can see your app on your phone in about ten seconds.** Expo Go lets you
   scan a QR code and the real app appears. For a non-technical founder, the
   ability to actually hold the product and say "the button should be bigger" is
   worth more than any technical benchmark.
2. **The web build is free.** The same code becomes your website. That matters a
   lot here, because web purchases avoid Apple's 30% cut (see the payments doc).
   With Flutter, web is a second-class citizen.
3. **Hiring.** When you bring on a developer, TypeScript/React is the largest
   talent pool in the world. Dart developers are rarer and pricier.

**The trade-off I accepted:** for very heavy graphics, Flutter has an edge. We
mitigate this with `react-native-reanimated` (animations that run on the phone's
UI thread at 60fps, not in JavaScript) and `@shopify/react-native-skia` (the same
graphics engine Chrome uses) for the slot reels. That combination is what modern
RN games use, and it is more than enough.

---

## Backend + database: Supabase (PostgreSQL)

**What it is:** a hosted Postgres database with authentication, file storage, and
serverless functions attached.

**Why not Firebase?** This is the most important technical decision in the
project, so I want to be clear about it.

Firebase's database (Firestore) is a *document* database. It's fast and pleasant
for chat apps and social feeds. It is a poor fit for money, because it lacks the
guarantee you need most: **multi-row transactions with real locking.**

Here is the concrete failure. A player has $10. They tap "bet $10" twice, fast,
on a bad connection. Two requests arrive at the same moment. Both read the
balance, both see $10, both approve the bet. You have just let someone wager $20
they don't have. In Postgres this is prevented by `SELECT ... FOR UPDATE`, which
makes the second request wait for the first to finish — you can see it in
`post_transfer()` in `db/migrations/0001_ledger.sql`. Firestore has transactions,
but the model is optimistic retry and it does not give you the same guarantees
across the patterns a ledger needs.

The second reason is the **double-entry ledger** itself. It relies on constraints,
triggers, and views that are Postgres features. Those rules are enforced by the
database, so a bug in application code *cannot* create money out of nothing. On
Firestore that safety net would have to be application code — which is precisely
where bugs live.

Supabase also gives us **Row Level Security**: rules attached to the tables
themselves saying "a player can read only their own rows". So even if someone
finds a hole in the API, the database refuses to hand over another player's data.
Note the policies in the migration are `select`-only — no client can write to the
ledger under any circumstances.

**The trade-off:** Firebase has a slightly gentler learning curve and better
push-notification tooling. Not close to enough to outweigh the above.

---

## Game logic: a shared TypeScript package, running on the server

This is the security decision.

**Every game outcome is computed on the server.** The app is a beautiful
renderer: it sends "I bet $5 on slots", receives "here is the grid, you won
$12.50", and plays the animation. It never decides anything.

If outcomes were computed on the phone, a player would only need to patch the
app to win every time — and people absolutely do this. The rule is simple:
**never trust the client.** You'll see it enforced in the type system in
`packages/engine/src/games/types.ts`, where every round has a `private` field
that is stripped before anything is sent to a player.

---

## Fairness: provable, not promised

`packages/engine/src/rng.ts` implements commit-reveal:

1. Before you play, the server picks a secret and shows you its fingerprint (a
   hash).
2. You can supply your own seed, mixed in.
3. Later the server reveals the secret. You check the fingerprint matches the one
   you were given *before* you played, and you can recompute every outcome
   yourself.

The house cannot change results after seeing your bet, and it can prove it. This
is table stakes for player trust, and it is the same evidence a certification lab
will ask for.

---

## The full picture

| Layer | Choice | Job |
|---|---|---|
| Mobile + web app | React Native, Expo, TypeScript | What players see |
| Animation | Reanimated + Skia | 60fps reels and card flips |
| Sound | expo-audio | Casino atmosphere |
| API | Supabase Edge Functions (Deno) | Server-authoritative game endpoints |
| Game logic | `@juwa/engine` (this repo) | Outcomes, RNG, settlement |
| Database | Supabase Postgres | Ledger, accounts, round history |
| Auth | Supabase Auth | Login, sessions, age gate |
| Payments | Stripe + IAP now; iGaming PSP later | Money in and out |
| Analytics | PostHog | What players actually do |
| Errors | Sentry | Knowing before players tell you |

---

## What it costs to run

Rough monthly, early on:

- Supabase Pro — $25
- Expo EAS (builds) — $0–99
- Sentry / PostHog — free tiers are generous
- Apple Developer — $99/year; Google Play — $25 once

**Under $200/month until you have real traction.** The expensive parts of this
business are legal and user acquisition, not infrastructure.
