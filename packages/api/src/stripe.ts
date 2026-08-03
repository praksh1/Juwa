/**
 * Stripe integration.
 *
 * Two halves, and the second one is the one that matters:
 *
 *  1. Creating a Checkout Session — send the player to Stripe's hosted page.
 *     Card details never touch our servers, which is most of what makes PCI
 *     compliance tractable for a small team.
 *
 *  2. Verifying the webhook — this is the *only* evidence a payment happened.
 *
 * WHY THE SUCCESS URL IS NOT EVIDENCE
 *
 * After paying, Stripe sends the browser back to a success page. It is
 * tempting to grant coins there. Do not: anyone can type that URL. A store
 * that grants on redirect is a free coin dispenser. Coins are granted from the
 * webhook, whose signature we verify against a secret only Stripe and we know.
 *
 * Implemented over `fetch` and node:crypto rather than the Stripe SDK. The
 * request is one form-encoded POST and the verification is an HMAC; keeping
 * both in sight — especially the signature check — is worth more here than the
 * convenience of a dependency.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

export class StripeError extends Error {
  constructor(message: string, readonly status = 502) {
    super(message);
    this.name = 'StripeError';
  }
}

export class WebhookVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WebhookVerificationError';
  }
}

// ------------------------------------------------------- webhook signatures

/**
 * Stripe signs webhooks as `t=<unix>,v1=<hex hmac>` where the signed payload is
 * `${timestamp}.${rawBody}`.
 *
 * Two checks, both required:
 *
 *  - The HMAC must match, compared in constant time. A byte-by-byte compare
 *    leaks which prefix was correct through timing.
 *  - The timestamp must be recent. Without that, a signature captured once
 *    stays valid forever and an attacker who ever sees a "payment succeeded"
 *    body can replay it for free coins indefinitely.
 *
 * The RAW body is required — not a re-serialised object. `JSON.parse` then
 * `JSON.stringify` reorders keys and changes whitespace, and the signature
 * will not match.
 */
export const DEFAULT_TOLERANCE_SECONDS = 300;

export interface StripeEvent {
  id: string;
  type: string;
  data: { object: Record<string, unknown> };
}

export function verifyWebhookSignature(
  rawBody: string,
  signatureHeader: string | undefined,
  secret: string,
  now = Date.now(),
  toleranceSeconds = DEFAULT_TOLERANCE_SECONDS,
): StripeEvent {
  if (!secret) throw new WebhookVerificationError('No webhook signing secret configured');
  if (!signatureHeader) throw new WebhookVerificationError('Missing Stripe-Signature header');

  let timestamp: string | null = null;
  const signatures: string[] = [];
  for (const part of signatureHeader.split(',')) {
    const [key, value] = part.trim().split('=', 2);
    if (key === 't') timestamp = value ?? null;
    // Stripe may send several v1 entries during a secret rotation.
    if (key === 'v1' && value) signatures.push(value);
  }

  if (!timestamp || !/^\d+$/.test(timestamp)) {
    throw new WebhookVerificationError('Signature header has no valid timestamp');
  }
  if (signatures.length === 0) {
    throw new WebhookVerificationError('Signature header has no v1 signature');
  }

  const ageSeconds = Math.abs(now / 1000 - Number(timestamp));
  if (ageSeconds > toleranceSeconds) {
    throw new WebhookVerificationError(
      `Signature timestamp is ${Math.round(ageSeconds)}s old, outside the ${toleranceSeconds}s window`,
    );
  }

  const expected = createHmac('sha256', secret)
    .update(`${timestamp}.${rawBody}`, 'utf8')
    .digest();

  const matched = signatures.some((candidate) => {
    let actual: Buffer;
    try {
      actual = Buffer.from(candidate, 'hex');
    } catch {
      return false;
    }
    return actual.length === expected.length && timingSafeEqual(expected, actual);
  });

  if (!matched) throw new WebhookVerificationError('Signature does not match');

  let event: StripeEvent;
  try {
    event = JSON.parse(rawBody);
  } catch {
    throw new WebhookVerificationError('Webhook body is not valid JSON');
  }
  if (!event?.id || !event?.type) {
    throw new WebhookVerificationError('Webhook body is not a Stripe event');
  }
  return event;
}

