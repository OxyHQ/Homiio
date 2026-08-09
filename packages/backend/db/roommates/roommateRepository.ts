/**
 * `roommate_requests` and `roommate_relationships` — the roommate handshake, on
 * Postgres.
 *
 * Both empty in production, so this port has no backfill and no consistency
 * window.
 *
 * ## Three read-then-writes became indexes, and none is re-implemented
 *
 * **"Is there already a pending request between these two?"** was a `$or` over
 * both directions followed by an insert — a window two concurrent requests both
 * pass. `roommate_requests_pending_pair_key` is a PARTIAL unique index on the
 * ORDERED pair, so the insert itself is the check. It only covers one direction,
 * which is deliberate and is why {@link createRoommateRequest} still refuses a
 * reverse-direction pending request explicitly: the two people asking each other
 * simultaneously is a real state, and the index cannot express "in either
 * direction" (a partial unique index has no expression form that normalises the
 * pair without also collapsing the sender, which the sent/received lists need).
 *
 * **"Does this pair already have an active relationship?"** was a
 * `findOneAndUpdate` upsert, which under concurrency inserts twice.
 * `roommate_relationships_active_pair_key` is a partial unique index on the
 * SORTED pair, so {@link acceptRoommateRequest} inserts and converges on `23505`.
 *
 * ## The pair is SORTED before it is written, and the CHECK is why that is safe
 *
 * `roommate_relationships_sorted_pair_check` enforces `oxy_user1_id <
 * oxy_user2_id`. Mongo stated the ordering in a doc comment and enforced
 * nothing, so a writer that skipped the sort produced a second, invisible row
 * for the same pair — and the "at most one active relationship" rule silently
 * stopped holding. {@link sortPair} is the one place the ordering is applied,
 * and the CHECK is what makes forgetting it a loud `23514` rather than a quiet
 * duplicate.
 *
 * The same CHECK rules out a self-relationship for free, since `x < x` is false.
 */

import { and, desc, eq, or } from 'drizzle-orm';
import type { DatabaseOrTransaction } from '../postgres';
import { roommateRelationships, roommateRequests } from '../schema';
import { isUniqueViolation } from '../uniqueViolation';

export type RoommateRequestRow = typeof roommateRequests.$inferSelect;
export type RoommateRelationshipRow = typeof roommateRelationships.$inferSelect;

/** A pending request already exists between these two people. */
export class PendingRoommateRequestExistsError extends Error {
  constructor() {
    super('A pending roommate request already exists between these users.');
    this.name = 'PendingRoommateRequestExistsError';
  }
}

/**
 * The canonical ordering for a relationship pair.
 *
 * Exported so a test can assert the stored row really is sorted rather than
 * trusting that the writer remembered — the property the CHECK exists to make
 * unforgettable.
 */
export function sortPair(a: string, b: string): readonly [string, string] {
  return a < b ? [a, b] : [b, a];
}

/**
 * Open a request.
 *
 * @throws {PendingRoommateRequestExistsError} When one is already pending
 *   between the two, in EITHER direction. The forward direction comes from the
 *   partial unique index's own `23505`; the reverse is a read, because no index
 *   can express it — see the header.
 */
export async function createRoommateRequest(
  db: DatabaseOrTransaction,
  input: { readonly fromOxyUserId: string; readonly toOxyUserId: string; readonly message?: string },
): Promise<RoommateRequestRow> {
  const reverse = await findPendingRequestBetween(db, input.toOxyUserId, input.fromOxyUserId);
  if (reverse) throw new PendingRoommateRequestExistsError();

  try {
    const [row] = await db
      .insert(roommateRequests)
      .values({
        fromOxyUserId: input.fromOxyUserId,
        toOxyUserId: input.toOxyUserId,
        message: input.message,
      })
      .returning();
    return row;
  } catch (error) {
    if (isUniqueViolation(error, 'roommate_requests_pending_pair_key')) {
      throw new PendingRoommateRequestExistsError();
    }
    throw error;
  }
}

/** The pending request from `fromOxyUserId` to `toOxyUserId`, if there is one. */
export async function findPendingRequestBetween(
  db: DatabaseOrTransaction,
  fromOxyUserId: string,
  toOxyUserId: string,
): Promise<RoommateRequestRow | undefined> {
  const [row] = await db
    .select()
    .from(roommateRequests)
    .where(
      and(
        eq(roommateRequests.fromOxyUserId, fromOxyUserId),
        eq(roommateRequests.toOxyUserId, toOxyUserId),
        eq(roommateRequests.status, 'pending'),
      ),
    )
    .limit(1);
  return row;
}

export interface RoommateRequestLists {
  readonly sent: readonly RoommateRequestRow[];
  readonly received: readonly RoommateRequestRow[];
}

/** Both sides of a person's request list, newest first. */
export async function listRoommateRequests(
  db: DatabaseOrTransaction,
  oxyUserId: string,
): Promise<RoommateRequestLists> {
  const [sent, received] = await Promise.all([
    db
      .select()
      .from(roommateRequests)
      .where(eq(roommateRequests.fromOxyUserId, oxyUserId))
      .orderBy(desc(roommateRequests.createdAt)),
    db
      .select()
      .from(roommateRequests)
      .where(eq(roommateRequests.toOxyUserId, oxyUserId))
      .orderBy(desc(roommateRequests.createdAt)),
  ]);
  return { sent, received };
}

