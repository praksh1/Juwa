# Start Here

You said you have no technical background. This page is written for you, not for
a developer. Nothing here assumes you know what any of the words mean.

---

## The decision that shapes everything

**Juwa is a social casino.** Players buy or earn Gold Coins, play with them, and
can never turn them back into money — like arcade tokens.

That one sentence is why the project is buildable in months rather than years:
no gaming licence, no state-by-state geofencing, and Apple, Google and Stripe
will all happily process coin sales. It also changes where the money comes from,
which surprises people — see [The Coin Economy](05-coin-economy.md).

---

## What is actually in this repository

Think of the project as five separate boxes that snap together.

**1. The rules of the games** — `packages/engine`

This is the maths. It knows what a slot machine pays for three cherries, when a
blackjack dealer must take another card, and what a roulette number is worth.
It contains no pictures and no buttons. It is pure rules.

Crucially, this box lives on our **server**, not on the player's phone. If the
rules lived on the phone, a determined player could modify the app to win every
time. People genuinely do this. So the phone asks our server "what happened?"
and the server answers.

**2. The money** — `packages/money` and `db/`

Everything to do with balances. Two ideas here are worth understanding because
they will save you a great deal of pain:

- *Money is stored as whole numbers of cents, never as decimals.* Computers are
  famously bad at decimals — ask one for 0.1 + 0.2 and it says 0.30000000000000004.
  Harmless in a shopping list, catastrophic across a million bets. So $12.34 is
  stored as `1234`.

- *We use double-entry bookkeeping,* the same system accountants have used since
  the 1400s. Money is never "added" to a balance; it is **moved** from one account
  to another, and both sides of the move are recorded. The database physically
  refuses to save a movement that doesn't balance. This means if your numbers are
  ever wrong you can find out exactly why, instead of guessing.

**3. The business model** — `packages/economy`

Coin packs and their prices, the daily bonus ladder, VIP tiers, and how big a
bet to suggest. These are not arbitrary numbers — each one is tuned against a
simulation and guarded by a test. This is the file you'll want to argue with,
and that's fine: it's designed to be argued with.

**4. The look** — `packages/ui`

Colours, text sizes, spacing, and how fast things animate. All in one place, so
when you decide the gold should be richer, it changes everywhere at once instead
of in forty separate files.

**5. The app** — `app/`

What players actually see and touch. It is a *renderer*: it shows results and
plays animations. It never decides anything about money or outcomes.

---

## Things worth knowing about what's been built

**The slot machine's payout percentage is measured, not claimed.** Every slot
advertises an "RTP" — return to player. Ours is 96.25%, meaning across millions
of spins the machine returns about $96.25 of every $100 wagered. That number was
not typed in by hand. Run `npm run rtp` and the computer simulates two million
spins and reports what it actually pays. If someone changes the game and the
number drifts, the automated tests refuse to let the change ship.

**Every result can be proved fair.** Before you play, the server locks in a
secret and shows you a fingerprint of it. After you play, it reveals the secret.
You can check the fingerprint matches the one you were given *beforehand* and
recalculate every result yourself. The house cannot change an outcome after
seeing your bet, and it can prove it.

**Three real bugs were caught by the tests while building this.** The random
number generator had a flaw that made some values come out negative, which would
have quietly skewed every game. The free-coin economy was tuned so generously
that a player could farm more coins by waiting than by paying $1.99, making the
cheapest purchase pointless. And a database index was written in a way Postgres
refuses to accept, which would have failed on the first deploy.

None of those reached anywhere. That is what the tests are for, and it's why the
project has them from day one rather than "later".

---

## The one thing I still need you to do

**Book an hour with a lawyer.** Not the big scary gaming-licence process — that's
off the table now, and since Juwa ships as a website rather than a store app,
so is app-store compliance.

[Legal Language](08-legal-language.md) has the clauses social casinos actually
use, written out, plus a ten-question list to take with you. It is a drafting
aid, not legal advice — but it means the hour is spent on your specifics rather
than on explaining what a social casino is.

A solicitor should confirm at minimum:

1. Your age gate (18+ is the sensible default for a casino-themed app).
2. Your terms of service and privacy policy.
3. That none of your promotions accidentally cross into **sweepstakes**
   territory. Giving away a real prize, even once, changes the legal analysis
   completely.

Cheap and quick compared with licensing, but not optional.

---

## Trying it yourself

You need [Node.js](https://nodejs.org) installed (the "LTS" version). Then, in a
terminal, from the project folder:

```bash
npm install          # download everything the project needs — once
npm run build        # compile the shared packages
npm test             # run all 61 checks
npm run rtp          # simulate two million spins and report real payout rates
npm run economy      # simulate players — how long does a balance actually last?
```

To see the app on your phone:

```bash
npm install -g expo-cli   # once
cd app
npx expo start
```

A square barcode appears in the terminal. Install "Expo Go" from your app store,
point your camera at it, and the app opens on your phone. Edit a file, save it,
and your phone updates within a second or two. That loop is the single best
reason I chose this toolset for you.

---

## Where to go next

| Question | Document |
|---|---|
| Why these technologies? | [Tech Stack](01-tech-stack.md) |
| What happens when, and how long? | [Roadmap](02-roadmap.md) |
| Can I take Zelle and Venmo? | [Payments & Legal](03-payments-and-legal.md) |
| How do we add game number 50? | [Adding a Game](04-adding-a-game.md) |
| How does it make money? | [The Coin Economy](05-coin-economy.md) |
| What happens when I tap SPIN? | [The Play Path](06-the-play-path.md) |
| How do I put it online? | [Deploying](07-deploying.md) |
| What do I say to the lawyer? | [Legal Language](08-legal-language.md) |
