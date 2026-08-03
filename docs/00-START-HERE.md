# Start Here

You said you have no technical background. This page is written for you, not for
a developer. Nothing here assumes you know what any of the words mean.

---

## What is actually in this repository

Think of the project as four separate boxes that snap together.

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

**3. The look** — `packages/ui`

Colours, text sizes, spacing, and how fast things animate. All in one place, so
when you decide the gold should be richer, it changes everywhere at once instead
of in forty separate files.

**4. The app** — `app/`

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

**A real bug was caught by the tests while building this.** The random number
generator had a subtle flaw that made some values come out negative — which would
have quietly skewed every game in the app. The test suite caught it before it
went anywhere. That is what the tests are for, and it's why the project has them
from day one rather than "later".

---

## The one thing I need you to do

Read [Payments & Legal](03-payments-and-legal.md), then **talk to a gaming
attorney.**

The short version: Zelle, Venmo and Stripe all prohibit gambling in their terms,
and real-money online casinos are legal in only a handful of US states, each
requiring a licence that costs a great deal and takes a year or more. There is a
very good route through this, and it's in that document — but the decision is
yours and it needs a lawyer, not me.

---

## Trying it yourself

You need [Node.js](https://nodejs.org) installed (the "LTS" version). Then, in a
terminal, from the project folder:

```bash
npm install          # download everything the project needs — once
npm run build        # compile the shared packages
npm test             # run all 41 checks
npm run rtp          # simulate two million spins and report real payout rates
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
