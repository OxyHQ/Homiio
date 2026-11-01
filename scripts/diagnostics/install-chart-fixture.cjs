/* This modifies only the isolated CI install. It is not a publishable package. */
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const appRequire = createRequire(path.resolve('packages/frontend/package.json'));
const bloomManifest = fs.realpathSync(appRequire.resolve('@oxy.so/bloom/package.json'));
const sdkManifest = fs.realpathSync(appRequire.resolve('@alia.onl/sdk/package.json'));
const bloomRoot = path.dirname(bloomManifest), sdkRoot = path.dirname(sdkManifest);
const bloom = JSON.parse(fs.readFileSync(bloomManifest, 'utf8'));
const sdk = JSON.parse(fs.readFileSync(sdkManifest, 'utf8'));
if (bloom.version !== '15.53.0' || sdk.version !== '22.1.1') throw new Error('Unexpected fixture versions');
const names = { 'bar-list': 'BarListCard', line: 'LineChartCard', surface: 'primitives/ChartCardSurface', header: 'primitives/ChartHeader', 'stat-tiles': 'primitives/ChartStatTiles' };
for (const [key, target] of Object.entries(names)) {
  const subpath = `./chart-cards/${key}`;
  if (bloom.exports[subpath]) throw new Error(`Refusing to override ${subpath}`);
  const routes = {
    'react-native': { types: `./lib/typescript/module/chart-cards/${target}.d.ts`, default: `./src/chart-cards/${target}.tsx` },
    import: { types: `./lib/typescript/module/chart-cards/${target}.d.ts`, default: `./lib/module/chart-cards/${target}.js` },
    require: { types: `./lib/typescript/commonjs/chart-cards/${target}.d.ts`, default: `./lib/commonjs/chart-cards/${target}.js` },
  };
  for (const condition of Object.values(routes)) for (const rel of Object.values(condition)) {
    if (!fs.existsSync(path.join(bloomRoot, rel))) throw new Error(`Missing fixture target ${rel}`);
  }
  bloom.exports[subpath] = routes;
}
fs.writeFileSync(bloomManifest, `${JSON.stringify(bloom, null, 2)}\n`);
fs.writeFileSync(path.join(sdkRoot, 'src/__diagnostic_chart_adapter.ts'), [
  "export { BarListCard } from '@oxy.so/bloom/chart-cards/bar-list';",
  "export { LineChartCard } from '@oxy.so/bloom/chart-cards/line';",
  '',
].join('\n'));
console.log('Created additive fixture subpaths and adapter in the isolated runner install only');
