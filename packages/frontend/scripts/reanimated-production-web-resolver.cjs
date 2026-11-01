const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

// The frozen 4.7.1 web caller invokes this import only inside if (__DEV__).
const callerHash = '05a665936b82cf8a930ee92fd83e17b4da4362eb13339b2ddeb20443b5b13bc0';
const requested = '../../platform-specific/workletsVersion.js';
const auditedFiles = {
  'lib/module/platform-specific/workletsVersion.js': '245dd76f22a19a6bfd3b3fe0c96098f2db757a728d800c545e05a8d0a6549b73',
  'lib/module/platform-specific/jsVersion.js': 'c9d5da086ef176bddce570feda78841d2c6640f6d07ea0a3760a55ba8a6c89bf',
  'scripts/validate-worklets-version.js': '15ab16a9498bc13eb817aa6c7dbc271a41db72203216404513f7c5e3b4644dc1',
  'compatibility.json': '928891213b16dad10021e3fd7656e3f579fc066a3b558a520b2bdeebaeb11987',
};

function withProductionWebReanimatedGuard(config, appRoot) {
  const previous = config.resolver.resolveRequest;
  let expected;
  let expectedModule;
  let root;
  try {
    const manifest = require.resolve('react-native-reanimated/package.json', { paths: [appRoot] });
    root = path.dirname(manifest);
    expected = fs.realpathSync(path.join(root, 'lib/module/ReanimatedModule/js-reanimated/JSReanimated.js'));
    expectedModule = fs.realpathSync(path.join(root, 'lib/module/platform-specific/workletsVersion.js'));
  } catch {
    return config;
  }
  const stub = path.join(__dirname, 'reanimated-dev-assert-stub.cjs');
  config.resolver.resolveRequest = (context, name, platform) => {
    const result = previous ? previous(context, name, platform) : context.resolveRequest(context, name, platform);
    if (platform === 'web' && context.dev === false && name === requested && result.type === 'sourceFile') {
      try {
        const origin = fs.realpathSync(context.originModulePath);
        if (fs.realpathSync(result.filePath) === expectedModule && origin === expected && crypto.createHash('sha256').update(fs.readFileSync(origin)).digest('hex') === callerHash && Object.entries(auditedFiles).every(([file, hash]) => crypto.createHash('sha256').update(fs.readFileSync(path.join(root, file))).digest('hex') === hash)) {
          return { type: 'sourceFile', filePath: stub };
        }
      } catch {
        // Delegate if the installed package cannot be verified.
      }
    }
    return result;
  };
  return config;
}
module.exports = { withProductionWebReanimatedGuard };
