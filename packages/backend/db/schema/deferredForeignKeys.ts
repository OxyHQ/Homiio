/**
 * Id-Shaped Columns That Carry No Foreign Key
 *
 * Two lists and one predicate. Between them and the real `.references()`
 * constraints, EVERY id-shaped column in this schema is classified — which is
 * what lets `__tests__/db/foreignKeys.test.ts` fail on a NEW one that nobody
 * decided about, rather than letting it ship unconstrained and be discovered as
 * an orphan row three batches later.
 *
 * `DEFERRED_FOREIGN_KEYS` is the TEMPORARY list: a constraint that is DECIDED
 * but not yet expressible, because the parent table has not landed. Homiio's
 * migration arrives in batches, so this list will be non-empty for most of it —
 * `properties.address_id` is decided today and cannot be written until
 * `properties` exists. The test turns each entry into a gate: the moment the
 * parent appears in the barrel, the run goes red naming every column that must
 * now reference it. An empty ledger is the finish line.
 *
 * `ID_COLUMNS_WITHOUT_FOREIGN_KEY` is the PERMANENT counterpart, and
 * {@link isOxyAccountColumn} is a predicate standing in for what would otherwise
 * be several hundred identical entries.
 *
 * ## The fact that shapes this file: there is no `users` table, and there never will be
 *
 * Oxy owns identity. Homiio reaches it over HTTP (`@oxyhq/core/server`
 * resolves the session), so **every `oxy_user_id` in this schema is a foreign
 * SERVICE's primary key** and can carry no foreign key. That is not a gap to
 * close later: a shadow `users` table would be a cache that can disagree with
 * Oxy, and validating on write would put an HTTP round trip in front of every
 * insert.
 *
 * `AGENTS.md` states the ownership rule in the same terms — property, room and
 * lease writes resolve the owner from the session `oxyUserId` and never accept
 * one from the client — so the absence of a constraint here is the same decision
 * seen from the database side, not a weaker version of it.
 */

import { getTableColumns, getTableName } from 'drizzle-orm';
import type { PgColumn, PgTable, UpdateDeleteAction } from 'drizzle-orm/pg-core';
import { sqlColumnName } from '../casing';
import { images } from './images';

/** A foreign key that is decided but not yet expressible. */
export interface DeferredForeignKey {
  readonly table: PgTable;
  readonly column: PgColumn;
  /** SQL name of the parent table, e.g. `properties`. */
  readonly parentTable: string;
  /** Column on the parent, e.g. `id`. */
  readonly parentColumn: string;
  /** Decided per relation — never left to default. */
  readonly onDelete: UpdateDeleteAction;
  /** Why that `ON DELETE`, in one line. */
  readonly reason: string;
}

/** An id-shaped column that will never carry a foreign key. */
export interface IdColumnWithoutForeignKey {
  readonly table: PgTable;
  readonly column: PgColumn;
  readonly reason: string;
}

/**
 * Empty as of migration 0000.
 *
 * Not because nothing is deferred in principle, but because the six tables in
 * 0000 form a CLOSED sub-graph: `countries` → `regions` → `cities` →
 * `neighborhoods`, `images`, and `addresses` referencing three of them. Every
 * relation among them is expressible today, so every one of them is a real
 * constraint.
 *
 * Batch 3 is where this list first fills up — `properties` will reference
 * `addresses` (which exists) but also `agencies` and `partners` (which will
 * not, if properties lands first).
 */
export const DEFERRED_FOREIGN_KEYS: readonly DeferredForeignKey[] = [];

/**
 * The SQL names of columns holding an OXY ACCOUNT id.
 *
 * A column named by any of these is a reference into Oxy's user table, reached
 * over HTTP, and can never carry a local constraint. A predicate rather than
 * several hundred individual entries because the reason is identical for every
 * one of them, and repeating it would bury the entries that have a reason of
 * their own.
 *
 * NONE of these names appears in migration 0000 — the geo tables and `images`
 * have no owner. The set is populated in advance because the alternative is
 * adding it under time pressure while porting `properties`, and because
 * `__tests__/db/foreignKeys.test.ts` asserts the predicate against a probe
 * column so it cannot be silently broken before the first real user of it
 * arrives.
 *
 * Every name is the SQL spelling, drawn from the Mongoose schemas it will come
 * from.
 */
