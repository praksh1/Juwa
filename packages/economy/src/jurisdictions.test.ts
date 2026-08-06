import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  RESTRICTED_STATES,
  SWEEPSTAKES_RESTRICTED_STATES,
  US_STATES,
  isKnownState,
  isRestrictedState,
  redemptionEnabled,
  restrictedStates,
  selectableStates,
} from './jurisdictions.js';

test('the state list is complete and has no duplicates', () => {
  // 50 states + DC + Puerto Rico.
  assert.equal(US_STATES.length, 52);
  const codes = new Set(US_STATES.map((s) => s.code));
  assert.equal(codes.size, US_STATES.length, 'duplicate state code');
  for (const state of US_STATES) {
    assert.match(state.code, /^[A-Z]{2}$/, `${state.code} is not a USPS code`);
  }
});

test('every restricted state is a real state', () => {
  // A typo here fails open — the state would not match, so nobody is blocked.
  for (const code of RESTRICTED_STATES) {
    assert.ok(isKnownState(code), `${code} is restricted but not in the state list`);
  }
});

test('restricted states cannot be selected', () => {
  const offered = new Set(selectableStates().map((s) => s.code));
  for (const code of RESTRICTED_STATES) {
    assert.ok(!offered.has(code), `${code} is restricted but still offered`);
  }
  assert.equal(selectableStates().length, US_STATES.length - RESTRICTED_STATES.length);
});

test('the restriction check is case-insensitive and null-safe', () => {
  assert.ok(isRestrictedState('WA'));
  assert.ok(isRestrictedState('wa'));
  assert.ok(!isRestrictedState('CA'));
  // A missing state must not read as restricted; the server rejects it
  // separately for being absent, with a message that says so.
  assert.ok(!isRestrictedState(null));
  assert.ok(!isRestrictedState(undefined));
  assert.ok(!isRestrictedState(''));
});

// ------------------------------------------------- the redemption switch

test('redemption is off, so the social list is what applies today', () => {
  // If this ever fails, somebody has made a currency redeemable. That is a
  // deliberate, legally significant act — see SWEEPSTAKES_RESTRICTED_STATES —
  // and it should not be possible to do it by accident.
  assert.equal(redemptionEnabled(), false);
  assert.deepEqual(restrictedStates(), RESTRICTED_STATES);
});

test('turning redemption on widens the block list by itself', () => {
  // The point of deriving the switch from the currency table rather than a
  // separate flag: nobody has to remember these two facts are connected.
  assert.deepEqual(restrictedStates(true), SWEEPSTAKES_RESTRICTED_STATES);
  assert.deepEqual(restrictedStates(false), RESTRICTED_STATES);
});

test('the sweepstakes list only ever closes states, never opens one', () => {
  // A strict superset. If a state were dropped on the way to the wider list,
  // enabling redemption would silently ADMIT players from a state the social
  // model had already decided to decline.
  for (const state of RESTRICTED_STATES) {
    assert.ok(
      SWEEPSTAKES_RESTRICTED_STATES.includes(state),
      `${state} is blocked today but would be admitted once redemption is on`,
    );
  }
});

test('every restricted code is a real jurisdiction', () => {
  // A typo here does not fail loudly — it just quietly stops blocking a state.
  for (const state of [...RESTRICTED_STATES, ...SWEEPSTAKES_RESTRICTED_STATES]) {
    assert.ok(isKnownState(state), `${state} is not a US state code`);
  }
});

test('the sweepstakes list has no duplicates and covers the fourteen', () => {
  assert.equal(new Set(SWEEPSTAKES_RESTRICTED_STATES).size, SWEEPSTAKES_RESTRICTED_STATES.length);
  assert.equal(SWEEPSTAKES_RESTRICTED_STATES.length, 14);
  // The two biggest markets, called out because losing them quietly would be
  // the most expensive way for this list to be wrong.
  for (const state of ['CA', 'NY']) {
    assert.ok(SWEEPSTAKES_RESTRICTED_STATES.includes(state), `${state} missing`);
  }
});

test('selectable states shrink when redemption is enabled', () => {
  const today = selectableStates().length;
  const withRedemption = US_STATES.filter(
    (state) => !restrictedStates(true).includes(state.code),
  ).length;
  assert.ok(withRedemption < today, 'enabling redemption did not close any states');
  assert.equal(today - withRedemption, 9, 'expected nine further states to close');
});
