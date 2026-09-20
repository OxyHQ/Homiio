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
 *
 * ## "Per instant" is now "per OVERLAP", and that changed the answer
 *
 * A viewing occupies half an hour, not a point. The second rule above was
 * literally `scheduled_at = scheduled_at`, so two visits five minutes apart
 * were not a conflict — an owner could be double-booked all afternoon and every
 * check would pass. {@link findOverlappingViewing} replaces the equality; the
 * `duration_minutes` column is what makes the question askable, and the CHECK
 * bounding it is what keeps the query's index scan exhaustive. See that
 * function for why there is still no GiST index.
 */

import { and, asc, eq, gte, inArray, lt, ne, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import {
  MAX_VIEWING_DURATION_MINUTES,
  instantToZonedCivil,
  type ViewingModality,
} from '@homiio/shared-types';
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

/** In person, or over video. The tuple lives in `shared-types/viewing.ts`. */
export type ViewingModalityValue = ViewingModality;

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
 * Does anything on this property OVERLAP `[scheduledAt, +durationMinutes)`?
 *
 * ## This was an equality, and the equality was the bug
 *
 * The rule used to be `scheduled_at = scheduled_at`: a viewing was an instant,
 * so two requests five minutes apart were not a conflict and an owner could be
 * booked solid all afternoon with every check passing. A viewing takes TIME —
 * the half hour is the whole point of it — so the question is an overlap, in
 * the half-open convention `db/availability/occupancy.ts` uses everywhere: an
 * appointment ending exactly as another begins is not a conflict.
 *
 * ## Why this is not a GiST index, when every other range in the schema is
 *
 * `tstzrange(scheduled_at, scheduled_at + make_interval(mins => duration))`
 * cannot be indexed: `timestamptz + interval` is STABLE, not IMMUTABLE
 * (`pg_proc.provolatile` reports `s` for `timestamptz_pl_interval`, measured on
 * this repository's image and asserted in `__tests__/db/viewingOverlap.test.ts`)
 * and an expression index requires IMMUTABLE. That is a refusal from the
 * server, not a preference.
 *
 * What replaces it is a BOUNDED scan on the existing
 * `(property_id, scheduled_at, status)` btree. An appointment can only still be
 * running at `scheduledAt` if it began within `MAX_VIEWING_DURATION_MINUTES` of
 * it — which is true because `viewing_requests_duration_check` says so — so the
 * lower bound is a constant the index can seek to, and the overlap predicate
 * filters the handful of rows between the bounds. The CHECK is load-bearing
 * here: widen it and this query silently stops being exhaustive.
 *
 * @param excludeId A request to ignore — the one being rescheduled, or the one
 *   being approved. Without it a request would conflict with itself.
 */
export async function findOverlappingViewing(
  db: DatabaseOrTransaction,
  propertyId: string,
  scheduledAt: Date,
  durationMinutes: number,
  options: { readonly excludeId?: string; readonly statuses?: readonly ViewingStatusValue[] } = {},
): Promise<ViewingRow | undefined> {
  const endsAt = new Date(scheduledAt.getTime() + durationMinutes * 60_000);
  const earliestStart = new Date(
    scheduledAt.getTime() - MAX_VIEWING_DURATION_MINUTES * 60_000,
  );

  const clauses: SQL[] = [
    eq(viewingRequests.propertyId, propertyId),
    inArray(viewingRequests.status, [...(options.statuses ?? ACTIVE_VIEWING_STATUSES)]),
    // The index bounds. Exhaustive because of the duration CHECK — see above.
    gte(viewingRequests.scheduledAt, earliestStart),
    lt(viewingRequests.scheduledAt, endsAt),
    // The overlap itself. `[)` on both sides: back-to-back is not a conflict.
    sql`${viewingRequests.scheduledAt}
        + make_interval(mins => ${viewingRequests.durationMinutes}) > ${scheduledAt.toISOString()}::timestamptz`,
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
  readonly durationMinutes: number;
  readonly modality: ViewingModalityValue;
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
      durationMinutes: input.durationMinutes,
      modality: input.modality,
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
 *
 * `ownerResponse` moves in the SAME statement as the status, for the same
 * reason `cancelled_by` does: `viewing_requests_owner_response_status_check`
 * forbids words on a `pending` request, so writing them in a second update
 * would be a `23514` on a row the first statement had already decided. One
 * writer, one statement, and the transition carries what the owner said with
 * it.
 */
export async function decideViewing(
  db: DatabaseOrTransaction,
  id: string,
  ownerOxyUserId: string,
  status: Extract<ViewingStatusValue, 'approved' | 'declined'>,
  ownerResponse?: string,
): Promise<ViewingRow | undefined> {
  const [row] = await db
    .update(viewingRequests)
    .set(ownerResponse === undefined ? { status } : { status, ownerResponse })
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
  ownerResponse?: string,
): Promise<ViewingRow | undefined> {
  const values: Partial<typeof viewingRequests.$inferInsert> = {
    status: 'cancelled',
    cancelledBy,
  };
  // Only the owner has an `owner_response` to write; a requester cancelling
  // says whatever they say in their own `message`.
  if (cancelledBy === 'owner' && ownerResponse !== undefined) values.ownerResponse = ownerResponse;

  const [row] = await db
    .update(viewingRequests)
    .set(values)
    .where(and(eq(viewingRequests.id, id), ne(viewingRequests.status, 'cancelled')))
    .returning();
  return row;
}

/** Reschedule a PENDING request, requester-scoped. */
export async function rescheduleViewing(
  db: DatabaseOrTransaction,
  id: string,
  requesterOxyUserId: string,
  input: {
    readonly scheduledAt: Date;
    readonly durationMinutes: number;
    readonly modality: ViewingModalityValue;
    readonly message?: string;
  },
): Promise<ViewingRow | undefined> {
  const values: Partial<typeof viewingRequests.$inferInsert> = {
    scheduledAt: input.scheduledAt,
    durationMinutes: input.durationMinutes,
    modality: input.modality,
  };
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
 * Delete declined and cancelled requests last touched before `cutoff`.
 *
 * The Postgres half of `cleanupService`'s retention sweep. `VIEWING_REQUEST_
 * RETENTION_DAYS` stays in `cleanupService`, beside the RecentlyViewed window it
 * sits next to, so the two retention policies are read in one place.
 *
 * ## Why this one mattered more than the other stale readers
 *
 * When the table moved to Postgres this sweep kept issuing its `deleteMany`
 * against Mongo, so it reaped NOTHING — and unlike a read that returns an empty
 * list, a sweep that deletes nothing produces no output a caller can notice. Its
 * only symptom is disk, months later, by which time nobody connects it to a
 * migration. `db/expiry.ts` records the same hazard from the schema side: a
 * table ported without its sweep grows forever, with no error and no failing
 * test.
 *
 * `updated_at` is the retention key, exactly as in Mongo — it carries drizzle's
 * `$onUpdate`, so it moves when the request is declined or cancelled, which is
 * the instant the clock should start from.
 *
 * @param cutoff Rows with `updated_at` strictly before this are removed.
 * @returns How many rows went.
 */
export async function pruneClosedViewingsBefore(
  db: DatabaseOrTransaction,
  cutoff: Date,
): Promise<number> {
  const rows = await db
    .delete(viewingRequests)
    .where(
      and(
        inArray(viewingRequests.status, ['declined', 'cancelled']),
        lt(viewingRequests.updatedAt, cutoff),
      ),
    )
    .returning({ id: viewingRequests.id });
  return rows.length;
}

/**
 * Viewing requests received by a listing owner since `since`, grouped by status.
 *
 * The analytics rollup. A `group by` in SQL where Mongo used a `$group`
 * pipeline, so the five buckets come from one statement rather than five.
 */
export async function countViewingsByStatusForOwner(
  db: DatabaseOrTransaction,
  ownerOxyUserId: string,
  since: Date,
): Promise<readonly { status: string; count: number }[]> {
  return db
    .select({ status: viewingRequests.status, count: sql<number>`count(*)::int` })
    .from(viewingRequests)
    .where(
      and(
        eq(viewingRequests.ownerOxyUserId, ownerOxyUserId),
        sql`${viewingRequests.createdAt} >= ${since.toISOString()}::timestamptz`,
      ),
    )
    .groupBy(viewingRequests.status);
}

/**
 * The wire shape the viewings screen reads.
 *
 * `id`, never `_id` — the wire contract is PR #287's clean cut. The Mongoose
 * handlers returned `viewing.toJSON()`, i.e. every field, so this carries every
 * column; there is nothing on this table that is not the requester's to see.
 *
 * ## `timeZone`, `date` and `time` are derived here rather than on the client
 *
 * `scheduledAt` is an instant, so the day and clock time it lands on depend on
 * the zone it is read in — and the client's zone is not the home's. The screen
 * used to derive "10:00" with `toLocaleTimeString` in the DEVICE's zone, which
 * is how a viewing agreed for Tuesday morning in Madrid was shown as Monday
 * night to somebody in Los Angeles with nothing saying so. The property's zone
 * is resolved once, server side (`db/availability/viewingTimeZone.ts`), and the
 * civil reading travels WITH it so a surface can render "10:00 (Europe/Madrid)"
 * and mean it. The instant is still there: a client that wants the device's
 * clock has everything it needs to compute it, deliberately.
 *
 * @param timeZone The listing's viewing zone. Omitted only where the caller
 *   genuinely has no listing in hand, in which case no civil reading is sent
 *   rather than one in some convenient zone.
 */
export function serializeViewing(
  row: ViewingRow,
  timeZone?: string,
): Record<string, unknown> {
  const civil = timeZone ? instantToZonedCivil(row.scheduledAt, timeZone) : null;
  return {
    id: row.id,
    propertyId: row.propertyId,
    requesterOxyUserId: row.requesterOxyUserId,
    ownerOxyUserId: row.ownerOxyUserId,
    scheduledAt: row.scheduledAt,
    durationMinutes: row.durationMinutes,
    modality: row.modality,
    timeZone: timeZone ?? null,
    date: civil?.date ?? null,
    time: civil?.time ?? null,
    message: row.message,
    ownerResponse: row.ownerResponse,
    status: row.status,
    cancelledBy: row.cancelledBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
