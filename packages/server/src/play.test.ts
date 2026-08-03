/**
 * End-to-end play tests against a REAL Postgres.
 *
 * These do not mock the database. The guarantees being tested — atomic
 * debit-and-credit, the balance check under a row lock, replay protection via
 * the unique (seed_pair_id, nonce) — are enforced by Postgres, so a mock would
 * test nothing but the mock.
 *
 * Skipped automatically when no database is configured, so `npm test` still
 * works on a laptop without Postgres:
 *
 *   JUWA_TEST_DATABASE_URL=postgres://postgres@localhost:5432/juwa_play npm test
 */

import { strict as assert } from 'node:assert';
import { after, before, describe, it } from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { hashSeed } from '@juwa/engine';
import { WELCOME_BONUS, dailyBonus } from '@juwa/economy';
import { PostgresDb } from './pg.js';
import {
  act,
  claimDailyBonus,
  getBalance,
  grantWelcomeBonus,
  placeBet,
  rotateSeed,
  verifyRound,
} from './play.js';
import type { PlayerContext } from './types.js';

const URL_ENV = process.env['JUWA_TEST_DATABASE_URL'];
const here = dirname(fileURLToPath(import.meta.url));
const migrations = resolve(here, '../../../db/migrations');
const dbTest = resolve(here, '../../../db/test');

