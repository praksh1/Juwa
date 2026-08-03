# Payments & Legal — read this before you build anything else

> ## ✅ DECIDED: Juwa is a social casino
> **August 2026.** Gold Coins are bought or earned, spent on play, and never
> convert back to money. No redemption, no sweepstakes, no gaming licence.
>
> **What this settles:**
> - Payments go through **Apple IAP, Google Play Billing and Stripe** — all of
>   which permit selling virtual currency. Zelle and Venmo are off the table and
>   are not needed.
> - No state gaming licence, no lab certification, no geofencing.
> - The app stores treat us as an ordinary casino-*themed* game, provided we
>   state clearly that coins have no cash value.
>
> **What still needs a lawyer:** age gating (18+ recommended), the sweepstakes
> line you must not cross, terms of service, and privacy/data rules. Far
> cheaper and faster than licensing, but not zero. See §6.
>
> The economics of this decision are in [The Coin Economy](05-coin-economy.md).

The rest of this document is the reasoning behind that decision. It is worth
keeping: it is the answer to "why can't we just take Venmo?", which you will be
asked again.

---

## 1. The thing nobody tells you first

**"Casino app" is not one product. It is three, and they have wildly different
costs.**

| Model | What players bet | Can they cash out? | Licence needed | Realistic cost to launch |
|---|---|---|---|---|
| **Social casino** | Virtual coins bought for fun | No | None | Low — weeks |
| **Sweepstakes casino** | Dual currency; one is redeemable | Yes, for prizes | No gaming licence, but heavy legal review | Medium — months |
| **Real-money iGaming** | Actual dollars | Yes | State gaming licence | High — 12–24 months, $1M+ |

Almost everyone who says "I want to build a casino app" pictures the third one
and budgets for the first one. The gap between them is not code. The code is
nearly identical — it's the same engines, the same ledger, the same UI. The gap
is licensing, banking, and compliance.

**Real-money online casino gaming is legal in only a handful of US states** —
New Jersey, Pennsylvania, Michigan, West Virginia, Connecticut, Delaware and
Rhode Island, at the time of writing. Each one requires its own licence from
that state's gaming regulator. That means:

- Corporate and personal background investigations of every significant owner
- Game software certified by an independent lab (GLI, BMM, or similar)
- Geolocation that proves a player is physically inside state lines on every bet
- Bank-grade AML/KYC programmes
- Application and licence fees in the hundreds of thousands to millions

This is not a "we'll sort it out after launch" item. Operating without it is a
criminal offence in most states, not a fine.

---

## 2. Why Zelle, Venmo and Stripe will not work for gambling

I want to be specific here, because these three come up every time.

### Zelle — no, and not fixable

Zelle is a bank-to-bank transfer network run by Early Warning Services (owned by
a consortium of major US banks). Two problems, either of which is fatal:

1. **There is no merchant API.** Zelle is a person-to-person product. There is
   no integration path for a business to programmatically accept or send Zelle
   payments inside an app. What businesses do instead is publish a phone number
   and reconcile by hand — which does not scale and is not auditable.
2. **Zelle payments are irreversible and have no purchase protection.** Zelle's
   own guidance is to use it only with people you trust. Regulators and banks
   actively monitor Zelle for gambling-related flows; accounts get frozen.

If you have seen a gaming app that takes Zelle, it is almost certainly operating
outside a licence. That is the company you'd be keeping.

### Venmo / PayPal / Braintree — prohibited by policy

Venmo and Braintree are both PayPal companies, so they share one acceptable-use
policy, and **gambling is a restricted category** under it. PayPal does process
gambling payments — but only for operators who are already licensed and who have
signed a specific gambling agreement. You cannot get there by signing up on the
website. Using a standard account for gaming gets it frozen with the balance
held, typically at the worst possible moment.

### Stripe — same story

