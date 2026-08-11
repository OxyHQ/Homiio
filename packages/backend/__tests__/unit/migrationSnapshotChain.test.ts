/**
 * The drizzle-kit SNAPSHOT chain, asserted as a chain.
 *
 * ## The failure this exists to catch, measured on `main`
 *
 * Two branches generate a migration off the same parent and are merged in
 * sequence. Nothing recomputes a snapshot, so both end up naming the SAME
 * `prevId` and the chain forks. Measured on `main` at `0a9a53f6`: `#356`
 * (watches → 0012) and `#358` (evictions → 0013) were both generated off 0011,
 * and `0013_snapshot.json` carried `prevId = c209c091…`, which is **0011's** id.
 *
 * The visible symptom is that `drizzle-kit generate` refuses to run at all:
 *
 *     Error: [drizzle/meta/0012_snapshot.json, drizzle/meta/0013_snapshot.json]
 *     are pointing to a parent snapshot: … which is a collision.
 *
 * **The dangerous half is the one that is not visible.** The later snapshot is a
 * full picture of the schema, and it was taken on a tree that never had the
 * earlier migration's objects — so `0013_snapshot.json` described 69 tables and
 * was missing all three of 0012's (`housing_alerts`, `housing_domain_events`,
 * `housing_watch_rules`) plus 0012's nine `saved_searches` columns. Once the
 * pointer is repaired but the CONTENT is not, the next generated migration
 * re-emits those objects, and since the deploy applies migrations
 * (`430f8ff2`) that is a release that fails at apply time with "relation already
 * exists" — not a confusing local error.
 *
 * ## Why a test rather than a convention
 *
 * Nothing recomputes a snapshot. The break sat on `main` from the moment #358
 * merged until somebody needed a 0014, and no test, no build and no deploy could
 * have noticed: a FRESH database applies every migration in order and never
 * reads a snapshot's contents, so CI and the per-worker throwaway databases pass
 * either way. The disagreement exists only against a database that already has
 * the migrations applied — which is production, and only production.
 *
 * This file reads the files themselves and needs no database, which is why it is
 * a unit test: it is checking a property of the repository, not of a server.
 *
 * ## One thing this deliberately does NOT check, and how that was established
 *
 * A first draft also asserted that every migration declares an
 * `oxy:deploy-phase` marker. Mutation-testing it — stripping the marker from
 * `0014` — killed the run, but **not through that assertion**: `@oxyhq/db`'s
 * migrator refuses an unmarked migration, and the jest harness migrates a
 * throwaway database in `globalSetup`, so the run dies before any test executes.
 * The assertion could therefore never be the thing that failed.
 *
 * It was removed rather than kept as a restatement. The migrator's check is
 * strictly stronger — it runs at APPLY time, in production, not only where the
 * harness happens to migrate — and an assertion that cannot fire is worse than
 * no assertion, because a reader takes it for a gate.
 */

import * as fs from 'fs';
import * as path from 'path';

import * as schema from '../../db/schema';
import { getTableName } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';

const MIGRATIONS_DIR = path.join(__dirname, '..', '..', 'drizzle');
const META_DIR = path.join(MIGRATIONS_DIR, 'meta');

/**
 * Floors, so a broken traversal cannot pass over nothing.
 *
 * `expect([]).toEqual([])` on an empty file list is exactly what a wrong path or
 * a changed filename produces, and it is indistinguishable from a clean chain.
 * Both numbers are MINIMUMS: adding a migration needs no edit here, removing one
 * does.
 */
const MINIMUM_SNAPSHOTS = 15;
const MINIMUM_TABLES = 72;

interface Snapshot {
  readonly file: string;
  readonly index: number;
  readonly id: string;
  readonly prevId: string;
  readonly tables: ReadonlySet<string>;
}

function readSnapshots(): Snapshot[] {
  return fs
    .readdirSync(META_DIR)
    .filter((file) => /^\d{4}_snapshot\.json$/.test(file))
    .sort()
    .map((file) => {
      const parsed = JSON.parse(fs.readFileSync(path.join(META_DIR, file), 'utf8')) as {
        id: string;
        prevId: string;
        tables: Record<string, unknown>;
      };
      return {
        file,
        index: Number(file.slice(0, 4)),
        id: parsed.id,
        prevId: parsed.prevId,
        // Keys are `public.<name>`; the qualifier is dropped so this compares
        // against the schema barrel's own names.
        tables: new Set(Object.keys(parsed.tables).map((key) => key.split('.').pop() ?? key)),
      };
    });
}

