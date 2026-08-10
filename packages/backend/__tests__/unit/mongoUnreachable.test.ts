import { execFileSync } from 'child_process';
import { readFileSync } from 'fs';
import path from 'path';

import { stripComments } from '@homiio/shared-types/testing/stripComments';

/**
 * Homiio's runtime cannot reach Mongo — asserted, not claimed.
 *
 * ## Why this is a test and not a checklist
 *
 * Removing `MONGODB_URI` from the live task definition is what turns "Homiio
 * does not use Mongo" from a statement about the code into a fact about the
 * process, and that step should not be taken on a file count. This gate is the
 * evidence: it can be run and re-run, it fails loudly if somebody reintroduces
 * a connection, and it keeps working after every agent on this migration has
 * moved on. It outlives the port — it is what stops Mongo coming back by
 * accident in six months.
 *
 * ## The allowlist IS the remaining work
 *
 * {@link PENDING_MONGO_FILES} is not a list of exceptions to tolerate. It is
 * the migration's own progress, expressed so that finishing a file means
 * DELETING a line here, and so that the day the list is empty is the day the
 * secret can be removed. A file that reaches Mongo and is not on the list fails
 * the build.
 *
 * ## Both halves are now empty, and the dependency is GONE
 *
 * This gate's allowlist and the test-side enumeration were two separate lists,
 * cleared by different people, and the distinction mattered while either held
 * an entry: this one retired the `MONGODB_URI` SECRET, and the other retired
 * the npm DEPENDENCY. Both are empty now.
 *
 *     grep -rl '^useMongoMemoryServer();' __tests__     # 0 — helper deleted
 *
 * `mongoose` and `mongodb-memory-server` are out of `package.json`, so the
 * strongest statement available is no longer "nothing imports Mongo" but
 * "Mongo is not installed": a reintroduced import fails to RESOLVE. This gate is
 * kept anyway, because a failed resolution is a confusing error at an arbitrary
 * call site, while this names the file and says why — and because somebody
 * re-adding the dependency should have to walk past a test that says not to.
 *
 * `__tests__` is still deliberately unscanned. That is now a statement about
 * scope rather than a concession: no suite can boot a Mongo that is not
 * installed, and the enumeration above is what proves none tries.
 *
 * ## Why an affirmative scan
 *
 * Enumeration is `git ls-files`, never a directory walk, so the scan cannot
 * disagree with the set git actually tracks and build output is excluded for
 * free rather than by an ignore list that rots. The scanned roots are an
 * AFFIRMATIVE list of what must be Mongo-free, rather than "everything minus
 * known binaries" — a new directory cannot silently widen the exemption; it is
 * simply not scanned until somebody adds it here on purpose.
 *
 * ## Why the extension filter is a list and not `.ts`
 *
 * It was `.ts` only, and that was a real hole rather than a theoretical one:
 * `scripts/seedCities.js` sat under a SCANNED root, did
 * `require('mongoose')` AND `require('../dist/models/index')`, and this gate
 * reported a clean tree the whole time. A TypeScript-shaped search for
 * importers cannot see it either — it imports the COMPILED barrel, so the
 * source path `models/` never appears in it. It is deleted now, along with
 * `scripts/seedCitiesSimple.js`, but the filter is widened so the next one
 * cannot repeat the trick: a Mongo reader does not stop counting because it was
 * written in JavaScript.
 */

const BACKEND_ROOT = path.join(__dirname, '..', '..');

/**
 * The roots that must be Mongo-free. Affirmative on purpose — see the header.
 *
 * `db/` is scanned WHOLE. It used to carry one exemption, `db/backfill/`, whose
 * job was reading Mongo and copying it into Postgres — the one place a Mongo
 * client was correct. That exemption is DELETED rather than left inert: the
 * `homiio-production` database was dropped, so the backfill read a source that
 * no longer exists and could never be run again. An exemption nothing needs is
 * indistinguishable from an exemption something is hiding behind, and a reader
 * a year from now cannot tell those apart.
 */
const SCANNED_ROOTS = [
  'controllers',
  'routes',
  'services',
  'middlewares',
  'utils',
  'config',
  'db',
  'types',
  'scripts',
] as const;

/**
 * Top-level files that are equally load-bearing and would otherwise be missed.
 *
 * `database/connection.ts` is deliberately absent: the module is gone, and this
 * list asserts each entry EXISTS, so naming a deleted file here would fail the
 * scan rather than guard anything. What stops it coming back is the
 * `database/connection` pattern in {@link MONGO_PATTERNS} — a re-created module
 * would be imported by something under a scanned root, and that import is what
 * fails the gate.
 */
const SCANNED_FILES = ['server.ts', 'worker.ts', 'config.ts'] as const;

