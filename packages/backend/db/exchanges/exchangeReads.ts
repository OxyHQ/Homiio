/**
 * `exchange_requests` — the home-swap and free-hosting flow, on Postgres.
 *
 * Empty in production, so this port has no backfill and no consistency window.
 *
 * ## The conflict scan becomes ONE overlap query
 *
 * `hasPropertyConflict` loaded EVERY confirmed exchange touching a property,
 * hydrated both windows and overlapped them in JavaScript — a full scan of the
 * committed set per request, growing with the table. Postgres answers it with a
 * range overlap, and `exchange_requests_requested_window_gist` exists precisely
 * for the target half.
 *
 * **`tstzrange(a, b)` is HALF-OPEN `[)` by default**, which is what the schema's
 * GiST index uses and what `utils/availabilityUtils.windowsOverlap` means: a
 * stay ending exactly when the next begins is NOT a conflict. Writing `'[]'`
 * here — the spelling `leases_term_range_gist` correctly uses — would make
 * adjacent stays collide and silently refuse legitimate bookings.
 *
 * A property can be committed in TWO roles and both are checked, because a swap
 * must not double-book the home the requester offers in return:
 *
 *  - as the TARGET of a confirmed exchange (`property_id` + requested window),
 *  - as the OFFERED home of a confirmed swap (`offered_property_id` + offered
 *    window).
 *
 * Only the first is index-backed today. The second is a filtered scan, which is
 * correct and — on a table with no rows — costs nothing measurable; an index for
 * it would be speculative under `CONVENTIONS.md`'s rule, and it needs a
 * migration rather than a line in a code port. Recorded so whoever measures a
 * real workload knows where to look.
 *
 * ## Two CHECKs the writer has to respect
 *
 * `exchange_requests_offered_window_check` is ALL-OR-NONE plus ordered, and
 * `exchange_requests_host_mode_offers_nothing_check` says a `host` request
 * offers nothing — the port of a `pre('save')` hook that `findOneAndUpdate`
 * walked straight past. {@link createExchangeRequest} writes the offered trio
 * together or not at all, which satisfies both by construction.
 */

