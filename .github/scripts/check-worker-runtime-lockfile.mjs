#!/usr/bin/env bun
// Fail when packages/backend/worker-runtime/bun.lock does not match its
// package.json.
//
// That directory is the listing worker image's Playwright: a one-dependency
// project (not a workspace, so a repository install never pulls Playwright)
// that packages/backend/Dockerfile installs with `--frozen-lockfile`. A frozen
// install is not a sync check (see scripts/check-lockfile-sync.mjs: it passes a
// widened range and a stale recorded version), and scripts/check-lockfile-sync
// only covers the root bun.lock, so this is the same two-layer check for this
// lockfile:
//
//   1. what bun.lock records for the project (name and every dependency map)
//      against the manifest, which a plain install does not repair;
//   2. a plain `bun install --lockfile-only` on a copy of the two files, which
//      must leave bun.lock byte-identical.
//
//   check-worker-runtime-lockfile.mjs [<directory>]   (default: packages/backend/worker-runtime)

import { copyFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const directory = resolve(
  process.argv[2] ?? join(repositoryRoot, 'packages/backend/worker-runtime'),
);
const FIELDS = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'];

function die(summary, details = []) {
  console.error(`::error::${summary}`);
  for (const detail of details) console.error(detail);
  process.exit(1);
}

function readJson(path, tolerant = false) {
  try {
    const text = readFileSync(path, 'utf8');
    return JSON.parse(tolerant ? text.replace(/,(?=\s*[}\]])/g, '') : text);
  } catch (error) {
    die(`Could not read ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

const pinnedBun = String(
  readJson(join(repositoryRoot, 'package.json')).packageManager ?? '',
).replace(/^bun@/, '');
if (Bun.version !== pinnedBun) {
  die(
    `This repository pins bun@${pinnedBun} but bun ${Bun.version} is running; a lockfile written by another bun can differ on formatting alone.`,
  );
}

const manifest = readJson(join(directory, 'package.json'));
const lockText = readFileSync(join(directory, 'bun.lock'), 'utf8');
const recorded = readJson(join(directory, 'bun.lock'), true).workspaces?.[''];
if (typeof recorded !== 'object' || recorded === null) {
  die(
    `${directory}/bun.lock records no root project, so there is nothing to compare against the manifest.`,
  );
}

// Layer 1.
const stale = [];
if (recorded.name !== manifest.name) {
  stale.push(
    `name is ${JSON.stringify(manifest.name)} in package.json but ${JSON.stringify(recorded.name)} in bun.lock`,
  );
}
for (const field of FIELDS) {
  const declared = JSON.stringify(Object.entries(manifest[field] ?? {}).sort());
  const locked = JSON.stringify(Object.entries(recorded[field] ?? {}).sort());
  if (declared !== locked)
    stale.push(`${field} is ${declared} in package.json but ${locked} in bun.lock`);
}
// Exact versions only. The Dockerfile's PLAYWRIGHT_VERSION has to name the
// release this installs, and a range the lockfile still satisfies is invisible
// to both layers here (bun keeps the locked resolution; measured).
for (const [name, version] of Object.entries(manifest.dependencies ?? {})) {
  if (!/^\d+\.\d+\.\d+$/.test(version))
    stale.push(`${name} must be an exact version, not ${JSON.stringify(version)}`);
}
if (Object.keys(manifest.dependencies ?? {}).length === 0) {
  stale.push('package.json declares no dependencies; this check would compare nothing');
}
if (stale.length > 0) {
  die(`${directory}/bun.lock does not match its package.json:`, [
    ...stale.map((line) => `  - ${line}`),
    `Fix: run \`bun install --lockfile-only\` in ${directory} and commit bun.lock with the manifest.`,
  ]);
}

// Layer 2.
const scratch = mkdtempSync(join(process.env.RUNNER_TEMP || tmpdir(), 'homiio-worker-runtime-'));
try {
  copyFileSync(join(directory, 'package.json'), join(scratch, 'package.json'));
  copyFileSync(join(directory, 'bun.lock'), join(scratch, 'bun.lock'));
  const install = Bun.spawnSync({
    cmd: [process.execPath, 'install', '--lockfile-only', '--ignore-scripts'],
    cwd: scratch,
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const output = `${install.stdout.toString()}${install.stderr.toString()}`;
  if (install.exitCode !== 0 || /^\s*error:/m.test(output)) {
    die(
      `\`bun install --lockfile-only\` failed (exit ${install.exitCode}), so the lockfile it would write cannot be compared.`,
      [output],
    );
  }
  const regenerated = readFileSync(join(scratch, 'bun.lock'), 'utf8');
  if (regenerated !== lockText) {
    die(`${directory}/bun.lock is OUT OF SYNC: a plain install rewrote it.`, [
      `Fix: run \`bun install --lockfile-only\` in ${directory} and commit bun.lock with the manifest.`,
      '--- regenerated bun.lock ---',
      regenerated,
    ]);
  }
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

console.log(
  `${directory}/bun.lock is in sync with its package.json (${Object.entries(manifest.dependencies)
    .map(([n, v]) => `${n}@${v}`)
    .join(', ')}).`,
);
