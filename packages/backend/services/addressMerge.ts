/**
 * Merging two canonical addresses — issue #360's second half, ADR 0001 §8.1.
 *
 * ## The requirement is REVERSIBILITY, and it decides the whole shape
 *
 * ADR 0001 §2.1.7: *a duplicate is recorded, never discarded. Merging is
 * reversible; deleting is not.* A merge that cannot be undone is a delete with
 * extra steps, so nothing here deletes anything: the losing row keeps existing,
 * keeps its identity keys, and gains a redirect that
 * `materializeHousingCandidate` already follows.
 *
 * Reversibility needs more than the redirect. The redirect says which row
 * survived; it says nothing about which relations moved, so an undo built on it
 * alone would have to GUESS — and guessing here hands one household's reviews
 * back to the wrong address. Every rewritten row is therefore itemised in
 * `address_merge_relation_moves`, and {@link revertAddressMerge} replays that
 * log backwards rather than re-deriving anything.
 *
 * ## Three phases, and the dry run is the same code
 *
 * {@link planAddressMerge} reads and writes nothing. {@link applyAddressMerge}
 * calls it inside its own transaction and executes the plan it returns, so the
 * preview a caller inspects is produced by the code that will do the work —
 * a separate "plan" implementation would be a second thing to keep in step, and
 * the one that drifted would be the one nobody ran.
 *
 * ## The collision REFUSES the merge, and that is a decision rather than a limit
 *
 * `reviews_author_address_key` is UNIQUE on `(oxy_user_id, address_id)`, so an
 * author who reviewed BOTH rows has a review that cannot move. An earlier
 * revision left that row on the losing address and recorded that it stayed,
 * defended on the ground that nothing was discarded. Nothing was — and it was
 * still wrong: a review list reads `where address_id = <place>`, so a row left
 * on the loser is INVISIBLE on the survivor. The author keeps a review of what
 * is now one place that nobody can see, and the constraint meant to stop one
 * author holding two reviews of one place has been satisfied by hiding one.
 *
 * So {@link planAddressMerge} detects collisions and {@link applyAddressMerge}
 * refuses, naming every colliding row. A merge is a correction workflow a person
 * performs; stopping to ask is legitimate for it in a way it never is for an
 * ingest.
 *
 * An UNKNOWN unique constraint is caught the same way but cannot be predicted,
 * so each move still runs inside a SAVEPOINT via `inSavepoint` and a violation
 * converts to the same refusal with the constraint named. Hand-issuing
 * `savepoint` / `rollback to` would look correct at every observable step and
 * then fail at COMMIT — postgres.js records the failed query on the transaction
 * and catching the rejection does not un-fail it.
 */

import { and, eq, sql } from 'drizzle-orm';
import { constraintNameOf, isUniqueViolation } from '@oxyhq/db';

import {
  addressMergeRelationMoves,
  addressMerges,
  type AddressMergeReason,
} from '../db/schema/addressMerges';
import { addresses } from '../db/schema/addresses';
import { getDb, inSavepoint, type DatabaseOrTransaction, type Transaction } from '../db/postgres';
import { movableAddressRelations, type AddressRelation } from '../db/addresses/addressRelations';

/**
 * How far {@link resolveSurvivor} follows a redirect chain before refusing.
 *
 * The same bound `materializeHousingCandidate` applies to reads, for the same
 * reason and deliberately the same number: a merge that produced a chain the
 * matcher cannot walk would be a merge whose result is invisible to every
 * caller. Because this service FLATTENS redirects, reaching the bound means a
 * cycle or a chain built by something else, and both are refusals.
 */
const MAX_MERGE_REDIRECTS = 8;

/** One relation row a merge would touch. */
export interface PlannedMove {
  readonly table: string;
  readonly column: string;
  readonly rowId: string;
  readonly discriminator: AddressRelation['discriminator'];
}

/** A row whose move a unique constraint would refuse. */
export interface PlannedCollision {
  readonly table: string;
  readonly column: string;
  readonly rowId: string;
  /** The constraint that would refuse it. */
  readonly constraint: string;
  /** One line a person can act on, naming what actually conflicts. */
  readonly detail: string;
}

