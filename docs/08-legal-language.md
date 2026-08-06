# Legal Language for a Social Casino

> **I am not a lawyer and this is not legal advice.** What follows is a
> drafting aid: the clauses social casino operators commonly use, in roughly the
> language they use them, so that your hour with a solicitor is spent on *your*
> specifics rather than on explaining what a social casino is.
>
> Take this to a lawyer. Do not publish it as-is.
>
> Two further cautions. My knowledge has a cutoff, and this area — particularly
> anything touching sweepstakes — has been moving quickly. And these patterns
> are drawn from US-facing operators; if you launch in the UK, EU, Canada or
> Australia, consumer-protection and gambling-adjacent rules differ materially.

---

## 1. The four sentences that do the heavy lifting

Almost every social casino puts some version of these where players will see
them — app listing, sign-up screen, store, and footer. They are what separates
"a game" from "gambling" in the eyes of a platform reviewer, an ad network, and
a regulator.

> **Juwa is intended for entertainment purposes only.**
>
> **Juwa is intended for an adult audience (18+).**
>
> **Gold Coins have no monetary value, cannot be redeemed for cash or prizes,
> and purchasing them does not constitute gambling.**
>
> **Practice or success at social casino gaming does not imply future success at
> real-money gambling.**

That last one looks odd until you know why it exists: it is the standard
disclaimer that keeps a free casino-style game from being treated as a
promotion for real gambling. Ad networks and app stores look for it specifically.

**Where Juwa already says these:** the sign-up screen, the store, the lobby
footer, and the wallet. Grep for "no cash value" to find them all.

---

## 2. Terms of Service — the clauses that actually matter

Ordered roughly by how much trouble their absence causes.

### 2.1 Virtual items are licensed, not owned

The single most important clause. Without it, players can argue they own their
coin balance, which turns every account closure into a property dispute.

> Gold Coins and other virtual items are licensed, not sold. You are granted a
> limited, personal, non-exclusive, non-transferable, non-sublicensable,
> revocable licence to use virtual items solely within the Service. You have no
> ownership or property interest in any virtual item, and virtual items have no
> monetary value outside the Service.
>
> We may modify, manage, control, or eliminate virtual items at any time, with
> or without notice. Virtual items are forfeited if your account is terminated
> or closed, and are not transferable between accounts, to other users, or to
> any third party.

### 2.2 No real-money gambling

> The Service does not offer real-money gambling or an opportunity to win real
> money or prizes. No element of the Service is a wager. Gold Coins cannot be
> exchanged for money, goods, or anything of value.

### 2.3 Age

> You must be at least 18 years old to create an account or purchase virtual
> items. By using the Service you represent and warrant that you are 18 or
> older. We may suspend or terminate any account we reasonably believe belongs
> to a person under 18, and any virtual items in that account will be forfeited.

Ask the lawyer whether your target markets need 21, and whether "represent and
warrant" is enough or you need documentary verification. Juwa collects a date of
birth and enforces 18 in the database (`assert_can_play`), which is stronger
than a checkbox and worth mentioning to them.

### 2.4 Purchases and refunds

> All purchases of virtual items are final and non-refundable except where
> required by applicable law. Because virtual items are delivered immediately
> and consumed within the Service, you acknowledge and agree that you lose any
> right of withdrawal or cancellation once delivery has begun.

The "except where required by applicable law" is not optional — EU and UK
consumer law grants withdrawal rights that a term cannot simply remove, though
the immediate-delivery consent above is the standard way of handling it. Get this
one checked properly; it is the clause most likely to be unenforceable if copied
carelessly.

### 2.5 Chargebacks

> Initiating a chargeback or payment dispute without first contacting support
> may result in immediate suspension or termination of your account and
> forfeiture of all virtual items.

Worth having, and worth actually honouring gently — a first-time chargeback is
usually confusion rather than fraud.

### 2.6 Prohibited conduct