/** Every table the barrel exports — the same enumeration the db gates use. */
function declaredTableNames(): Set<string> {
  const exported: unknown[] = Object.values(schema);
  const tables = exported.filter(
    (value): value is PgTable =>
      typeof value === 'object' && value !== null && Symbol.for('drizzle:Name') in value,
  );
  return new Set(tables.map(getTableName));
}

describe('the drizzle snapshot chain', () => {
  it('finds every snapshot on disk', () => {
    // The floor. A wrong directory or a changed filename pattern yields an empty
    // list, over which every assertion below passes silently.
    const snapshots = readSnapshots();
    expect(snapshots.length).toBeGreaterThanOrEqual(MINIMUM_SNAPSHOTS);
    expect(snapshots.map((snapshot) => snapshot.index)).toEqual(
      snapshots.map((_, position) => position),
    );
  });

  it('gives every snapshot exactly one predecessor, and no two the same parent', () => {
    // THE assertion. Two branches generated off one parent and merged in
    // sequence leave two snapshots naming the same `prevId`; nothing recomputes
    // a snapshot, so it sits there until somebody needs the next migration.
    const snapshots = readSnapshots();

    const wrongParent = snapshots
      .slice(1)
      .filter((snapshot, position) => snapshot.prevId !== snapshots[position].id)
      .map((snapshot) => `${snapshot.file} names prevId ${snapshot.prevId}`);
    expect(wrongParent).toEqual([]);

    // Stated separately rather than folded into the check above, because it is
    // the condition drizzle-kit itself reports and the wording a reader will be
    // searching for when they hit "are pointing to a parent snapshot … which is
    // a collision".
    const parents = snapshots.slice(1).map((snapshot) => snapshot.prevId);
    const shared = parents.filter((parent, position) => parents.indexOf(parent) !== position);
    expect(shared).toEqual([]);

    // Ids must be distinct too: two snapshots sharing an id would satisfy the
    // chain above while making "which one is the parent" unanswerable.
    const ids = snapshots.map((snapshot) => snapshot.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('leaves the head snapshot describing exactly the tables the schema declares', () => {
    // The CONSEQUENCE, caught independently of the cause. A forked chain is
    // repaired by fixing a pointer, and a pointer fix alone leaves the head
    // snapshot still missing the other branch's objects — which is the half that
    // reaches production. This compares the head against the schema barrel,
    // which is what the migrations are supposed to have built.
    const snapshots = readSnapshots();
    const head = snapshots[snapshots.length - 1];
    const declared = declaredTableNames();

    // Floors on both sides, for the same reason as above.
    expect(declared.size).toBeGreaterThanOrEqual(MINIMUM_TABLES);
    expect(head.tables.size).toBeGreaterThanOrEqual(MINIMUM_TABLES);

    const missingFromSnapshot = [...declared].filter((name) => !head.tables.has(name)).sort();
    const missingFromSchema = [...head.tables].filter((name) => !declared.has(name)).sort();
    expect({ missingFromSnapshot, missingFromSchema }).toEqual({
      missingFromSnapshot: [],
      missingFromSchema: [],
    });
  });

  it('has a journal entry for every migration file, and a file for every entry', () => {
    // Not the snapshot chain, but the same class of drift and free to check
    // here: the journal is what the MIGRATOR reads, and a `.sql` file absent
    // from it is never applied while an entry with no file fails the run.
    const journal = JSON.parse(
      fs.readFileSync(path.join(META_DIR, '_journal.json'), 'utf8'),
    ) as { entries: Array<{ idx: number; tag: string }> };
    const tags = journal.entries.map((entry) => entry.tag);
    expect(tags.length).toBeGreaterThanOrEqual(MINIMUM_SNAPSHOTS);

    const files = fs
      .readdirSync(MIGRATIONS_DIR)
      .filter((file) => file.endsWith('.sql'))
      .map((file) => file.replace(/\.sql$/, ''))
      .sort();
    expect(tags.slice().sort()).toEqual(files);
    // The journal's own order must be its index order, since that is the order
    // the migrator applies in.
    expect(journal.entries.map((entry) => entry.idx)).toEqual(
      journal.entries.map((_, position) => position),
    );
  });
});
