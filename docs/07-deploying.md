# Deploying Juwa

Juwa ships as a **website**, not a store app. No Apple Developer account, no
Google Play account, no store review.

This is the guide to getting it live. Follow it in order; each step takes
minutes, not days.

---

## What runs where

```
  Browser (iOS / Android / desktop)
     │
     │  static files — HTML, JS, icons, service worker
     ├────────────────────────────▶  Netlify / Vercel / Cloudflare Pages
     │
     │  Authorization: Bearer <Supabase JWT>
     ├────────────────────────────▶  Juwa API   (Node, packages/api)
     │                                    │
     │  sign up / log in / refresh        │  SQL
     └────────────────────────────▶  Supabase  ◀┘
                                     (Auth + Postgres)
```

Three pieces. Supabase owns identity and storage, the API owns the game, and a
static host serves the app.

---

## 1. Supabase

1. Create a project at supabase.com. Pick a region near your players.
2. Open the SQL editor and run every file in `db/migrations/` **in order**:
   `0001_ledger.sql`, `0002_social_economy.sql`, `0003_play.sql`,
   `0004_accounts.sql`, `0005_purchases.sql`.
3. Under Authentication → Providers, enable **Email**. Leave "Confirm email"
   on — it costs you a little sign-up friction and saves you a lot of junk
   accounts.
4. Collect three values from Settings:
   - **Project URL** and **anon key** (API section) — these go in the app
   - **JWT secret** (API → JWT Settings) — this goes in the API, and nowhere else

The anon key is public by design; it identifies the project and grants nothing.
Row Level Security is what protects the data, which is why every policy in the
schema is select-only and scoped to `auth.uid()`.

**The JWT secret is not public.** Anyone holding it can mint a token for any
player.

---

## 2. The API

Any host that runs Node works — Fly.io, Railway, Render, a container anywhere.

```bash
DATABASE_URL=postgres://...        # Supabase → Settings → Database → connection string
SUPABASE_JWT_SECRET=...            # from step 1
ALLOWED_ORIGINS=https://play.yourdomain.com
PORT=8787

# The store. Omit all four to run without one — checkout then returns 503,
# which is what you want on a staging environment.
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_SUCCESS_URL=https://play.yourdomain.com/
STRIPE_CANCEL_URL=https://play.yourdomain.com/
```

The API refuses to start with a Stripe key but no webhook secret. That
combination would take players' money and never grant coins — the worst failure
in the product, and exactly what a hurried deploy produces.

```bash
npm ci && npm run build
node packages/api/dist/main.js
```

It refuses to start if any of those are missing. That is deliberate: an API
running without a JWT secret is an API that accepts every token, and it should
never be possible to discover that in production.

`ALLOWED_ORIGINS` is an exact list, never `*`. Credentials are involved.

**Use the connection pooler** (port 6543) rather than a direct connection.
Serverless and small instances open more connections than Postgres will
tolerate.

---

## 3. The web app

```bash
cd app
EXPO_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co \
EXPO_PUBLIC_SUPABASE_ANON_KEY=eyJ... \
EXPO_PUBLIC_API_URL=https://api.yourdomain.com \
npm run build:web
```

That writes `app/dist`. Point Netlify, Vercel, or Cloudflare Pages at it.

`build:web` runs the export **and** `finalize-web.mjs`, which links the manifest
into the HTML and fails the build if the manifest references an icon that is not
there. Browsers silently refuse to install an app with a broken manifest, which
is a miserable thing to discover from a user report.

Two requirements from the host:

- **HTTPS.** Service workers and installability both require it. Every host
  above does it automatically.
- **SPA fallback** — serve `index.html` for unknown paths. On Netlify:

  ```
  /*  /index.html  200
  ```

### Demo mode is not a flag

If `EXPO_PUBLIC_API_URL` is unset, the app uses a local stub that fakes spins on
the device. There is no boolean to remember to flip — configure the URL and the
real client is used. A hard-coded `USE_DEMO_API = true` is exactly the kind of
thing that ships to production still set to `true`.