export interface AddressMergePlan {
  readonly survivorAddressId: string;
  readonly mergedAddressId: string;
  /** Every row that would be repointed, in a stable order. */
  readonly moves: readonly PlannedMove[];
  /** Rows per relation, for a caller that wants to eyeball the shape. */
  readonly countsByRelation: Readonly<Record<string, number>>;
  /**
   * Rows a unique constraint would refuse. A NON-EMPTY list means the merge is
   * refused — the dry run is where an operator sees it before attempting.
   */
  readonly collisions: readonly PlannedCollision[];
}

export type AddressMergeRefusal =
  | { readonly kind: 'same_address' }
  | { readonly kind: 'address_not_found'; readonly addressId: string }
  /** The loser already lost a merge that is still in force. */
  | { readonly kind: 'already_merged'; readonly intoAddressId: string }
  /** Following the survivor's redirects came back to the loser. */
  | { readonly kind: 'would_create_cycle' }
  /** The survivor's own redirect chain is longer than the matcher can walk. */
  | { readonly kind: 'redirect_chain_too_long' }
  /**
   * A relation row cannot move without violating a unique constraint.
   *
   * The merge is refused whole. Nothing is written, nothing is hidden, and the
   * colliding rows are named so somebody can decide — see this file's header for
   * why refusing beats leaving the row behind.
   */
  | { readonly kind: 'unique_collision'; readonly collisions: readonly PlannedCollision[] };

export class AddressMergeRefusedError extends Error {
  constructor(readonly refusal: AddressMergeRefusal) {
    super(`Address merge refused: ${refusal.kind}`);
    this.name = 'AddressMergeRefusedError';
  }
}

export interface AddressMergeInput {
  readonly survivorAddressId: string;
  readonly mergedAddressId: string;
  readonly reasonCode: AddressMergeReason;
  /** The human sentence. Required — see the column's docblock. */
  readonly reason: string;
  readonly evidenceUrl?: string;
  readonly actorOxyUserId?: string;
}

export interface AppliedMove extends PlannedMove {
  readonly outcome: 'moved';
}

export interface AddressMergeResult {
  readonly mergeId: string;
  readonly survivorAddressId: string;
  readonly mergedAddressId: string;
  readonly moves: readonly AppliedMove[];
  readonly movedCount: number;
}

/**
 * A `WHERE` matching the rows of one relation that point at `addressId`.
 *
 * Both identifiers come from the registry, which derives them from the schema —
 * they are never caller input — and they still go through `sql.identifier` so
 * the statement cannot be malformed by a name needing quoting.
 */
function pointsAt(relation: AddressRelation, addressId: string) {
  const column = sql`${sql.identifier(relation.table)}.${sql.identifier(relation.column)}`;
  if (!relation.discriminator) return sql`${column} = ${addressId}`;
  // The discriminator is REQUIRED on a polymorphic column: without it the
  // statement means "every subject", which is a different query that happens to
  // return the same rows today.
  return sql`${column} = ${addressId} and ${sql.identifier(relation.table)}.${sql.identifier(
    relation.discriminator.column,
  )} = ${relation.discriminator.value}`;
}

/** Follow `merged_into_address_id` to the row a caller should really use. */
async function resolveSurvivor(
  db: DatabaseOrTransaction,
  startId: string,
): Promise<{ id: string } | AddressMergeRefusal> {
  let currentId = startId;
  for (let hop = 0; hop <= MAX_MERGE_REDIRECTS; hop += 1) {
    const [row] = await db
      .select({ id: addresses.id, mergedInto: addresses.mergedIntoAddressId })
      .from(addresses)
      .where(eq(addresses.id, currentId))
      .limit(1);
    if (!row) return { kind: 'address_not_found', addressId: currentId };
    if (!row.mergedInto) return { id: row.id };
    currentId = row.mergedInto;
  }
  return { kind: 'redirect_chain_too_long' };
}

/**
 * What a merge would do. Reads only.
 *
 * Exported so a caller can inspect it — the issue's "permitir dry-run con plan
 * completo" — and used by {@link applyAddressMerge} itself, so the preview and
 * the execution cannot disagree.
 */
