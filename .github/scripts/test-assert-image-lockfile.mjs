#!/usr/bin/env node
// Mutation-tests assert-image-lockfile.mjs against throwaway fixture trees.
//
// The clean tree must pass first, so a check that fails everything cannot read
// as green; every mutation after it breaks exactly one thing and must fail with
// a message that names it.

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const script = join(dirname(fileURLToPath(import.meta.url)), 'assert-image-lockfile.mjs');
const root = mkdtempSync(join(process.env.RUNNER_TEMP || tmpdir(), 'homiio-image-lock-test-'));
let failures = 0;

function write(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, typeof value === 'string' ? value : JSON.stringify(value));
}

// Trailing commas, as bun writes them.
const mainLock = `{
  "lockfileVersion": 1,
  "workspaces": { "": { "name": "fixture" }, "packages/x": { "name": "@fixture/x" }, },
  "packages": {
    "@fixture/x": ["@fixture/x@workspace:packages/x"],
    "@scope/a": ["@scope/a@1.0.0", "", {}, "sha512-a"],
    "b": ["b@2.0.0", "", {}, "sha512-b2"],
    "@scope/a/b": ["b@1.0.0", "", {}, "sha512-b1"],
    "@fixture/x/c": ["c@3.0.0", "", {}, "sha512-c"],
  }
}
`;
const extraLock = `{
  "lockfileVersion": 2,
  "workspaces": { "": { "name": "extra" }, },
  "packages": {
    "d": ["d@4.0.0", "", {}, "sha512-d"],
  }
}
`;

function seed() {
  rmSync(join(root, 'app'), { recursive: true, force: true });
  const app = join(root, 'app');
  write(join(app, 'node_modules/@scope/a/package.json'), { name: '@scope/a', version: '1.0.0' });
  write(join(app, 'node_modules/b/package.json'), { name: 'b', version: '2.0.0' });
  write(join(app, 'node_modules/@scope/a/node_modules/b/package.json'), {
    name: 'b',
    version: '1.0.0',
  });
  write(join(app, 'node_modules/.bin/ignored'), '');
  write(join(app, 'packages/x/package.json'), { name: '@fixture/x', version: '0.0.0' });
  write(join(app, 'packages/x/node_modules/c/package.json'), { name: 'c', version: '3.0.0' });
  mkdirSync(join(app, 'node_modules/@fixture'), { recursive: true });
  symlinkSync('../../packages/x', join(app, 'node_modules/@fixture/x'));
  write(join(root, 'main.lock'), mainLock);
  write(join(root, 'extra.lock'), extraLock);
  return app;
}

function expect(label, wantStatus, needle, args) {
  const result = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });
  const output = `${result.stdout}${result.stderr}`;
  if (result.status !== wantStatus) {
    console.log(`FAIL ${label}: expected exit ${wantStatus}, got ${result.status}\n${output}`);
    failures += 1;
  } else if (needle && !output.includes(needle)) {
    console.log(
      `FAIL ${label}: exit ${result.status} was right but the output never mentioned ${needle}\n${output}`,
    );
    failures += 1;
  } else {
    console.log(`ok   ${label}`);
  }
}

const main = join(root, 'main.lock');
const extra = join(root, 'extra.lock');
try {
  let app = seed();
  expect(
    'clean tree passes, nested and workspace-nested packages counted',
    0,
    '4 installed packages',
    [app, '4', main],
  );

  app = seed();
  write(join(app, 'node_modules/b/package.json'), { name: 'b', version: '2.0.1' });
  expect('a top-level version the lockfile does not record fails', 1, 'b@2.0.1 is installed', [
    app,
    '1',
    main,
  ]);

  app = seed();
  write(join(app, 'node_modules/@scope/a/node_modules/b/package.json'), {
    name: 'b',
    version: '1.5.0',
  });
  expect('a nested version the lockfile does not record fails', 1, '@scope/a/b: b@1.5.0', [
    app,
    '1',
    main,
  ]);

  app = seed();
  write(join(app, 'packages/x/node_modules/c/package.json'), { name: 'c', version: '3.1.0' });
  expect(
    'a workspace-nested version the lockfile does not record fails',
    1,
    '@fixture/x/c: c@3.1.0',
    [app, '1', main],
  );

  app = seed();
  write(join(app, 'node_modules/stray/package.json'), { name: 'stray', version: '1.0.0' });
  expect('a package no lockfile records fails', 1, 'no version of it', [app, '1', main]);

  app = seed();
  write(join(app, 'node_modules/d/package.json'), { name: 'd', version: '4.0.0' });
  expect('a package only the second lockfile records fails without it', 1, 'd@4.0.0 is installed', [
    app,
    '1',
    main,
  ]);
  expect('and passes with it', 0, '5 installed packages', [app, '5', main, extra]);

  app = seed();
  expect('the vacuity floor fails a tree smaller than the minimum', 1, 'below the floor', [
    app,
    '5',
    main,
  ]);
  expect('an app root with no node_modules fails the floor', 1, 'below the floor', [
    join(root, 'nowhere'),
    '1',
    main,
  ]);
} finally {
  rmSync(root, { recursive: true, force: true });
}

if (failures > 0) {
  console.log(`${failures} mutation(s) survived`);
  process.exit(1);
}
console.log('All mutations detected.');
