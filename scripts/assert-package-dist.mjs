#!/usr/bin/env node

// Refuse to publish a package whose manifest points at files that were never
// built.
//
// @oxy.so/homiio-contracts and @oxy.so/homiio-sdk once had `composite: true`
// with the .tsbuildinfo beside the tsconfig (gitignored). After `rm -rf dist`
// tsc read that buildinfo, decided nothing had changed and emitted NOTHING, and
// `npm pack` shipped a tarball with no dist. The tsconfigs no longer keep build
// state, and this check, run by CI after each package's build,
// makes an empty tarball impossible whatever the next trap is: every file
// `main`, `types` and the non-wildcard `exports` name must exist.
//
// It also refuses a manifest that pins a sibling workspace package at a version
// other than the one that workspace declares. @oxy.so/homiio-sdk 0.1.3 was
// published depending on @oxy.so/homiio-contracts 0.1.1 while the workspace's
// contracts was already 0.2.0: everything in-repo resolved the workspace copy,
// so nothing failed, and the pin was corrected only after the release, leaving
// the source's "0.1.3" different from the registry's.
//
// Usage (from the package directory): node ../../scripts/assert-package-dist.mjs

import { existsSync, readdirSync, readFileSync } from 'node:fs';
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

const packagesDir = join(dir, '..');
const workspaceVersions = new Map(
  readdirSync(packagesDir)
    .map((entry) => join(packagesDir, entry, 'package.json'))
    .filter((file) => existsSync(file))
    .map((file) => JSON.parse(readFileSync(file, 'utf8')))
    .map((sibling) => [sibling.name, sibling.version]),
);
const stalePins = Object.entries({ ...manifest.dependencies, ...manifest.peerDependencies })
  .filter(([name, range]) => workspaceVersions.has(name) && range !== workspaceVersions.get(name))
  .map(([name, range]) => `${name} ${range} (workspace is ${workspaceVersions.get(name)})`);
if (stalePins.length > 0) {
  console.error(
    `${manifest.name}: pins a sibling workspace at a version it does not have — ${stalePins.join(', ')}. Pin the workspace's version and release that first.`,
  );
  process.exit(1);
}
console.log(`${manifest.name}: all ${targets.size} entry point(s) present.`);