export async function planAddressMerge(
  input: Pick<AddressMergeInput, 'survivorAddressId' | 'mergedAddressId'>,
  db: DatabaseOrTransaction = getDb(),
): Promise<AddressMergePlan> {
  const { survivorAddressId, mergedAddressId } = input;
  if (survivorAddressId === mergedAddressId) {
    throw new AddressMergeRefusedError({ kind: 'same_address' });
  }

  const loser = await resolveExistingAddress(db, mergedAddressId);
  if (loser.mergedInto) {
    throw new AddressMergeRefusedError({
      kind: 'already_merged',
      intoAddressId: loser.mergedInto,
    });
  }

  const survivor = await resolveSurvivor(db, survivorAddressId);
  if ('kind' in survivor) throw new AddressMergeRefusedError(survivor);
  // Following the survivor's redirects landed back on the row being retired, so
  // applying this merge would make the pair unreachable from either end. A
  // self-referencing foreign key cannot see a cycle of length two or more; this
  // is where it is refused.
  if (survivor.id === mergedAddressId) {
    throw new AddressMergeRefusedError({ kind: 'would_create_cycle' });
  }

  const moves: PlannedMove[] = [];
  const countsByRelation: Record<string, number> = {};

  for (const relation of await movableAddressRelations(db)) {
    const rows = await db.execute<{ id: string }>(
      sql`select ${sql.identifier(relation.table)}.id as id
          from ${sql.identifier(relation.table)}
          where ${pointsAt(relation, mergedAddressId)}
          order by ${sql.identifier(relation.table)}.id`,
    );
    const ids = [...rows].map((row) => row.id);
    countsByRelation[`${relation.table}.${relation.column}`] = ids.length;
    for (const rowId of ids) {
      moves.push({
        table: relation.table,
        column: relation.column,
        rowId,
        discriminator: relation.discriminator,
      });
    }
  }

  return {
    survivorAddressId: survivor.id,
    mergedAddressId,
    moves,
    countsByRelation,
    collisions: await findCollisions(db, survivor.id, mergedAddressId),
  };
}

/**
 * Rows a unique constraint would refuse.
 *
 * Only ONE constraint in this schema is keyed on an address column
 * (`reviews_author_address_key`, measured against `pg_indexes`), so it is
 * detected by name here — a generic "would any unique index refuse this update"
 * is not expressible without attempting the update. An UNKNOWN constraint is
 * therefore still possible, and {@link moveOne} converts one into the same
 * refusal rather than an opaque error, so the two paths agree about the outcome
 * and differ only in when it is discovered.
 */
async function findCollisions(
  db: DatabaseOrTransaction,
  survivorAddressId: string,
  mergedAddressId: string,
): Promise<readonly PlannedCollision[]> {
  const rows = await db.execute<{ id: string; oxy_user_id: string }>(sql`
    select loser.id as id, loser.oxy_user_id as oxy_user_id
    from reviews loser
    where loser.address_id = ${mergedAddressId}
      and exists (
        select 1 from reviews survivor
        where survivor.address_id = ${survivorAddressId}
          and survivor.oxy_user_id = loser.oxy_user_id
      )
    order by loser.id
  `);
  return [...rows].map((row) => ({
    table: 'reviews',
    column: 'address_id',
    rowId: row.id,
    constraint: 'reviews_author_address_key',
    detail:
      `author ${row.oxy_user_id} has reviewed both addresses; moving this review would ` +
      'give one author two reviews of one place, which the unique index refuses',
  }));
}

async function resolveExistingAddress(
  db: DatabaseOrTransaction,
  addressId: string,
): Promise<{ id: string; mergedInto: string | null }> {
  const [row] = await db
    .select({ id: addresses.id, mergedInto: addresses.mergedIntoAddressId })
    .from(addresses)
    .where(eq(addresses.id, addressId))
    .limit(1);
  if (!row) throw new AddressMergeRefusedError({ kind: 'address_not_found', addressId });
  return { id: row.id, mergedInto: row.mergedInto };
}

/**
 * Move one relation row, tolerating the unique violation that a legitimately
 * duplicated relation produces.
 *
 * The savepoint is `inSavepoint` — a NESTED DRIZZLE TRANSACTION — and not a
 * hand-issued `savepoint` / `rollback to`. The hand-rolled version behaves
 * correctly at every step a test can observe and then rejects at COMMIT with the
 * original duplicate-key error, because postgres.js records the failed query on
 * the transaction object and catching the rejection does not un-fail it. Only a
 * savepoint the DRIVER owns rolls its bookkeeping back too.
 */
