const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

// The frozen 4.7.1 web caller invokes this import only inside if (__DEV__).
const callerHash = '05a665936b82cf8a930ee92fd83e17b4da4362eb13339b2ddeb20443b5b13bc0';
const requested = '../../platform-specific/workletsVersion.js';

function withProductionWebReanimatedGuard(config, appRoot) {
  const previous = config.resolver.resolveRequest;
  let expected;
  try {
    const manifest = require.resolve('react-native-reanimated/package.json', { paths: [appRoot] });
    const root = path.dirname(manifest);
    expected = fs.realpathSync(path.join(root, 'lib/module/ReanimatedModule/js-reanimated/JSReanimated.js'));
  } catch {
    return config;
  }
  const stub = path.join(__dirname, 'reanimated-dev-assert-stub.cjs');
  config.resolver.resolveRequest = (context, name, platform) => {
    if (platform === 'web' && context.dev === false && name === requested) {
      try {
        const origin = fs.realpathSync(context.originModulePath);
        if (origin === expected && crypto.createHash('sha256').update(fs.readFileSync(origin)).digest('hex') === callerHash) {
          return { type: 'sourceFile', filePath: stub };
        }
      } catch {
        // Delegate if the installed package cannot be verified.
      }
    }
    return previous ? previous(context, name, platform) : context.resolveRequest(context, name, platform);
  };
  return config;
}
module.exports = { withProductionWebReanimatedGuard };