Gambling appears on Stripe's restricted-businesses list. Stripe supports
licensed operators in certain markets under a bespoke agreement, but a normal
Stripe account processing casino wagers will be shut down during review. Stripe
is superb, and I'd use it in a heartbeat — for a **social casino selling virtual
coins**, which is ordinary digital-goods commerce and entirely within policy.

### Plaid — useful, but it isn't a payment processor

Worth clearing up since you named it: Plaid mainly connects bank accounts and
reads account data. Gaming operators do use it, but for **identity and account
verification** and for powering ACH — not as the payment rail itself. It's a
component, not the answer.

---

## 3. What actually works

### If you go social / sweepstakes (my recommendation to start)

You are selling virtual currency. That is standard e-commerce, and the mainstream
processors will take you:

- **Apple In-App Purchase / Google Play Billing** — mandatory for coin packs sold
  inside the mobile apps. Apple and Google take 15–30%. This is not optional and
  it is the single biggest line item in your economics.
- **Stripe** — for web purchases, where you keep far more of the revenue. Expect
  a meaningful share of players to buy on web once you nudge them there.
- **Trustly / Nuvei / PayNearMe** — for redemptions, if you run sweepstakes.

⚠️ **A warning specific to the sweepstakes model.** It has been under active
regulatory attack, with multiple states moving to restrict or ban sweepstakes
casinos and attorneys-general issuing cease-and-desist letters. My information
has a cutoff and this area moves month to month. Do not take the table above as
current — have a gaming attorney confirm the position in every state you intend
to operate in, before you spend money on it.

### If you go real-money later

You will not be using consumer payment brands. You will be using processors
built for licensed iGaming: **Nuvei, Worldpay for Gaming, Paysafe, Trustly,
Sightline, PayNearMe**. They handle the card declines, the state-by-state rules,
and the bank relationships that general processors won't touch.

The good news: **the architecture in this repo doesn't change.** Payments sit
behind a provider interface, and the ledger records movements in minor units
regardless of who moved them. Swapping Stripe for Nuvei is a new adapter, not a
rewrite. That's deliberate.

---

## 4. The app stores

Both stores treat real-money gambling as a special category:

- **Apple** requires that real-money gaming apps be submitted by the licensed
  operator (or with documented permission from one), be free to download, and be
  geo-restricted to licensed regions.
- **Google Play** allows real-money gambling only in approved countries, and
  requires a declaration form plus proof of licence.

Social casino apps with no cash-out have a far easier path in both stores — they
are ordinary games. Sweepstakes apps land in an awkward middle and get rejected
with some regularity.

---

## 5. Why the social model won

Not as a compromise — as strategy:

1. **You can ship it.** Weeks, not years. Real players, real feedback, real
   revenue from coin sales.
2. **It de-risks everything expensive.** You'll learn whether people like your
   games before you spend a million dollars on a licence for games nobody wants.
3. **It is the same codebase.** Every piece in this repo — the engines, the
   provably-fair RNG, the ledger, the wallet — is exactly what a licensed
   operator needs. The currency definitions in `packages/engine/src/money.ts`
   ship with `redeemable: false`, and turning that on is a deliberate one-line
   change designed to be reviewed, not stumbled into.
4. **It is what the big players did.** Several major real-money operators
   started as social casinos and used the audience as their launch customers.

**Still see a lawyer**, even having chosen the safer model. A social casino is
far simpler than a licensed operator, but you still need someone to confirm your
age gating, your terms of service, and — most importantly — that nothing in your
promotions accidentally crosses into sweepstakes territory. Giving away a real
prize, even once, changes the legal analysis entirely.

---

## 6. Responsible gaming is not optional

Whichever model you choose, these ship from day one. They're in the schema
already (`profiles` in `db/migrations/0001_ledger.sql`):

- Deposit limits the player sets for themselves
- Session time limits and reality-check reminders
- Self-exclusion that is easy to turn on and deliberately hard to turn off
- Age verification before any purchase
- Visible links to problem-gambling support

These are legally required in licensed markets, they're app-store expectations
everywhere else, and they're the difference between a business you're proud of
and one you aren't.
