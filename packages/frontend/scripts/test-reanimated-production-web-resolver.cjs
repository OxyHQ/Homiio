const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { withProductionWebReanimatedGuard } = require('./reanimated-production-web-resolver.cjs');
const root = path.dirname(require.resolve('react-native-reanimated/package.json'));
const origin = fs.realpathSync(path.join(root, 'lib/module/ReanimatedModule/js-reanimated/JSReanimated.js'));
const request = '../../platform-specific/workletsVersion.js';
const fallback = { type: 'sourceFile', filePath: '/sentinel' };
const config = { resolver: { resolveRequest: () => fallback } };
withProductionWebReanimatedGuard(config, __dirname);
const run = (dev, platform, name = request, from = origin) => config.resolver.resolveRequest({ dev, originModulePath: from }, name, platform);
assert.equal(run(false, 'web').filePath, path.join(__dirname, 'reanimated-dev-assert-stub.cjs'));
assert.equal(run(true, 'web'), fallback);
assert.equal(run(false, 'ios'), fallback);
assert.equal(run(false, 'android'), fallback);
assert.equal(run(false, 'web', './unrelated'), fallback);
assert.equal(run(false, 'web', request, __filename), fallback);
const originalRead = fs.readFileSync;
try {
  fs.readFileSync = (file, ...args) => file === origin ? Buffer.from('modified caller') : originalRead(file, ...args);
  assert.equal(run(false, 'web'), fallback);
} finally {
  fs.readFileSync = originalRead;
}
assert.throws(() => require('./reanimated-dev-assert-stub.cjs').assertWorkletsVersion(), /Unexpected production call/);

// Exercise the same wrapper with Metro's resolver and actual installed files.
const metro = require(require.resolve('metro-resolver', { paths: [__dirname] }));
const lookup = (file) => {
  try {
    const stat = fs.statSync(file);
    return { exists: true, realPath: fs.realpathSync(file), type: stat.isDirectory() ? 'd' : 'f' };
  } catch {
    return { exists: false };
  }
};
const getPackageForModule = (file) => {
  let dir = file;
  while (dir !== path.dirname(dir)) {
    const manifest = path.join(dir, 'package.json');
    if (fs.existsSync(manifest)) {
      return { rootPath: dir, packageRelativePath: path.relative(dir, file), packageJson: JSON.parse(fs.readFileSync(manifest, 'utf8')) };
    }
    dir = path.dirname(dir);
  }
  return null;
};
const metroContext = {
  allowHaste: false, assetExts: new Set(), customResolverOptions: {}, dev: false,
  disableHierarchicalLookup: false, doesFileExist: (file) => lookup(file).type === 'f',
  fileSystemLookup: lookup, getPackage: (file) => JSON.parse(fs.readFileSync(file, 'utf8')),
  getPackageForModule, isESMImport: true, mainFields: ['react-native', 'browser', 'main'],
  nodeModulesPaths: [], originModulePath: origin, preferNativePlatform: true,
  resolveAsset: () => null, resolveHasteModule: () => null, resolveHastePackage: () => null,
  sourceExts: ['ts', 'tsx', 'js', 'jsx', 'json'], unstable_conditionNames: ['require'],
  unstable_conditionsByPlatform: { web: ['browser'] }, unstable_enablePackageExports: true,
  unstable_logWarning: () => {},
};
metroContext.resolveRequest = (context, name, platform) => metro.resolve({ ...context, resolveRequest: null }, name, platform);
const wrapped = withProductionWebReanimatedGuard({ resolver: {} }, __dirname).resolver.resolveRequest;
assert.equal(wrapped(metroContext, request, 'web').filePath, path.join(__dirname, 'reanimated-dev-assert-stub.cjs'));
for (const [dev, platform] of [[true, 'web'], [false, 'ios'], [false, 'android']]) {
  const result = wrapped({ ...metroContext, dev }, request, platform);
  assert.match(result.filePath, /platform-specific[/\\]workletsVersion\.js$/);
}
console.log('Real Metro resolver: production web intercepted; development web, iOS and Android delegated');
