const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createRequire } = require('node:module');
const { test, after } = require('node:test');
const { withAliaChartOptIn } = require('./alia-chart-opt-in.cjs');
const fromApp = createRequire(path.resolve('packages/frontend/package.json'));
const sdkRoot = fs.realpathSync(path.dirname(fromApp.resolve('@alia.onl/sdk/package.json')));
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'alia-chart-probe-'));
after(() => fs.rmSync(temp, { recursive: true, force: true }));
function fixture(name, version = '22.1.1') {
  const root = path.join(temp, name);
  fs.mkdirSync(path.join(root, 'src/components/thread'), { recursive: true });
  fs.mkdirSync(path.join(root, 'src/components/canvas'), { recursive: true });
  fs.copyFileSync(path.join(sdkRoot, 'src/components/thread/ToolResultCard.tsx'), path.join(root, 'src/components/thread/ToolResultCard.tsx'));
  fs.copyFileSync(path.join(sdkRoot, 'src/components/canvas/ChartRenderer.tsx'), path.join(root, 'src/components/canvas/ChartRenderer.tsx'));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: '@alia.onl/sdk', version }));
  fs.writeFileSync(path.join(root, 'src/__diagnostic_chart_adapter.ts'), 'export {};');
  return root;
}
const a = fixture('a');
const b = fixture('b');
const unsupported = fixture('unsupported', '0.0.0');
const link = path.join(temp, 'link');
fs.symlinkSync(a, link, 'dir');
const source = (root) => path.join(root, 'src/components/thread/ToolResultCard.tsx');
const adapter = (root) => path.join(root, 'src/__diagnostic_chart_adapter.ts');
const calls = [];
let missing = false;
const previous = (context, request, platform) => {
  calls.push({ origin: context.originModulePath, request, platform });
  if (missing && request === '@oxy.so/bloom/chart-cards/line') throw new Error('not exported');
  return { type: 'sourceFile', filePath: (request.endsWith('/bar-list') || request.endsWith('/line')) ? adapter(a) : request };
};
for (const platform of ['web', 'android', 'ios']) {
  test(`delegates and scopes real and symlinked importers on ${platform}`, () => {
    calls.length = 0;
    const config = withAliaChartOptIn({ resolver: { resolveRequest: previous } }, [link]);
    const context = { originModulePath: source(link), resolveRequest: () => { throw Error('previous resolver bypassed'); } };
    assert.equal(config.resolver.resolveRequest(context, '@oxy.so/bloom/chart-cards', platform).filePath, adapter(a));
    assert.deepEqual(calls.map((c) => c.request), ['@oxy.so/bloom/chart-cards/bar-list', '@oxy.so/bloom/chart-cards/line', adapter(a)]);
    assert.ok(calls.every((c) => c.platform === platform));
    calls.length = 0;
    context.originModulePath = source(b);
    assert.equal(config.resolver.resolveRequest(context, '@oxy.so/bloom/chart-cards', platform).filePath, '@oxy.so/bloom/chart-cards');
    assert.equal(calls.length, 1);
    calls.length = 0;
    context.originModulePath = source(a);
    assert.equal(config.resolver.resolveRequest(context, 'other-package', platform).filePath, 'other-package');
    assert.equal(calls.length, 1);
  });
  test(`supports two explicitly registered SDK copies on ${platform}`, () => {
    const config = withAliaChartOptIn({ resolver: { resolveRequest: previous } }, [a, b]);
    assert.equal(config.resolver.resolveRequest({ originModulePath: source(b) }, '@oxy.so/bloom/chart-cards', platform).filePath, adapter(b));
  });
  test(`fails explicitly when a subpath is missing on ${platform}`, () => {
    const config = withAliaChartOptIn({ resolver: { resolveRequest: previous } }, [a]);
    missing = true;
    try { assert.throws(() => config.resolver.resolveRequest({ originModulePath: source(a) }, '@oxy.so/bloom/chart-cards', platform), /Bloom line subpath unavailable/); }
    finally { missing = false; }
  });
}
test('rejects an unknown SDK version', () => {
  assert.throws(() => withAliaChartOptIn({}, [unsupported]), /unsupported SDK/);
});
test('preserves the default resolver when there is no prior override', () => {
  const config = withAliaChartOptIn({ resolver: {} }, [a]);
  assert.equal(config.resolver.resolveRequest({ originModulePath: source(b), resolveRequest: previous }, 'other-package', 'web').filePath, 'other-package');
});

test('rejects an SDK whose declared source has changed', () => {
  const altered = fixture('altered');
  fs.appendFileSync(source(altered), '\n// changed');
  assert.throws(() => withAliaChartOptIn({}, [altered]), /unrecognized source/);
});
test('does not silently activate without registered SDK roots', () => {
  assert.throws(() => withAliaChartOptIn({}, []), /specify SDK roots/);
});