---

## 3b. Stripe

1. Create an account at stripe.com. Selling virtual game currency is ordinary
   digital goods — say so plainly during onboarding, because "casino" in the
   business name invites a question you would rather answer up front than have
   raised after a payout hold.
2. **Settings → Developers → Webhooks → Add endpoint:**
   `https://api.yourdomain.com/webhooks/stripe`
   Subscribe to: `checkout.session.completed`,
   `checkout.session.async_payment_succeeded`,
   `checkout.session.async_payment_failed`, `checkout.session.expired`.
3. Copy the signing secret (`whsec_…`) into `STRIPE_WEBHOOK_SECRET`.
4. Test with a card number of `4242 4242 4242 4242`, any future expiry, any CVC.

**The webhook is the only thing that grants coins.** The browser returning to
your success page proves nothing — anyone can visit that URL. If the webhook is
misconfigured, players will be charged and receive nothing, and you will find out
from an angry email rather than a graph. Verify it works before taking a real
payment: Stripe's dashboard shows every delivery attempt and its response.

Prices live in `packages/economy/src/packs.ts`, not in Stripe. The client sends
a pack **id** and the server looks up the amount, so a modified client cannot
name its own price.

## 4. Check it

```bash
curl https://api.yourdomain.com/health          # {"ok":true}
```

Then in the browser:

1. Sign up. A confirmation email should arrive.
2. The age gate appears. Try a date under 18 — it must refuse.
3. Register properly; 100,000 GC land.
4. Play a spin; the balance changes.
5. DevTools → Application: a service worker is running and the manifest is
   valid.
6. Buy a pack with the test card. The coins arrive within a second or two, and
   Stripe's dashboard shows the webhook returning 200.
7. Finally, in Supabase SQL:

   ```sql
   select currency, sum(amount) from ledger_entries group by currency;  -- 0
   select * from reconcile_balances();                                  -- no rows
   ```

If either of those last two is wrong, stop and investigate before letting
anyone else in.

---

## 5. Before real players

- [ ] **Nightly reconciliation.** Alert if `reconcile_balances()` returns
      anything. This is your early warning that something is wrong with money.
- [ ] **Backups.** Supabase does daily; confirm the retention matches what you'd
      need to recover from a bad Tuesday.
- [ ] **Sentry** on both app and API.
- [ ] **A staging project.** Never test a migration against live player data.
- [ ] **Terms of service and privacy policy**, reviewed by the lawyer.

---

## Running it locally

```bash
createdb juwa
psql juwa -f db/test/supabase_shim.sql      # stands in for Supabase's auth schema
for f in db/migrations/*.sql; do psql juwa -f "$f"; done

DATABASE_URL=postgres://localhost/juwa \
SUPABASE_JWT_SECRET=local-dev-secret \
ALLOWED_ORIGINS=http://localhost:8081 \
node packages/api/dist/main.js
```

To drive the real API from the app without a Supabase project, put a valid token
in `localStorage['juwa.dev-token']`. It changes only which token the client
sends — the server still verifies the signature, so it grants nothing you did
not already have, and it is ignored entirely once Supabase is configured.

---

## What web-only costs you

Worth keeping in view, because both are real:

**Discovery.** App stores are a search channel. Without them, every player
arrives through ads, social, or SEO, so acquisition cost becomes the number that
decides whether the business works.

**Push on iOS.** Android browsers handle web push well. Safari only delivers it
to sites the user has added to their home screen — and most won't, unasked.
Since "your daily bonus is ready" is what drives the streak ladder, the
install prompt in the lobby is doing real work, and email deserves to be a
first-class channel rather than an afterthought.

Neither is fatal, and the trade buys you the entire platform fee: **$9.40 net on
a $9.99 pack instead of $6.99**. But plan the retention loop around them rather
than discovering them after launch.
