import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { minor } from '@juwa/money';
import { RngStream } from '../rng.js';
import { BlackjackEngine, handValue, type Card } from './blackjack.js';
import { RouletteEngine } from './roulette.js';
import { classicSlots } from './slots.js';
import { getGame, listGames } from './registry.js';
import { BetLimitError, IllegalActionError, toClientView } from './types.js';

const STAKE = minor(2000);

test('registry exposes every game through one interface', () => {
  const games = listGames();
  assert.ok(games.length >= 3);
  for (const game of games) {
    assert.equal(typeof game.id, 'string');
    assert.ok(game.rtp > 0.8 && game.rtp <= 1, `${game.id} has implausible RTP ${game.rtp}`);
    assert.ok(game.limits.min > 0 && game.limits.max > game.limits.min);
  }
  assert.equal(getGame('juwa-classic-slots').category, 'slots');
  assert.throws(() => getGame('no-such-game'), /Unknown game/);
});

test('client view never carries private state', () => {
  const engine = new BlackjackEngine();
  const state = engine.init(STAKE, new RngStream('s', 'c', 1));
  const view = toClientView(state) as Record<string, unknown>;
  // The hole card and the rest of the shoe must not be serialisable to a
  // player — that is the difference between a card game and a solved game.
  assert.equal('private' in view, false);
  assert.equal(JSON.stringify(view).includes('shoe'), false);
});

test('stakes outside the table limits are rejected', () => {
  const engine = classicSlots();
  const rng = () => new RngStream('s', 'c', 1);
  assert.throws(() => engine.init(minor(1), rng()), BetLimitError);
  assert.throws(() => engine.init(minor(999_999_999), rng()), BetLimitError);
});

// ---------------------------------------------------------------- slots

test('slots are deterministic for a given seed', () => {
  const engine = classicSlots();
  const one = engine.init(STAKE, new RngStream('server', 'client', 42));
  const two = engine.init(STAKE, new RngStream('server', 'client', 42));
  assert.deepEqual(one.public, two.public);
  assert.equal(one.settlement!.payout, two.settlement!.payout);
});

test('slots settle immediately and reject actions', () => {
  const engine = classicSlots();
  const state = engine.init(STAKE, new RngStream('s', 'c', 1));
  assert.equal(state.status, 'settled');
  assert.deepEqual(state.availableActions, []);
  assert.throws(() => engine.act(state, { type: 'hit' }, new RngStream('s', 'c', 2)),
    IllegalActionError);
});

test('slots grid is always 5x3 of known symbols', () => {
  const engine = classicSlots();
  for (let i = 0; i < 500; i++) {
    const { grid } = engine.init(STAKE, new RngStream('s', 'c', i)).public.baseSpin;
    assert.equal(grid.length, 5);
    for (const reel of grid) assert.equal(reel.length, 3);
  }
});

test('payout always equals stake times the reported multiplier', () => {
  // If these ever disagree, the ledger and the animation disagree, and one of
  // them is paying out the wrong amount.
  const engine = classicSlots();
  for (let i = 0; i < 2000; i++) {
    const state = engine.init(STAKE, new RngStream('s', 'c', i));
    const { stake, payout, multiplier } = state.settlement!;
    assert.equal(payout, Math.floor(stake * multiplier), `spin ${i}`);
    assert.ok(payout >= 0);
  }
});

test('slots RTP holds inside the certified band', () => {
  // The published figure is 96.25%. A change to a reel strip or a paytable
  // entry that moves RTP outside 95–97.5% must fail CI, not ship.
  const engine = classicSlots();
  let wagered = 0;
  let returned = 0;
  const spins = 200_000;
  for (let i = 0; i < spins; i++) {
    const state = engine.init(STAKE, new RngStream('rtp-guard', 'ci', i));
    wagered += STAKE;
    returned += state.settlement!.payout;
  }
  const rtp = returned / wagered;
  assert.ok(rtp > 0.95 && rtp < 0.975, `measured RTP ${(rtp * 100).toFixed(2)}% is out of band`);
  assert.ok(Math.abs(rtp - engine.rtp) < 0.015,
    `declared RTP ${engine.rtp} does not match measured ${rtp.toFixed(4)}`);
});

