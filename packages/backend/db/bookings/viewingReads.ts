/**
 * `viewing_requests` — the in-person tour, on Postgres.
 *
 * Empty in production, so this port has no backfill and no consistency window.
 *
 * ## `cancelled_by` is now an EQUIVALENCE, and it is the database's
 *
 * `viewing_requests_cancelled_by_status_check` states
 * `(status = 'cancelled') = (cancelled_by is not null)`. Mongo allowed a
 * `pending` request to name a canceller and — the damaging half — a `cancelled`
 * one to name nobody, which is a cancellation neither party can be shown to have
 * made. {@link cancelViewing} therefore writes both columns in ONE statement, and
 * {@link approveViewing} / {@link declineViewing} cannot reach a state where one
 * is set without the other.
 *
 * ## Two conflict rules, and why neither is a unique index
 *
 * "One active request per person per property" and "one active request per
 * property per instant" are both scoped to the ACTIVE statuses
 * (`pending`, `approved`), and Postgres has no partial unique index over a
 * status SET that also permits the historical rows — a declined request and a
 * cancelled one must not block a re-request. They stay reads, and the
 * `viewing_requests_property_scheduled_status_idx` compound is what serves them.
 *
 * That is a genuine difference from `roommate_requests`, where the active set is
 * the single value `pending` and the rule IS an index. The distinction is the
 * cardinality of the predicate, not a preference.
 */

