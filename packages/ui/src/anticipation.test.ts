import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { anticipatingReels } from './anticipation.js';

/** Build a 5x3 grid, putting SCATTER on the named reels. */
function grid(scatterReels: number[], reels = 5, rows = 3): string[][] {
  return Array.from({ length: reels }, (_, reel) =>
    Array.from({ length: rows }, (_, row) =>
      scatterReels.includes(reel) && row === 1 ? 'SCATTER' : 'LEMON',
    ),
  );
}

test('lights every remaining reel once one more scatter would trigger', () => {
  // Two showing on reels 0 and 1, three needed. Reels 2, 3 and 4 are all live.
  assert.deepEqual(anticipatingReels(grid([0, 1]), 3), [false, false, true, true, true]);
});

test('stays dark when the trigger is already out of reach in feel', () => {
  // One scatter is not "one away" from three, so nothing lights up — even
  // though two more scatters would technically still get there. A machine that
  // anticipates this often is a machine that anticipates nothing.
  assert.deepEqual(anticipatingReels(grid([0]), 3), [false, false, false, false, false]);
});

test('keeps going after the trigger is met, because higher tiers pay more', () => {
  // Three showing on the first three reels: four scatters awards more spins,
  // so reels 4 and 5 still have something to chase.
  assert.deepEqual(anticipatingReels(grid([0, 1, 2]), 3), [false, false, true, true, true]);
});

test('decides from what is showing BEFORE each reel lands', () => {
  // The scatters are on reels 3 and 4 — the LAST two. Nothing may light up,
  // because at the moment each reel was still spinning the player could not
  // have seen them. Counting the reel's own symbols first would light reel 4
  // for a scatter not yet revealed.
  assert.deepEqual(anticipatingReels(grid([3, 4]), 3), [false, false, false, false, false]);

  // And the mirror case: a scatter on reel 0 alone never lights reel 0 itself.
  assert.equal(anticipatingReels(grid([0, 1]), 3)[0], false);
});

test('a scatter landing mid-run extends the lit run rather than ending it', () => {
  // Scatters on reels 0 and 2, trigger 3. Reel 1 is dark (only one showing),
  // reels 3 and 4 are lit (two showing by then).
  assert.deepEqual(anticipatingReels(grid([0, 2]), 3), [false, false, false, true, true]);
});

test('counts multiple scatters on one reel', () => {
  const twoOnOneReel = [
    ['SCATTER', 'SCATTER', 'LEMON'],
    ['LEMON', 'LEMON', 'LEMON'],
    ['LEMON', 'LEMON', 'LEMON'],
  ];
  // Two are already showing after reel 0, so reels 1 and 2 are live.
  assert.deepEqual(anticipatingReels(twoOnOneReel, 3), [false, true, true]);
});

test('is disabled for games with no bonus round', () => {
  // The three-reel classics award no free spins, so `triggerCount` is 0.
  assert.deepEqual(anticipatingReels(grid([0, 1, 2], 3, 1), 0), [false, false, false]);
  // A trigger of one would light the machine on any single scatter.
  assert.deepEqual(anticipatingReels(grid([0, 1]), 1), [false, false, false, false, false]);
});

test('handles a two-scatter trigger', () => {
  // One showing is now "one away", so everything after reel 0 lights up.
  assert.deepEqual(anticipatingReels(grid([0]), 2), [false, true, true, true, true]);
});

test('returns one flag per reel and never mutates the grid', () => {
  const board = grid([0, 1]);
  const before = JSON.stringify(board);
  const flags = anticipatingReels(board, 3);
  assert.equal(flags.length, board.length);
  assert.equal(JSON.stringify(board), before);
});