// ------------------------------------------------------------- roulette

test('roulette opens a table then settles on bets', () => {
  const engine = new RouletteEngine();
  const rng = new RngStream('roulette', 'test', 3);
  let state = engine.init(minor(1000), rng);
  assert.equal(state.status, 'awaiting-action');
  assert.deepEqual(state.availableActions, ['place-bets']);
  assert.equal(state.public.winningNumber, -1, 'no number before bets are down');

  state = engine.act(state, {
    type: 'place-bets',
    bets: [{ type: 'straight', selection: [7], amount: minor(1000) }],
  }, rng);
  assert.equal(state.status, 'settled');
  assert.ok(state.public.winningNumber >= 0 && state.public.winningNumber < 37);
  assert.equal(state.public.color, state.public.winningNumber === 0 ? 'green' : state.public.color);
});

test('a straight-up winner returns 36x', () => {
  // Straight-up bets are extremely high variance: per-spin payout is 36x with
  // probability 1/37, giving a standard deviation of ~5.8x the stake. Over
  // 50,000 spins the standard error on RTP is ~0.026, so the tolerance below
  // is roughly four sigma. A tighter bound would fail on chance alone.
  const engine = new RouletteEngine();
  const spins = 50_000;
  let wins = 0;
  let staked = 0;
  let paid = 0;
  for (let i = 0; i < spins; i++) {
    const rng = new RngStream('straight', 'test', i);
    let state = engine.init(minor(1000), rng);
    state = engine.act(state, {
      type: 'place-bets',
      bets: [{ type: 'straight', selection: [17], amount: minor(1000) }],
    }, rng);
    staked += state.settlement!.stake;
    paid += state.settlement!.payout;
    if (state.public.winningNumber === 17) {
      wins++;
      assert.equal(state.settlement!.payout, 36_000, 'winner must be paid 35:1 plus stake');
    } else {
      assert.equal(state.settlement!.payout, 0);
    }
  }
  const expectedWins = spins / 37;
  assert.ok(Math.abs(wins - expectedWins) < 150,
    `17 landed ${wins} times in ${spins} — expected ~${Math.round(expectedWins)}`);
  const rtp = paid / staked;
  assert.ok(Math.abs(rtp - 36 / 37) < 0.11, `straight-up RTP ${rtp.toFixed(4)}`);
});

test('zero loses every even-money bet', () => {
  const engine = new RouletteEngine();
  for (let i = 0; i < 20_000; i++) {
    const rng = new RngStream('zero', 'test', i);
    let state = engine.init(minor(1000), rng);
    state = engine.act(state, {
      type: 'place-bets',
      bets: [
        { type: 'red', selection: [], amount: minor(500) },
        { type: 'black', selection: [], amount: minor(500) },
      ],
    }, rng);
    if (state.public.winningNumber === 0) {
      // Covering both colours still loses to the green pocket. That single
      // pocket is the entire house edge.
      assert.equal(state.settlement!.payout, 0);
      return;
    }
    // Any non-zero result returns exactly the stake on a red+black hedge.
    assert.equal(state.settlement!.payout, 1000);
  }
  assert.fail('zero never landed in 20,000 spins');
});

test('roulette rejects malformed bets', () => {
  const engine = new RouletteEngine();
  const rng = new RngStream('bad', 'test', 1);
  const state = engine.init(minor(1000), rng);
  const bad = (bets: unknown) =>
    assert.throws(() => engine.act(state, { type: 'place-bets', bets } as never, rng),
      IllegalActionError);
  bad([]);
  bad([{ type: 'split', selection: [1], amount: minor(1000) }]);
  bad([{ type: 'straight', selection: [99], amount: minor(1000) }]);
  bad([{ type: 'dozen', selection: [5], amount: minor(1000) }]);
});

// ------------------------------------------------------------ blackjack

const card = (rank: Card['rank']): Card => ({ rank, suit: 'S' });

test('hand values handle aces correctly', () => {
  assert.deepEqual(handValue([card('A'), card('K')]), { total: 21, soft: true });
  assert.deepEqual(handValue([card('A'), card('A')]), { total: 12, soft: true });
  assert.deepEqual(handValue([card('A'), card('9'), card('5')]), { total: 15, soft: false });
  assert.deepEqual(handValue([card('K'), card('Q'), card('J')]), { total: 30, soft: false });
});

