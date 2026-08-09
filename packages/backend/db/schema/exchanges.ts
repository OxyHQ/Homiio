/**
 * `exchange_requests` and `exchange_reviews` — the home-swap and free-hosting
 * flow.
 *
 * Ported from `models/schemas/ExchangeRequestSchema.ts` and
 * `models/schemas/ExchangeReviewSchema.ts`. Both empty in production.
 *
 * ## The two windows are FLATTENED, not a child table
 *
 * `requestedWindow` and `offeredWindow` are `{ start, end }` sub-schemas with a
 * 1:0..1 cardinality and — the deciding property — they are the FILTER of the
 * calendar-overlap query. A child table would put a join in front of it. This is
 * the same call `properties` makes for its twelve subdocuments, and the opposite
 * of `property_availability_windows`, which is a 1:N calendar.
 *
 * `requestedWindow` is `required`, so its two columns are `NOT NULL`.
 * `offeredWindow` is declared `default: undefined` and never materializes, so
 * both of its columns are nullable — the measured mongoose rule
 * `CONVENTIONS.md` states.
 */

import { boolean, check, doublePrecision, index, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { createdAt, generatedId, inList, timestamptz, updatedAt } from '@oxyhq/db';
import type { ExchangeMode, ExchangeRequestStatus } from '@homiio/shared-types';
import { properties } from './properties';

export const EXCHANGE_REQUEST_MODES = [
  'swap',
  'host',
  'both',
] as const satisfies readonly `${ExchangeMode}`[];

export const EXCHANGE_REQUEST_STATUSES = [
  'pending',
  'confirmed',
  'declined',
  'cancelled',
  'completed',
] as const satisfies readonly `${ExchangeRequestStatus}`[];

export const exchangeRequests = pgTable(
  'exchange_requests',
  {
    id: generatedId(),

    /** The host's listing. RESTRICT — see `leases.property_id`. */
    propertyId: text()
      .notNull()
      .references(() => properties.id, { onDelete: 'restrict' }),

    requesterOxyUserId: text().notNull(),
    hostOxyUserId: text().notNull(),

    mode: text({ enum: EXCHANGE_REQUEST_MODES }).notNull(),
    /** For a SWAP: the listing the requester offers in return. RESTRICT, same reasoning. */
    offeredPropertyId: text().references(() => properties.id, { onDelete: 'restrict' }),

    requestedWindowStart: timestamptz().notNull(),
    requestedWindowEnd: timestamptz().notNull(),
    offeredWindowStart: timestamptz(),
    offeredWindowEnd: timestamptz(),

    message: text(),
    status: text({ enum: EXCHANGE_REQUEST_STATUSES }).notNull().default('pending'),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    /**
     * The overlap index Mongo's `{ 'requestedWindow.start': 1,
     * 'requestedWindow.end': 1 }` could not be. `[)` bounds, matching
     * `property_availability_windows` — the `AvailabilityWindow` contract these
     * windows are checked against says adjacent windows do not overlap, and the
     * schema's own comment calls the range "half-open [start, end)".
     */
    index('exchange_requests_requested_window_gist').using(
      'gist',
      sql`tstzrange(${table.requestedWindowStart}, ${table.requestedWindowEnd})`,
    ),
    index('exchange_requests_property_status_idx').on(table.propertyId, table.status),
    index('exchange_requests_requester_status_created_idx').on(
      table.requesterOxyUserId,
      table.status,
      sql`${table.createdAt} desc`,
    ),
    index('exchange_requests_host_status_created_idx').on(
      table.hostOxyUserId,
      table.status,
      sql`${table.createdAt} desc`,
    ),
    check(
      'exchange_requests_mode_check',
      sql`${table.mode} in (${sql.raw(inList(EXCHANGE_REQUEST_MODES))})`,
    ),
    check(
      'exchange_requests_status_check',
      sql`${table.status} in (${sql.raw(inList(EXCHANGE_REQUEST_STATUSES))})`,
    ),
    check(
      'exchange_requests_requested_window_order_check',
      sql`${table.requestedWindowEnd} > ${table.requestedWindowStart}`,
    ),
    /**
     * The offered window is all-or-none, and ordered when present. The same
     * all-or-none shape `neighborhoods_bbox_complete_check` uses, for the same
     * reason: half a range is not a range.
     *
     * **The second branch spells out `is not null` on BOTH columns, and it has
     * to.** A CHECK passes on NULL — only an explicit `false` rejects a row — so
     * the shorter `(offered_window_end > offered_window_start)` evaluates to
     * NULL when exactly one of them is set, `false or NULL` is NULL, and the
     * constraint admits precisely the half-a-window it exists to refuse. Caught
     * by `__tests__/db/coherenceChecks.test.ts`, which asserts the refusal
     * rather than only the two coherent shapes — a one-direction test would have
     * shipped it.
     */
    check(
      'exchange_requests_offered_window_check',
      sql`(
        ${table.offeredWindowStart} is null and ${table.offeredWindowEnd} is null
      ) or (
        ${table.offeredWindowStart} is not null and ${table.offeredWindowEnd} is not null
          and ${table.offeredWindowEnd} > ${table.offeredWindowStart}
      )`,
    ),
    /**
     * A `host` request offers nothing.
     *
     * `pre('save')` clears `offeredPropertyId` and `offeredWindow` when the mode
     * is `host` — a SAVE hook, so `findOneAndUpdate` walks straight past it, and
     * a host request that carries an offered property reads to the host as a
     * swap they never agreed to. `swap` and `both` are deliberately unconstrained
     * in the other direction: the schema declares neither field required, and the
     * offer can legitimately be negotiated after the request is opened.
     */
    check(
      'exchange_requests_host_mode_offers_nothing_check',
      sql`${table.mode} <> 'host' or (
        ${table.offeredPropertyId} is null
        and ${table.offeredWindowStart} is null
        and ${table.offeredWindowEnd} is null
      )`,
    ),
  ],
);

/**
 * `exchange_reviews` — what each side said afterwards.
 *
 * Distinct from `reviews`, which rates an ADDRESS. This one rates a PERSON, is
 * scoped to one exchange, and is what a future reputation surface would read.
 */
export const exchangeReviews = pgTable(
  'exchange_reviews',
  {
    id: generatedId(),

    /**
     * RESTRICT: the review is evidence about a completed exchange, so the
     * exchange must outlive it. Nothing deletes an exchange request today —
     * `cancelled` and `declined` are statuses, not deletions.
     */
    exchangeRequestId: text()
      .notNull()
      .references(() => exchangeRequests.id, { onDelete: 'restrict' }),

    reviewerOxyUserId: text().notNull(),
    subjectOxyUserId: text().notNull(),

    /** 1-5 stars. */
    rating: doublePrecision().notNull(),
    comment: text(),
    /** `categories`, a closed four-field subdocument, flattened. Each 1-5 or absent. */
    categoriesCommunication: doublePrecision(),
    categoriesCleanliness: doublePrecision(),
    categoriesAccuracy: doublePrecision(),
    categoriesHospitality: doublePrecision(),
    isVerified: boolean().notNull().default(false),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    /** One review per reviewer per exchange — Mongo's own unique compound. */
    uniqueIndex('exchange_reviews_request_reviewer_key').on(
      table.exchangeRequestId,
      table.reviewerOxyUserId,
    ),
    index('exchange_reviews_subject_created_idx').on(
      table.subjectOxyUserId,
      sql`${table.createdAt} desc`,
    ),
    /**
     * The 1-5 bounds, from `MIN_RATING`/`MAX_RATING` in the schema. A range
     * constraint, which `CONVENTIONS.md` defers where production rows exist and
     * have not been measured — this table is empty, and an out-of-range star
     * silently skews the `$avg` every reputation aggregate is built on.
     */
    check('exchange_reviews_rating_check', sql`${table.rating} between 1 and 5`),
    check(
      'exchange_reviews_categories_range_check',
      sql`(${table.categoriesCommunication} is null or ${table.categoriesCommunication} between 1 and 5)
        and (${table.categoriesCleanliness} is null or ${table.categoriesCleanliness} between 1 and 5)
        and (${table.categoriesAccuracy} is null or ${table.categoriesAccuracy} between 1 and 5)
        and (${table.categoriesHospitality} is null or ${table.categoriesHospitality} between 1 and 5)`,
    ),
    /**
     * Nobody reviews themselves. Mongo enforced nothing; the controller resolves
     * both ids server-side, so this rejects only a bug — which is what a CHECK
     * on an empty table is for.
     */
    check(
      'exchange_reviews_distinct_parties_check',
      sql`${table.reviewerOxyUserId} <> ${table.subjectOxyUserId}`,
    ),
  ],
);
