#!/usr/bin/env node

// Refuse to publish a package whose manifest points at files that were never
// built.
//
// @oxy.so/homiio-contracts and @oxy.so/homiio-sdk once had `composite: true`
// with the .tsbuildinfo beside the tsconfig (gitignored). After `rm -rf dist`
// tsc read that buildinfo, decided nothing had changed and emitted NOTHING, and
// `npm pack` shipped a tarball with no dist. The tsconfigs no longer keep build
// state, and this check, run from each package's prepublishOnly after its build,
// makes an empty tarball impossible whatever the next trap is: every file
// `main`, `types` and the non-wildcard `exports` name must exist.
//
// Usage (from the package directory): node ../../scripts/assert-package-dist.mjs

import { existsSync, readFileSync } from 'node:fs';
import { join, normalize } from 'node:path';

const dir = process.cwd();
const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));

const targets = new Set();
const collect = (value) => {
  if (typeof value === 'string') {
    if (!value.includes('*') && !value.endsWith('package.json')) targets.add(normalize(value));
  } else if (value && typeof value === 'object') {
    for (const nested of Object.values(value)) collect(nested);
  }
};
collect(manifest.main);
collect(manifest.types);
collect(manifest.exports);

const missing = [...targets].filter((target) => !existsSync(join(dir, target)));
if (targets.size === 0 || missing.length > 0) {
  console.error(
    `${manifest.name}: ${targets.size === 0 ? 'the manifest names no entry point' : `not built — missing ${missing.join(', ')}`}. Run its build before packing.`,
  );
  process.exit(1);
}
console.log(`${manifest.name}: all ${targets.size} entry point(s) present.`);