import { and, asc, eq, inArray, ne, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import type { DatabaseOrTransaction } from '../postgres';
import { viewingRequests } from '../schema';
import {
  VIEWING_REQUEST_CANCELLERS,
  VIEWING_REQUEST_STATUSES,
} from '../schema/bookings';

/** A viewing status the CHECK accepts. */
export type ViewingStatusValue = (typeof VIEWING_REQUEST_STATUSES)[number];

/** Which side cancelled. */
export type ViewingCancellerValue = (typeof VIEWING_REQUEST_CANCELLERS)[number];

export type ViewingRow = typeof viewingRequests.$inferSelect;

/**
 * The statuses that occupy a slot.
 *
 * Declared once because THREE reads share it — the per-person guard, the
 * per-instant guard, and the approval re-check — and two of them disagreeing
 * about what "active" means is how a double-booking arrives.
 */
export const ACTIVE_VIEWING_STATUSES: readonly ViewingStatusValue[] = ['pending', 'approved'];

/** Whether `value` is one of the four declared statuses. */
export function isViewingStatus(value: unknown): value is ViewingStatusValue {
  return (
    typeof value === 'string' && (VIEWING_REQUEST_STATUSES as readonly string[]).includes(value)
  );
}

/** One viewing request by id. */
export async function findViewingById(
  db: DatabaseOrTransaction,
  id: string,
): Promise<ViewingRow | undefined> {
  const [row] = await db
    .select()
    .from(viewingRequests)
    .where(eq(viewingRequests.id, id))
    .limit(1);
  return row;
}

/** Does this person already hold an active request on this property? */
export async function findActiveViewingForRequester(
  db: DatabaseOrTransaction,
  propertyId: string,
  requesterOxyUserId: string,
): Promise<ViewingRow | undefined> {
  const [row] = await db
    .select()
    .from(viewingRequests)
    .where(
      and(
        eq(viewingRequests.propertyId, propertyId),
        eq(viewingRequests.requesterOxyUserId, requesterOxyUserId),
        inArray(viewingRequests.status, [...ACTIVE_VIEWING_STATUSES]),
      ),
    )
    .limit(1);
  return row;
}

/**
 * Is this instant already taken on this property?
 *
 * @param excludeId A request to ignore — the one being rescheduled, or the one
 *   being approved. Without it a request would conflict with itself.
 */
export async function findViewingAtInstant(
  db: DatabaseOrTransaction,
  propertyId: string,
  scheduledAt: Date,
  options: { readonly excludeId?: string; readonly statuses?: readonly ViewingStatusValue[] } = {},
): Promise<ViewingRow | undefined> {
  const clauses: SQL[] = [
    eq(viewingRequests.propertyId, propertyId),
    eq(viewingRequests.scheduledAt, scheduledAt),
    inArray(viewingRequests.status, [...(options.statuses ?? ACTIVE_VIEWING_STATUSES)]),
  ];
  if (options.excludeId !== undefined) clauses.push(ne(viewingRequests.id, options.excludeId));

  const [row] = await db
    .select()
    .from(viewingRequests)
    .where(and(...clauses) as SQL)
    .limit(1);
  return row;
}

export interface CreateViewingInput {
  readonly propertyId: string;
  readonly requesterOxyUserId: string;
  readonly ownerOxyUserId: string;
  readonly scheduledAt: Date;
  readonly message?: string;
}

/** Open a viewing request. Always `pending`, never from the body. */
export async function createViewing(
  db: DatabaseOrTransaction,
  input: CreateViewingInput,
): Promise<ViewingRow> {
  const [row] = await db
    .insert(viewingRequests)
    .values({
      propertyId: input.propertyId,
      requesterOxyUserId: input.requesterOxyUserId,
      ownerOxyUserId: input.ownerOxyUserId,
      scheduledAt: input.scheduledAt,
      message: input.message,
      status: 'pending',
    })
    .returning();
  return row;
}

export interface ListViewingsFilter {
  readonly requesterOxyUserId?: string;
  readonly propertyId?: string;
  readonly status?: ViewingStatusValue;
}

/** The predicate shared by the page and its `count(*)`, so the two agree. */
function listFilter(filter: ListViewingsFilter): SQL {
  const clauses: SQL[] = [];
  if (filter.requesterOxyUserId !== undefined) {
    clauses.push(eq(viewingRequests.requesterOxyUserId, filter.requesterOxyUserId));
  }
  if (filter.propertyId !== undefined) {
    clauses.push(eq(viewingRequests.propertyId, filter.propertyId));
  }
  if (filter.status !== undefined) clauses.push(eq(viewingRequests.status, filter.status));
  // Every caller supplies at least one clause; `sql\`true\`` is the honest
  // identity rather than a cast that pretends an empty `and` is an SQL.
  return clauses.length > 0 ? (and(...clauses) as SQL) : sql`true`;
}

export interface ListViewingsResult {
  readonly rows: readonly ViewingRow[];
  readonly total: number;
}

/** One page of viewing requests, soonest first. */
export async function listViewings(
  db: DatabaseOrTransaction,
  filter: ListViewingsFilter,
  page: { readonly limit: number; readonly offset: number },
): Promise<ListViewingsResult> {
  const where = listFilter(filter);
  const [rows, [totalRow]] = await Promise.all([
    db
      .select()
      .from(viewingRequests)
      .where(where)
      .orderBy(asc(viewingRequests.scheduledAt))
      .limit(page.limit)
      .offset(page.offset),
    db
      .select({ value: sql<number>`count(*)::int` })
      .from(viewingRequests)
      .where(where),
  ]);
  return { rows, total: totalRow.value };
}

/**
 * Move a PENDING request to `approved` or `declined`, owner-scoped.
 *
 * The owner and the `pending` status are both in the `UPDATE`'s predicate, so a
 * second approval matches no row instead of re-running the transition — and two
 * concurrent approvals cannot both succeed.
 *
 * `cancelled_by` is deliberately not written: it is NULL already, and the CHECK
 * requires it to stay that way for any status but `cancelled`.
 */
export async function decideViewing(
  db: DatabaseOrTransaction,
  id: string,
  ownerOxyUserId: string,
  status: Extract<ViewingStatusValue, 'approved' | 'declined'>,
): Promise<ViewingRow | undefined> {
  const [row] = await db
    .update(viewingRequests)
    .set({ status })
    .where(
      and(
        eq(viewingRequests.id, id),
        eq(viewingRequests.ownerOxyUserId, ownerOxyUserId),
        eq(viewingRequests.status, 'pending'),
      ),
    )
    .returning();
  return row;
}

/**
 * Cancel a request, recording WHICH side did it.
 *
 * Both columns move in one statement — the CHECK is an equivalence, so writing
 * the status alone is a `23514` and writing the canceller alone is one too.
 */
export async function cancelViewing(
  db: DatabaseOrTransaction,
  id: string,
  cancelledBy: ViewingCancellerValue,
): Promise<ViewingRow | undefined> {
  const [row] = await db
    .update(viewingRequests)
    .set({ status: 'cancelled', cancelledBy })
    .where(and(eq(viewingRequests.id, id), ne(viewingRequests.status, 'cancelled')))
    .returning();
  return row;
}

/** Reschedule a PENDING request, requester-scoped. */
export async function rescheduleViewing(
  db: DatabaseOrTransaction,
  id: string,
  requesterOxyUserId: string,
  input: { readonly scheduledAt: Date; readonly message?: string },
): Promise<ViewingRow | undefined> {
  const values: Partial<typeof viewingRequests.$inferInsert> = { scheduledAt: input.scheduledAt };
  if (input.message !== undefined) values.message = input.message;

  const [row] = await db
    .update(viewingRequests)
    .set(values)
    .where(
      and(
        eq(viewingRequests.id, id),
        eq(viewingRequests.requesterOxyUserId, requesterOxyUserId),
        eq(viewingRequests.status, 'pending'),
      ),
    )
    .returning();
  return row;
}

/**
 * The wire shape the viewings screen reads.
 *
 * `id`, never `_id` — the wire contract is PR #287's clean cut. The Mongoose
 * handlers returned `viewing.toJSON()`, i.e. every field, so this carries every
 * column; there is nothing on this table that is not the requester's to see.
 */
export function serializeViewing(row: ViewingRow): Record<string, unknown> {
  return {
    id: row.id,
    propertyId: row.propertyId,
    requesterOxyUserId: row.requesterOxyUserId,
    ownerOxyUserId: row.ownerOxyUserId,
    scheduledAt: row.scheduledAt,
    message: row.message,
    status: row.status,
    cancelledBy: row.cancelledBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
