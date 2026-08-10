import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { symbolState, type SymbolState, type SymbolStateInput } from './symbol-state.js';

const base: SymbolStateInput = {
  reelIdle: true,
  row: 0,
  paying: false,
  celebrating: false,
  settled: false,
};

test('the whole truth table', () => {
  // Every combination of the four inputs, stated once, so a change to the
  // function has to be a deliberate change to this table.
  const cases: [Partial<SymbolStateInput>, SymbolState][] = [
    // A settled reel with nothing paying anywhere.
    [{}, 'resting'],
    // A settled reel, this cell paid, presentation still running.
    [{ paying: true, celebrating: true }, 'winning'],
    // Same cell once the presentation has finished: lit, but still.
    [{ paying: true, celebrating: true, settled: true }, 'won'],
    // A settled reel, something else paid.
    [{ celebrating: true }, 'dimmed'],
    [{ celebrating: true, settled: true }, 'dimmed'],
    // Turning: every cell is still, whatever else is true of it.
    [{ reelIdle: false }, 'moving'],
    [{ reelIdle: false, paying: true, celebrating: true }, 'moving'],
    [{ reelIdle: false, celebrating: true }, 'moving'],
    [{ reelIdle: false, paying: true, celebrating: true, settled: true }, 'moving'],
    // Off the end of the window: filler scrolling past is never part of a win.
    [{ row: -1 }, 'moving'],
    [{ row: -4, paying: true, celebrating: true }, 'moving'],
    [{ row: -1, celebrating: true }, 'moving'],
    [{ row: -2, paying: true, celebrating: true, settled: true }, 'moving'],
  ];
  for (const [overrides, expected] of cases) {
    const input = { ...base, ...overrides };
    assert.equal(
      symbolState(input),
      expected,
      `${JSON.stringify(input)} should be ${expected}`,
    );
  }
});

test('a paying cell is never dimmed', () => {
  /*
   * The one ordering that matters.
   *
   * `paying` and `celebrating` are true together on every winning cell, because
   * a cell can only pay while a win is being shown. If dimming were checked
   * first, the symbols that actually paid would be the ones that faded out and
   * every other symbol would stay bright — the presentation exactly inverted.
   */
  assert.equal(symbolState({ ...base, paying: true, celebrating: true }), 'winning');
});

test('nothing is dimmed when nothing has won', () => {
  // A grid that is permanently faded reads as broken rather than as focused.
  for (const row of [0, 1, 2, 4]) {
    assert.equal(symbolState({ ...base, row }), 'resting');
  }
});

test('every visible row behaves the same as every other', () => {
  // Guards a "row 1 is the payline" assumption creeping back in: on a 3-4-5-4-3
  // machine the middle reel has five rows and none of them is special.
  for (let row = 0; row < 5; row++) {
    assert.equal(symbolState({ ...base, row, paying: true, celebrating: true }), 'winning');
    assert.equal(symbolState({ ...base, row, celebrating: true }), 'dimmed');
  }
});

test('a win stops moving but never stops being marked', () => {
  /*
   * The bug this state exists for, reported twice by a player: "the animation
   * keeps looping until I spin again."
   *
   * Once settled, a winning cell must still be distinguishable from every
   * other cell on the machine — the player has to be able to look up late and
   * see what paid — while being in a state the animation layer treats as
   * static. Collapsing it to 'resting' would lose the marking; leaving it as
   * 'winning' is the loop.
   */
  const settled = symbolState({ ...base, paying: true, celebrating: true, settled: true });
  assert.equal(settled, 'won');
  assert.notEqual(settled, 'resting', 'a settled win must still be marked');
  assert.notEqual(settled, 'winning', 'a settled win must not still be animating');
});
