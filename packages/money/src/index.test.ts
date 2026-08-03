import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { add, allocate, format, minor, MoneyError, mul, parse, sub } from './index.js';

test('rejects non-integer amounts', () => {
  assert.throws(() => minor(12.34), MoneyError);
  assert.throws(() => minor(NaN), MoneyError);
  assert.throws(() => minor(Number.MAX_SAFE_INTEGER + 1), MoneyError);
});

test('addition is exact where floats are not', () => {
  // The canonical float failure: 0.1 + 0.2 !== 0.3.
  assert.equal(add(minor(10), minor(20)), 30);
  assert.equal(sub(minor(30), minor(20)), 10);
});

test('multiplication rounds down, never up', () => {
  // 3:2 blackjack on an odd stake would leave half a cent. The house keeps it
  // rather than inventing money.
  assert.equal(mul(minor(101), 2.5), 252);
  assert.equal(mul(minor(1), 0.5), 0);
  assert.throws(() => mul(minor(100), -1), MoneyError);
});

test('allocate never creates or destroys money', () => {
  for (const [amount, parts] of [[100, 3], [1, 4], [9999, 7], [0, 5]] as const) {
    const shares = allocate(minor(amount), parts);
    assert.equal(shares.length, parts);
    assert.equal(shares.reduce((a, b) => a + b, 0), amount, `${amount} split ${parts} ways`);
  }
});

test('formats and parses as inverses', () => {
  assert.equal(format(minor(123456), 'USD'), '$1,234.56');
  assert.equal(format(minor(-500), 'USD'), '-$5.00');
  assert.equal(format(minor(1500), 'GC'), '1,500 GC');
  assert.equal(parse('1234.56', 'USD'), 123456);
  assert.equal(parse('$1,234.56', 'USD'), 123456);
  assert.equal(parse('7', 'USD'), 700);
});

test('rejects sub-cent input rather than silently rounding it', () => {
  // Accepting "0.001" and rounding is how a deposit form becomes a rounding
  // exploit. Reject it at the boundary.
  assert.throws(() => parse('0.001', 'USD'), MoneyError);
  assert.throws(() => parse('abc', 'USD'), MoneyError);
  assert.throws(() => parse('1.5', 'GC'), MoneyError);
});
