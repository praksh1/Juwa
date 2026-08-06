import { CURRENCIES } from '@juwa/money';

/**
 * Where Juwa 3.0 will and will not open an account.
 *
 * A social casino needs no gaming licence, but a handful of US states write
 * their gambling statutes broadly enough that "you paid money and received a
 * chance at a thing of value" can catch a coin purchase — even when the coins
 * are worthless by design. The industry convention is to decline registrations
 * from those states rather than argue the point, because the cost of declining
 * is a few percent of signups and the cost of being wrong is the company.
 *
 * THIS LIST IS A STARTING POINT, NOT LEGAL ADVICE. It matches what most US
 * social casinos exclude today. A lawyer should confirm it before launch and
 * revisit it yearly — these statutes move.
 *
 * It lives here, in the business-rules package, so that changing it is a
 * one-line data edit reviewed like any other product decision, and so the
 * server and the app cannot disagree about who is allowed in.
 */

export interface Jurisdiction {
  /** USPS two-letter code. Stored on the profile as `region`. */
  code: string;
  name: string;
}

/** The 50 states, DC, and Puerto Rico. */
export const US_STATES: Jurisdiction[] = [
  { code: 'AL', name: 'Alabama' },
  { code: 'AK', name: 'Alaska' },
  { code: 'AZ', name: 'Arizona' },
  { code: 'AR', name: 'Arkansas' },
  { code: 'CA', name: 'California' },
  { code: 'CO', name: 'Colorado' },
  { code: 'CT', name: 'Connecticut' },
  { code: 'DE', name: 'Delaware' },
  { code: 'DC', name: 'District of Columbia' },
  { code: 'FL', name: 'Florida' },
  { code: 'GA', name: 'Georgia' },
  { code: 'HI', name: 'Hawaii' },
  { code: 'ID', name: 'Idaho' },
  { code: 'IL', name: 'Illinois' },
  { code: 'IN', name: 'Indiana' },
  { code: 'IA', name: 'Iowa' },
  { code: 'KS', name: 'Kansas' },
  { code: 'KY', name: 'Kentucky' },
  { code: 'LA', name: 'Louisiana' },
  { code: 'ME', name: 'Maine' },
  { code: 'MD', name: 'Maryland' },
  { code: 'MA', name: 'Massachusetts' },
  { code: 'MI', name: 'Michigan' },
  { code: 'MN', name: 'Minnesota' },
  { code: 'MS', name: 'Mississippi' },
  { code: 'MO', name: 'Missouri' },
  { code: 'MT', name: 'Montana' },
  { code: 'NE', name: 'Nebraska' },
  { code: 'NV', name: 'Nevada' },
  { code: 'NH', name: 'New Hampshire' },
  { code: 'NJ', name: 'New Jersey' },
  { code: 'NM', name: 'New Mexico' },
  { code: 'NY', name: 'New York' },
  { code: 'NC', name: 'North Carolina' },
  { code: 'ND', name: 'North Dakota' },
  { code: 'OH', name: 'Ohio' },
  { code: 'OK', name: 'Oklahoma' },
  { code: 'OR', name: 'Oregon' },
  { code: 'PA', name: 'Pennsylvania' },
  { code: 'PR', name: 'Puerto Rico' },
  { code: 'RI', name: 'Rhode Island' },
  { code: 'SC', name: 'South Carolina' },
  { code: 'SD', name: 'South Dakota' },
  { code: 'TN', name: 'Tennessee' },
  { code: 'TX', name: 'Texas' },
  { code: 'UT', name: 'Utah' },
  { code: 'VT', name: 'Vermont' },
  { code: 'VA', name: 'Virginia' },
  { code: 'WA', name: 'Washington' },
  { code: 'WV', name: 'West Virginia' },
  { code: 'WI', name: 'Wisconsin' },
  { code: 'WY', name: 'Wyoming' },
];

