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
import { createdAt, generatedId, inList, timestamptz, updatedAt } from '@oxy.so/db';
import { ADDRESS_LEVELS, addresses } from './addresses';

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

/**
 * Where a correction proposal is in its life. TWO members, and the shortness is
 * the decision rather than an omission.
 *
 * ADR 0001 §15's open decision 5 — *who may propose a merge, and what resolves
 * it* — is explicitly UNDECIDED: the community resolves it, and the quorum is
 * somebody else's to pick. So this table ships the half that is decided (a
 * proposal is RECORDED instead of being applied as a silent edit) and refuses to
 * invent the half that is not. There is no `applied` and no `rejected`, because
 * nothing may set them; a status value nothing can reach reads as a workflow
 * that exists and does not.
 *
 * Adding one later is `DROP CONSTRAINT` / `ADD CONSTRAINT` on a CHECK, which is
 * exactly why `CONVENTIONS.md` chose `text` + CHECK over a pg enum.
 */
export const ADDRESS_MERGE_PROPOSAL_STATUSES = ['open', 'withdrawn'] as const;

export type AddressMergeProposalStatus = (typeof ADDRESS_MERGE_PROPOSAL_STATUSES)[number];

/**
 * A proposal to correct a KEY field of a canonical address — ADR 0001 §8.1.
 *
 * ## Why a correction is a row here rather than an UPDATE on `addresses`
 *
 * §8.1 draws the line and this table is the far side of it: *correction of
 * attributes is an ordinary edit and does not change identity — unless it
 * changes a key field, in which case it is a merge proposal.* A key field is one
 * §3.1 hashes (`street`, `number`, `building_name`, `block`, `entrance`,
 * `floor`, `unit`, `subunit`), so writing one re-keys the row: the place a
 * listing, a lease, a review and an eviction all point at silently becomes a
 * different place, and — because the corrected key may ALREADY belong to another
 * row — the correction is not even expressible as an edit. It is a statement
 * that two identities are one, which is what {@link addressMerges} applies and
 * what this table proposes.
 *
 * ## The proposal carries the whole proposed identity, not a patch
 *
 * A patch would have to distinguish "leave `entrance` alone" from "clear
 * `entrance`", and one nullable column cannot say both. So every one of the
 * eight key fields is stored at its PROPOSED value — the row's current value
 * where the proposer did not touch it — which makes NULL mean exactly one thing
 * (the proposed place has no such field) and makes
 * {@link addressMergeProposals.proposedIdentityKey} computable from the row
 * alone. The diff against the address is what a reader renders; it is derived,
 * not stored.
 *
 * ## Visibility
 *
 * Tier **C**, and it inherits the PRECISION LADDER rather than the protected-
 * column registry: `proposed_floor` / `_unit` / `_subunit` name the dwelling
 * inside a building exactly as `addresses.floor` does (ADR 0003 §2.1), so a
 * reader below `exact` is served the proposal with those three absent. A
 * proposal published in full would be a second route to the unit label the
 * address serializer withholds.
 */
