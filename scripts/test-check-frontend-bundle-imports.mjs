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

mkdirSync(join(fixture, 'components'));
writeFileSync(
  join(fixture, 'components', 'Good.tsx'),
  "import Ionicons from '@expo/vector-icons/Ionicons';\n",
);

const clean = run();
if (clean.status !== 0) {
  console.error(`FAIL: direct family import was rejected\n${clean.stdout}${clean.stderr}`);
  process.exit(1);
}

writeFileSync(
  join(fixture, 'components', 'Bad.tsx'),
  "import { Ionicons } from '@expo/vector-icons';\n",
);
const broken = run();
if (broken.status !== 1 || !broken.stderr.includes('components/Bad.tsx:1')) {
  console.error(`FAIL: root-barrel import escaped the gate\n${broken.stdout}${broken.stderr}`);
  process.exit(1);
}

console.log('Bundle-import gate mutations detected.');
