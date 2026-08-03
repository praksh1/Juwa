import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  RESTRICTED_STATES,
  US_STATES,
  isKnownState,
  isRestrictedState,
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