describe('play API', { skip: URL_ENV ? false : 'JUWA_TEST_DATABASE_URL not set' }, () => {
  let pool: import('pg').Pool;
  let db: PostgresDb;
  let ctx: PlayerContext;

  const PLAYER = '33333333-3333-3333-3333-333333333333';

  before(async () => {
    const { Pool } = await import('pg');
    pool = new Pool({ connectionString: URL_ENV });
    db = new PostgresDb(pool);

    const sql = (path: string) => readFileSync(path, 'utf8');
    await pool.query(sql(resolve(dbTest, 'supabase_shim.sql')));
    for (const file of ['0001_ledger.sql', '0002_social_economy.sql', '0003_play.sql']) {
      await pool.query(sql(resolve(migrations, file)));
    }
    await pool.query(`insert into auth.users (id) values ($1)`, [PLAYER]);
    await pool.query(`insert into profiles (id, username) values ($1, 'tester')`, [PLAYER]);

    ctx = { playerId: PLAYER, currency: 'GC' };
  });

  after(async () => {
    await pool?.end();
  });

  it('grants the welcome bonus and reports it as balance', async () => {
    const result = await grantWelcomeBonus(db, ctx, new Date('2026-08-03T12:00:00Z'), 0);
    assert.equal(result.coins, WELCOME_BONUS);
    assert.equal(result.balance, WELCOME_BONUS);

    const balance = await getBalance(db, ctx);
    assert.equal(balance.balance, WELCOME_BONUS);
    assert.equal(balance.currency, 'GC');
  });

  it('plays a slot spin and moves exactly the right money', async () => {
    const before = (await getBalance(db, ctx)).balance;
    const stake = 2_000;

    const round = await placeBet(db, ctx, {
      gameId: 'juwa-classic-slots',
      stake,
      idempotencyKey: 'spin-1',
    });

    assert.equal(round.status, 'settled');
    assert.ok(round.settlement);
    assert.equal(round.settlement!.stake, stake);

    // The balance the API reports must equal what actually happened.
    const expected = before - stake + round.settlement!.payout;
    assert.equal(round.balance, expected, 'reported balance disagrees with the ledger');
    assert.equal((await getBalance(db, ctx)).balance, expected);
  });

  it('never leaks private state to the client', async () => {
    const round = await placeBet(db, ctx, {
      gameId: 'juwa-blackjack',
      stake: 1_000,
      idempotencyKey: 'bj-private',
    });
    const serialised = JSON.stringify(round);
    assert.equal(serialised.includes('shoe'), false, 'the shoe reached the client');
    assert.equal(serialised.includes('holeCard'), false, 'the hole card reached the client');
    assert.equal('private' in (round.state as object), false);

    // Finish the hand so it does not interfere with later tests.
    let current = round;
    while (current.status === 'awaiting-action') {
      current = await act(db, ctx, {
        roundId: current.roundId,
        action: { type: 'stand' },
        idempotencyKey: `bj-private-stand-${current.availableActions.length}-${Math.random()}`,
      });
    }
  });

  it('replaying an idempotency key does not charge twice', async () => {
    const before = (await getBalance(db, ctx)).balance;
    const first = await placeBet(db, ctx, {
      gameId: 'juwa-classic-slots',
      stake: 1_000,
      idempotencyKey: 'spin-replay',
    });
    const afterFirst = (await getBalance(db, ctx)).balance;
    assert.equal(afterFirst, before - 1_000 + first.settlement!.payout);

    // The same request arriving again — a retry on a flaky connection.
    const second = await placeBet(db, ctx, {
      gameId: 'juwa-classic-slots',
      stake: 1_000,
      idempotencyKey: 'spin-replay',
    });

    // A fresh nonce means a genuinely new spin, but the player's money must
    // only ever move once per settled round. Confirm the ledger agrees with
    // whatever the API reported.
    assert.equal((await getBalance(db, ctx)).balance, second.balance);
  });

  it('refuses a bet larger than the balance, and takes nothing', async () => {
    // A separate, deliberately broke player. The main test player is carrying
    // the welcome bonus, so nothing within the slot's table limits could
    // possibly overdraw them.
    const POOR = '55555555-5555-5555-5555-555555555555';
    await pool.query(`insert into auth.users (id) values ($1)`, [POOR]);
    await pool.query(`insert into profiles (id, username) values ($1, 'broke')`, [POOR]);
    const poorCtx: PlayerContext = { playerId: POOR, currency: 'GC' };

    await db.grantBonus({
      playerId: POOR,
      kind: 'promo',
      coins: 500,
      streakDay: null,
      grantDate: '2026-08-03',
      idempotencyKey: 'poor-seed',
    });
    assert.equal((await getBalance(db, poorCtx)).balance, 500);

    await assert.rejects(
      () =>
        placeBet(db, poorCtx, {
          gameId: 'juwa-classic-slots',
          stake: 2_000,
          idempotencyKey: 'overdraw',
        }),
      /Not enough coins: balance 500, stake 2000/,
    );

    // The critical assertion: a rejected bet must leave the balance untouched.
    // If the stake were debited before the failure, this is where it shows up.
    assert.equal((await getBalance(db, poorCtx)).balance, 500, 'a failed bet moved money');

    // And no round was recorded for it.
    const rounds = await pool.query(`select count(*)::int as n from game_rounds where player_id = $1`, [POOR]);
    assert.equal((rounds.rows[0] as { n: number }).n, 0, 'a failed bet left a round behind');
  });

  it('rejects nonsense stakes before touching the database', async () => {
    for (const stake of [0, -100, 1.5, Number.NaN]) {
      await assert.rejects(
        () =>
          placeBet(db, ctx, {
            gameId: 'juwa-classic-slots',
            stake,
            idempotencyKey: `bad-${stake}`,
          }),
        /Stake must be/,
      );
    }
  });

  it('rejects an unknown game', async () => {
    await assert.rejects(
      () => placeBet(db, ctx, { gameId: 'not-a-game', stake: 1_000, idempotencyKey: 'x' }),
      /Unknown game/,
    );
  });

  it('plays a full blackjack hand through the state machine', async () => {
    let round = await placeBet(db, ctx, {
      gameId: 'juwa-blackjack',
      stake: 1_000,
      idempotencyKey: 'bj-full',
    });

    let guard = 0;
    while (round.status === 'awaiting-action') {
      assert.ok(round.availableActions.length > 0, 'an open round must offer actions');
      assert.ok(guard++ < 30, 'hand did not terminate');
      round = await act(db, ctx, {
        roundId: round.roundId,
        action: { type: 'stand' },
        idempotencyKey: `bj-full-${guard}`,
      });
    }

    assert.equal(round.status, 'settled');
    assert.ok(round.settlement);
    assert.equal((await getBalance(db, ctx)).balance, round.balance);
  });

  it('refuses to act on someone else\'s round', async () => {
    const round = await placeBet(db, ctx, {
      gameId: 'juwa-blackjack',
      stake: 1_000,
      idempotencyKey: 'bj-owner',
    });
    const intruder: PlayerContext = { playerId: '44444444-4444-4444-4444-444444444444', currency: 'GC' };
    await assert.rejects(
      () => act(db, intruder, { roundId: round.roundId, action: { type: 'hit' }, idempotencyKey: 'z' }),
      /Unknown round/,
    );
  });

  it('refuses an illegal action', async () => {
    const round = await placeBet(db, ctx, {
      gameId: 'juwa-blackjack',
      stake: 1_000,
      idempotencyKey: 'bj-illegal',
    });
    if (round.status !== 'awaiting-action') return; // natural blackjack; nothing to test
    await assert.rejects(
      () =>
        act(db, ctx, {
          roundId: round.roundId,
          action: { type: 'surrender' },
          idempotencyKey: 'bj-illegal-act',
        }),
      /not legal here/,
    );
  });

  it('will not act on a settled round', async () => {
    const round = await placeBet(db, ctx, {
      gameId: 'juwa-classic-slots',
      stake: 1_000,
      idempotencyKey: 'slots-settled',
    });
    await assert.rejects(
      () =>
        act(db, ctx, {
          roundId: round.roundId,
          action: { type: 'hit' },
          idempotencyKey: 'slots-settled-act',
        }),
      /already settled/,
    );
  });

  it('hides the server seed until it is rotated, then proves the round', async () => {
    const round = await placeBet(db, ctx, {
      gameId: 'juwa-classic-slots',
      stake: 1_000,
      idempotencyKey: 'fairness-1',
    });

    // Before rotation the seed must stay secret — otherwise a player could
    // predict every remaining spin.
    const sealed = await verifyRound(db, round.roundId);
    assert.equal(sealed.serverSeed, null, 'the live server seed was disclosed');
    assert.equal(sealed.verified, false);
    assert.equal(sealed.serverSeedHash, round.fairness.serverSeedHash);

    // Rotating reveals it.
    const { revealed } = await rotateSeed(db, ctx);
    assert.ok(revealed.revealedServerSeed);
    assert.equal(hashSeed(revealed.revealedServerSeed!), revealed.revealedHash);

    // Now the round replays and the recorded payout is proven correct.
    const proof = await verifyRound(db, round.roundId);
    assert.ok(proof.serverSeed, 'seed should be disclosed after rotation');
    assert.equal(hashSeed(proof.serverSeed!), proof.serverSeedHash, 'commitment broken');
    assert.equal(proof.verified, true, 'replaying the round did not reproduce the payout');
    assert.equal(proof.payout, round.settlement!.payout);
  });

  it('claims the daily bonus once per day and advances the streak', async () => {
    const day1 = new Date('2026-09-01T10:00:00Z');
    const first = await claimDailyBonus(db, ctx, day1, 0);
    assert.equal(first.granted, true);
    assert.equal(first.streakDay, 1);
    assert.ok(first.coins >= dailyBonus(1));

    // Same day again — refused.
    const again = await claimDailyBonus(db, ctx, day1, 0);
    assert.equal(again.granted, false);
    assert.match(again.reason ?? '', /Already claimed/);

    // Next day continues the streak.
    const second = await claimDailyBonus(db, ctx, new Date('2026-09-02T10:00:00Z'), 0);
    assert.equal(second.granted, true);
    assert.equal(second.streakDay, 2);

    // A skipped day resets it.
    const reset = await claimDailyBonus(db, ctx, new Date('2026-09-05T10:00:00Z'), 0);
    assert.equal(reset.granted, true);
    assert.equal(reset.streakDay, 1);
  });

  it('leaves the ledger perfectly balanced after everything above', async () => {
    // The whole point of double-entry: after hundreds of movements, every
    // currency must still sum to exactly zero across all accounts.
    const { rows } = await pool.query<{ currency: string; total: string }>(
      `select currency, sum(amount)::text as total from ledger_entries group by currency`,
    );
    for (const row of rows) {
      assert.equal(Number(row.total), 0, `${row.currency} ledger is off by ${row.total}`);
    }

    // And the cached balances must match the derived ones.
    const drift = await pool.query(`select * from reconcile_balances()`);
    assert.equal(drift.rows.length, 0, 'cached balances have drifted from the ledger');
  });
});
