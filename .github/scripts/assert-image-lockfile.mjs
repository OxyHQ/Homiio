#!/usr/bin/env node
// Fail unless every package installed in an image is a name@version a lockfile
// records.
//
//   assert-image-lockfile.mjs <app root> <minimum package count> <bun.lock> [<bun.lock> ...]
//
// packages/backend/Dockerfile installs with `bun install --frozen-lockfile`
// against the repository's bun.lock (and the worker's Playwright from
// packages/backend/worker-runtime/bun.lock). `--frozen-lockfile` is not a
// proof that the tree matches the lockfile — it refuses some desyncs and passes
// others — so CI's image smoke runs this inside each built image and compares
// what is ON DISK with what the lockfiles say.
//
// Compared by name@version, not by position. bun.lock keys its `packages` by
// hoisted path for the WHOLE repository; a `--filter`ed install of three
// workspaces hoists differently (measured: zod 4.6.5 sits nested in the full
// tree and at the top of the filtered one), so the paths differ while every
// version still comes from the lockfile. What this rules out is the failure
// that mattered: a version the lockfile never recorded, i.e. one resolved
// against the registry at build time. The previous, lockfile-less image install
// fails it on 32 packages (measured 2026-10-13).
//
// Runs on Node or Bun with no dependencies, so it works in every image target.

import { existsSync, lstatSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const [appRoot, minimumArgument, ...lockfiles] = process.argv.slice(2);
const minimum = Number(minimumArgument);
if (!appRoot || !Number.isInteger(minimum) || minimum < 1 || lockfiles.length === 0) {
  console.error(
    'usage: assert-image-lockfile.mjs <app root> <minimum package count> <bun.lock> [<bun.lock> ...]',
  );
  process.exit(2);
}

function fail(message, details = []) {
  console.error(`::error::${message}`);
  for (const line of details) console.error(line);
  process.exit(1);
}

// bun.lock is JSON with trailing commas; the same tolerant parse as
// scripts/check-lockfile-sync.mjs.
const recorded = new Map(); // name@version -> the first lockfile recording it
for (const lockfile of lockfiles) {
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(lockfile, 'utf8').replace(/,(?=\s*[}\]])/g, ''));
  } catch (error) {
    fail(
      `${lockfile} could not be parsed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const packages = parsed?.packages;
  if (typeof packages !== 'object' || packages === null || Object.keys(packages).length === 0) {
    fail(`${lockfile} records no packages, so nothing could be compared against it`);
  }
  for (const entry of Object.values(packages)) {
    if (!Array.isArray(entry) || typeof entry[0] !== 'string') continue;
    // Workspace links (`@homiio/backend@workspace:packages/backend`) are not
    // installed packages; the walk skips the symlinks they produce.
    if (entry[0].includes('@workspace:')) continue;
    if (!recorded.has(entry[0])) recorded.set(entry[0], lockfile);
  }
}

const checked = [];
const problems = [];

function readManifest(directory) {
  try {
    return JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'));
  } catch {
    return undefined;
  }
}

function visit(directory, key) {
  if (lstatSync(directory).isSymbolicLink()) return;
  const manifest = readManifest(directory);
  if (manifest === undefined) return;
  const actual = `${manifest.name}@${manifest.version}`;
  if (recorded.has(actual)) {
    checked.push(actual);
  } else {
    const known = [...recorded.keys()].filter((spec) => spec.startsWith(`${manifest.name}@`));
    problems.push(
      `${key}: ${actual} is installed; the lockfiles record ${known.length > 0 ? known.join(', ') : 'no version of it'}`,
    );
  }
  walk(join(directory, 'node_modules'), `${key}/`);
}

function walk(nodeModules, prefix) {
  if (!existsSync(nodeModules)) return;
  for (const entry of readdirSync(nodeModules)) {
    if (entry.startsWith('.')) continue;
    const path = join(nodeModules, entry);
    if (entry.startsWith('@')) {
      for (const scoped of readdirSync(path))
        visit(join(path, scoped), `${prefix}${entry}/${scoped}`);
    } else {
      visit(path, `${prefix}${entry}`);
    }
  }
}

walk(join(appRoot, 'node_modules'), '');
const packagesDirectory = join(appRoot, 'packages');
if (existsSync(packagesDirectory)) {
  for (const workspace of readdirSync(packagesDirectory)) {
    const name = readManifest(join(packagesDirectory, workspace))?.name;
    if (name) walk(join(packagesDirectory, workspace, 'node_modules'), `${name}/`);
  }
}

if (problems.length > 0) {
  fail(
    `${problems.length} installed package(s) are versions no lockfile records:`,
    problems.map((p) => `  - ${p}`),
  );
}
// Vacuity floor: a wrong app root or an empty tree must not pass by comparing
// nothing.
if (checked.length < minimum) {
  fail(
    `only ${checked.length} installed package(s) were found under ${appRoot}, below the floor of ${minimum}`,
  );
}

const sample = checked
  .filter((_, index) => index % Math.max(1, Math.floor(checked.length / 12)) === 0)
  .slice(0, 12);
console.log(
  `${checked.length} installed packages under ${appRoot} are versions ${lockfiles.join(' + ')} record (sample: ${sample.join(', ')})`,
);
