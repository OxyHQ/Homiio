/**
 * `roommate_requests` and `roommate_relationships` — the roommate handshake.
 *
 * Ported from `models/schemas/RoommateRequestSchema.ts` and
 * `models/schemas/RoommateRelationshipSchema.ts`. Both empty in production.
 *
 * Accepting a request creates a relationship (`roommateController`), which is
 * the one durable record; the request stays as the audit link that produced it.
 */

import { check, doublePrecision, index, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { createdAt, generatedId, inList, timestamptz, updatedAt } from '@oxyhq/db';

export const ROOMMATE_REQUEST_STATUSES = ['pending', 'accepted', 'declined'] as const;
export const ROOMMATE_RELATIONSHIP_STATUSES = ['active', 'ended'] as const;

export const roommateRequests = pgTable(
  'roommate_requests',
  {
    id: generatedId(),

    fromOxyUserId: text().notNull(),
    toOxyUserId: text().notNull(),
    message: text(),
    status: text({ enum: ROOMMATE_REQUEST_STATUSES }).notNull().default('pending'),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    /**
     * At most one PENDING request per ordered pair — Mongo's
     * `partialFilterExpression: { status: 'pending' }`, which
     * `CONVENTIONS.md` maps directly onto a Postgres partial unique index.
     *
     * Partial rather than plain, and the partiality is the whole point: a
     * declined request must not stop the same person asking again later.
     */
    uniqueIndex('roommate_requests_pending_pair_key')
      .on(table.fromOxyUserId, table.toOxyUserId)
      .where(sql`${table.status} = 'pending'`),
    // Mongo's standalone `{ fromOxyUserId: 1 }` is the leading prefix of the
    // partial index above — but a PARTIAL index cannot serve an unfiltered
    // prefix scan, so the sender's own list ("requests I have sent", any status)
    // needs its own index. That asymmetry with a plain unique index is exactly
    // the kind of thing that reads as a duplicate and is not.
    index('roommate_requests_from_idx').on(table.fromOxyUserId),
    index('roommate_requests_to_status_idx').on(table.toOxyUserId, table.status),
    check(
      'roommate_requests_status_check',
      sql`${table.status} in (${sql.raw(inList(ROOMMATE_REQUEST_STATUSES))})`,
    ),
    /** Nobody rooms with themselves. Both ids are resolved server-side. */
    check(
      'roommate_requests_distinct_parties_check',
      sql`${table.fromOxyUserId} <> ${table.toOxyUserId}`,
    ),
  ],
);

export const roommateRelationships = pgTable(
  'roommate_relationships',
  {
    id: generatedId(),

    /**
     * The pair, stored SORTED (`oxy_user1_id < oxy_user2_id` by string) so one
     * pair maps to one canonical row regardless of who asked.
     *
     * The sort is what makes the partial unique index below mean "at most one
     * active relationship between these two people" rather than "at most one per
     * direction". Mongo stated it in a doc comment and enforced nothing, so a
     * writer that skipped the sort produced a second, invisible row for the same
     * pair. The CHECK makes it a property of the row.
     */
    oxyUser1Id: text().notNull(),
    oxyUser2Id: text().notNull(),

    /**
     * The request whose acceptance created this relationship.
     *
     * SET NULL: the audit link is nice to have and the relationship is the
     * durable fact — deleting a request must not delete the tenancy it produced.
     * NULL already means "created without a request" (the schema declares it
     * optional), so the action introduces no second meaning.
     */
    requestId: text().references(() => roommateRequests.id, { onDelete: 'set null' }),

    matchScore: doublePrecision().notNull().default(0),
    status: text({ enum: ROOMMATE_RELATIONSHIP_STATUSES }).notNull().default('active'),
    startDate: timestamptz().notNull(),
    endDate: timestamptz(),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    /** At most one ACTIVE relationship per sorted pair — Mongo's partial unique index. */
    uniqueIndex('roommate_relationships_active_pair_key')
      .on(table.oxyUser1Id, table.oxyUser2Id)
      .where(sql`${table.status} = 'active'`),
    // "My roommates", from either side. Neither is served by the partial unique
    // index above, for the same reason as `roommate_requests_from_idx`.
    index('roommate_relationships_user1_idx').on(table.oxyUser1Id),
    index('roommate_relationships_user2_idx').on(table.oxyUser2Id),
    check(
      'roommate_relationships_status_check',
      sql`${table.status} in (${sql.raw(inList(ROOMMATE_RELATIONSHIP_STATUSES))})`,
    ),
    /** The canonical ordering. Also rules out a self-relationship, since `x < x` is false. */
    check('roommate_relationships_sorted_pair_check', sql`${table.oxyUser1Id} < ${table.oxyUser2Id}`),
    /** `min: 0, max: 100` from the schema. Empty table, nothing to reject. */
    check('roommate_relationships_match_score_check', sql`${table.matchScore} between 0 and 100`),
    check(
      'roommate_relationships_order_check',
      sql`${table.endDate} is null or ${table.endDate} >= ${table.startDate}`,
    ),
  ],
);
