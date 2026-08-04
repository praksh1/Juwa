/**
 * Parse and validate ALLOWED_ORIGINS.
 *
 * CORS is an exact string comparison against the browser's `Origin` header,
 * and that header has a fixed shape: scheme, host, optional port, and nothing
 * else. No path, no trailing slash, ever. So `juwa.example.workers.dev` and
 * `https://juwa.example.workers.dev/` both fail to match `https://
 * juwa.example.workers.dev` — silently, on the browser's side, where the server
 * sees a request it simply declines to answer.
 *
 * The player is told "Cannot reach the server". The operator sees a healthy
 * API answering /health perfectly. Nothing in any log connects the two, and
 * the value LOOKS right to anyone reading it. This is the single most
 * expensive configuration mistake in the whole deployment, so it is checked at
 * boot and refused rather than left to be discovered from a screenshot.
 */

export interface OriginProblem {
  readonly value: string;
  readonly reason: string;
}

export interface ParsedOrigins {
  readonly origins: string[];
  readonly problems: OriginProblem[];
}

export function parseAllowedOrigins(raw: string): ParsedOrigins {
  const origins: string[] = [];
  const problems: OriginProblem[] = [];

  for (const entry of raw.split(',')) {
    const value = entry.trim();
    if (value === '') continue;

    if (value === '*') {
      problems.push({
        value,
        reason:
          'a wildcard cannot be used here. Credentials are sent with these ' +
          'requests, and browsers refuse "*" for credentialed requests — it ' +
          'would also let any site on the internet act as a signed-in player.',
      });
      continue;
    }

    let url: URL;
    try {
      url = new URL(value);
    } catch {
      problems.push({
        value,
        reason:
          'is not a URL. An Origin always starts with https:// — a bare ' +
          'hostname never matches and every browser request is refused.',
      });
      continue;
    }

    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      problems.push({ value, reason: `has scheme ${url.protocol} — must be https:// or http://.` });
      continue;
    }

    // `new URL('https://x.dev/')` yields pathname "/", which is what a copied
    // address from a browser bar looks like. The Origin header has no path at
    // all, so this must be rejected rather than quietly trimmed: trimming
    // hides that the configured value and the real one were different.
    if (url.pathname !== '/' || url.search !== '' || url.hash !== '') {
      problems.push({
        value,
        reason:
          'has a path, query or fragment. An Origin is scheme + host + port ' +
          'only — remove everything after the hostname, including a trailing slash.',
      });
      continue;
    }

    if (value.endsWith('/')) {
      problems.push({
        value,
        reason: 'ends with "/". The Origin header never has a trailing slash, so this never matches.',
      });
      continue;
    }

    if (url.protocol === 'http:' && !isLoopback(url.hostname)) {
      problems.push({
        value,
        reason:
          'uses http:// on a public host. The site is served over https, and a ' +
          'browser will not send credentialed requests from https to http.',
      });
      continue;
    }

    origins.push(url.origin);
  }

  if (origins.length === 0 && problems.length === 0) {
    problems.push({ value: raw, reason: 'is empty — no browser origin could ever be allowed.' });
  }

  return { origins, problems };
}

function isLoopback(hostname: string): boolean {
  return ['localhost', '127.0.0.1', '[::1]', '::1'].includes(hostname);
}

/** The message printed before refusing to start. */
export function describeProblems(problems: readonly OriginProblem[]): string {
  return [
    'ALLOWED_ORIGINS is not usable:',
    '',
    ...problems.map((p) => `  ✗ ${JSON.stringify(p.value)} ${p.reason}`),
    '',
    'It must be the exact origin the browser sends, comma-separated for more',
    'than one. For example:',
    '',
    '  https://juwa.example.workers.dev',
    '  https://juwa.example.workers.dev,https://play.example.com',
    '',
  ].join('\n');
}
