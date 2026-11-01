const fs = require('node:fs');
const path = require('node:path');
const root = process.argv[2];
const counts = new Map();
function visit(map) {
  if (Array.isArray(map.sections)) { for (const s of map.sections) visit(s.map); return; }
  for (const source of map.sources ?? []) {
    if (source.includes('@alia.onl/sdk/src/components/AliaAskCore.tsx')) counts.set('askCore', (counts.get('askCore') ?? 0) + 1);
    if (source.includes('@alia.onl/sdk/src/runtime/config.tsx')) counts.set('runtimeConfig', (counts.get('runtimeConfig') ?? 0) + 1);
    if (source.includes('@alia.onl/sdk/src/metro/granular-charts.js')) counts.set('adapter', (counts.get('adapter') ?? 0) + 1);
    if (source.includes('@oxy.so/bloom/lib/module/chart-cards/index.js') || source.includes('@oxy.so/bloom/src/chart-cards/index.ts')) counts.set('legacyBarrel', (counts.get('legacyBarrel') ?? 0) + 1);
  }
}
const maps = fs.readdirSync(root, { recursive: true }).filter((p) => p.endsWith('.map'));
if (!maps.length) throw Error(`No source maps in ${root}`);
for (const file of maps) visit(JSON.parse(fs.readFileSync(path.join(root, file), 'utf8')));
console.log(JSON.stringify({ root, maps: maps.length, askCore: counts.get('askCore') ?? 0, runtimeConfig: counts.get('runtimeConfig') ?? 0, adapter: counts.get('adapter') ?? 0, legacyBarrel: counts.get('legacyBarrel') ?? 0 }));
for (const name of ['askCore', 'runtimeConfig', 'adapter']) if (counts.get(name) !== 1) throw Error(`Expected one ${name} source, found ${counts.get(name) ?? 0}`);
if (counts.get('legacyBarrel')) throw Error('Legacy chart barrel remains in the emitted source maps');
