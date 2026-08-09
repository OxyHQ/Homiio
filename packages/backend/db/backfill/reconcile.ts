/**
 * `--reconcile` — bring Postgres back into line with Mongo, including DELETIONS.
 *
 * ## This is a BRIDGE, and it must not be mistaken for a supported dual-run
 *
 * The catalogue READS from Postgres while every write still goes to Mongoose, so
 * the two stores drift the moment the ingest worker touches anything. Measured
 * in production ~70 minutes after the copy: 54 properties deleted from Mongo and
 * still being served from Postgres — ghost listings a user can click — plus two
 * updates that never arrived. Roughly 17 deletions an hour.
 *
 * The backfill cannot fix that BY DESIGN. `ON CONFLICT DO NOTHING` over verbatim
 * ids propagates neither an update nor a deletion, so a re-run is a no-op. That
 * is correct for a copy and the wrong tool for drift.
 *
 * **It runs until the property write path lands, and then it stops being a
 * sync.** Once Postgres is the only writer there is nothing to reconcile, and
 * this becomes the VERIFICATION path — the thing that proves the two stores
 * agree during the retirement of the Mongo one, not the thing that makes them
 * agree. Nobody should read it as sanctioning writes to both.
 *
 * ## Deletion is the dangerous half, so it is the careful one
 *
 * An under-counting source query and a genuine mass deletion are
 * INDISTINGUISHABLE from inside this process: both look like "the source has
 * fewer ids than the target". So deletion is gated on a shrink threshold
 * measured against the target's own current count — which IS the previous run's
 * result, so no state has to be carried — and every id is logged before any of
 * them is removed.
 *
 * The threshold direction matters: it fails toward KEEPING rows. A run that
 * refuses leaves ghosts for another hour; a run that deletes wrongly destroys
 * rows whose source is gone and cannot be re-copied.
 *
 * ## Order is the copy's, reversed
 *
 * Upserts run parent-first, exactly as the copy does. Deletes run CHILD-FIRST,
 * which for these tables means the reverse collection order: a property must go
 * before the `addresses` row it references (`RESTRICT`) and before the `images`
 * its `property_images` rows reference (`RESTRICT` again). The child TABLES of a
 * property need no special handling — `property_images`, `property_documents`
 * and `property_availability_windows` are all `ON DELETE CASCADE`, so removing
 * the listing takes them with it.
 */

import { eq, getTableColumns, inArray, sql } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';
import { Logger } from '../../utils/logger';
import type { Database } from '../postgres';
import { sameValue } from './geo';
import { columnNames } from './geoPlan';
import type { CandidateRow } from './rowAudit';

const logger = new Logger('DataReconcile');

/** Ids per statement when reading or deleting by id. */
const BATCH_IDS = 1_000;

/** Ids named in the log before a delete. Enough to recognise the shape. */
const MAX_LOGGED_DELETIONS = 20;

/**
 * How far the source may shrink relative to the target before deletion refuses.
 *
 * 2% of `properties` is ~350 rows against an observed drift of 54 (0.3%) — well
 * clear of normal churn, and nowhere near the shape of a query bug, which
 * returns a fraction of the ids rather than a few hundred fewer. A source that
 * reads EMPTY is caught by the same test, which is the case that would otherwise
 * delete the entire catalogue.
 */
export const MAX_SOURCE_SHRINK = 0.02;

/**
 * Surplus rows always permitted, however small the table.
 *
 * A share alone is the wrong shape at small N: one row gone from a ten-row table
 * is 10%, which is ordinary churn and which a percentage gate refuses — making
 * the tool useless on exactly the tables where a mistake is cheapest. The
 * allowance is therefore `max(share, floor)`.
 *
 * 100 against production's observed 54 deletions an hour leaves room for a
 * backlog without ever approaching the shape of a broken query, which returns a
 * FRACTION of the ids rather than a hundred fewer.
 */
export const ABSOLUTE_SURPLUS_FLOOR = 100;

/**
 * How many surplus rows may be removed before the guard refuses.
 *
 * A TOTAL wipe is refused unconditionally and at any size: "the source returned
 * nothing" and "everything was deleted" are the same observation from here, and
 * one of them is a bug in this process. That case is what a share-based gate
 * misses on a small table, where 100% is still under the absolute floor.
 */
export function deletionAllowance(stored: number): number {
  return Math.max(Math.floor(stored * MAX_SOURCE_SHRINK), ABSOLUTE_SURPLUS_FLOOR);
}

