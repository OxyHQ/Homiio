#!/usr/bin/env bun
// Mutation-tests check-worker-runtime-lockfile.mjs against copies of the real
// packages/backend/worker-runtime. The clean copy must pass first; each
// mutation then breaks one thing and must fail naming it.

import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scripts = dirname(fileURLToPath(import.meta.url));
const source = resolve(scripts, '..', '..', 'packages/backend/worker-runtime');
const check = join(scripts, 'check-worker-runtime-lockfile.mjs');
const root = mkdtempSync(join(process.env.RUNNER_TEMP || tmpdir(), 'homiio-worker-runtime-test-'));
let failures = 0;

function seed() {
  const target = join(root, 'worker-runtime');
  rmSync(target, { recursive: true, force: true });
  cpSync(join(source, 'package.json'), join(target, 'package.json'));
  cpSync(join(source, 'bun.lock'), join(target, 'bun.lock'));
  return target;
}

function edit(path, transform) {
  writeFileSync(path, transform(readFileSync(path, 'utf8')));
}

function expect(label, directory, wantStatus, needle) {
  const result = Bun.spawnSync({
    cmd: [process.execPath, check, directory],
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const output = `${result.stdout.toString()}${result.stderr.toString()}`;
  if (result.exitCode !== wantStatus) {
    console.log(`FAIL ${label}: expected exit ${wantStatus}, got ${result.exitCode}\n${output}`);
    failures += 1;
  } else if (needle && !output.includes(needle)) {
    console.log(
      `FAIL ${label}: exit ${result.exitCode} was right but the output never mentioned ${needle}\n${output}`,
    );
    failures += 1;
  } else {
    console.log(`ok   ${label}`);
  }
}

try {
  expect('the committed lockfile passes', seed(), 0, 'is in sync');

  let dir = seed();
  edit(join(dir, 'package.json'), (text) =>
    text.replace('"playwright": "1.61.1"', '"playwright": "1.61.0"'),
  );
  expect(
    'a manifest version change without the lockfile fails (layer 1)',
    dir,
    1,
    'dependencies is',
  );

  dir = seed();
  edit(join(dir, 'package.json'), (text) =>
    text.replace('"name": "@homiio/worker-runtime"', '"name": "@homiio/renamed"'),
  );
  expect('a renamed project fails (layer 1)', dir, 1, 'name is');

  // Both records agree with the manifest, but bun keeps the locked resolution,
  // so only the exact-version rule sees a widened range.
  dir = seed();
  edit(join(dir, 'package.json'), (text) =>
    text.replace('"playwright": "1.61.1"', '"playwright": "^1.61.1"'),
  );
  edit(join(dir, 'bun.lock'), (text) =>
    text.replace('"playwright": "1.61.1",', '"playwright": "^1.61.1",'),
  );
  expect(
    'a widened range recorded in both files fails (exact-version rule)',
    dir,
    1,
    'must be an exact version',
  );

  // The project record is right but a resolved package is missing: only the
  // regenerate-and-compare layer can see these.
  dir = seed();
  edit(join(dir, 'bun.lock'), (text) => text.replace(/\n\s*"fsevents": \[[^\n]*\n/, '\n'));
  expect(
    'a lockfile missing an optional package bun silently re-adds fails (layer 2)',
    dir,
    1,
    'OUT OF SYNC',
  );

  // bun reports an unparseable lockfile as `error:` and still exits 0.
  dir = seed();
  edit(join(dir, 'bun.lock'), (text) => text.replace(/\n\s*"playwright-core": \[[^\n]*\n/, '\n'));
  expect(
    'a lockfile bun cannot parse fails even though bun exits 0 (layer 2)',
    dir,
    1,
    'cannot be compared',
  );
} finally {
  rmSync(root, { recursive: true, force: true });
}

if (failures > 0) {
  console.log(`${failures} mutation(s) survived`);
  process.exit(1);
}
console.log('All mutations detected.');
