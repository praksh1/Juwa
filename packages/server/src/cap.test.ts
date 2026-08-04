import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { capPayout } from './play.js';

/**
 * The operator panel offers a max-win ceiling. These exist because the first
 * version of that feature shipped the control, the storage, the audit trail and
 * a tested `applyMaxWin` helper — and never called any of it. Everything looked
 * right except that the cap did nothing.
 */

test('no ceiling configured leaves the payout untouched', () => {
  assert.deepEqual(capPayout(1_000, 999_999, null), {
    payout: 999_999,
    capped: false,
    ceiling: null,
  });
  assert.deepEqual(capPayout(1_000, 999_999, undefined), {
    payout: 999_999,
    capped: false,
    ceiling: null,
  });
});

test('a payout under the ceiling is untouched', () => {
  assert.deepEqual(capPayout(1_000, 5_000, 10), { payout: 5_000, capped: false, ceiling: 10_000 });
});

test('a payout exactly at the ceiling is not capped', () => {
  // Off-by-one here would clip a legitimate maximum win and be reported as a
  // missing jackpot, which is the worst kind of bug to debug from a screenshot.
  assert.deepEqual(capPayout(1_000, 10_000, 10), { payout: 10_000, capped: false, ceiling: 10_000 });
});

test('a payout over the ceiling is clipped to it', () => {
  assert.deepEqual(capPayout(1_000, 480_000, 10), {
    payout: 10_000,
    capped: true,
    ceiling: 10_000,
  });
});

test('fractional ceilings round DOWN', () => {
  // Rounding up pays more than the operator configured. That is the one
  // direction a ceiling must never fail in.
  const { payout } = capPayout(333, 100_000, 2.5);
  assert.equal(payout, 832);
  assert.ok(payout <= 333 * 2.5);
});

test('a ceiling can never produce a negative payout', () => {
  // A negative payout would credit the ledger backwards, and the ledger trigger
  // would reject the transaction — turning a config mistake into an outage.
  const { payout } = capPayout(1, 5_000, 0.0001);
  assert.ok(payout >= 0, `payout was ${payout}`);
});

test('the ceiling is reported so it can be recorded', () => {
  // Without the ceiling travelling alongside the decision there is no way to
  // explain a capped round afterwards.
  const result = capPayout(2_000, 1_000_000, 25);
  assert.equal(result.ceiling, 50_000);
  assert.equal(result.payout, 50_000);
  assert.equal(result.capped, true);
});