export const addressMergeProposals = pgTable(
  'address_merge_proposals',
  {
    id: generatedId(),

    /** The row being corrected. RESTRICT: a proposal names a place that exists. */
    fromAddressId: text()
      .notNull()
      .references(() => addresses.id, { onDelete: 'restrict' }),
    /**
     * The row that already carries `proposed_identity_key`, when one does.
     *
     * Resolved SERVER-SIDE at write time and never supplied by a caller: a
     * proposer names a correction, not a target row, and letting them name one
     * would be letting them point one household's history at another's address.
     * NULL means no existing row carries the corrected identity — so the
     * correction would MINT a place rather than merge into one, which is a
     * materially different act and the reason the column is nullable rather than
     * defaulted to the `from` row.
     */
    toAddressId: text().references(() => addresses.id, { onDelete: 'restrict' }),

    // ── The proposed identity, in full. See the docblock. ──
    /** `addresses.street` is NOT NULL, so its proposed value is too. */
    proposedStreet: text().notNull(),
    proposedNumber: text(),
    proposedBuildingName: text(),
    proposedBlock: text(),
    proposedEntrance: text(),
    proposedFloor: text(),
    proposedUnit: text(),
    proposedSubunit: text(),

    /**
     * `deriveAddressLevel` over the proposed fields — the level the corrected
     * place would BE.
     *
     * Stored rather than re-derived on read because it is the level
     * `proposed_identity_key` was hashed AT, and a key without its level is a
     * digest nobody can reproduce.
     */
    proposedAddressLevel: text({ enum: ADDRESS_LEVELS }).notNull(),
    /** `computeAddressIdentityKey` over the proposed fields, at that level. */
    proposedIdentityKey: text().notNull(),
    /**
     * `ADDRESS_NORMALIZATION_VERSION` at the instant the key above was computed.
     *
     * The same column `address_candidates` carries, for the same reason: it is
     * what lets a later reader tell a genuine disagreement between two
     * observations from a change in the normalization rules between them.
     */
    normalizationVersion: integer().notNull(),

    /** The human sentence. NOT NULL — see {@link addressMerges}'s `reason`. */
    reason: text().notNull(),
    /** Where the evidence can be seen: a cadastral record, a photo of the door. */
    evidenceUrl: text(),

    /**
     * The Oxy account that proposed it — the SESSION's, never a body's.
     *
     * No foreign key, and none is possible: Oxy owns identity and this schema
     * has no `users` table (`CONVENTIONS.md`).
     */
    proposedByOxyUserId: text().notNull(),

    status: text({ enum: ADDRESS_MERGE_PROPOSAL_STATUSES }).notNull().default('open'),
    /** Set when the proposer withdraws it. NULL means it is still open. */
    withdrawnAt: timestamptz(),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    /** Every open proposal about one place, newest first — the visible list. */
    index('address_merge_proposals_from_idx')
      .on(table.fromAddressId, sql`${table.createdAt} desc`)
      .where(sql`${table.status} = 'open'`),

    /**
     * One person may not file the SAME correction about one place twice.
     *
     * PARTIAL on `status = 'open'`, and that predicate is what the index exists
     * for rather than a detail of it: a proposer who withdraws a correction and
     * later files it again is an ordinary sequence, and a total index would
     * refuse the second one forever. It is also scoped by PROPOSER on purpose —
     * two different people proposing the same correction is corroboration, and
     * corroboration is the raw material of whatever quorum §15.5 eventually
     * picks, so deduping it away would destroy the signal.
     */
    uniqueIndex('address_merge_proposals_open_key')
      .on(table.fromAddressId, table.proposedByOxyUserId, table.proposedIdentityKey)
      .where(sql`${table.status} = 'open'`),

    check(
      'address_merge_proposals_status_check',
      sql`${table.status} in (${sql.raw(inList(ADDRESS_MERGE_PROPOSAL_STATUSES))})`,
    ),
    check(
      'address_merge_proposals_level_check',
      sql`${table.proposedAddressLevel} in (${sql.raw(inList(ADDRESS_LEVELS))})`,
    ),
    /**
     * A proposal may not name its own row as the merge target.
     *
     * `to_address_id = from_address_id` would say "this place should become
     * itself", which is what a caller-supplied target could produce and what the
     * server-side resolver never does.
     */
    check(
      'address_merge_proposals_not_self_check',
      sql`${table.toAddressId} is null or ${table.toAddressId} <> ${table.fromAddressId}`,
    ),
    /**
     * `withdrawn` names the instant and `open` does not — with `is not null`
     * spelled out on the positive branch, because a CHECK rejects only an
     * explicit FALSE and the tidier spelling evaluates to NULL, admitting
     * exactly the half-state it exists to refuse (`CONVENTIONS.md`).
     */
    check(
      'address_merge_proposals_withdrawn_coherence_check',
      sql`(${table.status} = 'open' and ${table.withdrawnAt} is null)
          or (${table.status} = 'withdrawn' and ${table.withdrawnAt} is not null)`,
    ),
  ],
);
