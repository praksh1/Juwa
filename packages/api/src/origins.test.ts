import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { parseAllowedOrigins } from './origins.js';

const ok = (raw: string) => {
  const { origins, problems } = parseAllowedOrigins(raw);
  assert.deepEqual(problems, [], `unexpected problems for ${raw}`);
  return origins;
};
const bad = (raw: string) => {
  const { problems } = parseAllowedOrigins(raw);
  assert.ok(problems.length > 0, `expected ${JSON.stringify(raw)} to be refused`);
  return problems;
};

test('a correct origin is accepted', () => {
  assert.deepEqual(ok('https://juwa.praksh.workers.dev'), ['https://juwa.praksh.workers.dev']);
});

test('a missing scheme is refused', () => {
  // The real failure from deployment: the value looks right to a human, and
  // never matches the Origin header, which always carries a scheme.
  const [problem] = bad('juwa.praksh.workers.dev');
  assert.match(problem!.reason, /not a URL|https:\/\//);
});

test('a trailing slash is refused rather than trimmed', () => {
  // Trimming would work, and would hide that the configured value differed
  // from the real one — so the next person copies the same wrong thing.
  bad('https://juwa.praksh.workers.dev/');
});

test('a path, query or fragment is refused', () => {
  bad('https://juwa.praksh.workers.dev/app');
  bad('https://juwa.praksh.workers.dev?x=1');
  bad('https://juwa.praksh.workers.dev#top');
});

test('a wildcard is refused', () => {
  // Browsers reject "*" for credentialed requests anyway, and it would let any
  // site on the internet act as a signed-in player.
  const [problem] = bad('*');
  assert.match(problem!.reason, /wildcard/);
});

test('several origins are parsed, and whitespace is tolerated', () => {
  assert.deepEqual(
    ok(' https://a.example.com , https://b.example.com '),
    ['https://a.example.com', 'https://b.example.com'],
  );
});

test('an empty value is refused', () => {
  bad('');
  bad('   ');
  bad(',,');
});

test('http is allowed on loopback and refused in public', () => {
  assert.deepEqual(ok('http://localhost:8081'), ['http://localhost:8081']);
  assert.deepEqual(ok('http://127.0.0.1:8081'), ['http://127.0.0.1:8081']);
  // https pages cannot send credentialed requests to http, so this can only
  // ever fail — better at boot than at a player's first bet.
  bad('http://juwa.praksh.workers.dev');
});

test('a port is preserved, and the default port is normalised away', () => {
  // `new URL().origin` drops :443 for https. The Origin header does the same,
  // so the comparison still holds — but it must be the normalised form that is
  // stored, or the two disagree.
  assert.deepEqual(ok('https://a.example.com:8443'), ['https://a.example.com:8443']);
  assert.deepEqual(ok('https://a.example.com:443'), ['https://a.example.com']);
});

test('one bad entry does not silently drop the good ones', () => {
  // The failure to avoid is a half-applied list: the good origin works, the
  // typo does not, and nobody notices until the second site is tried.
  const { origins, problems } = parseAllowedOrigins('https://good.example.com,bad.example.com');
  assert.deepEqual(origins, ['https://good.example.com']);
  assert.equal(problems.length, 1);
});
