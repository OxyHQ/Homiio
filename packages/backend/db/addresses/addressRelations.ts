/**
 * Every column that can point at an `addresses` row, and what a merge does with
 * each one — issue #360's "mover todas las FKs".
 *
 * ## Derived, not written down
 *
 * The foreign keys are read out of the drizzle schema at module load
 * ({@link addressForeignKeys}), so a column added tomorrow appears here without
 * anybody remembering to add it. That is the whole design, and the reason is a
 * failure this repository has already had twice: a hand-maintained list of
 * not-an-id path segments in `RightBar` (#423) and a hand-maintained list of
 * `PlaceType` values in `homeSectionsController` (#416) both had to name every
 * case, and both did not.
 *
 * ## What derivation CANNOT see, and how that is handled
 *
 * Two columns hold an address id with **no foreign key at all**:
 * `housing_domain_events.subject_id` and `housing_alerts.subject_id`, each
 * discriminated by a `subject_type` column whose CHECK includes `'address'`
 * (`deferredForeignKeys.ts` records why neither can carry a constraint). No
 * catalogue query finds them, so they are declared in
 * {@link POLYMORPHIC_ADDRESS_RELATIONS} by hand — and the declaration is the
 * dangerous half, so `__tests__/db/addressRelations.test.ts` asserts against the
 * live `subject_type` CHECK that `'address'` is still an accepted value. A
 * discriminator that stopped accepting addresses would make these two entries
 * lies, and nothing else would notice.
 *
 * Measured on a database migrated to 0014: `images.entity_type` is
 * `property | city | region | country | profile` and does **not** include
 * `address`, so images are not an address relation and there is no media for a
 * merge to lose. Worth stating because the issue's must-not-lose list names
 * media; the honest answer is that none is attached to a place.
 *
 * ## Every foreign key is classified, and being unclassified FAILS
 *
 * {@link classifyAddressRelation} returns a disposition for each derived key,
 * and the gate refuses a key it does not recognise rather than defaulting it to
 * anything. A default would be a decision made by absence: `move` would rewrite
 * an audit row the first time somebody adds one, and `keep` would silently leave
 * a real relation pointing at a retired address. Both are the shape of bug this
 * module exists to prevent, so there is no default.
 */

import { getTableConfig, type PgTable } from 'drizzle-orm/pg-core';
import { sqlColumnName } from '@oxyhq/db';

import * as schema from '../schema';
import { addresses } from '../schema/addresses';

/**
 * What a merge does with one column.
 *
 * `keep` is not "ignore" — it is the recorded decision that the column names a
 * FACT ABOUT THE PAST, and rewriting it would falsify history rather than
 * repair a reference.
 */
export type AddressRelationDisposition =
  /** Repoint to the survivor, and record the move so a revert can undo it. */
  | 'move'
  /** Leave it. It records what happened, and what happened does not change. */
  | 'keep'
  /** The merge's own audit trail. Rewriting it would erase the merge. */
  | 'audit';

export interface AddressRelation {
  /** The SQL table name, as it appears in `pg_class`. */
  readonly table: string;
  /** The SQL column name, as it appears in `pg_attribute`. */
  readonly column: string;
  readonly disposition: AddressRelationDisposition;
  /**
   * The `<type_column>` and value that make a polymorphic row an address row,
   * or `null` for a real foreign key.
   *
   * A move over a polymorphic column MUST carry this predicate: without it the
   * update would repoint every `property` and `review` subject whose id happens
   * to collide, and ids here are uuid v7 so a collision is not the concern —
   * the concern is that the statement would be semantically "rewrite every
   * subject", which is only prevented by the predicate being present.
   */
  readonly discriminator: { readonly column: string; readonly value: string } | null;
}

/** The drizzle table objects, by SQL name, for the registry to resolve against. */
function declaredTables(): Map<string, PgTable> {
  const tables = new Map<string, PgTable>();
  for (const value of Object.values(schema)) {
    let config;
    try {
      config = getTableConfig(value as PgTable);
    } catch {
      // Not a table. The barrel is documented as tables-only, so this is a
      // belt-and-braces skip rather than an expected branch.
      continue;
    }
    tables.set(config.name, value as PgTable);
  }
  return tables;
}

/**
 * Every foreign key in the schema whose target is `addresses`, derived.
 *
 * Returns SQL names on both sides — `sqlColumnName`, never `column.name`, which
 * is the drizzle PROPERTY name and would silently match nothing in a catalogue
 * query or produce `column "materializedAddressId" does not exist` in emitted
 * SQL. `@oxyhq/db`'s own header records that trap.
 */
export function addressForeignKeys(): readonly { table: string; column: string }[] {
  const found: { table: string; column: string }[] = [];
  for (const [tableName, table] of declaredTables()) {
    for (const foreignKey of getTableConfig(table).foreignKeys) {
      const reference = foreignKey.reference();
      if (reference.foreignTable !== addresses) continue;
      for (const column of reference.columns) {
        found.push({ table: tableName, column: sqlColumnName(column) });
      }
    }
  }
  return found.sort((a, b) => a.table.localeCompare(b.table) || a.column.localeCompare(b.column));
}