/**
 * Files that still reach Mongo, each with the agent or reason that will remove
 * it. DELETE a line when its port lands; an empty list is the signal that
 * `MONGODB_URI` can come off the task definition.
 *
 * **It is now EMPTY, and that is the signal.** Nothing this gate scans reaches
 * Mongo any more: `controllers/billingController.ts` came off with the billing
 * port, and `scripts/seedImages.ts` — whose only reach was `import type
 * { Types } from 'mongoose'`, erased at compile time and used purely to spell
 * two parameters `Types.ObjectId | string` — takes plain `string` ids now, which
 * is what every Postgres primary key is. The list emptying is what the
 * `MONGODB_URI` removal from the task definition and SSM waits on.
 *
 * Keep the map and the gate rather than deleting them with the last entry: they
 * are what stops a Mongo import coming BACK, and "no unaccounted Mongo reader"
 * against an empty allowlist is a stronger assertion than it has ever been. The
 * vacuity floor below is what keeps that from being a check on nothing.
 *
 * `controllers/analyticsController.ts` and `controllers/roommateController.ts`
 * were on this list at 55e1ec4a and came off in #326, which landed between this
 * gate being written and being merged — so `main` carried a red "no stale
 * pending entry" for that window. That is the gate working exactly as its
 * header describes: a finished port shows up here as a line to DELETE, not as a
 * silent tolerance.
 *
 * `scripts/seedProperties.ts` came off with the seed port, and what it cost is
 * worth recording because the list made it look larger than it was: the
 * seeder's write path had already moved in #281, so all that still reached
 * Mongo was a `database/connection` import used for a single
 * `database.disconnect()` in its CLI teardown. This list's LENGTH was never a
 * measure of the remaining work — the same is true of the two entries above it.
 */
const PENDING_MONGO_FILES: ReadonlyMap<string, string> = new Map([]);

/**
 * A file "reaches Mongo" if it imports mongoose or the Mongoose model barrel,
 * or opens a connection.
 *
 * Matched against COMMENT-STRIPPED source, because several modules in this
 * repository document what they no longer do in exactly this vocabulary — a
 * raw-text scan matches their own explanation and fails on correct code. That
 * is not hypothetical: it happened while writing a sibling gate today.
 *
 * **The stripping is deliberate, and it used to be unsound.** This file carried
 * its own two-regex stripper, which let a block-comment opener MENTIONED inside
 * a `//` comment open a real block and blank everything up to the next
 * terminator. In
 * `config.ts` that is 109 lines — a `mongoose` import anywhere inside them
 * would have passed this gate silently, which is the one thing it exists to
 * prevent. It now strips through `@homiio/shared-types/testing/stripComments`,
 * shared with the currency gate that hit the same fault; the intent above is
 * unchanged, only the implementation is sound. See
 * `packages/frontend/__tests__/stripComments.test.ts`.
 *
 * **`import` and `require` are BOTH covered for the barrel, not only for
 * mongoose**, and the asymmetry that used to sit here was load-bearing:
 * `scripts/seedCities.js` reached the models through
 * `require('../dist/models/index')` — the COMPILED barrel, under `dist/`, so
 * neither an `import`-shaped pattern nor a grep for the source path `models/`
 * could see it. `dist` is matched by the same `[^'"]*` that matches a relative
 * prefix, so the compiled spelling is covered without naming it.
 */