test('blackjack pays 3:2', () => {
  const engine = new BlackjackEngine();
  let naturals = 0;
  for (let i = 0; i < 3000 && naturals < 5; i++) {
    const state = engine.init(minor(1000), new RngStream('bj', 'test', i));
    const hand = state.public.hands[0]!;
    if (hand.outcome === 'blackjack') {
      naturals++;
      assert.equal(hand.payout, 2500, 'natural should return stake + 3:2');
    }
  }
  assert.ok(naturals > 0, 'no natural blackjack occurred in 3000 deals');
});

test('a round always terminates and settles', () => {
  const engine = new BlackjackEngine();
  for (let i = 0; i < 2000; i++) {
    const rng = new RngStream('bj-terminate', 'test', i);
    let state = engine.init(minor(1000), rng);
    let guard = 0;
    while (state.status === 'awaiting-action') {
      if (guard++ > 40) assert.fail(`round ${i} did not terminate`);
      // Always hit — the most aggressive strategy, guaranteeing we exercise
      // busting and the dealer-play path.
      state = engine.act(state, { type: 'hit' }, rng);
    }
    assert.equal(state.status, 'settled');
    assert.ok(state.settlement!.payout >= 0);
    assert.ok(state.public.dealerRevealed);
    for (const hand of state.public.hands) assert.ok(hand.outcome, 'every hand must be scored');
  }
});

test('illegal actions are refused', () => {
  const engine = new BlackjackEngine();
  const rng = new RngStream('bj-illegal', 'test', 1);
  const state = engine.init(minor(1000), rng);
  assert.throws(() => engine.act(state, { type: 'surrender' }, rng), IllegalActionError);
  assert.throws(() => engine.act(state, { type: 'place-bets' }, rng), IllegalActionError);
});

test('doubling doubles the stake and draws exactly one card', () => {
  const engine = new BlackjackEngine();
  for (let i = 0; i < 500; i++) {
    const rng = new RngStream('bj-double', 'test', i);
    let state = engine.init(minor(1000), rng);
    if (!state.availableActions.includes('double')) continue;
    state = engine.act(state, { type: 'double' }, rng);
    const hand = state.public.hands[0]!;
    assert.equal(hand.stake, 2000);
    assert.equal(hand.cards.length, 3);
    assert.equal(state.status, 'settled');
    return;
  }
  assert.fail('double was never offered in 500 deals');
});

test('splitting creates a second hand with its own stake', () => {
  const engine = new BlackjackEngine();
  for (let i = 0; i < 3000; i++) {
    const rng = new RngStream('bj-split', 'test', i);
    let state = engine.init(minor(1000), rng);
    if (!state.availableActions.includes('split')) continue;
    state = engine.act(state, { type: 'split' }, rng);
    assert.equal(state.public.hands.length, 2);
    assert.equal(state.public.hands[1]!.stake, 1000);
    for (const hand of state.public.hands) assert.equal(hand.cards.length, 2);
    // Total exposure is now two units, and the settlement must say so.
    while (state.status === 'awaiting-action') {
      state = engine.act(state, { type: 'stand' }, rng);
    }
    assert.equal(state.settlement!.stake, 2000);
    return;
  }
  assert.fail('split was never offered in 3000 deals');
});

test('house edge lands where the rules say it should', () => {
  // Always-stand is a known-bad strategy that gives up roughly 16% to the
  // house. If this drifts far from that, the dealer logic has changed.
  const engine = new BlackjackEngine();
  let staked = 0;
  let paid = 0;
  for (let i = 0; i < 20_000; i++) {
    const rng = new RngStream('bj-edge', 'test', i);
    let state = engine.init(minor(1000), rng);
    while (state.status === 'awaiting-action') {
      state = engine.act(state, { type: 'stand' }, rng);
    }
    staked += state.settlement!.stake;
    paid += state.settlement!.payout;
  }
  const rtp = paid / staked;
  assert.ok(rtp > 0.78 && rtp < 0.88,
    `always-stand RTP ${(rtp * 100).toFixed(2)}% — expected ~84%`);
});
