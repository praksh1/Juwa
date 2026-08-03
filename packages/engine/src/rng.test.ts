import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { createServerSeed, hashSeed, RngStream, verifySeed } from './rng.js';

test('commitment verifies only for the true seed', () => {
  const { serverSeed, serverSeedHash } = createServerSeed();
  assert.equal(verifySeed(serverSeed, serverSeedHash), true);
  assert.equal(verifySeed(serverSeed + 'x', serverSeedHash), false);
  assert.equal(verifySeed(serverSeed, hashSeed('different')), false);
  assert.equal(verifySeed(serverSeed, 'not-hex'), false);
});

test('same seeds replay to identical results', () => {
  // This is the property that lets a player audit a disputed bet.
  const a = new RngStream('server', 'client', 7);
  const b = new RngStream('server', 'client', 7);
  for (let i = 0; i < 100; i++) assert.equal(a.next(), b.next());
});

test('different nonces diverge', () => {
  const a = new RngStream('server', 'client', 1);
  const b = new RngStream('server', 'client', 2);
  assert.notEqual(a.next(), b.next());
});

test('floats stay in [0, 1)', () => {
  const rng = new RngStream('server', 'client', 0);
  for (let i = 0; i < 50_000; i++) {
    const v = rng.next();
    assert.ok(v >= 0 && v < 1, `out of range: ${v}`);
  }
});

test('nextInt is uniform across a non-power-of-two range', () => {
  // 37 pockets is the case that a naive modulo gets subtly wrong, which is
  // precisely the bias a certification lab looks for.
  const buckets = new Array(37).fill(0);
  const rng = new RngStream('uniformity', 'test', 0);
  const draws = 3_700_000;
  for (let i = 0; i < draws; i++) buckets[rng.nextInt(37)]++;

  const expected = draws / 37;
  // Chi-square with 36 degrees of freedom: 59.3 is the 99% critical value.
  const chi2 = buckets.reduce((sum, o) => sum + (o - expected) ** 2 / expected, 0);
  assert.ok(chi2 < 59.3, `chi-square ${chi2.toFixed(1)} suggests a biased generator`);
});

test('shuffle is a permutation and does not mutate its input', () => {
  const source = Object.freeze([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  const rng = new RngStream('shuffle', 'test', 0);
  const shuffled = rng.shuffle(source);
  assert.deepEqual(shuffled.slice().sort((a, b) => a - b), [...source]);
  assert.deepEqual(source, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
});

test('rejects invalid bounds', () => {
  const rng = new RngStream('a', 'b', 0);
  assert.throws(() => rng.nextInt(0), RangeError);
  assert.throws(() => rng.nextInt(-5), RangeError);
  assert.throws(() => rng.nextInt(2.5), RangeError);
});
