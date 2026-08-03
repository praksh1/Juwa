/**
 * Money primitives.
 *
 * RULE #1 OF THE CODEBASE: money is never a floating-point number.
 *
 * `0.1 + 0.2 === 0.30000000000000004` in JavaScript. If balances are stored as
 * decimals, that error compounds across millions of bets until the ledger no
 * longer balances and nobody can tell whether the difference is a rounding bug
 * or theft. So every amount in Juwa is an integer count of *minor units*
 * (cents for USD, and a single "credit" for play-money currencies).
 *
 * $12.34 is stored as 1234. Never 12.34.
 */

/** An integer number of minor units. Branded so a raw `number` can't sneak in. */
export type Minor = number & { readonly __brand: 'Minor' };

export type CurrencyCode = 'USD' | 'GC' | 'SC';

export interface Currency {
  code: CurrencyCode;
  /** Digits after the decimal point. USD = 2, play-money credits = 0. */
  decimals: number;
  symbol: string;
  /** Whether this currency is redeemable for real money. Drives compliance rules. */
  redeemable: boolean;
}

export const CURRENCIES: Record<CurrencyCode, Currency> = {
  /** Real money. Only ever enabled in licensed jurisdictions. */
  USD: { code: 'USD', decimals: 2, symbol: '$', redeemable: false },
  /** Gold Coins — pure play money. Purchasable, never redeemable. */
  GC: { code: 'GC', decimals: 0, symbol: 'GC', redeemable: false },
  /** Sweeps Coins — promotional, redeemable under a sweepstakes model. */
  SC: { code: 'SC', decimals: 2, symbol: 'SC', redeemable: false },
};

/**
 * Every currency ships `redeemable: false`. Turning redemption on is a
 * deliberate act that must be paired with a gaming licence and a KYC provider —
 * see docs/03-payments-and-legal.md. It is a one-line change on purpose: the
 * line should be reviewed, not stumbled into.
 */

export class MoneyError extends Error {}

export function minor(value: number): Minor {
  if (!Number.isInteger(value)) {
    throw new MoneyError(`Money must be an integer in minor units, got ${value}`);
  }
  if (!Number.isSafeInteger(value)) {
    throw new MoneyError(`Money out of safe integer range: ${value}`);
  }
  return value as Minor;
}

export const ZERO = minor(0);

export function add(a: Minor, b: Minor): Minor {
  return minor(a + b);
}

export function sub(a: Minor, b: Minor): Minor {
  return minor(a - b);
}

/**
 * Multiply money by a payout multiplier (e.g. a 2.5x win).
 *
 * Rounding always goes *down*, toward zero, so the house never pays out a
 * fraction of a cent it did not intend to. The discarded remainder is real
 * money and must not vanish — callers that care (progressive jackpots, rake)
 * should use `mulWithRemainder`.
 */
export function mul(amount: Minor, multiplier: number): Minor {
  if (!Number.isFinite(multiplier) || multiplier < 0) {
    throw new MoneyError(`Invalid multiplier: ${multiplier}`);
  }
  return minor(Math.floor(amount * multiplier));
}

export function mulWithRemainder(
  amount: Minor,
  multiplier: number,
): { value: Minor; remainderMicros: number } {
  if (!Number.isFinite(multiplier) || multiplier < 0) {
    throw new MoneyError(`Invalid multiplier: ${multiplier}`);
  }
  const exact = amount * multiplier;
  const value = Math.floor(exact);
  return { value: minor(value), remainderMicros: Math.round((exact - value) * 1e6) };
}

/**
 * Split an amount into `parts` shares that sum back to exactly the original.
 * Used for splitting a pot between tied poker players — the leftover cents go
 * to the earliest seats, which is standard house rule, rather than evaporating.
 */
export function allocate(amount: Minor, parts: number): Minor[] {
  if (!Number.isInteger(parts) || parts <= 0) {
    throw new MoneyError(`Cannot split into ${parts} parts`);
  }
  const base = Math.floor(amount / parts);
  let remainder = amount - base * parts;
  const shares: Minor[] = [];
  for (let i = 0; i < parts; i++) {
    const extra = remainder > 0 ? 1 : 0;
    remainder -= extra;
    shares.push(minor(base + extra));
  }
  return shares;
}

/** Human-readable, for UI and logs only. Never parse this back into money. */
export function format(amount: Minor, code: CurrencyCode): string {
  const currency = CURRENCIES[code];
  const negative = amount < 0;
  const abs = Math.abs(amount);
  const divisor = 10 ** currency.decimals;
  const whole = Math.floor(abs / divisor);
  const frac = abs % divisor;
  const wholeStr = whole.toLocaleString('en-US');
  const body =
    currency.decimals === 0
      ? wholeStr
      : `${wholeStr}.${String(frac).padStart(currency.decimals, '0')}`;
  const sign = negative ? '-' : '';
  return code === 'USD' ? `${sign}${currency.symbol}${body}` : `${sign}${body} ${currency.symbol}`;
}

/** Parse user input ("12.34") into minor units. Rejects anything ambiguous. */
export function parse(input: string, code: CurrencyCode): Minor {
  const currency = CURRENCIES[code];
  const trimmed = input.trim().replace(/[$,\s]/g, '');
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(trimmed);
  if (!match) throw new MoneyError(`Cannot parse "${input}" as ${code}`);
  const [, sign, whole, frac = ''] = match;
  if (frac.length > currency.decimals) {
    throw new MoneyError(`${code} supports ${currency.decimals} decimal places, got "${input}"`);
  }
  const padded = frac.padEnd(currency.decimals, '0');
  const value = Number(whole) * 10 ** currency.decimals + Number(padded || '0');
  return minor(sign === '-' ? -value : value);
}