/**
 * The two columns that hold an address id without a foreign key.
 *
 * Declared, because nothing can derive them — and every field is checked against
 * the live catalogue by the gate, including that the discriminator's CHECK still
 * admits `'address'`.
 */
export const POLYMORPHIC_ADDRESS_RELATIONS: readonly AddressRelation[] = [
  {
    table: 'housing_domain_events',
    column: 'subject_id',
    disposition: 'move',
    discriminator: { column: 'subject_type', value: 'address' },
  },
  {
    table: 'housing_alerts',
    column: 'subject_id',
    disposition: 'move',
    discriminator: { column: 'subject_type', value: 'address' },
  },
];

/**
 * The disposition of one derived foreign key, or `null` when it is unknown.
 *
 * `null` is what makes the gate a gate: an unrecognised key fails
 * `__tests__/db/addressRelations.test.ts` by name, and the person adding the
 * column decides what a merge should do with it. That decision cannot be made
 * correctly by a default, and it is cheap to make explicitly.
 */
export function classifyAddressRelation(
  table: string,
  column: string,
): AddressRelationDisposition | null {
  const key = `${table}.${column}`;
  switch (key) {
    // ── Relations that describe the PRESENT, and must follow the place ──
    //
    // A listing advertises a dwelling; after the merge the dwelling is the
    // survivor. A review is filed against a dwelling at three levels plus the
    // row itself, and moving only `address_id` would leave it filed under the
    // retired row at two of the three — which is the failure a census that
    // stopped at "reviews has an address column" would have shipped.
    case 'properties.address_id':
    case 'reviews.address_id':
    case 'reviews.street_level_id':
    case 'reviews.building_level_id':
    case 'reviews.unit_level_id':
      return 'move';

    // A provider's id for a place. After the merge the place is the survivor, so
    // the next ingest carrying that ref should land there directly rather than
    // through a redirect. `(source, external_id)` is unique GLOBALLY and carries
    // no address column, so this move can never collide.
    case 'address_external_refs.address_id':
      return 'move';

    // The hierarchy. A unit whose building lost a merge must re-parent, or its
    // parent is a retired row — and `parent_address_id` is what every other
    // domain is meant to read instead of recomputing the chain.
    case 'addresses.parent_address_id':
      return 'move';

    // A row that already redirected to the loser now redirects to the survivor.
    // FLATTENED rather than chained, deliberately: the matcher follows at most
    // `MAX_MERGE_REDIRECTS` hops, and a cap is a thing that gets hit. The chain
    // is not lost — `address_merges` records every step — so flattening moves
    // the history into the audit table where it is readable, instead of encoding
    // it as a walk whose length is bounded.
    case 'addresses.merged_into_address_id':
      return 'move';

    // ── Relations that describe the PAST ──
    //
    // "This candidate produced THAT row" and "this act of materialization
    // resolved to THAT row" are facts about what happened. The row still exists
    // and still redirects, so nothing is dangling; rewriting these would make
    // the audit say a materialization produced a row it did not produce, which
    // is the one thing a merge audit must never do.
    case 'address_candidates.materialized_address_id':
    case 'address_materializations.address_id':
      return 'keep';

    // ── The merge's own record ──
    // `previous_address_id` is the value a revert restores TO. Rewriting any of
    // these three would make the log say a row came from somewhere it did not,
    // which is the one thing an undo cannot survive — and this gate is what
    // caught the third one: giving it a foreign key made it appear in the
    // derived set, and it failed here until somebody decided.
    case 'address_merges.survivor_address_id':
    case 'address_merges.merged_address_id':
    case 'address_merge_relation_moves.previous_address_id':
      return 'audit';

    default:
      return null;
  }
}

/**
 * The full registry: every derived foreign key with its disposition, plus the
 * declared polymorphic columns.
 *
 * Throws on an unclassified key rather than skipping it. A registry that
 * silently omitted a relation would produce a merge that silently left it
 * behind, and the whole point of deriving the set is that the omission cannot
 * happen quietly.
 */
export function addressRelations(): readonly AddressRelation[] {
  const relations: AddressRelation[] = [];
  for (const { table, column } of addressForeignKeys()) {
    const disposition = classifyAddressRelation(table, column);
    if (disposition === null) {
      throw new Error(
        `Unclassified address relation ${table}.${column}. Add it to ` +
          '`classifyAddressRelation` in db/addresses/addressRelations.ts: a merge ' +
          'must know whether to move it (a relation), keep it (a record of the ' +
          'past) or refuse it (the merge audit itself).',
      );
    }
    relations.push({ table, column, disposition, discriminator: null });
  }
  return [...relations, ...POLYMORPHIC_ADDRESS_RELATIONS];
}

/** Just the relations a merge repoints. */
export function movableAddressRelations(): readonly AddressRelation[] {
  return addressRelations().filter((relation) => relation.disposition === 'move');
}