import { and, desc, eq, inArray, ne, or, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import type { DatabaseOrTransaction } from '../postgres';
import { exchangeRequests } from '../schema';
import {
  EXCHANGE_REQUEST_MODES,
  EXCHANGE_REQUEST_STATUSES,
} from '../schema/exchanges';

/** An exchange mode the CHECK accepts. */
export type ExchangeModeValue = (typeof EXCHANGE_REQUEST_MODES)[number];

/** An exchange status the CHECK accepts. */
export type ExchangeStatusValue = (typeof EXCHANGE_REQUEST_STATUSES)[number];

export type ExchangeRequestRow = typeof exchangeRequests.$inferSelect;

/**
 * The statuses that occupy the calendar.
 *
 * Only a CONFIRMED exchange blocks — a pending request is a proposal, and two
 * people may propose the same dates. Declared once because the create-time and
 * confirm-time checks share it.
 */
export const BLOCKING_EXCHANGE_STATUSES: readonly ExchangeStatusValue[] = ['confirmed'];

/** Whether `value` is one of the five declared statuses. */
export function isExchangeStatus(value: unknown): value is ExchangeStatusValue {
  return (
    typeof value === 'string' && (EXCHANGE_REQUEST_STATUSES as readonly string[]).includes(value)
  );
}

/** A half-open window `[start, end)`. */
export interface ExchangeWindowInput {
  readonly start: Date;
  readonly end: Date;
}

/**
 * Is `propertyId` already committed over `window`, in EITHER role?
 *
 * @param excludeId The request being confirmed, so it never conflicts with
 *   itself.
 */
export async function hasPropertyConflict(
  db: DatabaseOrTransaction,
  propertyId: string,
  window: ExchangeWindowInput,
  options: { readonly excludeId?: string } = {},
): Promise<boolean> {
  // `tstzrange(a, b)` — default `[)` bounds. See the header: `'[]'` here would
  // make two adjacent stays collide.
  //
  // The two bounds are bound as ISO STRINGS with an explicit `::timestamptz`,
  // not as `Date`s. postgres.js infers a parameter's wire type from its position
  // and cannot do so inside `tstzrange(...)` — a bare `Date` there fails at
  // SERIALISATION with `The "string" argument must be of type string ... Received
  // an instance of Date`, before the server ever sees the statement. The cast is
  // what tells it, and it also states the type the range is built from.
  const start = window.start.toISOString();
  const end = window.end.toISOString();

  const overlapsRequested = sql`
    ${exchangeRequests.propertyId} = ${propertyId}
    and tstzrange(${exchangeRequests.requestedWindowStart}, ${exchangeRequests.requestedWindowEnd})
        && tstzrange(${start}::timestamptz, ${end}::timestamptz)`;

  // The offered window is nullable, and `tstzrange(null, null)` is NULL rather
  // than an error — so a row with no offered window simply never overlaps, which
  // is the answer we want and needs no extra predicate.
  const overlapsOffered = sql`
    ${exchangeRequests.offeredPropertyId} = ${propertyId}
    and tstzrange(${exchangeRequests.offeredWindowStart}, ${exchangeRequests.offeredWindowEnd})
        && tstzrange(${start}::timestamptz, ${end}::timestamptz)`;

  const clauses: SQL[] = [
    inArray(exchangeRequests.status, [...BLOCKING_EXCHANGE_STATUSES]),
    or(overlapsRequested, overlapsOffered) as SQL,
  ];
  if (options.excludeId !== undefined) clauses.push(ne(exchangeRequests.id, options.excludeId));

  const [row] = await db
    .select({ id: exchangeRequests.id })
    .from(exchangeRequests)
    .where(and(...clauses) as SQL)
    .limit(1);
  return row !== undefined;
}

export interface CreateExchangeRequestInput {
  readonly propertyId: string;
  readonly requesterOxyUserId: string;
  readonly hostOxyUserId: string;
  readonly mode: ExchangeModeValue;
  readonly requestedWindow: ExchangeWindowInput;
  /** SWAP only. Written as a trio with the offered window, or not at all. */
  readonly offeredPropertyId?: string;
  readonly offeredWindow?: ExchangeWindowInput;
  readonly message?: string;
}

/**
 * Open an exchange request. Always `pending`, never from the body.
 *
 * The offered property and window are written TOGETHER or omitted together,
 * which is what `exchange_requests_offered_window_check` (all-or-none) and
 * `exchange_requests_host_mode_offers_nothing_check` both require.
 */
export async function createExchangeRequest(
  db: DatabaseOrTransaction,
  input: CreateExchangeRequestInput,
): Promise<ExchangeRequestRow> {
  const [row] = await db
    .insert(exchangeRequests)
    .values({
      propertyId: input.propertyId,
      requesterOxyUserId: input.requesterOxyUserId,
      hostOxyUserId: input.hostOxyUserId,
      mode: input.mode,
      requestedWindowStart: input.requestedWindow.start,
      requestedWindowEnd: input.requestedWindow.end,
      offeredPropertyId: input.offeredPropertyId,
      offeredWindowStart: input.offeredWindow?.start,
      offeredWindowEnd: input.offeredWindow?.end,
      message: input.message,
      status: 'pending',
    })
    .returning();
  return row;
}

/** One exchange request by id. */
export async function findExchangeRequestById(
  db: DatabaseOrTransaction,
  id: string,
): Promise<ExchangeRequestRow | undefined> {
  const [row] = await db
    .select()
    .from(exchangeRequests)
    .where(eq(exchangeRequests.id, id))
    .limit(1);
  return row;
}

export interface ListExchangeRequestsFilter {
  readonly requesterOxyUserId?: string;
  readonly hostOxyUserId?: string;
  readonly status?: ExchangeStatusValue;
}

/** The predicate shared by the page and its `count(*)`, so the two agree. */
function listFilter(filter: ListExchangeRequestsFilter): SQL {
  const clauses: SQL[] = [];
  if (filter.requesterOxyUserId !== undefined) {
    clauses.push(eq(exchangeRequests.requesterOxyUserId, filter.requesterOxyUserId));
  }
  if (filter.hostOxyUserId !== undefined) {
    clauses.push(eq(exchangeRequests.hostOxyUserId, filter.hostOxyUserId));
  }
  if (filter.status !== undefined) clauses.push(eq(exchangeRequests.status, filter.status));
  return clauses.length > 0 ? (and(...clauses) as SQL) : sql`true`;
}

export interface ListExchangeRequestsResult {
  readonly rows: readonly ExchangeRequestRow[];
  readonly total: number;
}

/** One page of exchange requests, newest first. */
export async function listExchangeRequests(
  db: DatabaseOrTransaction,
  filter: ListExchangeRequestsFilter,
  page: { readonly limit: number; readonly offset: number },
): Promise<ListExchangeRequestsResult> {
  const where = listFilter(filter);
  const [rows, [totalRow]] = await Promise.all([
    db
      .select()
      .from(exchangeRequests)
      .where(where)
      .orderBy(desc(exchangeRequests.createdAt))
      .limit(page.limit)
      .offset(page.offset),
    db
      .select({ value: sql<number>`count(*)::int` })
      .from(exchangeRequests)
      .where(where),
  ]);
  return { rows, total: totalRow.value };
}

/**
 * Move a request to `nextStatus`, but only from one of `fromStatuses`.
 *
 * The permitted FROM set is in the `UPDATE`'s own predicate, so two hosts
 * confirming at once cannot both succeed — the read that precedes this in the
 * controller chooses the ERROR, this chooses whether the write happens.
 */
export async function transitionExchangeRequest(
  db: DatabaseOrTransaction,
  id: string,
  nextStatus: ExchangeStatusValue,
  fromStatuses: readonly ExchangeStatusValue[],
  options: { readonly message?: string } = {},
): Promise<ExchangeRequestRow | undefined> {
  const values: Partial<typeof exchangeRequests.$inferInsert> = { status: nextStatus };
  if (options.message !== undefined) values.message = options.message;

  const [row] = await db
    .update(exchangeRequests)
    .set(values)
    .where(
      and(
        eq(exchangeRequests.id, id),
        inArray(exchangeRequests.status, [...fromStatuses]),
      ),
    )
    .returning();
  return row;
}

/** Update only the message, for the already-in-that-state convergence path. */
export async function setExchangeRequestMessage(
  db: DatabaseOrTransaction,
  id: string,
  message: string,
): Promise<ExchangeRequestRow | undefined> {
  const [row] = await db
    .update(exchangeRequests)
    .set({ message })
    .where(eq(exchangeRequests.id, id))
    .returning();
  return row;
}

/**
 * The wire shape the exchange screens read.
 *
 * The two windows are RE-NESTED: `db/schema/CONVENTIONS.md` flattens them into
 * four columns because they are the filter of the overlap query, and the wire
 * contract (`ExchangeWindow` in shared-types) is still `{ start, end }`. The
 * offered window is emitted only when it is present — all-or-none, matching the
 * CHECK, so a `host` request carries no empty shell.
 */
export function serializeExchangeRequest(row: ExchangeRequestRow): Record<string, unknown> {
  return {
    id: row.id,
    propertyId: row.propertyId,
    requesterOxyUserId: row.requesterOxyUserId,
    hostOxyUserId: row.hostOxyUserId,
    mode: row.mode,
    offeredPropertyId: row.offeredPropertyId,
    requestedWindow: { start: row.requestedWindowStart, end: row.requestedWindowEnd },
    offeredWindow:
      row.offeredWindowStart === null || row.offeredWindowEnd === null
        ? undefined
        : { start: row.offeredWindowStart, end: row.offeredWindowEnd },
    message: row.message,
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
