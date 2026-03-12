const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const projectRoot = __dirname;
const monorepoRoot = path.resolve(projectRoot, '../..');

const config = getDefaultConfig(projectRoot);

config.projectRoot = projectRoot;
config.watchFolders = [monorepoRoot];

const blockPath = (dir) => {
  const resolved = path.resolve(dir);
  return new RegExp(`${resolved.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}/.*`);
};

config.resolver = {
  ...config.resolver,
  blockList: [
    blockPath(path.join(monorepoRoot, 'packages/backend')),
    blockPath(path.join(monorepoRoot, 'packages/shared-types/src')),
    /\.expo\/.*/,
    /\.metro\/.*/,
    /\.cache\/.*/,
  ],
  extraNodeModules: {
    '@homiio/shared-types': path.join(monorepoRoot, 'packages/shared-types'),
  },
  nodeModulesPaths: [
    path.join(projectRoot, 'node_modules'),
    path.join(monorepoRoot, 'node_modules'),
  ],
  unstable_enableSymlinks: true,
  assetExts: config.resolver.assetExts.filter((ext) => ext !== 'svg'),
  sourceExts: [...config.resolver.sourceExts, 'svg'],
};

// SVG transformer (custom wrapper for monorepo resolution)
config.transformer = {
  ...config.transformer,
  babelTransformerPath: path.join(projectRoot, 'svg-transformer.js'),
};

// NativeWind
const { withNativeWind } = require('nativewind/metro');
module.exports = withNativeWind(config, { input: './styles/global.css' });