/**
 * Whether the stored row is newer than the one the mappers produced.
 *
 * Compared on `updatedAt`, which both sides carry and which the copy preserves
 * verbatim — so the question is "which store wrote this row last", answered by
 * the value each store recorded rather than by a clock this process reads.
 *
 * A row with no usable timestamp on either side is NOT treated as newer: the
 * comparison cannot be made, and refusing to update on an unanswerable question
 * would silently stop reconciling those rows forever.
 */
export function isTargetNewer(source: CandidateRow, target: CandidateRow): boolean {
  const sourceAt = source.updatedAt;
  const targetAt = target.updatedAt;
  if (!(sourceAt instanceof Date) || !(targetAt instanceof Date)) return false;
  return targetAt.getTime() > sourceAt.getTime();
}

/** Whether removing `surplus` of `stored` rows is permitted. */
export function mayDelete(surplus: number, stored: number): boolean {
  if (stored > 0 && surplus >= stored) return false;
  return surplus <= deletionAllowance(stored);
}

/**
 * A row that could have come from Mongo, decided by the SHAPE of its id.
 *
 * ## The bug this exists to make impossible
 *
 * "Absent from the source" means two completely different things after the write
 * path lands, and only one of them is a ghost:
 *
 *  - a row copied from Mongo whose document has since been DELETED — a ghost,
 *    and the thing this mode removes;
 *  - a row CREATED in Postgres, which was never in Mongo and never will be.
 *
 * Deleting the second is destroying live data in the authoritative store, with
 * no source left to re-copy it from. The two are indistinguishable by absence
 * alone, so they have to be told apart some other way.
 *
 * ## Why the id SHAPE and not `created_at`
 *
 * `db/ids.ts` states the invariant this rests on: every primary key is `text`
 * holding a 24-char ObjectId hex for rows that existed before the cutover, and a
 * uuid v7 for every row created after it. `generatedId()` mints the uuid; no
 * write path can produce an ObjectId hex for a new row, and no copied row can
 * carry anything else, because the backfill copies `_id` verbatim.
 *
 * That makes the test STRUCTURAL — it depends on how the id was made, not on a
 * clock. A `created_at` filter would depend on the copy's own timestamps being
 * trustworthy and on picking a cutover instant, and both of those are exactly
 * the kind of thing that is off by an hour at 3am. This one cannot be off by an
 * hour.
 *
 * It is also permanent rather than a property of this week: it stays correct
 * long after the current window (in which Postgres has created nothing at all,
 * so the ambiguity is empty) has closed.
 */
const MONGO_ID_SHAPE = /^[0-9a-f]{24}$/i;

/** Whether this id could have come from Mongo, and so may be considered for
 *  deletion. See {@link MONGO_ID_SHAPE}. */
export function couldHaveComeFromMongo(id: string): boolean {
  return MONGO_ID_SHAPE.test(id);
}

/** What one table's reconciliation did. */
export interface ReconcileTableReport {
  readonly table: string;
  readonly inserted: number;
  readonly updated: number;
  readonly deleted: number;
  readonly unchanged: number;
  /** Columns that differed, and on how many rows — what actually drifted. */
  readonly columns: Readonly<Record<string, number>>;
  /** Set when deletion was refused, saying why. */
  readonly deletionRefused: string | null;
  /**
   * Rows absent from the source that were NOT considered for deletion, because
   * their id shape says they were created in Postgres.
   *
   * Reported rather than silently skipped: an exclusion nobody can see is
   * indistinguishable from a filter that never ran.
   */
  readonly retainedPostCutover: number;
  /** Ids this run removed, or WOULD remove under `--dry-run`. */
  readonly deletions: readonly string[];
  /**
   * Rows left alone because the TARGET's `updated_at` is NEWER than the
   * source's — a live write this must not roll back.
   */
  readonly skippedTargetNewer: number;
}

/**
 * Bring one table's rows into line with the rows the mappers just produced.
 *
 * `scopedTo` bounds what deletion may consider. For a collection's PARENT table
 * it is the whole table — every id the source no longer has is a ghost. For a
 * CHILD table it must be the parents in this chunk, because rows belonging to
 * parents the chunk never looked at are not absent, they are simply out of view;
 * deleting those would empty the table one chunk at a time.
 *
 * @returns Counts per category. `unchanged` is reported rather than inferred
 *   because a reconciliation that only reports what it changed cannot tell a
 *   converged run from one that examined nothing.
 */