export const OXY_ACCOUNT_COLUMN_NAMES: ReadonlySet<string> = new Set([
  // The owner of a property, room, lease, review, saved item, profile … — the
  // single most common column in the schema, and the one `AGENTS.md` forbids
  // accepting from a client.
  'oxy_user_id',
  // `RoommateRequest` / `RoommateRelationship` / `ExchangeRequest` name their
  // two sides rather than using one `oxy_user_id`.
  'requester_oxy_user_id',
  'recipient_oxy_user_id',
  'sender_oxy_user_id',
  // `Review.reports[]`, `ListingReport`, `EvictionReport`.
  'reporter_oxy_user_id',
  // `Lease` names both parties; `TenantApplication` and `ViewingRequest` name
  // the applicant. All Oxy accounts.
  'landlord_oxy_user_id',
  'tenant_oxy_user_id',
  'applicant_oxy_user_id',
  // `Notification` recipients and `Conversation` participants.
  'user_oxy_user_id',
  'participant_oxy_user_id',
  // `EvictionCase.organizer`, `EvictionComment` author, `Partner` account.
  'organizer_oxy_user_id',
  'author_oxy_user_id',
  'partner_oxy_user_id',
]);

/**
 * True when `column` holds an Oxy account id.
 *
 * Uses {@link sqlColumnName}, NEVER `column.name`: the latter is the TypeScript
 * PROPERTY name (`oxyUserId`), so a set of snake_case names compared against it
 * would match NOTHING — and this predicate would answer `false` for every column
 * while looking perfectly correct, letting every account column through the gate
 * unclassified. That is the exact vacuous-check shape `db/casing.ts` documents,
 * and it is why the test exercises this function against a probe column whose
 * property name and SQL name differ.
 */
export function isOxyAccountColumn(column: PgColumn): boolean {
  return OXY_ACCOUNT_COLUMN_NAMES.has(sqlColumnName(column));
}

/**
 * Every id-shaped column that is NOT an Oxy account id and still carries no
 * foreign key. Each has its own reason; none of them is "we forgot".
 */
export const ID_COLUMNS_WITHOUT_FOREIGN_KEY: readonly IdColumnWithoutForeignKey[] = [
  {
    table: images,
    column: images.entityId,
    reason:
      'Polymorphic by `entity_type` across five nouns — a `properties.id`, ' +
      '`cities.id`, `regions.id`, `countries.id` or `profiles.id`. A single ' +
      'column cannot reference five tables, so this is permanent rather than ' +
      'deferred: it does not become expressible when the missing tables land. ' +
      'Mongo declared it with no `ref` for the same reason, and every read is ' +
      'already scoped by the `(entity_type, entity_id)` PAIR rather than by the ' +
      'id alone — which is the index this table carries and the reason a ' +
      'dangling id costs nothing beyond returning no rows.',
  },
];

/**
 * Every `*_id`-shaped column in a table, by SQL name.
 *
 * Deliberately matches on the SQL name (via {@link sqlColumnName}) rather than
 * the property name, for the reason spelled out on {@link isOxyAccountColumn} —
 * `endsWith('_id')` against `coverImageId` is `false`, so the property-name
 * version of this function would return an empty list for every table and the
 * gate built on it would pass over nothing.
 */
export function idShapedColumns(table: PgTable): PgColumn[] {
  return Object.values(getTableColumns(table)).filter((column) => {
    const name = sqlColumnName(column);
    return name === 'id' ? false : name.endsWith('_id') || name.endsWith('_ids');
  });
}

/** A stable `table.column` label, for a test failure message. */
export function columnLabel(column: PgColumn): string {
  return `${getTableName(column.table)}.${sqlColumnName(column)}`;
}