> You agree not to: use bots, scripts, automation, or any software that
> interacts with the Service other than the published client; exploit bugs,
> errors, or unintended game behaviour; create multiple accounts to obtain
> additional bonuses; buy, sell, or transfer accounts or virtual items;
> reverse-engineer, decompile, or interfere with the Service; or attempt to
> access another user's account.
>
> We may void any winnings, remove any virtual items, and suspend or terminate
> any account obtained through prohibited conduct.

Juwa rate-limits bets per player and grants coins only through the server, so
the technical enforcement exists; this makes the consequence contractual too.

### 2.7 Termination

> We may suspend or terminate your account at any time, with or without cause
> and with or without notice. On termination, your licence to use virtual items
> ends and all virtual items are forfeited without refund.

### 2.8 Dispute resolution

Standard in US-facing terms:

> **Binding arbitration.** Any dispute arising out of or relating to these Terms
> or the Service shall be resolved by binding individual arbitration
> administered by [ARBITRATION BODY] under its consumer rules.
>
> **Class action waiver.** You and we agree that each may bring claims only in an
> individual capacity, and not as a plaintiff or class member in any purported
> class or representative proceeding.
>
> **Opt-out.** You may opt out of arbitration by writing to [ADDRESS] within 30
> days of first accepting these Terms.

⚠️ Arbitration clauses are enforceable in the US but restricted or void in
several other jurisdictions, and mass-arbitration campaigns have made them a
double-edged sword. This is exactly the kind of clause not to copy without
advice.

### 2.9 Limitation of liability and disclaimers

The usual "AS IS", no warranties, liability capped at amounts paid in the last
12 months. Boilerplate, but jurisdiction-sensitive — hand it to the lawyer.

### 2.10 Governing law, changes, contact

Where you incorporate; how you notify of changes (usually "continued use
constitutes acceptance", plus email for material changes); a real contact
address. Several jurisdictions require a genuine postal address, not just an
email.

---

## 3. Privacy Policy

Whatever the lawyer drafts, it has to accurately describe what Juwa actually
does. From the code, that is:

| Data | Why | Where |
|---|---|---|
| Email address | Account identity, login, password reset | Supabase Auth |
| Password | Never seen by us — hashed by Supabase | Supabase Auth |
| Username | Display | `profiles` |
| Date of birth | The 18+ age gate | `profiles` |
| Country | Regional rules | `profiles` |
| Coin balance, bets, wins | The game and its ledger | `ledger_entries`, `game_rounds` |
| Purchase records | Receipts and support | `coin_purchases` |
| Card details | **Never touch our servers** — Stripe's hosted checkout | Stripe |
| IP address, timestamps | Security, rate limiting | Logs |

Clauses to expect:

- **Not directed at children.** "The Service is not directed to children under
  13 and we do not knowingly collect personal information from them." (COPPA in
  the US; the UK Age Appropriate Design Code is stricter and worth raising.)
- **Legal basis / rights.** GDPR (EU/UK) and CCPA/CPRA (California) both require
  disclosure and give access, deletion and opt-out rights. Ask which apply given
  where you will actually have users.
- **Sub-processors.** Name them: Supabase (auth and database), Stripe
  (payments), your hosting provider, and any analytics.
- **Retention.** How long you keep data after account closure. Note that the
  ledger is deliberately append-only — corrections are posted as reversing
  entries rather than edits. That is good financial practice and it interacts
  with "right to erasure", so flag it explicitly.
- **Cookies / local storage.** Juwa stores a session and a mute preference in
  the browser. Minimal, but disclose it.

---

## 4. The sweepstakes line — do not cross it accidentally

This is where a social casino becomes a regulated product, and it is easy to
cross without meaning to.

In broad US terms, a promotion becomes gambling when three things coincide:

1. **Consideration** — the player pays something
2. **Chance** — the outcome is random
3. **Prize** — something of value is won

A social casino has consideration (coin purchases) and chance (the games), and
survives because there is **no prize** — coins have no value and cannot leave
the system.

So the things that would break it:

- ❌ Letting players cash out, at all
- ❌ Awarding real prizes — gift cards, merchandise, tournament payouts
- ❌ Tolerating a secondary market where accounts or coins are sold for money
- ❌ Anything that gives coins value outside the game