export async function reconcileTable(options: {
  readonly database: Database;
  readonly table: PgTable;
  readonly tableName: string;
  readonly produced: readonly CandidateRow[];
  /** The rows deletion may consider, or `null` for the whole table. */
  readonly scopedTo: { readonly column: string; readonly parentIds: readonly string[] } | null;
  /** Whether this run may delete at all. */
  readonly allowDeletes: boolean;
  /** Decide and report everything, write nothing. */
  readonly dryRun: boolean;
}): Promise<ReconcileTableReport> {
  const { database, table, tableName, produced, scopedTo, allowDeletes, dryRun } = options;
  const columns = getTableColumns(table);
  const idColumn = columns.id;
  const writable: string[] = columnNames(table).filter(
    (column: string) => column !== 'id' && columns[column]?.generated === undefined,
  );

  const rows = produced.filter(
    (row): row is CandidateRow & { id: string } => typeof row.id === 'string',
  );
  const byId = new Map(rows.map((row) => [row.id, row]));

  // Read what is REALLY stored rather than trusting what an earlier step
  // believes it wrote — the same reason the copy verifies by reading back.
  const stored = new Map<string, CandidateRow>();
  const scopeIds = scopedTo?.parentIds ?? [];
  if (scopedTo === null) {
    for (let start = 0; start < rows.length; start += BATCH_IDS) {
      const batch = rows.slice(start, start + BATCH_IDS).map((row) => row.id);
      for (const row of await database.select().from(table).where(inArray(idColumn, batch))) {
        stored.set(String((row as CandidateRow).id), row as CandidateRow);
      }
    }
  } else {
    for (let start = 0; start < scopeIds.length; start += BATCH_IDS) {
      const batch = scopeIds.slice(start, start + BATCH_IDS);
      const parent = columns[scopedTo.column];
      for (const row of await database.select().from(table).where(inArray(parent, batch))) {
        stored.set(String((row as CandidateRow).id), row as CandidateRow);
      }
    }
  }

  let inserted = 0;
  let updated = 0;
  let unchanged = 0;
  let skippedTargetNewer = 0;
  const differing: Record<string, number> = {};

  for (const row of rows) {
    const current = stored.get(row.id);
    if (current === undefined) {
      // `onConflictDoNothing` is only meaningful because every id here is either
      // copied verbatim from Mongo or DETERMINISTICALLY minted (#318) — a random
      // mint would make the conflict clause unreachable, so a re-run would insert
      // duplicates while reporting convergence.
      if (!dryRun) {
        await database
          .insert(table)
          .values(row as PgTable['$inferInsert'])
          .onConflictDoNothing();
      }
      inserted += 1;
      continue;
    }

    // A column the mapper never SETS is not a difference. It takes the column's
    // DEFAULT on insert, so the stored value is what the schema chose and there
    // is nothing to compare it against — `properties.has_images` is derived by
    // `db/hasImages.ts`, `views` is application state, `title` has no Mongo
    // source at all. Comparing them reports every row as changed on every run,
    // which is both a lie and a rewrite of all three columns.
    //
    // Where the column has NO default, `undefined` does mean NULL and IS
    // compared: that is the difference between "the schema filled this in" and
    // "the copy lost it".
    const comparable = writable.filter(
      (column: string) => row[column] !== undefined || columns[column]?.hasDefault !== true,
    );
    // `?? null` on BOTH sides. For a nullable column with no default an omitted
    // key stores NULL, so `undefined` and `null` are the same fact here — and
    // without this every row differs on `properties.title`, which has no Mongo
    // source at all and is therefore `undefined` in every mapped row and NULL in
    // every stored one.
    const changed = comparable.filter(
      (column: string) => !sameValue(row[column] ?? null, current[column] ?? null),
    );
    if (changed.length === 0) {
      unchanged += 1;
      continue;
    }

    // NEVER roll a live write back.
    //
    // This mode was written while Mongo was the only writer, so "the source
    // differs" meant "the target is stale". Once the write path moved, that
    // stopped being true in one direction: the target can now be AHEAD, and
    // applying the source over it undoes work the authoritative store just did.
    //
    // Measured the hour the write path landed: of three differing properties,
    // TWO were newer in Postgres — the ingest worker refreshing `expires_at`
    // against the new authority — and a blind apply would have moved both
    // deadlines backwards by about an hour, into the path of the expiry sweep.
    //
    // So the rule is directional rather than symmetric: reconciliation may only
    // ever carry a STALE target forward. A target that is ahead is not drift, it
    // is the future, and it is skipped and counted.
    if (isTargetNewer(row, current)) {
      skippedTargetNewer += 1;
      continue;
    }
    for (const column of changed) differing[column] = (differing[column] ?? 0) + 1;

    // EVERY writable column, not only the ones that differ. `updated_at` carries
    // drizzle's `$onUpdate`, so an update that does not name it stamps the row
    // with this process's clock and destroys the historical value the migration
    // exists to preserve — the trap `CONVENTIONS.md` was corrected to name, and
    // the reason `geo.ts`'s reconcile writes whole rows too.
    if (!dryRun) {
      await database
        .update(table)
        .set(Object.fromEntries(comparable.map((column: string) => [column, row[column]])))
        .where(eq(idColumn, row.id));
    }
    updated += 1;
  }

  // ── deletion ──
  const absent = [...stored.keys()].filter((id) => !byId.has(id));
  // A row created in Postgres was never in Mongo, so its absence says nothing.
  // Removing it would destroy live data in the authoritative store.
  const surplus = absent.filter((id) => couldHaveComeFromMongo(id));
  const retainedPostCutover = absent.length - surplus.length;
  if (retainedPostCutover > 0) {
    logger.info(
      `${tableName}: ${retainedPostCutover} row(s) absent from the source were RETAINED — ` +
      'their id shape says they were created in Postgres, not copied from Mongo',
    );
  }
  let deleted = 0;
  let deletionRefused: string | null = null;

  if (surplus.length > 0) {
    if (!allowDeletes) {
      deletionRefused = `${surplus.length} surplus row(s) left in place: deletion was not authorised for this table`;
    } else {
      if (!mayDelete(surplus.length, stored.size)) {
        // Fails toward KEEPING rows. A refused run leaves ghosts for another
        // hour; a wrong delete destroys rows whose source is already gone.
        deletionRefused =
          `${surplus.length} of ${stored.size} stored row(s) are absent from the source, ` +
          `above the allowance of ${deletionAllowance(stored.size)} ` +
          `(the greater of ${MAX_SOURCE_SHRINK * 100}% and ${ABSOLUTE_SURPLUS_FLOOR}); ` +
          'a TOTAL wipe is refused at any size. A source query returning too few ' +
          'ids and a genuine mass deletion look identical from here, so nothing ' +
          'was removed. Re-run once the difference is understood.';
        logger.error(`${tableName}: ${deletionRefused}`);
      } else {
        // Logged BEFORE the delete, so the record survives a run that then fails.
        logger.warn(
          `${tableName}: ${dryRun ? 'WOULD remove' : 'removing'} ${surplus.length} row(s) ` +
          'absent from the source',
          {
            ids: surplus.slice(0, MAX_LOGGED_DELETIONS),
            truncated: Math.max(0, surplus.length - MAX_LOGGED_DELETIONS),
          },
        );
        for (let start = 0; start < surplus.length; start += BATCH_IDS) {
          const batch = surplus.slice(start, start + BATCH_IDS);
          if (!dryRun) await database.delete(table).where(inArray(idColumn, batch));
          deleted += batch.length;
        }
      }
    }
  }

  const report: ReconcileTableReport = {
    table: tableName,
    inserted,
    updated,
    deleted,
    unchanged,
    columns: differing,
    deletionRefused,
    retainedPostCutover,
    deletions: deletionRefused === null ? surplus : [],
    skippedTargetNewer,
  };
  logger.info(`Reconciled ${tableName}`, report);
  return report;
}

