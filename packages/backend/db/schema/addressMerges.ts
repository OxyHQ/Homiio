/**
 * The record of a merge — issue #360's second half, ADR 0001 §2.1.7 and §8.1.
 *
 * ## Why a merge is a ROW rather than a column update
 *
 * ADR 0001 §2.1.7: *a duplicate is recorded, never discarded. Merging is
 * reversible; deleting is not.* Setting `addresses.merged_into_address_id` is
 * enough to make the matcher redirect, and it is NOT enough to undo anything:
 * it says which row survived and says nothing about which relations moved, so a
 * revert would have to guess. Guessing here means handing one household's
 * reviews back to the wrong address.
 *
 * These two tables are the difference between a merge and a delete with extra
 * steps. {@link addressMerges} is the act; {@link addressMergeRelationMoves} is
 * the itemised list of every row that changed, recorded BY VALUE, which is what
 * a revert replays backwards.
 *
 * ## The measurement that decided "never delete"
 *
 * Twelve columns could point at an address before this migration (ten real
 * foreign keys plus two polymorphic `subject_id` columns), and read off
 * `pg_constraint` on a database migrated to 0014, **eleven of the twelve refuse
 * a delete and exactly one CASCADES**: `address_external_refs.address_id`. So
 * deleting a losing row
 * would not merely be irreversible — it would be irreversible *quietly, on the
 * one table that decides whether the next ingest of that place finds it again*.
 * Everything else would at least raise. That asymmetry is the argument, and it
 * is measured rather than assumed.
 *
 * ## Visibility
 *
 * INTERNAL. A merge names an actor and a reason, and neither belongs in a public
 * DTO; the redirect it produces is observable through the matcher, which is the
 * only part a caller ever sees.
 */

