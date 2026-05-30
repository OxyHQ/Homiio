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
  assetExts: [
    ...config.resolver.assetExts.filter((ext) => ext !== 'svg'),
    'woff2',
    'woff',
  ],
  sourceExts: [...config.resolver.sourceExts, 'svg'],
};

// SVG transformer — use the package's built-in Expo entry directly.
config.transformer = {
  ...config.transformer,
  babelTransformerPath: require.resolve('react-native-svg-transformer/expo'),
};

// NativeWind
const { withNativeWind } = require('nativewind/metro');

// 1rem === 16px on every platform. NativeWind defaults `inlineRem` to 14 on
// native (16 on web), which silently shrinks every rem-based utility
// (`text-*`, `gap-*`, `p-*`, `w-*`, `h-*`, `rounded-*` …) to 87.5% of its web
// size — making the whole app, and the sidebar in particular, render smaller
// on native than on web. Pinning it to the browser default of 16 keeps the
// box model and typography identical across web and native.
const REM_PX = 16;

module.exports = withNativeWind(config, {
  input: './styles/global.css',
  inlineRem: REM_PX,
});
