import { execFileSync } from 'child_process';
import { readFileSync } from 'fs';
import path from 'path';

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
 * ## Why an affirmative scan
 *
 * Enumeration is `git ls-files`, never a directory walk, so the scan cannot
 * disagree with the set git actually tracks and build output is excluded for
 * free rather than by an ignore list that rots. The scanned roots are an
 * AFFIRMATIVE list of what must be Mongo-free, rather than "everything minus
 * known binaries" — a new directory cannot silently widen the exemption; it is
 * simply not scanned until somebody adds it here on purpose.
 */

const BACKEND_ROOT = path.join(__dirname, '..', '..');

/**
 * The roots that must be Mongo-free. Affirmative on purpose — see the header.
 *
 * `db/` is scanned EXCEPT `db/backfill/`, which is exempted structurally rather
 * than by name: the backfill's entire job is reading Mongo and copying it into
 * Postgres, so it is the one place a Mongo client is correct. It retires with
 * the source database, not with this gate.
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

/** Top-level files that are equally load-bearing and would otherwise be missed. */
const SCANNED_FILES = ['server.ts', 'worker.ts', 'config.ts', 'database/connection.ts'] as const;

/**
 * The backfill, exempt because reading Mongo is its purpose.
 *
 * A prefix rather than a filename, so a new backfill module does not have to be
 * remembered — and narrow enough that nothing outside `db/backfill/` inherits it.
 */
const BACKFILL_PREFIX = 'db/backfill/';

/**
 * Files that still reach Mongo, each with the agent or reason that will remove
 * it. DELETE a line when its port lands; an empty list is the signal that
 * `MONGODB_URI` can come off the task definition.
 *
 * Measured at origin/main 55e1ec4a.
 */
const PENDING_MONGO_FILES: ReadonlyMap<string, string> = new Map([
  ['controllers/billingController.ts', 'homiio-billing — task #40, ~30 Billing call sites'],
  ['routes/profiles.ts', 'homiio-billing — 3 Billing sites incl. a `new Billing({...})` write'],
  ['controllers/analyticsController.ts', 'analytics port in flight'],
  ['controllers/roommateController.ts', 'homiio-reviews-roommates — roommates + profiles'],
  ['services/geoResolutionService.ts', 'homiio-property-writes — geo services'],
  ['scripts/requeue-pisos-coordinates.ts', 'homiio-property-writes — live tooling, needs a real port'],
  ['scripts/seedImages.ts', 'unassigned — decide port vs delete like the other one-offs'],
  ['services/healthService.ts', 'reports Mongo connectivity; retires with the connection itself'],
  ['database/connection.ts', 'the Mongo connection module; deleted last, with models/'],
  // The two ENTRYPOINTS, and the reason the secret is still load-bearing:
  // each imports `database/connection` and calls `database.connect()` at boot
  // (server.ts:117 and :192, worker.ts:513). No model import — which is why a
  // census that greps only for `models/` misses them entirely. These are the
  // last two lines to delete, and deleting them is what makes the runtime
  // genuinely unable to open a connection.
  ['server.ts', 'calls database.connect() at boot — remove with database/connection.ts'],
  ['worker.ts', 'calls database.connect() at boot — remove with database/connection.ts'],
  ['scripts/seedProperties.ts', 'unassigned — decide port vs delete like the other one-offs'],
]);

/**
 * A file "reaches Mongo" if it imports mongoose or the Mongoose model barrel,
 * or opens a connection.
 *
 * Matched against COMMENT-STRIPPED source, because several modules in this
 * repository document what they no longer do in exactly this vocabulary — a
 * raw-text scan matches their own explanation and fails on correct code. That
 * is not hypothetical: it happened while writing a sibling gate today.
 */
const MONGO_PATTERNS: readonly RegExp[] = [
  /\bfrom\s+['"]mongoose['"]/,
  /\brequire\(\s*['"]mongoose['"]\s*\)/,
  /\bfrom\s+['"][^'"]*\/models['"]/,
  /\bfrom\s+['"][^'"]*\/models\/[^'"]*['"]/,
  /\bfrom\s+['"][^'"]*database\/connection['"]/,
];

function trackedFiles(): string[] {
  const output = execFileSync('git', ['ls-files', '--', '.'], {
    cwd: BACKEND_ROOT,
    encoding: 'utf8',
  });
  return output.split('\n').filter((line) => line.endsWith('.ts'));
}

/** Strip line and block comments. Crude by design — it only has to remove prose. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

function isScanned(file: string): boolean {
  if (file.includes('__tests__')) return false;
  if (file.startsWith(BACKFILL_PREFIX)) return false;
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
    ];
    for (const source of negatives) {
      const stripped = stripComments(source);
      expect([source, MONGO_PATTERNS.some((p) => p.test(stripped))]).toEqual([source, false]);
    }
  });
});

describe('boot does not require Mongo', () => {
  /**
   * `MONGODB_URI` read at startup is what makes the secret still load-bearing.
   * This does not fail today — `config.ts` still reads it — so it names the
   * location instead, and becomes an equality the day that line goes.
   *
   * Split from the import gate deliberately: a file can import nothing from
   * Mongo and still demand the variable, and the two are removed by different
   * changes.
   */
  it('names every production module reading MONGODB_URI', () => {
    const readers = trackedFiles()
      .filter((file) => !file.includes('__tests__') && !file.startsWith(BACKFILL_PREFIX))
      .filter((file) => stripComments(readFileSync(path.join(BACKEND_ROOT, file), 'utf8')).includes('MONGODB_URI'));

    // Exactly one, and it is the config reader. When this becomes `[]`, the
    // variable can be removed from the environment as well as the code.
    expect(readers).toEqual(['config.ts']);
  });
});
