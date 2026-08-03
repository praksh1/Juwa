// Metro configuration for a monorepo.
//
// By default Metro only looks for modules beside the app. In a workspace the
// shared packages (@juwa/ui, @juwa/money) live two directories up and are
// symlinked into the root node_modules, so Metro has to be told to watch the
// repo root and to resolve from both node_modules folders. Without this you get
// "Unable to resolve @juwa/ui" the first time you run the app.
const { getDefaultConfig } = require('expo/metro-config');
const path = require('node:path');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '..');

const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];
config.resolver.disableHierarchicalLookup = true;

/**
 * Optional dependencies we deliberately do not ship.
 *
 * @supabase/supabase-js has an optional hook for OpenTelemetry tracing. Metro
 * resolves imports statically, so it fails the build over a package we never
 * intend to install — there is no tracing backend in a browser, and shipping
 * the API to every player would be dead weight in the bundle.
 *
 * Resolving it to `empty` is the supported way to say "this import is real but
 * intentionally absent".
 */
const STUBBED = new Set(['@opentelemetry/api']);

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (STUBBED.has(moduleName)) return { type: 'empty' };
  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
