// Make sure the shared @juwa/* packages are compiled before Metro runs.
//
// The app resolves @juwa/ui and friends through their package.json `main`,
// which points at dist/. On a fresh clone nothing is built yet, so Metro fails
// with "Unable to resolve @juwa/ui" — an error that names the app rather than
// the missing build step, and sends you looking in the wrong place.
//
// The root `npm run build:web` builds these first. This script exists for when
// something runs the app's own build:web directly, which is easy to do by
// accident: Netlify's setup wizard sets a "Base directory" of `app`, and from
// inside app/ the name `build:web` resolves to THIS package's script rather
// than the root's. Same command, different script, and the difference is
// exactly the three builds below.

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

// Build order matters: economy and ui both import money.
const packages = ['money', 'economy', 'ui'];

const missing = packages.filter((name) => {
  const manifest = resolve(root, 'packages', name, 'package.json');
  if (!existsSync(manifest)) {
    throw new Error(
      `packages/${name} is not in this checkout. Expected ${manifest}.`,
    );
  }
  const { main } = require(manifest);
  return !existsSync(resolve(root, 'packages', name, main));
});

if (missing.length === 0) {
  process.exit(0);
}

console.log(`Building shared packages: ${missing.map((n) => `@juwa/${n}`).join(', ')}`);

// Run npm through the same executable that invoked us. Calling the bare `npm`
// off PATH picks up whichever version the shell happens to find, which on a CI
// image is not always the one running this script.
const npmCli = process.env.npm_execpath;
const command = npmCli ? process.execPath : 'npm';
const prefix = npmCli ? [npmCli] : [];

for (const name of missing) {
  execFileSync(
    command,
    [...prefix, 'run', 'build', '--workspace', `@juwa/${name}`],
    { cwd: root, stdio: 'inherit' },
  );
}