/**
 * States where we decline to open an account.
 *
 * - **WA** — the strictest. Washington treats online gambling as a felony and
 *   defines "thing of value" broadly enough to reach virtual currency; the
 *   state supreme court let a suit against a free-to-play coin casino proceed
 *   on exactly that theory. Everyone excludes Washington.
 * - **ID** — a narrow statutory definition of permitted contests with no
 *   social-gaming carve-out.
 * - **NV** — bars unlicensed operators broadly; a licensed state is a
 *   surprisingly awkward place to run an unlicensed free product.
 * - **MI** — post-2019 internet gaming act, aggressively enforced.
 * - **MT** — one of the few states restricting internet gambling outright.
 */
export const RESTRICTED_STATES: readonly string[] = ['WA', 'ID', 'NV', 'MI', 'MT'];

/**
 * The wider list that applies the moment coins become redeemable.
 *
 * ⚠️ NOT IN FORCE TODAY, AND THAT IS NOT AN OVERSIGHT. Juwa is a social
 * casino: `assertRedeemable` in @juwa/money refuses to convert Gold Coins into
 * anything, so there is no prize, no redemption, and none of the statutes
 * below reach the product as it stands.
 *
 * They reach it the instant that changes. Every one of these was written for
 * the SWEEPSTAKES model — dual currency, where a "free" coin can be turned
 * back into money — and adding redemption is precisely the move that converts
 * Juwa from the first thing into the second. Between 2025 and 2026 eleven
 * states banned that model outright:
 *
 *   CA  AB 831, signed 11 October 2025, in force 1 January 2026
 *   CT  in force February 2026
 *   OK  SB 1589, passed over a veto, in force 1 November 2026
 *   LA  dedicated statute signed May 2026, replacing AG enforcement
 *   TN  dedicated statute signed May 2026, replacing AG enforcement
 *   IN, ME, MT, NV, NJ, NY  statutory bans enacted across 2025–26
 *
 * and three more already enforced older gambling law against operators:
 *
 *   ID, MI, WA
 *
 * California and New York alone are roughly a fifth of the US population, so
 * this is not a rounding error on a business plan.
 *
 * WHY IT IS HERE AT ALL, UNUSED. A buyer's first question about a social
 * casino is what it costs to turn on redemption. Answering "the state list is
 * already written and switches itself on" is a better answer than a promise,
 * and it means nobody has to rediscover this research under deadline. The list
 * is a strict superset of `RESTRICTED_STATES`, so switching modes only ever
 * closes states, never opens one.
 *
 * ⚠️ MOVING TARGET. Bills were still being signed when this was written.
 * Anyone enabling redemption must have a lawyer re-check the list on the day,
 * not trust this comment.
 */
export const SWEEPSTAKES_RESTRICTED_STATES: readonly string[] = [
  'CA', 'CT', 'ID', 'IN', 'LA', 'ME', 'MI', 'MT', 'NJ', 'NV', 'NY', 'OK', 'TN', 'WA',
];

/**
 * Whether any currency can be turned back into money.
 *
 * The switch is derived from the currency table rather than kept as a separate
 * flag, so it cannot be forgotten. Somebody enabling redemption edits one
 * boolean in @juwa/money; the registration gate widens by itself, in the same
 * commit, without anyone remembering that these two facts are connected.
 */
export function redemptionEnabled(): boolean {
  return Object.values(CURRENCIES).some((currency) => currency.redeemable);
}

/**
 * The states that actually block registration right now.
 *
 * Takes the redemption state as an argument so the widened behaviour can be
 * tested without a build that really pays money out.
 */
export function restrictedStates(redeemable = redemptionEnabled()): readonly string[] {
  return redeemable ? SWEEPSTAKES_RESTRICTED_STATES : RESTRICTED_STATES;
}

/** The only country we currently accept. */
export const SUPPORTED_COUNTRIES: readonly string[] = ['US'];

export function isRestrictedState(code: string | null | undefined): boolean {
  if (!code) return false;
  return restrictedStates().includes(code.toUpperCase());
}

export function isKnownState(code: string | null | undefined): boolean {
  if (!code) return false;
  return US_STATES.some((state) => state.code === code.toUpperCase());
}

/** States a new player may choose. Restricted ones are absent, not disabled. */
export function selectableStates(): Jurisdiction[] {
  return US_STATES.filter((state) => !isRestrictedState(state.code));
}

export const RESTRICTED_STATE_MESSAGE =
  'We are not able to open accounts in your state at this time.';