**Even once.** A single promotional giveaway of something valuable can change the
analysis for the whole product.

Juwa enforces this structurally rather than by policy: `assertRedeemable()`
always throws, and a database trigger rejects every withdrawal. Show your lawyer
`db/migrations/0002_social_economy.sql` — that a cash-out is impossible without a
deliberate schema change is a genuinely useful fact for them.

If you ever *do* want redemption, that is the sweepstakes model: a second,
non-purchasable currency obtained free (including a mail-in "alternative method
of entry"), redeemable for prizes. It is a different legal product needing
state-by-state analysis, and it has been under active regulatory attack. Do not
drift into it — decide to do it.

---

## 5. Platform and advertising rules

Even without an app store, others get a say:

- **Stripe.** Selling virtual game currency is ordinary digital goods. Say so
  plainly during onboarding — "casino" in the name invites a question better
  answered up front than after a payout hold.
- **Meta / Google ads.** Social casino advertising is a restricted category in
  many countries and may need certification even with no real-money play. Check
  before you budget for acquisition.
- **Apple / Google.** Not applicable while Juwa is a website. If you ever ship a
  native app: casino-themed games are allowed, need an age rating, and must not
  imply real gambling.

---

## 6. What to actually ask the lawyer

Take this list. It is roughly an hour's worth.

### ⚠️ Ask question 0 first — it is worth more than the rest combined

> **Between 2025 and 2026, fourteen US states banned sweepstakes casinos.**
> Juwa has no redemption — `assertRedeemable` in `@juwa/money` refuses to
> convert coins into anything — so those statutes were written for a model it
> does not operate. **Does that hold?** Some of the bills are drafted broadly.
> If a free-to-play social casino with purchasable coins falls inside any of
> them, that is a product change, and it is far cheaper to hear it now.

The fourteen are listed, dated and cited in `SWEEPSTAKES_RESTRICTED_STATES`
(`packages/economy/src/jurisdictions.ts`), already wired to switch on by itself
if redemption is ever enabled. California and New York are among them — about a
fifth of the US population — so this is not a detail to defer.

The rest of the list assumes the answer to question 0 is "yes, you are outside
them".

1. Is 18 the right minimum age for the markets I am targeting, and is
   self-declared date of birth sufficient, or do I need verification?
2. Which jurisdictions am I exposed to, given I sell worldwide over the web —
   and should I geo-block anywhere?
3. Is my no-refund term enforceable where my players are, given EU/UK
   withdrawal rights?
4. Should I include an arbitration clause and class-action waiver, or does it
   create more risk than it removes?
5. Does anything in my bonus, VIP or promotional design risk creating
   "consideration for a prize"?
6. What must my privacy policy say given Supabase and Stripe as sub-processors,
   and how do GDPR/CCPA deletion rights interact with an append-only financial
   ledger?
7. Do I need a company before taking payments, and in which jurisdiction?
8. Is my marketing language safe — can I say "casino", "jackpot", "win"?
9. What are my obligations if a player says they have a gambling problem?
10. Anything specific to my state or country I have not thought to ask?

**Bring with you:** the four disclaimers in §1, this document, and a link to
`db/migrations/0002_social_economy.sql`. A lawyer who can see that redemption is
structurally impossible will get to an answer faster than one taking your word
for it.

---

## 7. Responsible play

Not strictly required for a social casino in most places, but expected by ad
networks and platforms, and simply right. Juwa's schema already carries the
fields — `self_excluded_until`, `daily_deposit_limit`, `session_limit_minutes` —
and `assert_can_play` enforces self-exclusion on every bet. The UI for setting
them is not built yet.

Standard language:

> Juwa is a game. If it stops being fun, take a break. You can set spending
> limits or self-exclude at any time in your profile. If you are worried about
> gambling, help is available at [national helpline].

Social casino revenue is heavily concentrated in a small number of players. That
makes these controls a business decision as much as an ethical one: a product
that depends on a handful of people spending more than they can afford is
fragile, and it is the kind of thing that ends up in a journalist's inbox.