/** Test helper, and the reference for what Stripe actually sends. */
export function signWebhook(rawBody: string, secret: string, timestampSeconds: number): string {
  const signature = createHmac('sha256', secret)
    .update(`${timestampSeconds}.${rawBody}`, 'utf8')
    .digest('hex');
  return `t=${timestampSeconds},v1=${signature}`;
}

// ----------------------------------------------------------- checkout

export interface CheckoutRequest {
  purchaseId: string;
  playerId: string;
  packName: string;
  coins: number;
  /** In USD cents. Always from the server's catalogue, never from the client. */
  priceUsd: number;
  successUrl: string;
  cancelUrl: string;
  customerEmail?: string;
}

export interface CheckoutSession {
  id: string;
  url: string;
}

export interface StripeGateway {
  createCheckoutSession(request: CheckoutRequest): Promise<CheckoutSession>;
}

export class LiveStripeGateway implements StripeGateway {
  constructor(
    private readonly secretKey: string,
    private readonly apiBase = 'https://api.stripe.com',
  ) {}

  async createCheckoutSession(request: CheckoutRequest): Promise<CheckoutSession> {
    const form = new URLSearchParams({
      mode: 'payment',
      success_url: request.successUrl,
      cancel_url: request.cancelUrl,
      client_reference_id: request.purchaseId,
      'line_items[0][quantity]': '1',
      'line_items[0][price_data][currency]': 'usd',
      'line_items[0][price_data][unit_amount]': String(request.priceUsd),
      'line_items[0][price_data][product_data][name]': request.packName,
      'line_items[0][price_data][product_data][description]':
        `${request.coins.toLocaleString('en-US')} Gold Coins. For entertainment only — ` +
        'Gold Coins have no cash value and cannot be exchanged for money or prizes.',
      // Echoed back on the webhook. This is how we know which purchase to grant.
      'metadata[purchase_id]': request.purchaseId,
      'metadata[player_id]': request.playerId,
    });
    if (request.customerEmail) form.set('customer_email', request.customerEmail);

    const response = await fetch(`${this.apiBase}/v1/checkout/sessions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.secretKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        // If we retry after a timeout, Stripe returns the original session
        // rather than opening a second one for the same purchase.
        'Idempotency-Key': `checkout:${request.purchaseId}`,
      },
      body: form.toString(),
    });

    const payload = (await response.json().catch(() => ({}))) as {
      id?: string;
      url?: string;
      error?: { message?: string };
    };

    if (!response.ok || !payload.id || !payload.url) {
      throw new StripeError(
        payload.error?.message ?? `Stripe rejected the checkout request (${response.status})`,
      );
    }
    return { id: payload.id, url: payload.url };
  }
}

/**
 * Pulls the purchase id back out of a webhook event.
 *
 * Reads `metadata.purchase_id` and falls back to `client_reference_id`, because
 * both are set at creation and losing either would strand a real payment.
 */
export function purchaseIdFromEvent(event: StripeEvent): string | null {
  const session = event.data?.object ?? {};
  const metadata = session['metadata'] as Record<string, string> | undefined;
  return metadata?.['purchase_id'] ?? (session['client_reference_id'] as string | undefined) ?? null;
}

export function isPaid(event: StripeEvent): boolean {
  const session = event.data?.object ?? {};
  // `payment_status: 'paid'` is the authoritative field. A completed session
  // with an async method (some bank debits) can arrive unpaid and settle later,
  // which is what async_payment_succeeded is for.
  return session['payment_status'] === 'paid';
}