async function moveOne(
  tx: Transaction,
  move: PlannedMove,
  survivorAddressId: string,
): Promise<AppliedMove> {
  try {
    await inSavepoint(tx, async (sp) =>
      sp.execute(
        sql`update ${sql.identifier(move.table)}
            set ${sql.identifier(move.column)} = ${survivorAddressId}
            where ${sql.identifier(move.table)}.id = ${move.rowId}`,
      ),
    );
    return { ...move, outcome: 'moved' };
  } catch (error) {
    // `isUniqueViolation` reads the SQLSTATE off `cause`, because drizzle wraps
    // the driver's error and `error.code` is undefined on the wrapper — a
    // predicate written against `error.code` is permanently false, so the
    // refusal below would never be reached and the merge would fail with an
    // opaque driver error instead.
    if (!isUniqueViolation(error)) throw error;
    // A constraint `findCollisions` does not know about. Same OUTCOME as a
    // predicted collision — the merge is refused whole — so the two paths cannot
    // disagree about what happens; they differ only in when it is discovered.
    throw new AddressMergeRefusedError({
      kind: 'unique_collision',
      collisions: [
        {
          table: move.table,
          column: move.column,
          rowId: move.rowId,
          constraint: constraintNameOf(error) ?? 'unknown_unique_constraint',
          detail:
            'a unique constraint refused this move, and it is not one ' +
            '`findCollisions` predicts — the merge is refused whole rather than ' +
            'leaving the row on a retired address',
        },
      ],
    });
  }
}

/**
 * Declare two rows the same place, in one transaction.
 *
 * The ORDER is the requirement the issue states as "no eliminar la entidad
 * origen antes de validar que todas las referencias se movieron": relations
 * move first, the redirect is written last, and both are inside one transaction
 * so neither can be observed without the other. Nothing is deleted at any point,
 * which is what makes the ordering a safety property rather than a race.
 */
export async function applyAddressMerge(
  input: AddressMergeInput,
  db: DatabaseOrTransaction = getDb(),
): Promise<AddressMergeResult> {
  const run = async (tx: Transaction): Promise<AddressMergeResult> => {
    const plan = await planAddressMerge(input, tx);
    // Refused WHOLE, before anything is written. The dry run reports the same
    // list, so an operator sees it without attempting the merge.
    if (plan.collisions.length > 0) {
      throw new AddressMergeRefusedError({
        kind: 'unique_collision',
        collisions: plan.collisions,
      });
    }

    const applied: AppliedMove[] = [];
    for (const move of plan.moves) {
      applied.push(await moveOne(tx, move, plan.survivorAddressId));
    }

    const movedCount = applied.length;

    // The redirect, written only now that every relation has been dealt with.
    await tx
      .update(addresses)
      .set({ mergedIntoAddressId: plan.survivorAddressId })
      .where(eq(addresses.id, plan.mergedAddressId));

    const [merge] = await tx
      .insert(addressMerges)
      .values({
        survivorAddressId: plan.survivorAddressId,
        mergedAddressId: plan.mergedAddressId,
        reasonCode: input.reasonCode,
        reason: input.reason,
        evidenceUrl: input.evidenceUrl ?? null,
        actorOxyUserId: input.actorOxyUserId ?? null,
        movedRelationCount: movedCount,
        appliedAt: new Date(),
      })
      .returning({ id: addressMerges.id });

    if (applied.length > 0) {
      await tx.insert(addressMergeRelationMoves).values(
        applied.map((move) => ({
          mergeId: merge.id,
          relationTable: move.table,
          relationColumn: move.column,
          relationRowId: move.rowId,
          previousAddressId: plan.mergedAddressId,
          outcome: move.outcome,
        })),
      );
    }

    return {
      mergeId: merge.id,
      survivorAddressId: plan.survivorAddressId,
      mergedAddressId: plan.mergedAddressId,
      moves: applied,
      movedCount,
    };
  };

  // A caller already inside a transaction gets its own; otherwise open one.
  return 'transaction' in db
    ? db.transaction((tx) => run(tx as Transaction))
    : run(db as Transaction);
}

