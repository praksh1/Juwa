/**
 * Supabase JWT verification.
 *
 * Supabase Auth owns identity — sign-up, passwords, email confirmation, session
 * refresh — and hands the browser a signed JWT. This service's only job is to
 * check that signature and read the user id out of it.
 *
 * Writing our own auth would mean writing our own password hashing, reset
 * flows, and session handling. That is a great deal of security-critical code
 * to get wrong for no benefit.
 *
 * Implemented against node:crypto rather than a JWT library: it is HMAC and
 * base64url, the whole thing is fifty lines, and a dependency that can verify
 * tokens is a dependency that can be compromised into accepting them.
 */

import { createHmac, timingSafeEqual } from 'node:crypto';

export interface JwtClaims {
  /** The Supabase user id. This is the player id everywhere in Juwa. */
  sub: string;
  exp: number;
  iat?: number;
  aud?: string | string[];
  role?: string;
  email?: string;
}

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthError';
  }
}

function base64UrlDecode(segment: string): Buffer {
  const padded = segment.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(padded + '='.repeat((4 - (padded.length % 4)) % 4), 'base64');
}

export function signJwt(claims: JwtClaims, secret: string): string {
  const encode = (value: unknown) =>
    Buffer.from(JSON.stringify(value))
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

  const header = encode({ alg: 'HS256', typ: 'JWT' });
  const payload = encode(claims);
  const signature = createHmac('sha256', secret)
    .update(`${header}.${payload}`)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  return `${header}.${payload}.${signature}`;
}

/**
 * Verify a token and return its claims.
 *
 * Throws on anything suspicious. Notably it pins the algorithm to HS256: a
 * token whose header says `alg: none` — or `RS256`, hoping we will treat the
 * public key as an HMAC secret — is rejected outright. That confusion is the
 * classic JWT vulnerability and it is why the algorithm is never read from the
 * token itself.
 */
export function verifyJwt(token: string, secret: string, now = Date.now()): JwtClaims {
  if (!secret) throw new AuthError('Server is misconfigured: no JWT secret');

  const parts = token.split('.');
  if (parts.length !== 3) throw new AuthError('Malformed token');
  const [headerPart, payloadPart, signaturePart] = parts as [string, string, string];

  let header: { alg?: string; typ?: string };
  try {
    header = JSON.parse(base64UrlDecode(headerPart).toString('utf8'));
  } catch {
    throw new AuthError('Malformed token header');
  }
  if (header.alg !== 'HS256') {
    throw new AuthError(`Unsupported token algorithm: ${header.alg}`);
  }

  const expected = createHmac('sha256', secret)
    .update(`${headerPart}.${payloadPart}`)
    .digest();
  const actual = base64UrlDecode(signaturePart);

  // Constant time, so response timing cannot be used to forge a signature byte
  // by byte.
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    throw new AuthError('Invalid token signature');
  }

  let claims: JwtClaims;
  try {
    claims = JSON.parse(base64UrlDecode(payloadPart).toString('utf8'));
  } catch {
    throw new AuthError('Malformed token payload');
  }

  if (!claims.sub || typeof claims.sub !== 'string') {
    throw new AuthError('Token has no subject');
  }
  if (typeof claims.exp !== 'number' || claims.exp * 1000 <= now) {
    throw new AuthError('Token has expired');
  }

  return claims;
}

/**
 * The same, but absent is not an error.
 *
 * Player routes require a token, so `bearerToken` throwing is right there. The
 * operator login route is reached WITHOUT one by definition, and turning a
 * missing header into an exception on the way to sign-in produces a confusing
 * 401 before the credentials have even been read.
 */
export function optionalBearerToken(header: string | undefined): string | undefined {
  if (!header) return undefined;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1]! : undefined;
}

/** Pull a bearer token out of an Authorization header. */
export function bearerToken(header: string | undefined): string {
  if (!header) throw new AuthError('Missing Authorization header');
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!match) throw new AuthError('Authorization header must be a Bearer token');
  return match[1]!;
}
