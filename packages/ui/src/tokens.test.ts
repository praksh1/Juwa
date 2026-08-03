import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { contrastRatio, meetsAA, parseHex } from './contrast.js';
import { colors, layout, motion, spacing, typography } from './tokens.js';

test('contrast maths matches known values', () => {
  assert.equal(contrastRatio('#FFFFFF', '#000000'), 21);
  assert.equal(Math.round(contrastRatio('#FFFFFF', '#FFFFFF')), 1);
  assert.deepEqual(parseHex('#D4AF37'), { r: 212, g: 175, b: 55 });
  assert.deepEqual(parseHex('fff'), { r: 255, g: 255, b: 255 });
  assert.throws(() => parseHex('nope'), /Not a hex colour/);
});

test('body text is readable on every surface', () => {
  // A dark theme makes it very easy to ship text nobody can read outdoors.
  // This fails the build instead.
  const surfaces = [colors.surface.base, colors.surface.raised, colors.surface.overlay];
  for (const surface of surfaces) {
    assert.ok(
      meetsAA(colors.text.primary, surface),
      `primary text on ${surface} is ${contrastRatio(colors.text.primary, surface).toFixed(2)}:1`,
    );
    assert.ok(
      meetsAA(colors.text.secondary, surface),
      `secondary text on ${surface} is ${contrastRatio(colors.text.secondary, surface).toFixed(2)}:1`,
    );
  }
});

test('gold is legible as large text and as a button fill', () => {
  // Gold is our brand colour, so it must work in the two ways we actually use
  // it: as large headings on dark, and as a button background with dark text.
  assert.ok(meetsAA(colors.gold.default, colors.surface.base, true));
  assert.ok(meetsAA(colors.text.inverse, colors.gold.default));
});

test('win and loss colours are distinguishable and readable', () => {
  assert.ok(meetsAA(colors.feedback.win, colors.surface.base, true));
  assert.ok(meetsAA(colors.feedback.error, colors.surface.base, true));
  // Win and loss must not be confusable for a red-green colourblind player, so
  // they differ in luminance too, not only in hue.
  const winVsLoss = contrastRatio(colors.feedback.win, colors.feedback.loss);
  assert.ok(winVsLoss > 2, `win/loss differ by only ${winVsLoss.toFixed(2)}:1 in luminance`);
});

test('spacing scale has no arbitrary values', () => {
  // Every step is a multiple of 4. This is what keeps layouts feeling aligned.
  for (const [name, value] of Object.entries(spacing)) {
    assert.equal(value % 4, 0, `spacing.${name} = ${value} is not on the 4pt grid`);
  }
});

test('type scale is monotonic', () => {
  const order = ['caption', 'bodySmall', 'body', 'h3', 'h2', 'h1', 'display'] as const;
  for (let i = 1; i < order.length; i++) {
    const prev = typography[order[i - 1]!].fontSize;
    const curr = typography[order[i]!].fontSize;
    assert.ok(curr > prev, `${order[i]} (${curr}) should be larger than ${order[i - 1]} (${prev})`);
  }
});

test('money styles use tabular figures', () => {
  // Without this, a balance counting up makes the entire row jitter.
  assert.deepEqual(typography.money.fontVariant, ['tabular-nums']);
  assert.deepEqual(typography.moneyLarge.fontVariant, ['tabular-nums']);
});

test('touch targets meet the accessibility minimum', () => {
  assert.ok(layout.minTouchTarget >= 44);
});

test('reel timing leaves room for anticipation', () => {
  // The spin has to be long enough to build tension and short enough that a
  // player can still get through hundreds of spins in a session.
  assert.ok(motion.reelSpin >= 1500 && motion.reelSpin <= 4000);
  assert.ok(motion.reelStagger > 0);
  // Five reels stopping in sequence must not outlast a player's patience.
  const total = motion.reelSpin + motion.reelStagger * 4 + motion.nearMissExtension;
  assert.ok(total < 6000, `worst-case spin takes ${total}ms`);
});