export type AddressMergeRevertRefusal =
  | { readonly kind: 'merge_not_found'; readonly mergeId: string }
  | { readonly kind: 'already_reverted' }
  /** The loser has since lost ANOTHER merge; undoing out of order is unsafe. */
  | { readonly kind: 'superseded'; readonly currentSurvivorId: string }
  /** The move log does not carry the number of moves the merge recorded. */
  | { readonly kind: 'move_log_incomplete'; readonly expected: number; readonly found: number };

export class AddressMergeRevertRefusedError extends Error {
  constructor(readonly refusal: AddressMergeRevertRefusal) {
    super(`Address merge revert refused: ${refusal.kind}`);
    this.name = 'AddressMergeRevertRefusedError';
  }
}

/**
 * Undo a merge by replaying its log backwards.
 *
 * ## It replays, and never re-derives
 *
 * "Move everything currently on the survivor back to the loser" would be the
 * obvious implementation and is catastrophically wrong: the survivor has its own
 * relations, and some arrived after the merge. Only the itemised log knows which
 * rows this merge touched, which is the reason the log exists.
 *
 * ## The floor that makes a partial log a refusal rather than a partial undo
 *
 * `address_merges.moved_relation_count` was written by the apply, and the revert
 * asserts the log still holds exactly that many `moved` rows. A merge whose log
 * were truncated would otherwise be half-reverted silently — the shape of loss
 * this whole file exists to prevent. `0` is a legitimate count (merging a row
 * nothing references is ordinary), so the assertion is equality, never `> 0`.
 */
export async function revertAddressMerge(
  mergeId: string,
  actorOxyUserId: string | null,
  db: DatabaseOrTransaction = getDb(),
): Promise<{ restoredCount: number }> {
  const run = async (tx: Transaction): Promise<{ restoredCount: number }> => {
    const [merge] = await tx
      .select()
      .from(addressMerges)
      .where(eq(addressMerges.id, mergeId))
      .limit(1);
    if (!merge) throw new AddressMergeRevertRefusedError({ kind: 'merge_not_found', mergeId });
    if (merge.status === 'reverted') {
      throw new AddressMergeRevertRefusedError({ kind: 'already_reverted' });
    }

    // The loser must still redirect to THIS merge's survivor. If it redirects
    // somewhere else, a later merge moved it and undoing this one first would
    // leave the two logs describing a state neither produced.
    const loser = await resolveExistingAddress(tx, merge.mergedAddressId);
    if (loser.mergedInto !== merge.survivorAddressId) {
      throw new AddressMergeRevertRefusedError({
        kind: 'superseded',
        currentSurvivorId: loser.mergedInto ?? merge.mergedAddressId,
      });
    }

    const moves = await tx
      .select()
      .from(addressMergeRelationMoves)
      .where(eq(addressMergeRelationMoves.mergeId, mergeId));
    const moved = moves.filter((move) => move.outcome === 'moved');
    if (moved.length !== merge.movedRelationCount) {
      throw new AddressMergeRevertRefusedError({
        kind: 'move_log_incomplete',
        expected: merge.movedRelationCount,
        found: moved.length,
      });
    }

    // Clear the redirect FIRST: a row moving back to the loser while the loser
    // still redirects would be readable, through the matcher, as still living on
    // the survivor — a window in which the undo is half-visible. Inside one
    // transaction nobody can observe it, and doing it in the order that is
    // correct anyway costs nothing.
    await tx
      .update(addresses)
      .set({ mergedIntoAddressId: null })
      .where(eq(addresses.id, merge.mergedAddressId));

    for (const move of moved) {
      await tx.execute(
        sql`update ${sql.identifier(move.relationTable)}
            set ${sql.identifier(move.relationColumn)} = ${move.previousAddressId}
            where ${sql.identifier(move.relationTable)}.id = ${move.relationRowId}`,
      );
    }

    await tx
      .update(addressMerges)
      .set({
        status: 'reverted',
        revertedAt: new Date(),
        revertedByOxyUserId: actorOxyUserId,
      })
      .where(and(eq(addressMerges.id, mergeId), eq(addressMerges.status, 'applied')));

    return { restoredCount: moved.length };
  };

  return 'transaction' in db
    ? db.transaction((tx) => run(tx as Transaction))
    : run(db as Transaction);
}
