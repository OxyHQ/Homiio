const fs = require('node:fs');
const path = require('node:path');
const { gzipSync } = require('node:zlib');
const root = path.join(process.cwd(), 'packages/frontend/dist');
const maps = fs.readdirSync(root, { recursive: true }).filter((name) => name.endsWith('.js.map'));
if (!maps.length) throw new Error('No source maps found');
const groups = new Map();
const modules = [];
function visit(map) {
  if (Array.isArray(map.sections)) {
    for (const section of map.sections) visit(section.map);
    return;
  }
  if (!Array.isArray(map.sources)) throw new Error('Unsupported source map');
  for (let i = 0; i < map.sources.length; i++) {
    const source = map.sources[i];
    const content = map.sourcesContent?.[i];
    if (typeof content !== 'string') continue;
    const match = source.match(
      /node_modules\/(?:\.bun\/[^/]+\/node_modules\/)?(@[^/]+\/[^/]+|[^/]+)/,
    );
    const group = match?.[1] ?? 'application-or-runtime';
    const size = gzipSync(content).length;
    const previous = groups.get(group) ?? { modules: 0, standaloneGzip: 0 };
    previous.modules++;
    previous.standaloneGzip += size;
    groups.set(group, previous);
    modules.push({
      source: source.replace(/^.*node_modules\//, 'node_modules/'),
      standaloneGzip: size,
    });
  }
}
for (const name of maps) visit(JSON.parse(fs.readFileSync(path.join(root, name), 'utf8')));
console.log(
  'Diagnostic only: independently gzipped SOURCE is not additive or equal to export gzip.',
);
console.log('Source maps:', maps.length);
console.log(
  'Groups:',
  JSON.stringify(
    [...groups.entries()].sort((a, b) => b[1].standaloneGzip - a[1].standaloneGzip).slice(0, 40),
  ),
);
console.log(
  'Largest modules:',
  JSON.stringify(modules.sort((a, b) => b.standaloneGzip - a.standaloneGzip).slice(0, 50)),
);
