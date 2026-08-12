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

/**
 * Juwa runs the SOCIAL CASINO model (decided 2026-08; see
 * docs/03-payments-and-legal.md).
 *
 * Three currencies:
 *
 *   GC  — Gold Coins. What players wager. Bought with real money or earned
 *         free, and NEVER convertible back to money. They are entertainment,
 *         like arcade tokens, not a balance.
 *   CC  — Casino Cash. A conversion balance held between a player and their
 *         agent. It buys GC and it buys NOTHING ELSE — there is no path from CC
 *         to money, to a card, or to another player.
 *   USD — real money, used solely to price coin packs in the store. Players
 *         never hold a USD balance in the app.
 *
 * ## What this file used to say, and what changed
 *
 * It said "two currencies, and only two", and that there was deliberately no
 * third because a redeemable one turns the product into a sweepstakes casino.
 * The first half is now out of date; the second half is not, and is the reason
 * `CC.redeemable` is FALSE.
 *
 * `redeemable` here means exactly one thing: whether `assertRedeemable` will
 * let a cash-out path proceed. CC converts to GC, which is a movement inside a
 * closed loop between two virtual balances; it does not convert to money, and
 * nothing in this codebase can pay it out. That gate is unchanged and still
 * throws for every currency in the table.
 *
 * Whether the SURROUNDING business — agents settling with players off-platform
 * — makes this a sweepstakes model is a question for counsel and not one this
 * type can answer. See docs/03-payments-and-legal.md.
 */
export type CurrencyCode = 'USD' | 'GC' | 'CC';

export interface Currency {
  code: CurrencyCode;
  /** Digits after the decimal point. USD = 2, coins are whole numbers. */
  decimals: number;
  symbol: string;
  /**
   * Whether a player can convert this back into money. Both are `false` and
   * must stay that way under the social model — this flag is what the
   * withdrawal path checks before it will do anything.
   */
  redeemable: boolean;
}

export const CURRENCIES: Record<CurrencyCode, Currency> = {
  /** Store pricing only. Players never hold a USD balance. */
  USD: { code: 'USD', decimals: 2, symbol: '$', redeemable: false },
  /** Gold Coins — pure play money. Purchasable, never redeemable. */
  GC: { code: 'GC', decimals: 0, symbol: 'GC', redeemable: false },
  /**
   * Casino Cash — converts to GC and to nothing else.
   *
   * Whole numbers, like GC: a rate is expressed as an integer number of GC per
   * CC precisely so that no conversion ever produces a fraction of either.
   *
   * The symbol is the letters. NOT a currency sign, and never `$` — CC is not
   * dollars, is not redeemable for dollars, and drawing it as though it were is
   * the single fastest way to make every claim this product makes about being a
   * social casino untrue.
   */
  CC: { code: 'CC', decimals: 0, symbol: 'CC', redeemable: false },
};

/** The currency players actually wager. */
export const PLAY_CURRENCY: CurrencyCode = 'GC';

export class RedemptionError extends Error {}

/**
 * The single gate every cash-out path must pass through.
 *
 * Under the social model this always throws, which is the point: any future
 * code that tries to pay a player out fails loudly and immediately rather than
 * quietly shipping a feature that changes the company's legal position. Turning
 * redemption on is not a code change — it is a licence, a KYC provider and a
 * redemption processor, and only then this function.
 */
export function assertRedeemable(code: CurrencyCode): never | void {
  const currency = CURRENCIES[code];
  if (!currency.redeemable) {
    throw new RedemptionError(
      `${code} is not redeemable. Juwa operates the social casino model: coins ` +
        `are entertainment and cannot be converted to money. See ` +
        `docs/03-payments-and-legal.md before changing this.`,
    );
  }
}

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
