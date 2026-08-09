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
 * ## The registry is READ by the backfill, and the two roommate entries are why
 *
 * It was documentation until the roommate port. The copy's verifier and
 * `--reconcile` both handled `views` and `title` by a HEURISTIC —
 * `views` is `NOT NULL DEFAULT 0` so an omitted key is skipped as
 * "the schema decided this", and `title` is nullable with nothing writing it,
 * so an omitted key and a stored NULL agree. Neither escape works for a column
 * that has no default AND that the application really writes: the verifier
 * reads a value where it expected NULL and reports a fidelity MISMATCH, which
 * fails the run (`data.ts:1400`), and `--reconcile` reports the row as
 * differing on every pass.
 *
 * `settings_roommate_preferences_location` is exactly that shape — nullable, no
 * default, and written by `PUT /api/roommates/preferences` from the day the
 * roommate port ships, while Mongo has nothing to compare it against. So
 * {@link unmappedColumnNames} exists and both readers consult it, which is what
 * turns the paragraph above from a claim into a mechanism.
 *
 * It covers `compareSample` and `reconcileTable`, and NOT `compareMintedRows` —
 * that path serves tables whose ids are minted, and neither table named here is
 * one (`mintsIds` is empty for both plans). Add the check there too if a minted
 * table ever gains an entry.
 *
 * ## Every entry is the same bug, seen from the database
 *
 * None of these is a new feature. They are fields the PRODUCT already believes
 * in — `retrieve.ts:31` and `roomController.ts:203` both issue
 * `$inc: { views: 1 }`, a 43.51 MiB Mongo text index has been indexing `title`,
 * and `EDITABLE_ROOMMATE_PREFERENCE_FIELDS` accepts `location` and `interests`
 * while `RoommateFilters` sends both — and that mongoose STRICT MODE has been
 * silently discarding, because none of them is declared in its schema. The
 * census measured `views` and `title` as absent on all 17,644 property rows;
 * the two roommate fields are absent on all five profiles for the same reason.
 *
 * Declaring them here rather than leaving them out is a deliberate choice, and
 * it is the cheaper one: adding a column to `properties` later is a migration
 * against the largest table in the schema, while the facts that make them safe
 * to declare now — that they have no data and that the code which will fill
 * them already exists — are measured rather than hoped for.
 *
 * The two `profiles` entries go one step further than the two `properties`
 * ones: their readers were REPAIRED in the same change that added them (the
 * discover `location` filter and `calculateMatchPercentage`'s interests
 * branch), so they start being written the moment the roommate port ships
 * rather than waiting for a later batch.
 */

import { getTableName } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';
import { profiles } from './profiles';
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
  {
    table: profiles,
    property: 'settingsRoommatePreferencesLocation',
    reason:
      'ABSENT on all five production profiles, and unstorable rather than ' +
      'unused: `personalProfileSchema` declares no ' +
      '`settings.roommate.preferences.location`, so mongoose strict mode drops ' +
      'it out of the `$set` `updateRoommatePreferences` builds from its own ' +
      'allow-list — which DOES list it, as does the client\'s ' +
      '`RoommateFilters`. The consequence is a discover filter that has ' +
      'matched nothing for its whole life. There is nothing to copy; the ' +
      'column starts empty and the roommate port is what begins writing it.',
  },
  {
    table: profiles,
    property: 'settingsRoommatePreferencesInterests',
    reason:
      'ABSENT on all five production profiles, discarded by the same strict ' +
      'mode as `settings.roommate.preferences.location` above. Its second ' +
      'consequence is invisible from the write side: ' +
      '`calculateMatchPercentage`\'s interests branch is worth 20 of 100 ' +
      'points and is guarded by `prefs1.interests && prefs2.interests`, so no ' +
      'roommate score has ever been able to include it. Nullable rather than ' +
      'defaulted to `{}`, because "never listed any" and "listed none" are ' +
      'different answers and only the second is an empty array.',
  },
];

/**
 * The TypeScript property names registered for one table.
 *
 * Compared by table NAME rather than by object identity: the backfill reaches
 * its targets through `requireTable(...)`, and an identity comparison would
 * silently match nothing if that ever handed back a different instance of the
 * same table — the vacuous-check failure this whole file exists to avoid.
 */
export function unmappedColumnNames(table: PgTable): ReadonlySet<string> {
  const name = getTableName(table);
  return new Set(
    UNMAPPED_COLUMNS.filter((entry) => getTableName(entry.table) === name).map(
      (entry) => entry.property,
    ),
  );
}
