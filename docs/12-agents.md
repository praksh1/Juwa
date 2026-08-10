# Agents

Admin → Agent → Player. Three roles, one level deep, and deliberately no more
than that.

An **agent** is a distributor. An operator gives them an inventory of coins;
they hand that inventory out to the players they recruited. That is the whole
job. Agents do not recruit other agents, there are no downlines, there is no
commission structure, and there is no path for coins to travel back from a
player to an agent.

---

## The shape of it

```
  OPERATOR                    AGENT                      PLAYER
  ────────                    ─────                      ──────
  console at /admin           the app's Agent tab        the app, unchanged

  creates agents        →     holds inventory       →    receives coins
  grants inventory            invites players            plays games
  activates / suspends        allocates to players       cannot send anything back
  reassigns players
```

Coins only ever flow **down**. House → agent → player. Every arrow is a real
double-entry transaction in the same ledger the games use.

---

## Before anything: you need an operator account

The operator console is at **your API's URL + `/admin`** — on Railway, not on
the Cloudflare site. No operator code is ever shipped to a player's device, so
it is not on the player site and never will be.

If you have never created an operator, you cannot sign in and therefore cannot
create an agent. Set it up first — see
[Deploying, §3c](07-deploying.md#3c-the-operator-panel). The short version: put
`BOOTSTRAP_OPERATOR_EMAIL` and `BOOTSTRAP_OPERATOR_PASSWORD` in Railway's
variables, redeploy, read the `otpauth://` line out of the deploy log into an
authenticator app, then delete both variables.

## Setting up your first agent

The person **signs up as an ordinary player first**, with their own email and
their own password, through the normal flow. Nothing in this system creates a
login on somebody else's behalf, and no operator ever sees an agent's password.

Then, in the operator console at `/admin`:

1. Scroll to **Agents**.
2. Type their existing **player username**, give them an **agent name** (this
   is what their players see), and press **Promote to agent**.
3. They start **pending** — they can see the dashboard but cannot allocate or
   invite. Press **Activate** when you are ready.
4. Type an amount in **Grant inventory**, add a reference if you want one on
   the record, and press **Grant**.

Next time they open the app they have an **Agent** tab.

> **There is no separate agent login, and this catches everyone once.** An agent
> signs in through the ordinary player sign-in box with their own email and
> password. Being an agent is a property of an account, not a different door.
> The tab appears because the server tells the app that this account is an
> agent — so if the tab is missing, the account has not been promoted yet.

## How an agent gets players

They press **Create invite link** and send the link to somebody. It works
**once** and expires after **seven days**. The person who opens it sees "Invited
by <agent name>" on the sign-up screen and is attached to that agent the moment
they finish registering.

Players who signed up before any of this existed, or who signed up directly,
have no agent. That is fine and nothing breaks — free coins, the daily bonus and
the store all work exactly as before for everybody.

## Moving a player between agents

Operator only, from the console. There is no self-service route for it: not for
the player, not for the agent. It is recorded in the audit log with who did it.

---

## What is enforced, and where

**In the database, not in the API.** `allocate_to_player` re-checks that the
agent is active and that the player belongs to *that* agent, inside the same
transaction that moves the coins. A bug in the API, a route somebody adds later,
or a direct `psql` session cannot move coins between an agent and a player who
are not related, because the function that moves them refuses.

| Rule | Enforced by |
| --- | --- |
| An agent can only fund their own players | `allocate_to_player` ownership check |
| An agent can never allocate more than they hold | `account_balance_cache` non-negative trigger |
| Two simultaneous allocations cannot both spend the last coins | row lock in `post_transfer`, taken in id order |
| A suspended agent can do nothing | status check in `allocate_to_player` |
| An invitation works exactly once | `UPDATE ... WHERE redeemed_at is null` |
| A retried allocation pays once | idempotency key on the ledger transaction |
| Nobody can edit history | `audit_log` is append-only; the ledger is insert-only |

The concurrency case is worth stating plainly because it is the one that costs
real money if it is wrong: six simultaneous requests for 200,000 coins against
an inventory of 893,000 result in exactly four allocations and two refusals,
never five. That is tested.

## What agents and players cannot do

None of these exist as endpoints. They are not unbuilt features.

- A player cannot withdraw, redeem, cash out, sell, or transfer coins.
- A player cannot send coins back to their agent.
- A player cannot change which agent they belong to.
- An agent cannot take coins back from a player.
- An agent cannot transfer inventory to another agent.
- An agent cannot create another agent, or grant themselves inventory.

The first two are the important ones. **A balance that can flow back out to a
person is a balance somebody can be paid cash for**, and that is the line
between a social casino and a business that needs a gambling licence in every
state it operates in.

---

## ⚠️ Two things to take to a lawyer before this goes live

Both are about the agent system specifically, not about the app in general.

**1. Agents distributing coins that were bought with money.** Coins in this
product are sold through the app store and through Stripe. An agent handing out
coins is handing out something that has a retail price, to people they may know
personally. If any agent takes cash for those coins — even informally, even
without your knowledge — the transaction on the other side looks exactly like an
unlicensed gambling operation, and it looks that way to a regulator whether or
not the software permitted it. You need a written agent agreement that forbids
it in terms, and a way to suspend an agent the day you hear about it. The
suspend button exists; the agreement does not yet.

**2. Apple and Google in-app purchase rules.** Both stores require that digital
goods consumed in an app are sold through their billing systems, and both take a
cut. An agent distributing coins outside the store is, from Apple's point of
view, a distribution channel for a digital good that bypassed App Store billing.
Today this is shipped as a web app, which is why the question has not bitten
yet — the rules apply to native apps. **If you ever wrap this in a native
iOS or Android app, this feature is the thing most likely to fail review.** Ask
about it before you pay anyone to build the wrapper, not after.

Neither of these is a reason not to have agents. They are reasons to have the
paperwork before the agents, rather than after.

---

## Where the code is

| Thing | File |
| --- | --- |
| Schema, and every rule that cannot be bypassed | `db/migrations/0009_agents.sql` |
| Audit attribution | `db/migrations/0010_agent_audit_actor.sql` |
| Data layer | `packages/server/src/agents.ts` |
| HTTP routes | `packages/api/src/agent-routes.ts` |
| Operator console section | `packages/api/src/admin-console.ts` |
| Agent dashboard | `app/src/screens/AgentScreen.tsx` |
| Invite link handling | `app/src/api/invite.ts` |
| Tests | `packages/api/src/agents.test.ts` |

Run the tests with a local Postgres:

```bash
PGHOST=/var/run/postgresql npm run test:api
```
