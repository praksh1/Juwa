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

module.exports = config;
