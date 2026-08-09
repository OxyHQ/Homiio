/**
 * `eviction_cases` and its four related tables — the public solidarity board.
 *
 * Ported from `models/schemas/EvictionCaseSchema.ts`, `EvictionCommentSchema.ts`
 * and `EvictionReportSchema.ts`. All empty in production.
 *
 * A case is a PUBLIC notice that an eviction is scheduled, so neighbours can
 * show up. Privacy-minimal by design: no tenant identity, no unit-level address,
 * and the controller rounds the coordinates before persisting when the reporter
 * marks the location `approximate`.
 *
 * ## Two privacy decisions the schema itself carries
 *
 * **`attendees` becomes a TABLE, not a column.** Mongoose hid the RSVP roster
 * with `select: false`, which is a per-QUERY default drizzle does not have — a
 * bare `select()` would return it. As `eviction_case_attendees` it cannot be
 * returned by accident at all: getting the roster requires writing a join.
 * `protectedColumns.ts` records this as the case where a child table is strictly
 * stronger than the registry.
 *
 * **The five `contact_*` columns ARE protected columns.** They are the
 * organizer's phone, email, Telegram and WhatsApp on a public board, and they
 * stayed out of responses only because no DTO listed them.
 *
 * ## `attendeeCount` is NOT ported
 *
 * It exists in Mongo because `attendees` is `select: false` and loading the
 * roster to count it was the thing the flag avoided. Once the roster is its own
 * table, `count(*)` over an indexed `case_id` answers it — and unlike
 * `properties.has_images`, which is kept against the same rule, this is not a
 * SORT key of any feed, so there is no `ORDER BY` a correlated aggregate has to
 * survive. Carrying it would be a second representation of one fact that can
 * disagree with the first. Recorded as an uncarried field in
 * `db/MIGRATION-CONTRACT.md`.
 */