/**
 * Move a PENDING request to `accepted` or `declined`, and only if `oxyUserId` is
 * its recipient.
 *
 * The recipient and the `pending` status are both in the `UPDATE`'s predicate
 * rather than checked first: that is what makes a double-accept answer
 * `undefined` for the second caller instead of running the acceptance twice.
 */
export async function respondToRoommateRequest(
  db: DatabaseOrTransaction,
  requestId: string,
  recipientOxyUserId: string,
  status: 'accepted' | 'declined',
): Promise<RoommateRequestRow | undefined> {
  const [row] = await db
    .update(roommateRequests)
    .set({ status })
    .where(
      and(
        eq(roommateRequests.id, requestId),
        eq(roommateRequests.toOxyUserId, recipientOxyUserId),
        eq(roommateRequests.status, 'pending'),
      ),
    )
    .returning();
  return row;
}

/**
 * The active relationship for an accepted request, created if it is not there.
 *
 * Idempotent by the partial unique index rather than by a preceding read: two
 * concurrent accepts of two different requests between the same pair both
 * insert, one gets `23505`, and both end up looking at the one row.
 */
export async function ensureActiveRelationship(
  db: DatabaseOrTransaction,
  input: {
    readonly requestId: string;
    readonly fromOxyUserId: string;
    readonly toOxyUserId: string;
    readonly matchScore: number;
  },
): Promise<RoommateRelationshipRow> {
  const [oxyUser1Id, oxyUser2Id] = sortPair(input.fromOxyUserId, input.toOxyUserId);

  try {
    const [row] = await db
      .insert(roommateRelationships)
      .values({
        oxyUser1Id,
        oxyUser2Id,
        requestId: input.requestId,
        matchScore: input.matchScore,
        status: 'active',
        startDate: new Date(),
      })
      .returning();
    return row;
  } catch (error) {
    if (!isUniqueViolation(error, 'roommate_relationships_active_pair_key')) throw error;
    const existing = await findActiveRelationshipBetween(db, oxyUser1Id, oxyUser2Id);
    if (!existing) {
      // The index refused the insert, so a row satisfying it existed at that
      // instant. Not finding it now means it was ended in between — a real
      // state, and one the caller must not be handed a fabricated row for.
      throw error;
    }
    return existing;
  }
}

/** The active relationship between a SORTED pair, if there is one. */
export async function findActiveRelationshipBetween(
  db: DatabaseOrTransaction,
  oxyUser1Id: string,
  oxyUser2Id: string,
): Promise<RoommateRelationshipRow | undefined> {
  const [row] = await db
    .select()
    .from(roommateRelationships)
    .where(
      and(
        eq(roommateRelationships.oxyUser1Id, oxyUser1Id),
        eq(roommateRelationships.oxyUser2Id, oxyUser2Id),
        eq(roommateRelationships.status, 'active'),
      ),
    )
    .limit(1);
  return row;
}

/** Every relationship this person is a party to, either side, newest first. */
export async function listRoommateRelationships(
  db: DatabaseOrTransaction,
  oxyUserId: string,
): Promise<readonly RoommateRelationshipRow[]> {
  return db
    .select()
    .from(roommateRelationships)
    .where(
      or(
        eq(roommateRelationships.oxyUser1Id, oxyUserId),
        eq(roommateRelationships.oxyUser2Id, oxyUserId),
      ),
    )
    .orderBy(desc(roommateRelationships.createdAt));
}

/**
 * End an ACTIVE relationship, and only if `oxyUserId` is one of its two parties.
 *
 * `end_date` is written in the same statement as the status, because
 * `roommate_relationships_order_check` only constrains the two against each
 * other — nothing would stop an `ended` row with no end date, which is a
 * relationship nobody can say when they left.
 */
export async function endRoommateRelationship(
  db: DatabaseOrTransaction,
  relationshipId: string,
  oxyUserId: string,
): Promise<RoommateRelationshipRow | undefined> {
  const [row] = await db
    .update(roommateRelationships)
    .set({ status: 'ended', endDate: new Date() })
    .where(
      and(
        eq(roommateRelationships.id, relationshipId),
        eq(roommateRelationships.status, 'active'),
        or(
          eq(roommateRelationships.oxyUser1Id, oxyUserId),
          eq(roommateRelationships.oxyUser2Id, oxyUserId),
        ),
      ),
    )
    .returning();
  return row;
}

/**
 * `match_score` clamped into the range `roommate_relationships_match_score_check`
 * accepts.
 *
 * The scorer is a percentage by construction, but it is arithmetic over
 * user-supplied preference data — and a value outside `[0, 100]` would be a
 * `23514` that fails the ACCEPT of a request the recipient really made, over a
 * number that is decoration on the row. Clamping keeps the constraint's promise
 * while refusing to let it break the handshake.
 */
export function clampMatchScore(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
}

/** The wire shape the roommate screens read for a request. */
export function toRoommateRequestDTO(row: RoommateRequestRow): Record<string, unknown> {
  return {
    id: row.id,
    fromOxyUserId: row.fromOxyUserId,
    toOxyUserId: row.toOxyUserId,
    message: row.message,
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