const MONGO_PATTERNS: readonly RegExp[] = [
  /\bfrom\s+['"]mongoose['"]/,
  /\brequire\(\s*['"]mongoose['"]\s*\)/,
  /\bfrom\s+['"][^'"]*\/models['"]/,
  /\bfrom\s+['"][^'"]*\/models\/[^'"]*['"]/,
  /\brequire\(\s*['"][^'"]*\/models['"]\s*\)/,
  /\brequire\(\s*['"][^'"]*\/models\/[^'"]*['"]\s*\)/,
  /\bfrom\s+['"][^'"]*database\/connection['"]/,
  /\brequire\(\s*['"][^'"]*database\/connection['"]\s*\)/,
];

/**
 * Executable source, whatever it is written in. See the header — a `.ts`-only
 * filter let a `require('mongoose')` under `scripts/` pass unseen.
 *
 * `.d.ts` is excluded because a declaration file cannot open a connection, and
 * including it would only add noise; every other shape here can.
 */
const SOURCE_EXTENSIONS = ['.ts', '.js', '.cjs', '.mjs'] as const;

function trackedFiles(): string[] {
  const output = execFileSync('git', ['ls-files', '--', '.'], {
    cwd: BACKEND_ROOT,
    encoding: 'utf8',
  });
  return output
    .split('\n')
    .filter((line) => !line.endsWith('.d.ts'))
    .filter((line) => SOURCE_EXTENSIONS.some((extension) => line.endsWith(extension)));
}

function isScanned(file: string): boolean {
  if (file.includes('__tests__')) return false;
  if ((SCANNED_FILES as readonly string[]).includes(file)) return true;
  return SCANNED_ROOTS.some((root) => file.startsWith(`${root}/`));
}

function reachesMongo(file: string): boolean {
  const source = stripComments(readFileSync(path.join(BACKEND_ROOT, file), 'utf8'));
  return MONGO_PATTERNS.some((pattern) => pattern.test(source));
}

describe('the runtime cannot reach Mongo', () => {
  const scanned = trackedFiles().filter(isScanned);

  /**
   * Vacuity floor. A broken `git ls-files`, a bad filter, or a rename that
   * empties `SCANNED_ROOTS` all produce an empty scan — and an empty scan
   * passes every assertion below by examining nothing, which is exactly what a
   * clean tree looks like. 250 measured at 55e1ec4a; the floor is deliberately
   * below that so ordinary deletions do not trip it, and far above zero.
   */
  it('scans a plausible number of files', () => {
    expect(scanned.length).toBeGreaterThan(180);
  });

  /** The scan reaches top-level files, which a `**\/*.ts` pathspec would silently drop. */
  it('includes top-level modules, not only nested ones', () => {
    for (const file of SCANNED_FILES) {
      expect(scanned).toContain(file);
    }
  });

  /**
   * The widening past `.ts` is not vacuous.
   *
   * Reverting {@link SOURCE_EXTENSIONS} to `['.ts']` leaves every other
   * assertion in this file green — the tree is clean either way — so nothing
   * else would notice a Mongo reader written in JavaScript becoming invisible
   * again. That is exactly how `scripts/seedCities.js` went unseen. This case
   * fails on the revert, which is the whole point of it.
   */
  it('scans JavaScript sources too, not only TypeScript', () => {
    const javascript = scanned.filter((file) => /\.(js|cjs|mjs)$/.test(file));
    expect(javascript.length).toBeGreaterThan(0);
  });

  /**
   * THE GATE. Any file reaching Mongo must be named in the pending list; the
   * day that list is empty, the secret can come off the task definition.
   */
  it('has no unaccounted Mongo reader', () => {
    const offenders = scanned.filter((file) => reachesMongo(file) && !PENDING_MONGO_FILES.has(file));
    expect(offenders).toEqual([]);
  });

  /**
   * The pending list cannot rot. An entry for a file that no longer reaches
   * Mongo is a port that landed without anyone deleting its line — which would
   * hide the moment the list actually empties, and that moment is the entire
   * point of the list.
   */
  it('has no stale pending entry', () => {
    const stale = [...PENDING_MONGO_FILES.keys()].filter(
      (file) => !scanned.includes(file) || !reachesMongo(file)
    );
    expect(stale).toEqual([]);
  });

  /** Every entry states who removes it, so the list is a plan rather than a tolerance. */
  it('gives a reason for every pending file', () => {
    for (const [file, reason] of PENDING_MONGO_FILES) {
      expect([file, reason.trim().length > 10]).toEqual([file, true]);
    }
  });

  /**
   * The detector must actually detect. Mutation-tested by construction rather
   * than by editing a file: each pattern is run against source that should
   * match and source that should not, so a pattern broken into never matching
   * cannot pass as a clean tree.
   */
  it('detects each import shape it claims to', () => {
    const positives = [
      "import mongoose from 'mongoose';",
      'const mongoose = require("mongoose");',
      "import { Billing } from '../models';",
      "import { Property } from '../../models/schemas/PropertySchema';",
      "import database from '../database/connection';",
      // The COMPILED barrel, reached by `require` — the exact line
      // `scripts/seedCities.js` carried while this gate reported a clean tree.
      "const { City } = require('../dist/models/index');",
      "const { Billing } = require('../models');",
      "const database = require('../database/connection');",
    ];
    for (const source of positives) {
      expect([source, MONGO_PATTERNS.some((p) => p.test(source))]).toEqual([source, true]);
    }

    const negatives = [
      "import { db } from '../db';",
      "import { properties } from '../db/schema';",
      "// import mongoose from 'mongoose';",
      "/* this module no longer imports from '../models' */",
      "import { modelsAreGone } from './modelsAreGone';",
      // The `require` half needs its own negatives, or a pattern widened to
      // match every `require(...)` would pass the positives above and be caught
      // by nothing.
      "const { db } = require('../db');",
      "const schema = require('../db/schema');",
      "const { modelsAreGone } = require('./modelsAreGone');",
    ];
    for (const source of negatives) {
      const stripped = stripComments(source);
      expect([source, MONGO_PATTERNS.some((p) => p.test(stripped))]).toEqual([source, false]);
    }
  });
});

describe('boot does not require Mongo', () => {
  /**
   * `MONGODB_URI` read at startup is what made the secret load-bearing. Nothing
   * reads it, the variable is off the task definition, and
   * `/oxy/homiio/MONGODB_URI` is deleted from SSM.
   *
   * Split from the import gate deliberately: a file can import nothing from
   * Mongo and still demand the variable, and the two were removed by different
   * changes. The `db/backfill/` exemption that used to sit on this filter is
   * gone with the backfill itself — reading the OLD database by URL was the
   * whole of its job, and that database no longer exists.
   *
   * Scans EVERY tracked source file, not only the scanned roots: a stray
   * `process.env.MONGODB_URI` anywhere is a demand for a secret nobody can
   * supply, and there is no longer any directory where that is legitimate.
   */
  it('names every production module reading MONGODB_URI', () => {
    const readers = trackedFiles()
      .filter((file) => !file.includes('__tests__'))
      .filter((file) => stripComments(readFileSync(path.join(BACKEND_ROOT, file), 'utf8')).includes('MONGODB_URI'));

    expect(readers).toEqual([]);
  });
});
