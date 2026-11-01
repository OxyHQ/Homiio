/* Diagnostic only: a prototype of an SDK-owned Metro opt-in. */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const SUPPORTED = {
  '22.1.1': {
    'src/components/thread/ToolResultCard.tsx': '3ee679038681e7d2486b1d867e13d9e5868e729f2925b78b4577538ac5d1c6eb',
    'src/components/canvas/ChartRenderer.tsx': 'e05d736dc4b43b2905c078fd460a900ebff5024082db077e32357f5119a1130b',
  },
};
function checkedTargets(roots) {
  const targets = new Map();
  for (const rootInput of roots) {
    const root = fs.realpathSync(rootInput);
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    const hashes = pkg.name === '@alia.onl/sdk' && SUPPORTED[pkg.version];
    if (!hashes) throw new Error(`Alia chart opt-in: unsupported SDK ${pkg.name}@${pkg.version}`);
    const adapter = fs.realpathSync(path.join(root, 'src/__diagnostic_chart_adapter.ts'));
    for (const [relative, hash] of Object.entries(hashes)) {
      const source = fs.realpathSync(path.join(root, relative));
      const actual = crypto.createHash('sha256').update(fs.readFileSync(source)).digest('hex');
      if (actual !== hash) throw new Error(`Alia chart opt-in: unrecognized source ${relative}`);
      targets.set(source, adapter);
    }
  }
  return targets;
}
function withAliaChartOptIn(config, roots) {
  if (!Array.isArray(roots) || roots.length === 0) throw new Error('Alia chart opt-in: specify SDK roots');
  const targets = checkedTargets(roots);
  const previous = config.resolver?.resolveRequest;
  const delegate = (context, moduleName, platform) =>
    previous ? previous(context, moduleName, platform) : context.resolveRequest(context, moduleName, platform);
  config.resolver ??= {};
  config.resolver.resolveRequest = (context, moduleName, platform) => {
    if (moduleName !== '@oxy.so/bloom/chart-cards') return delegate(context, moduleName, platform);
    let origin;
    try { origin = fs.realpathSync(context.originModulePath); } catch { return delegate(context, moduleName, platform); }
    const adapter = targets.get(origin);
    if (!adapter) return delegate(context, moduleName, platform);
    for (const name of ['bar-list', 'line']) {
      let result;
      try { result = delegate(context, `@oxy.so/bloom/chart-cards/${name}`, platform); }
      catch (error) { throw new Error(`Alia chart opt-in: Bloom ${name} subpath unavailable for ${platform}`, { cause: error }); }
      if (result?.type !== 'sourceFile' || typeof result.filePath !== 'string' || !fs.existsSync(result.filePath)) {
        throw new Error(`Alia chart opt-in: Bloom ${name} subpath unavailable for ${platform}`);
      }
    }
    return delegate(context, adapter, platform);
  };
  return config;
}
module.exports = { withAliaChartOptIn };
