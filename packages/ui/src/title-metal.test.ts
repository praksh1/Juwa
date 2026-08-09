import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { contrastRatio } from './contrast.js';
import { hexToHsl } from './cabinet.js';
import {
  BRIGHT_SIGN,
  displayWidth,
  effectiveGround,
  nearestMetal,
  titleMetal,
} from './title-metal.js';

test('a hue picks the metal it is closest to, the short way round the wheel', () => {
  assert.equal(nearestMetal(43).name, 'gold');
  assert.equal(nearestMetal(20).name, 'copper');
  assert.equal(nearestMetal(173).name, 'teal');
  assert.equal(nearestMetal(215).name, 'ice');
  assert.equal(nearestMetal(150).name, 'emerald');
  // 5° is nearer copper (24°) than rose (348°) by 19° to 17°... it is not, and
  // that is the point: crossing zero has to be handled or every red tile in the
  // catalogue comes out orange.
  assert.equal(nearestMetal(5).name, 'rose');
  assert.equal(nearestMetal(355).name, 'rose');
});

test('the ramp flips with the brightness of the sign', () => {
  const onDark = titleMetal(43, 0.2);
  const onBright = titleMetal(43, 0.8);
  // Raised metal is pale on top and deep at the baseline.
  assert.ok(hexToHsl(onDark.top).l > hexToHsl(onDark.bottom).l);
  // Engraved lettering is dark throughout, with a light rim to lift it.
  assert.ok(hexToHsl(onBright.mid).l < 0.35);
  assert.ok(hexToHsl(onBright.rim).l > 0.85);
  assert.ok(hexToHsl(onDark.rim).l < 0.2);
});

test('every metal stays readable against the sign it is chosen for', () => {
  /*
   * These letters are outlined: a rim stroke under a gradient fill. That is a
   * different legibility question from flat text, and getting it wrong in the
   * obvious direction is what this test exists to stop.
   *
   * A word is readable when its SHAPE separates from the background and its
   * INTERIOR separates from its own edge. Either the body or the rim clearing
   * 3:1 against the ground is enough for the first — an outlined letter on a
   * ground that matches its fill still reads, which is the entire reason signs
   * are made this way. The second is not optional: a rim the same value as the
   * fill is a fill, and then only the first condition is holding the word up.
   *
   * The first version of this test demanded the body alone clear the ground and
   * failed on mid-grey signs, which is where the real catalogue lives — three
   * of the tiles measure between 0.42 and 0.53. The demand was wrong, not the
   * palette.
   */
  for (let hue = 0; hue < 360; hue += 5) {
    for (const [luminance, ground] of [
      [0.15, '#141414'],
      [0.45, '#5E5E5E'],
      [0.53, '#8A8A8A'],
      [0.75, '#D0C39A'],
      [0.9, '#F2F2F2'],
    ] as const) {
      const metal = titleMetal(hue, luminance);
      const behind = effectiveGround(ground, metal);
      const shape = Math.max(contrastRatio(metal.mid, behind), contrastRatio(metal.rim, behind));
      assert.ok(
        shape >= 3,
        `hue ${hue} on a ${luminance} sign: ${metal.name} disappears into it (${shape.toFixed(2)})`,
      );
      assert.ok(
        contrastRatio(metal.mid, metal.rim) >= 3,
        `hue ${hue} on a ${luminance} sign: ${metal.name} has no visible edge`,
      );
    }
  }
});

test('the rim always opposes the body, so the letters have an edge', () => {
  for (let hue = 0; hue < 360; hue += 11) {
    for (const luminance of [0.1, 0.49, 0.51, 0.95]) {
      const metal = titleMetal(hue, luminance);
      assert.ok(
        contrastRatio(metal.rim, metal.mid) >= 3,
        `hue ${hue} at ${luminance}: rim and body are too close`,
      );
    }
  }
});

test('BRIGHT_SIGN is the only thing that decides the ramp', () => {
  assert.equal(titleMetal(43, BRIGHT_SIGN).mid, titleMetal(43, 0).mid);
  assert.notEqual(titleMetal(43, BRIGHT_SIGN + 0.01).mid, titleMetal(43, 0).mid);
});

test('the width estimate never runs a name off the end of its sign', () => {
  /*
   * Real widths, measured with a canvas at 100px in the display stack, as a
   * fraction of the point size. These are the fallback face a phone actually
   * uses — not the condensed one the stack names first and no device has.
   *
   * The estimate must be at or above every one of them. It was under all six,
   * by about a fifth, and that is exactly what a clipped "MIDNIGHT GOLD" in the
   * lobby looks like.
   */
  const measured: [string, number][] = [
    ['Juwa Classic', 7.556],
    ['Dragon’s Hoard', 9.333],
    ['Lucky Sevens', 7.779],
    ['Supernova', 6.26],
    ['Aurora', 4.389],
    ['Mines', 3.167],
    ['Desert Mirage', 8.334],
    ['Midnight Gold', 8.11],
    ['Carnival Row', 7.814],
    ['Pharaoh’s Vault', 9.463],
    ['European Roulette', 11.334],
  ];
  for (const [name, atLeast] of measured) {
    // Compared without letter spacing, because the measurement was taken
    // without it: adding it to one side of the comparison would hide a
    // shortfall of up to a whole character.
    const estimate = displayWidth(name, 0);
    assert.ok(
      estimate >= atLeast,
      `${name}: estimate ${estimate.toFixed(2)} is under the measured ${atLeast}`,
    );
  }
});

test('a longer name is estimated wider than a shorter one', () => {
  assert.ok(displayWidth('Pharaoh’s Vault') > displayWidth('Plinko'));
  assert.ok(displayWidth('WWWW') > displayWidth('IIII'));
});
