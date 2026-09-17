#!/usr/bin/env node
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const CHECK = new URL('./check-frontend-bundle-imports.mjs', import.meta.url).pathname;
const fixture = mkdtempSync(join(tmpdir(), 'homiio-bundle-imports-'));
process.on('exit', () => rmSync(fixture, { recursive: true, force: true }));

function run() {
  return spawnSync(process.execPath, [CHECK, fixture], { encoding: 'utf8' });
}

function fail(message, result) {
  console.error(`FAIL: ${message}\n${result.stdout}${result.stderr}`);
  process.exit(1);
}

mkdirSync(join(fixture, 'components'));
writeFileSync(
  join(fixture, 'components', 'Good.tsx'),
  [
    "import { RiHomeLine } from '@oxy.so/bloom/icons';",
    "import { Button } from '@oxy.so/bloom/button';",
    "jest.mock('@oxy.so/bloom/toast', () => ({}));",
    // Negative control: a doc comment QUOTING the forbidden form is not an import.
    "// never write: import { Button } from '@oxy.so/bloom';",
    "// nor: import Ionicons from '@expo/vector-icons/Ionicons';",
    " * e.g. `import { alert } from '@oxy.so/bloom';` — use the subpath.",
    '',
  ].join('\n'),
);

const clean = run();
if (clean.status !== 0) fail('subpath imports or a comment were rejected', clean);

const mutations = [
  ['VectorIcons.tsx', "import { Ionicons } from '@expo/vector-icons';\n"],
  ['VectorIconsSubpath.tsx', "import Ionicons from '@expo/vector-icons/Ionicons';\n"],
  ['VectorIconsRequire.js', "const Ionicons = require('@expo/vector-icons/Ionicons');\n"],
  ['VectorIconsMock.tsx', "jest.mock('@expo/vector-icons/Ionicons', () => ({}));\n"],
  ['Lucide.tsx', "import { Home } from 'lucide-react-native';\n"],
  ['LucideSubpath.tsx', "import Home from 'lucide-react-native/dist/esm/icons/home';\n"],
  ['BloomFrom.tsx', "import { Button } from '@oxy.so/bloom';\n"],
  ['BloomMultiline.tsx', "import {\n  Button,\n  alert,\n} from \"@oxy.so/bloom\";\n"],
  ['BloomExport.ts', "export { Button } from '@oxy.so/bloom';\n"],
  ['BloomRequire.js', "const bloom = require('@oxy.so/bloom');\n"],
  ['BloomMock.tsx', "jest.mock('@oxy.so/bloom', () => ({}));\n"],
];

for (const [name, source] of mutations) {
  const path = join(fixture, 'components', name);
  writeFileSync(path, source);
  const broken = run();
  rmSync(path);
  if (broken.status !== 1 || !broken.stderr.includes(`components/${name}:`)) {
    fail(`forbidden import in ${name} escaped the gate`, broken);
  }
}

console.log(`Bundle-import gate: ${mutations.length} mutations detected, controls pass.`);
