import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  GameConfigCache,
  GameDisabledError,
  StakeOutOfRangeError,
  applyMaxWin,
  assertBetAllowed,
  type GameConfig,
} from './game-config.js';

const DEFAULTS: GameConfig = {
  enabled: true,
  maxWinMultiplier: null,
  maxPayoutGc: null,
  minBet: null,
  maxBet: null,
};

function fakeDb(rows: unknown[], counter: { calls: number }, maxPayoutGc: number | null = null) {
  return {
    async query<T>(sql: string): Promise<{ rows: T[] }> {
      if (sql.includes('game_configs')) {
        counter.calls++;
        return { rows: rows as T[] };
      }
      return { rows: [{ max_single_bet_payout: maxPayoutGc }] as T[] };
    },
  };
}

test('an unconfigured game runs on engine defaults, not disabled', async () => {
  // The failure this guards against takes the whole catalogue offline the first
  // time the config table is empty.
  const counter = { calls: 0 };
  const cache = new GameConfigCache(fakeDb([], counter));
  const config = await cache.get('anything');
  assert.deepEqual(config, DEFAULTS);
});

test('config is cached and refreshed on a clock, not per call', async () => {
  const counter = { calls: 0 };
  let now = 1_000_000;
  const cache = new GameConfigCache(
    fakeDb([{ game_id: 'g', enabled: false, max_win_multiplier: null, min_bet: null, max_bet: null }], counter),
    () => now,
  );

  await cache.get('g');
  await cache.get('g');
  await cache.get('g');
  assert.equal(counter.calls, 1, 'queried more than once inside the window');

  now += 31_000;
  await cache.get('g');
  assert.equal(counter.calls, 2, 'did not refresh after the window');
});

test('concurrent misses share one query rather than stampeding', async () => {
  const counter = { calls: 0 };
  const cache = new GameConfigCache(fakeDb([], counter));
  await Promise.all(Array.from({ length: 20 }, () => cache.get('g')));
  assert.equal(counter.calls, 1, `${counter.calls} queries for one refresh`);
});

test('invalidate makes an operator change visible immediately', async () => {
  const counter = { calls: 0 };
  const cache = new GameConfigCache(fakeDb([], counter));
  await cache.get('g');
  cache.invalidate();
  await cache.get('g');
  assert.equal(counter.calls, 2);
});

test('a disabled game refuses bets', () => {
  assert.throws(
    () => assertBetAllowed({ ...DEFAULTS, enabled: false }, 'g', 100),
    GameDisabledError,
  );
  // The message must not name the operator or the reason — a player does not
  // need to know the game was switched off deliberately.
  try {
    assertBetAllowed({ ...DEFAULTS, enabled: false }, 'g', 100);
  } catch (error) {
    assert.match((error as Error).message, /temporarily unavailable/);
  }
});

test('operator bet limits are enforced', () => {
  const config = { ...DEFAULTS, minBet: 100, maxBet: 5_000 };
  assert.doesNotThrow(() => assertBetAllowed(config, 'g', 100));
  assert.doesNotThrow(() => assertBetAllowed(config, 'g', 5_000));
  assert.throws(() => assertBetAllowed(config, 'g', 99), StakeOutOfRangeError);
  assert.throws(() => assertBetAllowed(config, 'g', 5_001), StakeOutOfRangeError);
});

test('the max win cap rounds down and never pays more than set', () => {
  const config = { ...DEFAULTS, maxWinMultiplier: 10 };

  // Under the cap, untouched.
  assert.deepEqual(applyMaxWin(config, 1_000, 5_000), { payout: 5_000, capped: false });
  // Exactly at the cap is not a cap.
  assert.deepEqual(applyMaxWin(config, 1_000, 10_000), { payout: 10_000, capped: false });
  // Over it, clipped.
  assert.deepEqual(applyMaxWin(config, 1_000, 99_000), { payout: 10_000, capped: true });

  // Fractional ceilings round DOWN. Rounding up pays more than the operator
  // configured, which is the one direction a cap must never fail in.
  const fractional = { ...DEFAULTS, maxWinMultiplier: 2.5 };
  assert.deepEqual(applyMaxWin(fractional, 333, 100_000), { payout: 832, capped: true });

  // No cap configured means no change at all.
  assert.deepEqual(applyMaxWin(DEFAULTS, 1_000, 999_999), { payout: 999_999, capped: false });
});

test('the global absolute payout cap wins over a larger game multiplier cap', () => {
  const config = { ...DEFAULTS, maxWinMultiplier: 100, maxPayoutGc: 5_000 };
  assert.deepEqual(applyMaxWin(config, 1_000, 80_000), { payout: 5_000, capped: true });
});

test('the global payout cap also applies to games without a configured row', async () => {
  const cache = new GameConfigCache(fakeDb([], { calls: 0 }, 12_345));
  assert.equal((await cache.get('new-game')).maxPayoutGc, 12_345);
});

test('a zero-multiplier cap cannot produce a negative payout', () => {
  // The column rejects <= 0, but the arithmetic must be safe regardless: a
  // negative payout would credit the ledger backwards.
  const { payout } = applyMaxWin({ ...DEFAULTS, maxWinMultiplier: 0.0001 }, 1, 5_000);
  assert.ok(payout >= 0, `payout was ${payout}`);
});