import { check, doublePrecision, index, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { createdAt, generatedId, geography, inList, timestamptz, updatedAt } from '@oxyhq/db';
import type { EvictionCaseStatus } from '@homiio/shared-types';
import { agencies } from './agencies';
import { images } from './images';
import { LISTING_REPORT_REASONS, LISTING_REPORT_STATUSES } from './reports';

export const EVICTION_CASE_STATUSES = [
  'upcoming',
  'stopped',
  'postponed',
  'executed',
  'cancelled',
] as const satisfies readonly `${EvictionCaseStatus}`[];

export const EVICTION_LOCATION_PRECISIONS = ['exact', 'approximate'] as const;

export const evictionCases = pgTable(
  'eviction_cases',
  {
    id: generatedId(),

    /** The organizer. */
    oxyUserId: text().notNull(),

    title: text().notNull(),
    description: text().notNull(),

    // ── location ──
    //
    // `required`, so its label and its two coordinates are NOT NULL. The
    // GeoJSON `type: 'Point'` discriminator is NOT ported: it is a constant, and
    // the Postgres column below carries the geometry type in its own value.
    locationLabel: text().notNull(),
    /**
     * NAMED coordinate columns, replacing Mongo's positional `[lng, lat]` array.
     *
     * The same decision, for the same reason, as `addresses`: an ordered pair is
     * transposable and a named pair is not, and a lat/lon swap does not look
     * wrong — it yields a plausible point in the wrong hemisphere. On a board
     * whose entire purpose is telling people WHERE to turn up, that is the worst
     * kind of silent error.
     */
    locationLongitude: doublePrecision().notNull(),
    locationLatitude: doublePrecision().notNull(),
    /**
     * The port of Mongo's `{ 'location.coordinates': '2dsphere' }` index — the
     * second and last one in this migration.
     *
     * GENERATED, never written, exactly like `addresses.geo`: a hand-written geo
     * column and the two coordinate columns are two representations of one fact
     * and can disagree. `ST_MakePoint` and the `geometry → geography` cast are
     * both IMMUTABLE in PostGIS 3.5, which is what a generated column requires,
     * and `__tests__/db/postgis.test.ts` asserts it against `pg_proc` rather than
     * taking it on trust.
     *
     * Declared BARE rather than `geography(Point, 4326)` for the drizzle-kit
     * typmod reason `addresses.geo` documents.
     */
    locationGeo: geography().generatedAlwaysAs(
      sql`ST_MakePoint(location_longitude, location_latitude)::geography`,
    ),
    locationPrecision: text({ enum: EVICTION_LOCATION_PRECISIONS })
      .notNull()
      .default('approximate'),
    locationCity: text(),
    /**
     * ISO-3166-1 alpha-2, uppercased at the call site.
     *
     * No format CHECK, matching `countries.code`: `CONVENTIONS.md` defers format
     * validators, and applying one here but not there would leave the same rule
     * enforced in one place and not the other for no reason a reader could find.
     */
    locationCountryCode: text(),

    scheduledAt: timestamptz().notNull(),
    status: text({ enum: EVICTION_CASE_STATUSES }).notNull().default('upcoming'),

    /**
     * The agency carrying out the eviction, when one is named.
     *
     * SET NULL, matching `properties.agency_id` and `reviews.agency_id`: deleting
     * an agency must not delete the notices that name it, and NULL already means
     * "no agency named".
     */
    agencyId: text().references(() => agencies.id, { onDelete: 'set null' }),

    // ── contactInfo — ALL FIVE PROTECTED, see `protectedColumns.ts` ──
    //
    // A sub-schema with no default, so it never materializes and every column is
    // nullable.
    contactPhone: text(),
    contactEmail: text(),
    contactTelegram: text(),
    contactWhatsapp: text(),
    contactInstructions: text(),

    /**
     * `coverImage`, a nested path with no defaults — so it never materializes
     * and both columns are nullable.
     *
     * SET NULL: deleting an image must not delete the case. Same call as
     * `regions.cover_image_id` and `cities.cover_image_id`.
     */
    coverImageId: text().references(() => images.id, { onDelete: 'set null' }),
    /** The denormalized URL, as Mongo stored it beside the reference. */
    coverImageUrl: text(),

    /**
     * Server-only bookkeeping for the once-per-case outcome nudge. Never
     * client-settable — absent from the creatable and editable field lists.
     */
    outcomeReminderSentAt: timestamptz(),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    // The public board: filter by status, order by date.
    index('eviction_cases_status_scheduled_idx').on(table.status, table.scheduledAt),
    // "My cases".
    index('eviction_cases_oxy_user_created_idx').on(
      table.oxyUserId,
      sql`${table.createdAt} desc`,
    ),
    // The bbox / nearby board query. GiST over the generated point, the same
    // shape `addresses_geo_gist` carries.
    index('eviction_cases_location_geo_gist').using('gist', table.locationGeo),
    // Mongo's standalone `{ agencyId: 1 }`, kept partial: an agency is named on
    // a minority of cases and the index has no reason to hold a NULL for the rest.
    index('eviction_cases_agency_id_idx')
      .on(table.agencyId)
      .where(sql`${table.agencyId} is not null`),
    check(
      'eviction_cases_status_check',
      sql`${table.status} in (${sql.raw(inList(EVICTION_CASE_STATUSES))})`,
    ),
    check(
      'eviction_cases_location_precision_check',
      sql`${table.locationPrecision} in (${sql.raw(inList(EVICTION_LOCATION_PRECISIONS))})`,
    ),
    /**
     * The coordinate bounds, and the one place `CONVENTIONS.md` says a range
     * CHECK is mandatory rather than deferred.
     *
     * `geography` does NOT validate its input — measured on PostGIS 3.5:
     * `ST_MakePoint(0, 100)::geography` emits a NOTICE, coerces latitude 100 to
     * **80** by wrapping over the pole, and the insert SUCCEEDS. Dropping Mongo's
     * validator without replacing it would turn a loud rejection into a
     * gathering advertised at a different, entirely plausible place.
     */
    check(
      'eviction_cases_coordinates_range_check',
      sql`${table.locationLongitude} between -180 and 180
        and ${table.locationLatitude} between -90 and 90`,
    ),
  ],
);

/**
 * `updates[]` — the organizer's timeline (a reschedule, a status change, a note
 * from the ground).
 *
 * Declared `{ _id: true }` in Mongo precisely so an update can be referenced, so
 * every row keeps its id.
 */
export const evictionCaseUpdates = pgTable(
  'eviction_case_updates',
  {
    id: generatedId(),
    caseId: text()
      .notNull()
      .references(() => evictionCases.id, { onDelete: 'cascade' }),
    message: text().notNull(),
    newScheduledAt: timestamptz(),
    newStatus: text({ enum: EVICTION_CASE_STATUSES }),
    createdAt: createdAt(),
  },
  (table) => [
    index('eviction_case_updates_case_created_idx').on(
      table.caseId,
      sql`${table.createdAt} desc`,
    ),
    check(
      'eviction_case_updates_new_status_check',
      sql`${table.newStatus} in (${sql.raw(inList(EVICTION_CASE_STATUSES))})`,
    ),
  ],
);

/**
 * `attendees[]` — who said they will be there.
 *
 * The table that replaces a `select: false` column; see the header. Declared
 * `{ _id: false }` in Mongo, so the backfill mints an id per row.
 */
export const evictionCaseAttendees = pgTable(
  'eviction_case_attendees',
  {
    id: generatedId(),
    caseId: text()
      .notNull()
      .references(() => evictionCases.id, { onDelete: 'cascade' }),
    oxyUserId: text().notNull(),
    /** Mongo's `at`, renamed: `at` alone says nothing about what happened then. */
    rsvpedAt: createdAt(),
  },
  (table) => [
    /**
     * One RSVP per person per case.
     *
     * Mongo could not express it, so the controller's "have they already
     * RSVP'd?" read raced its own insert — and the count it feeds is what the
     * public board shows as turnout. The unique index closes the window and
     * makes `count(*)` over this table the honest number.
     */
    uniqueIndex('eviction_case_attendees_case_user_key').on(table.caseId, table.oxyUserId),
  ],
);

/** `eviction_comments` — the public coordination thread. */
export const evictionComments = pgTable(
  'eviction_comments',
  {
    id: generatedId(),
    /** CASCADE — the schema's own docstring says comments die with their case. */
    caseId: text()
      .notNull()
      .references(() => evictionCases.id, { onDelete: 'cascade' }),
    oxyUserId: text().notNull(),
    body: text().notNull(),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index('eviction_comments_case_created_idx').on(table.caseId, sql`${table.createdAt} desc`),
    // Mongo's standalone `{ oxyUserId: 1 }` — an author's own comments, and not
    // a prefix of the index above.
    index('eviction_comments_oxy_user_id_idx').on(table.oxyUserId),
  ],
);

/**
 * `eviction_reports` — a trust & safety report against a case (a suspected fake
 * notice, inappropriate content).
 *
 * The same shape as `listing_reports`, scoped to a case instead of a property,
 * and it reuses that module's two vocabularies rather than declaring a second
 * copy — the reasons and statuses are one set, and two tuples that are meant to
 * be identical are two tuples that can drift.
 */
export const evictionReports = pgTable(
  'eviction_reports',
  {
    id: generatedId(),
    /**
     * CASCADE. A report exists to get a case looked at; once the case is gone
     * there is nothing to look at, and the durable record of what was DECIDED
     * lives in `moderation_reports`, whose `reported_id` carries no foreign key
     * and therefore outlives the object. RESTRICT would let one open report stop
     * an organizer deleting their own notice.
     */
    caseId: text()
      .notNull()
      .references(() => evictionCases.id, { onDelete: 'cascade' }),
    reporterOxyUserId: text().notNull(),
    reason: text({ enum: LISTING_REPORT_REASONS }).notNull(),
    details: text(),
    contactEmail: text(),
    status: text({ enum: LISTING_REPORT_STATUSES }).notNull().default('open'),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index('eviction_reports_status_created_idx').on(table.status, sql`${table.createdAt} desc`),
    index('eviction_reports_case_status_idx').on(table.caseId, table.status),
    /** One OPEN report per reporter per case — Mongo's partial unique index. */
    uniqueIndex('eviction_reports_open_reporter_key')
      .on(table.caseId, table.reporterOxyUserId)
      .where(sql`${table.status} = 'open'`),
    check(
      'eviction_reports_reason_check',
      sql`${table.reason} in (${sql.raw(inList(LISTING_REPORT_REASONS))})`,
    ),
    check(
      'eviction_reports_status_check',
      sql`${table.status} in (${sql.raw(inList(LISTING_REPORT_STATUSES))})`,
    ),
  ],
);
