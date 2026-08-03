# Adding a Game

You asked for an architecture that scales to as many games as possible. This
document is the proof that it does — adding a game touches three files and
changes nothing else.

## The contract

Every game implements one interface, `GameEngine`
(`packages/engine/src/games/types.ts`):

```ts
interface GameEngine {
  id: string;
  name: string;
  category: GameCategory;
  limits: BetLimits;
  rtp: number;

  /** Open a round. Instant games settle here and are done. */
  init(stake: Minor, rng: RngStream): RoundState;

  /** Apply a player action to an open round. Multi-step games use this. */
  act(state: RoundState, action: GameAction, rng: RngStream): RoundState;
}
```

That is the whole surface. The wallet, the ledger, the API and the app all speak
`GameEngine` — none of them has ever heard of "slots" or "blackjack".

## Two rules that are not negotiable

**1. Engines are pure.** No clock, no `Math.random()`, no network, no
module-level mutable state. Randomness arrives only through the injected
`RngStream`.

This isn't purism. It's what makes a round *replayable*: given the same seeds,
an engine produces the same result forever. When a player disputes a hand six
months from now, you replay it from the stored seeds and show them exactly what
happened. It's also what lets the test suite simulate two million spins in ten
seconds.

**2. Engines run on the server.** The `RoundState.private` field — the rest of
the shoe, the dealer's hole card — is stripped by `toClientView()` before
anything is sent to a player. A client that can see the deck is a client that
can beat you.

## The three steps

### 1. Write the engine

`packages/engine/src/games/keno.ts`:

```ts
export class KenoEngine implements GameEngine<KenoPublic, null, KenoConfig> {
  readonly id = 'juwa-keno';
  readonly name = 'Keno';
  readonly category = 'instant' as const;
  readonly limits = { min: minor(50), max: minor(20_000) };
  readonly rtp = 0.95;          // measured, then written here
  readonly config = { spots: 80, drawn: 20 };

  init(stake: Minor, rng: RngStream): RoundState<KenoPublic, null> {
    assertWithinLimits(stake, this.limits);
    const drawn = rng.shuffle(ALL_NUMBERS).slice(0, 20);
    const multiplier = payoutFor(drawn);
    return {
      status: 'settled',
      public: { drawn, multiplier },
      private: null,
      availableActions: [],
      settlement: { stake, payout: mul(stake, multiplier), multiplier },
    };
  }

  act(state, action) {
    throw new IllegalActionError(action.type, state.availableActions);
  }
}
```

### 2. Register it

One line in `packages/engine/src/games/registry.ts`:

```ts
register(new KenoEngine());
```

The lobby, the bet endpoint and the settlement path pick it up automatically.

### 3. Measure the RTP before you ship it

Add the game to `packages/engine/src/tools/rtp.ts` and run:

```bash
npm run rtp
```

The simulator reports the payout percentage, hit frequency and volatility over
millions of rounds. **Then** write that number into `readonly rtp`, and add a
test that fails if it ever drifts — as `games.test.ts` does for slots.

This ordering matters. RTP is a *measured property* of your reel strips and
paytable, not a setting you choose. Anyone who tells you they "set the RTP to
96%" has misunderstood how a slot machine works.

## Then the renderer

The engine is a few hours. The renderer — art, animation, sound — is where the
real time goes, and that is exactly the right shape: the risky part (money,
fairness, settlement) is written and tested once and shared by every game, while
the per-game work is presentation, where a bug costs you an ugly screen rather
than your float.

## Multi-step games

Blackjack (`packages/engine/src/games/blackjack.ts`) is the reference. The
pattern:

- `init` deals and returns `status: 'awaiting-action'` with `availableActions`
- `act` validates the action **against `availableActions`** and advances
- when no hand can act, the dealer plays and the round settles

Always validate against `availableActions`. The client is untrusted input — a
player who can send `double` on a five-card hand will.

## A checklist for new games

- [ ] Engine implements `GameEngine`, pure, no `Math.random()`
- [ ] Hidden state in `private`, never in `public`
- [ ] `act()` rejects anything not in `availableActions`
- [ ] Bet limits enforced via `assertWithinLimits`
- [ ] RTP measured by simulation, then asserted in a test
- [ ] Determinism test: same seeds → same result
- [ ] Termination test: a round always reaches `settled`
- [ ] `payout === floor(stake * multiplier)` holds
- [ ] Registered in `registry.ts`
