import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  LAND_PEAK_SPEED,
  RAMP_SLOPE,
  landBlur,
  landPosition,
  landSpeed,
  rampBlur,
  rampDistance,
  rampPosition,
  rampSpeed,
} from './reel-motion.js';

/** Numerical derivative, for checking the analytic ones are actually right. */
function slope(f: (u: number) => number, u: number, h = 1e-6): number {
  return (f(u + h) - f(u - h)) / (2 * h);
}

test('the reel pulls back before it goes anywhere', () => {
  // The feature, stated as a test: somewhere early in the spin-up the reel is
  // BEHIND where it started. Without this the reels are at full speed on the
  // first frame, which nothing with mass has ever done.
  const samples = Array.from({ length: 101 }, (_, i) => rampPosition(i / 100));
  const lowest = Math.min(...samples);
  assert.ok(lowest < 0, 'the ramp never goes backwards — there is no pull-back');
  // Deep enough to see, shallow enough not to look broken. At the tuned depth
  // this is about a sixth of the ramp distance, a quarter of a symbol.
  assert.ok(lowest < -0.12, `pull-back is only ${lowest.toFixed(3)} of the ramp — too shallow`);
  assert.ok(lowest > -0.3, `pull-back is ${lowest.toFixed(3)} of the ramp — too deep`);
});

test('the pull-back happens early and is over well before the ramp ends', () => {
  let deepestAt = 0;
  for (let i = 0; i <= 100; i++) {
    if (rampPosition(i / 100) < rampPosition(deepestAt)) deepestAt = i / 100;
  }
  assert.ok(deepestAt > 0.2 && deepestAt < 0.6, `pull-back bottoms out at u=${deepestAt}`);
  // And by the end the reel is ahead of where it started, or the "spin-up"
  // would be handing over to the loop while still travelling backwards.
  assert.ok(rampPosition(1) > 0);
});

test('the ramp starts from a standstill and the landing ends at one', () => {
  assert.equal(rampPosition(0), 0);
  assert.equal(rampSpeed(0), 0);
  assert.ok(Math.abs(landPosition(1) - 1) < 1e-12);
  assert.ok(Math.abs(landSpeed(1)) < 1e-12);
});

test('the analytic speeds really are the derivatives of the positions', () => {
  // Guards the exact mistake that would be invisible: a position curve edited
  // without its derivative, leaving the blur describing a motion that is no
  // longer happening.
  for (let i = 1; i < 100; i++) {
    const u = i / 100;
    assert.ok(
      Math.abs(rampSpeed(u) - slope(rampPosition, u)) < 1e-4,
      `ramp speed disagrees with the ramp at u=${u}`,
    );
    assert.ok(
      Math.abs(landSpeed(u) - slope(landPosition, u)) < 1e-4,
      `landing speed disagrees with the landing at u=${u}`,
    );
  }
});

test('the ramp hands over to the loop at exactly the loop rate', () => {
  /*
   * THE property this file exists for.
   *
   * The reel accelerates along the ramp and then runs at a constant rate. If
   * the ramp's final velocity is not that rate there is a step in the velocity
   * at the handover, and a step in something that has been accelerating like a
   * wheel reads instantly as a dropped frame. It is obvious in motion and
   * invisible in a screenshot, a code review, or a snapshot test — so it is
   * asserted here.
   */
  for (const rate of [500, 1044, 2000]) {
    for (const seconds of [0.2, 0.42, 1]) {
      const distance = rampDistance(rate, seconds);
      // Position is distance x rampPosition(t / seconds), so velocity at the
      // end is distance x rampSpeed(1) / seconds.
      const handover = (distance * rampSpeed(1)) / seconds;
      assert.ok(
        Math.abs(handover - rate) < 1e-9,
        `ramp ends at ${handover.toFixed(4)} but the loop runs at ${rate}`,
      );
    }
  }
});

test('RAMP_SLOPE is the ramp slope, not a number that happens to look like it', () => {
  assert.ok(Math.abs(rampSpeed(1) - RAMP_SLOPE) < 1e-12);
});

test('blur is full at speed and gone the moment the reel stops', () => {
  // Zero at both ends of the landing: the reel is fastest as it begins to
  // settle and stopped when it has. In between it never exceeds full.
  assert.ok(Math.abs(landBlur(1)) < 1e-9, 'the reel is still blurred after it has stopped');
  assert.ok(Math.abs(landBlur(0) - 1) < 1e-9, 'the reel is not blurred when it is fastest');
  assert.equal(rampBlur(0), 0, 'the reel is blurred while it is standing still');
  assert.ok(Math.abs(rampBlur(1) - 1) < 1e-9, 'the reel is not at full blur when up to speed');

  for (let i = 0; i <= 100; i++) {
    const u = i / 100;
    assert.ok(landBlur(u) >= 0 && landBlur(u) <= 1, `landing blur out of range at u=${u}`);
    assert.ok(rampBlur(u) >= 0 && rampBlur(u) <= 1, `ramp blur out of range at u=${u}`);
  }
});

test('blur falls away as the reel decelerates, and the rock-back is invisible', () => {
  /*
   * The landing overshoots and comes back, so the reel genuinely REVERSES part
   * way through — around u = 0.58 — and is therefore moving again, and
   * therefore blurred again. That is physically right and must not be
   * "corrected". What matters is the two things an eye would catch:
   *
   *   1. Through the whole visible deceleration, before the reel turns, the
   *      blur only ever decreases. A blur that came back on while the reel was
   *      slowing would look like a focus fault.
   *   2. Whatever blur the rock-back brings is small enough not to be seen. At
   *      the tuned constants it peaks under a tenth, which on a 58-point symbol
   *      is a third of a pixel.
   *
   * An earlier version of this test asserted monotonicity all the way to u=0.8
   * and failed at 0.59. The curve was right; the assertion had the turning
   * point in the wrong place.
   */
  let turnsAt = 1;
  for (let i = 1; i <= 100; i++) {
    if (landSpeed(i / 100) >= 0) continue;
    turnsAt = i / 100;
    break;
  }
  assert.ok(turnsAt > 0.4 && turnsAt < 0.7, `the reel turns at u=${turnsAt}, which is not a settle`);

  let previous = landBlur(0);
  for (let u = 0.01; u < turnsAt; u += 0.01) {
    const now = landBlur(u);
    assert.ok(now <= previous + 1e-9, `blur increased at u=${u.toFixed(2)}, before the reel turned`);
    previous = now;
  }

  let afterTurn = 0;
  for (let u = turnsAt; u <= 1; u += 0.01) afterTurn = Math.max(afterTurn, landBlur(u));
  assert.ok(afterTurn < 0.1, `the rock-back is ${(afterTurn * 100).toFixed(1)}% blurred — visible`);
});

test('the landing overshoots its target rather than creeping onto it', () => {
  // Somewhere near the end the reel is PAST where it lands, then comes back.
  const beyond = Array.from({ length: 21 }, (_, i) => landPosition(0.8 + i * 0.01));
  assert.ok(
    beyond.some((p) => p > 1),
    'the landing never passes its target — the reel creeps in rather than settling',
  );
  assert.ok(LAND_PEAK_SPEED > 0);
});