import { check, index, integer, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { createdAt, generatedId, inList, timestamptz } from '@oxyhq/db';
import { addresses } from './addresses';

/**
 * Why two rows were declared the same place.
 *
 * A closed set rather than free text, because it is the input to any later
 * question about whether a class of merge was a good idea — "how often does
 * `duplicate_identity_key` get reverted" is answerable, "how often does
 * somebody's sentence get reverted" is not. The prose reason travels beside it
 * in {@link addressMerges.reason}, which is required and is not this.
 */
export const ADDRESS_MERGE_REASONS = [
  /** The two rows carry identity keys that resolve to the same dwelling. */
  'duplicate_identity_key',
  /** The same provider ref was seen naming both rows. */
  'duplicate_external_ref',
  /** A person proposed it and the community approved it. */
  'approved_correction',
  /** An import created a row that an existing one already described. */
  'ingest_duplicate',
] as const;

export type AddressMergeReason = (typeof ADDRESS_MERGE_REASONS)[number];

/**
 * What happened to one relation row. One member, and that is the decision.
 *
 * ## Why there is no `left_in_place`
 *
 * There WAS one, for one revision, and removing it is a correction worth
 * recording. `reviews_author_address_key` is UNIQUE on
 * `(oxy_user_id, address_id)`, so an author who reviewed BOTH rows has a review
 * the merge cannot move. The first answer was to leave that row on the losing
 * address and record that it stayed — which discards nothing, and was defended
 * on exactly that ground.
 *
 * It is still wrong, for a reason the "nothing was deleted" framing hides: a
 * review list reads `where address_id = <the place>`, so a row left on the loser
 * is **invisible on the survivor**. The author keeps a review of what is now one
 * place that nobody can see, and the constraint that was supposed to prevent one
 * author holding two reviews of one place has been satisfied by hiding one. A
 * row surviving in the table is not the same as content surviving.
 *
 * So a collision REFUSES the merge and reports it. A merge is a correction
 * workflow performed by a person, and stopping to ask is a legitimate answer for
 * it in a way it would never be for an ingest — nothing is lost, nothing is
 * hidden, and the decision goes to somebody who can talk to the author.
 */
export const ADDRESS_MERGE_MOVE_OUTCOMES = ['moved'] as const;

export type AddressMergeMoveOutcome = (typeof ADDRESS_MERGE_MOVE_OUTCOMES)[number];

/** A merge that is in force, or one that has been undone. */
export const ADDRESS_MERGE_STATUSES = ['applied', 'reverted'] as const;

export type AddressMergeStatus = (typeof ADDRESS_MERGE_STATUSES)[number];

/**
 * One act of declaring two canonical rows the same place.
 *
 * ## Both ends carry a real foreign key, and both are RESTRICT
 *
 * The audit is the thing that makes the operation reversible, so neither row may
 * be deleted while a merge names it. That is the same reasoning
 * `address_materializations.address_id` already applies, and it is what makes
 * "no delete before the relations moved" a property of the DATABASE rather than
 * a rule the service remembers.
 */
export const addressMerges = pgTable(
  'address_merges',
  {
    id: generatedId(),

    /** The row that survives. Every moved relation now points here. */
    survivorAddressId: text()
      .notNull()
      .references(() => addresses.id, { onDelete: 'restrict' }),
    /**
     * The row that lost, and which keeps existing.
     *
     * It keeps its `identity_key` and its `normalized_key` too, deliberately: a
     * later materialization that hashes to the loser's key hits the loser and is
     * redirected by the matcher, which is both correct and what makes the merge
     * undoable. Releasing the key on merge would make a revert unable to restore
     * the row's identity — somebody else may have taken it in between.
     */
    mergedAddressId: text()
      .notNull()
      .references(() => addresses.id, { onDelete: 'restrict' }),

    status: text({ enum: ADDRESS_MERGE_STATUSES }).notNull().default('applied'),
    reasonCode: text({ enum: ADDRESS_MERGE_REASONS }).notNull(),
    /**
     * The human sentence. NOT NULL and not defaulted.
     *
     * A merge with no stated reason is the shape that becomes unauditable six
     * months later, and the reason code above is a category rather than an
     * explanation.
     */
    reason: text().notNull(),
    /** Where the evidence can be seen — a correction thread, a dataset row. */
    evidenceUrl: text(),

    /** The Oxy account that performed it, or NULL for an operational job. */
    actorOxyUserId: text(),

    /**
     * How many relation rows this merge moved, copied from the plan it executed.
     *
     * Denormalized ON PURPOSE, and it is the anti-vacuity floor for the whole
     * operation rather than a convenience: a revert asserts that the number of
     * `moved` rows it replays equals this number, so a merge whose move log was
     * partially lost cannot be silently half-reverted. `0` is a legitimate value
     * — merging a row nothing references is a real and ordinary case — which is
     * why the assertion is equality against a recorded count and not `> 0`.
     */
    movedRelationCount: integer().notNull(),

    appliedAt: timestamptz().notNull(),
    /** Set when the merge is undone. NULL means it is still in force. */
    revertedAt: timestamptz(),
    revertedByOxyUserId: text(),

    createdAt: createdAt(),
  },
  (table) => [
    // A row may lose at most one merge that is still in force. PARTIAL on
    // `status`, because a row that was merged, reverted and merged again is an
    // ordinary history and a total unique index would forbid the second merge.
    // The predicate must be repeated verbatim by any `ON CONFLICT` naming this
    // index, or Postgres answers `42P10` at runtime with a clean `tsc`.
    uniqueIndex('address_merges_active_loser_key')
      .on(table.mergedAddressId)
      .where(sql`${table.status} = 'applied'`),

    index('address_merges_survivor_idx').on(table.survivorAddressId),
    index('address_merges_merged_idx').on(table.mergedAddressId),

    check(
      'address_merges_status_check',
      sql`${table.status} in (${sql.raw(inList(ADDRESS_MERGE_STATUSES))})`,
    ),
    check(
      'address_merges_reason_code_check',
      sql`${table.reasonCode} in (${sql.raw(inList(ADDRESS_MERGE_REASONS))})`,
    ),
    // A row cannot be merged into itself. Same one-row cycle a self-referencing
    // foreign key cannot see, and the same CHECK `addresses` already carries for
    // `merged_into_address_id`. Longer cycles are refused by the writer.
    check(
      'address_merges_not_self_check',
      sql`${table.survivorAddressId} <> ${table.mergedAddressId}`,
    ),
    // `reverted` names both the instant and nothing else; `applied` names
    // neither. Written with `is not null` spelled out on the positive branch,
    // because a CHECK rejects only an explicit FALSE and the tidier spelling
    // evaluates to NULL — admitting exactly the half-state it exists to refuse.
    // `CONVENTIONS.md` records that trap shipping once already.
    check(
      'address_merges_reverted_coherence_check',
      sql`(${table.status} = 'applied' and ${table.revertedAt} is null)
          or (${table.status} = 'reverted' and ${table.revertedAt} is not null)`,
    ),
    check('address_merges_moved_count_check', sql`${table.movedRelationCount} >= 0`),
  ],
);

/**
 * One row per relation the merge touched — the itemised log a revert replays.
 *
 * ## Why the table and column are stored as TEXT
 *
 * They name a place in the schema, and a schema is not a table this database can
 * reference. The alternative would be an enum, which would need a migration
 * every time a relation is added — and the relation registry the service reads
 * is derived from the catalogue precisely so that adding one cannot be forgotten.
 * Storing the name keeps the log readable by a human running `psql` during an
 * incident, which is the audience it has.
 *
 * The service validates both names against the registry before writing, so a
 * typo cannot enter; what it cannot do is stop a relation being RENAMED later,
 * and a rename that leaves this log behind is exactly the case
 * {@link addressMergeRelationMoves.outcome} plus the revert's own preflight are
 * there to refuse loudly rather than apply blindly.
 *
 * ## Why `previous_address_id` is stored even though it is always the loser
 *
 * For `moved` rows it is redundant with the merge's `merged_address_id` — and
 * for a SPLIT, which reuses this engine, it is not, because a split moves rows
 * off a survivor onto a new row and the previous value differs per relation.
 * Recording it makes the log self-describing rather than only interpretable
 * against its parent, which is what an audit read during an incident needs.
 */
export const addressMergeRelationMoves = pgTable(
  'address_merge_relation_moves',
  {
    id: generatedId(),

    /** CASCADE: a move has no meaning without the merge that made it. */
    mergeId: text()
      .notNull()
      .references(() => addressMerges.id, { onDelete: 'cascade' }),

    /** The table whose row was touched, as it appears in `pg_class`. */
    relationTable: text().notNull(),
    /** The column that was rewritten, as it appears in `pg_attribute`. */
    relationColumn: text().notNull(),
    /** The primary key of the row that was touched. */
    relationRowId: text().notNull(),

    /**
     * What the column held before. See the docblock for why it is stored.
     *
     * A REAL foreign key rather than a classified exemption: the value is always
     * an existing address, and RESTRICT here is the same guarantee the merge
     * itself carries — the row a revert would restore to may not be deleted
     * while a log entry names it. It appears in the derived relation registry as
     * `audit`, which is what stops a merge from rewriting its own history.
     */
    previousAddressId: text()
      .notNull()
      .references(() => addresses.id, { onDelete: 'restrict' }),
    /**
     * Always `moved` today — see {@link ADDRESS_MERGE_MOVE_OUTCOMES}.
     *
     * Kept as a column rather than dropped because the SPLIT half of #360 puts a
     * second kind of row in this log, and a log whose rows are indistinguishable
     * is a log a revert cannot read selectively. It is not a placeholder for a
     * collision outcome: a collision refuses the merge and writes nothing.
     */
    outcome: text({ enum: ADDRESS_MERGE_MOVE_OUTCOMES }).notNull(),

    createdAt: createdAt(),
  },
  (table) => [
    // The revert reads every move of one merge, in one go.
    index('address_merge_relation_moves_merge_idx').on(table.mergeId),
    // One merge touches one row of one relation at most once. This is what makes
    // the replay idempotent: a double-write would move a row twice and a revert
    // would put it back once.
    uniqueIndex('address_merge_relation_moves_row_key').on(
      table.mergeId,
      table.relationTable,
      table.relationColumn,
      table.relationRowId,
    ),

    check(
      'address_merge_relation_moves_outcome_check',
      sql`${table.outcome} in (${sql.raw(inList(ADDRESS_MERGE_MOVE_OUTCOMES))})`,
    ),
  ],
);