/**
 * Every target id a collection's parent table holds that the source no longer
 * has.
 *
 * Read from the TARGET rather than diffed against the produced rows, because the
 * produced set only covers documents the stream actually saw — and "the stream
 * saw fewer documents than exist" is the failure this whole guard is about.
 */
export async function findSurplusIds(
  database: Database,
  table: PgTable,
  sourceIds: readonly string[],
): Promise<string[]> {
  const idColumn = getTableColumns(table).id;
  if (sourceIds.length === 0) {
    // Every row is surplus, which is exactly the shape that must never delete
    // silently. Returned honestly; the caller's shrink guard refuses it.
    const all = await database.select({ id: idColumn }).from(table);
    return all.map((row) => String(row.id));
  }

  const surplus: string[] = [];
  // `notInArray` against the whole source set in one statement would bind
  // 172,000 parameters. Chunking the SOURCE side is wrong — a row absent from
  // one chunk is present in another — so the TARGET is walked instead and each
  // id tested against an in-memory set.
  const known = new Set(sourceIds);
  const rows = await database.select({ id: idColumn }).from(table);
  for (const row of rows) {
    const id = String(row.id);
    if (!known.has(id)) surplus.push(id);
  }
  return surplus;
}

/** A count of rows in a table, for the shrink guard's denominator. */
export async function countTable(database: Database, table: PgTable): Promise<number> {
  const [row] = await database.execute<{ count: string }>(
    sql`select count(*)::text as count from ${table}`,
  );
  return Number(row?.count ?? 0);
}
