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

/** The only country we currently accept. */
export const SUPPORTED_COUNTRIES: readonly string[] = ['US'];

export function isRestrictedState(code: string | null | undefined): boolean {
  if (!code) return false;
  return RESTRICTED_STATES.includes(code.toUpperCase());
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
