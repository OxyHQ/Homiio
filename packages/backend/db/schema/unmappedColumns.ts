/**
 * Columns With No Mongo Source
 *
 * The mirror image of the backfill's `UncarriedField` list. That one records a
 * SOURCE field with no target column (`coverImageIndex`); this one records a
 * TARGET column with no source field — a column the copy will never write,
 * because there is nothing on the Mongo side to write from.
 *
 * ## Why it needs a registry rather than a comment
 *
 * The backfill's column-coverage check runs in BOTH directions, and the
 * over-population direction is the one that matters here: a column the source
 * never had is a column a copier can only fill by INVENTING a value, and an
 * invented value is worse than a NULL because a NULL is obviously absent. So
 * the check has to be able to tell "this column was left empty on purpose" from
 * "this column was missed", and a list of names in a doc comment cannot answer
 * that question mechanically.
 *
 * Every entry is therefore an assertion with two halves: the column really has
 * no source, AND leaving it at its declared default is the correct outcome of
 * the copy. `__tests__/db/unmappedColumns.test.ts` checks that each named
 * property exists on its table — an entry naming a column that is not there
 * protects nothing and reports nothing, the same failure mode
 * `protectedColumns.ts` guards against.
 *
 * ## Both entries are the same bug, seen from the database
 *
 * `views` and `title` are not new features. They are fields the PRODUCT already
 * believes in — `retrieve.ts:31` and `roomController.ts:203` both issue
 * `$inc: { views: 1 }`, and a 43.51 MiB Mongo text index has been indexing
 * `title` — and that mongoose STRICT MODE has been silently discarding, because
 * neither is declared in `PropertySchema`. The census measured both as absent
 * on all 17,644 rows.
 *
 * Declaring them here rather than leaving them out is a deliberate choice, and
 * it is the cheaper one: adding a column to `properties` later is a migration
 * against the largest table in the schema, while the two facts that make them
 * safe to declare now — that they have no data and that the code which will
 * fill them already exists — are measured rather than hoped for.
 */

import type { PgTable } from 'drizzle-orm/pg-core';
import { properties } from './properties';

/** A column the backfill deliberately never writes. */
export interface UnmappedColumn {
  readonly table: PgTable;
  /** The TypeScript property name on the table. */
  readonly property: string;
  /** Why there is no source field, and why the declared default is the right answer. */
  readonly reason: string;
}

export const UNMAPPED_COLUMNS: readonly UnmappedColumn[] = [
  {
    table: properties,
    property: 'views',
    reason:
      'ABSENT on all 17,644 production rows. `views` is not declared in ' +
      '`PropertySchema`, so mongoose strict mode strips it out of ' +
      '`findByIdAndUpdate(id, { $inc: { views: 1 } })` — every view increment ' +
      'this product has ever issued was an empty update, at ' +
      '`controllers/property/retrieve.ts:31` and ' +
      '`controllers/roomController.ts:203`. (0 of 17,644 is CONSISTENT with ' +
      'silent discard but does not prove it on its own; what closes it is the ' +
      'code — the field is simply not in the schema.) There is nothing to ' +
      'copy, so every listing starts at 0 and a later batch restores the ' +
      'writer as `UPDATE … SET views = views + 1`. Counting beginning after ' +
      'the cutover is an EXPECTED condition, not a defect to diagnose.',
  },
  {
    table: properties,
    property: 'title',
    reason:
      'ABSENT on all 17,644 production rows, for the same reason as `views`: ' +
      'not declared in `PropertySchema`, and `IngestionService` never writes ' +
      'it (zero occurrences of `title` in that file). Mongo nonetheless ' +
      'carries a `title_text_description_text` index spending 43.51 MiB — 89% ' +
      'of the whole collection\'s index footprint — indexing a field that ' +
      'exists on no document. The consequence is recorded on ' +
      '`properties.search_vector`, which covers `description` ALONE: ' +
      'weighting a field with no data would copy the phantom index into ' +
      'Postgres. Nullable rather than defaulted, because "no headline" is a ' +
      'real state a listing can be in.',
  },
];
