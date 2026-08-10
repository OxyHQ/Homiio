/**
 * `eviction_cases` and its child tables — the public solidarity board.
 *
 * A case is a PUBLIC notice that an eviction is scheduled, so neighbours can
 * show up. It is also information about a household that is about to lose its
 * home, which is why the shape below is dictated by
 * `docs/adr/0003-privacy-verification-publication.md` §7 rather than by what is
 * convenient to render.
 *
 * ## Four privacy decisions the schema itself carries
 *
 * **The PUBLIC coordinates and the PRIVATE ones are different columns, and only
 * the public pair feeds the spatial index.** `location_longitude` /
 * `location_latitude` keep the names they have always had, and they have always
 * held the PUBLISHED pair — what changes is that the value is now a random
 * offset rather than the true point rounded. `location_geo` is generated from
 * them, so every bbox and radius query on this board runs against the published
 * disc's centre. That is not a simplification — it is the control that stops a
 * bbox query being a triangulation oracle. A GiST index over the exact point
 * would let anybody binary-search a rectangle down to the true coordinate
 * without ever being served it.
 *
 * **The exact pair is NULL unless the affected household authorised it.** ADR
 * 0003 §3.3 states the rule this table is the named example of: if no feature
 * needs the fine value, do not store the fine value. `location_exact_*` is
 * written only when `location_household_authorized_at` is set, and all three
 * columns are in `protectedColumns.ts`, so reading one without naming it is a
 * `tsc` error.
 *
 * **`attendees` is a TABLE, not a column.** Mongoose hid the RSVP roster with
 * `select: false`, a per-QUERY default drizzle does not have — a bare `select()`
 * would return it. As `eviction_case_attendees` it cannot be returned by
 * accident at all: getting the roster requires writing a join. ADR 0003 §7.4
 * then confirms the roster is disclosed to NOBODY, the organiser included.
 *
 * **The five `contact_*` columns ARE protected columns.** They are the
 * organiser's phone, email, Telegram and WhatsApp on a public board, and they
 * stayed out of responses only because no DTO listed them.
 *
 * ## `attendeeCount` is NOT a column
 *
 * `count(*)` over an indexed `case_id` answers it, and it is not a SORT key of
 * any feed, so there is no `ORDER BY` a correlated aggregate has to survive.
 * Carrying it would be a second representation of one fact that can disagree
 * with the first.
 */

import {
  bigint,
  check,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { createdAt, generatedId, geography, inList, timestamptz, updatedAt } from '@oxyhq/db';
import type {
  EvictionCaseStatus,
  EvictionHelpNeedType,
  EvictionLocationAccessAction,
  EvictionLocationAccessPurpose,
  EvictionOrganizationChannel,
  EvictionPublicPrecision,
  EvictionReportReason,
  EvictionTimelineEventType,
} from '@homiio/shared-types';
import { agencies } from './agencies';
import { images } from './images';
import { regions } from './geo';
import { LISTING_REPORT_STATUSES } from './reports';

export const EVICTION_CASE_STATUSES = [
  'upcoming',
  'stopped',
  'postponed',
  'executed',
  'cancelled',
] as const satisfies readonly `${EvictionCaseStatus}`[];

/**
 * The precisions the board may PUBLISH at.
 *
 * `exact` is absent, and its absence is the constraint: there is no value a
 * client, a controller or a migration can put in this column that means "show
 * the building". The exact pair lives in its own nullable columns, reachable
 * only through an access grant.
 */
export const EVICTION_PUBLIC_PRECISIONS = [
  'street',
  'neighborhood',
  'approximate_radius',
] as const satisfies readonly EvictionPublicPrecision[];

export const EVICTION_TIMELINE_EVENT_TYPES = [
  'case_created',
  'date_changed',
  'location_precision_changed',
  'instructions_updated',
  'postponed',
  'stopped',
  'executed',
  'cancelled',
  'legal_resource_added',
  'organization_verified',
  'correction_published',
  'precautionary_hold_applied',
  'note',
] as const satisfies readonly `${EvictionTimelineEventType}`[];

export const EVICTION_HELP_NEED_TYPES = [
  'presence',
  'legal_support',
  'translation',
  'transport',
  'temporary_housing',
  'outreach',
  'organization_contact',
] as const satisfies readonly `${EvictionHelpNeedType}`[];

export const EVICTION_REPORT_REASONS = [
  'false_information',
  'personal_data_exposed',
  'location_too_precise',
  'outdated',
  'harassment',
  'spam',
  'dangerous_contact',
] as const satisfies readonly `${EvictionReportReason}`[];

export const EVICTION_LOCATION_ACCESS_PURPOSES = [
  'legal_representation',
  'accompaniment',
  'emergency_housing',
] as const satisfies readonly `${EvictionLocationAccessPurpose}`[];

export const EVICTION_LOCATION_ACCESS_ACTIONS = [
  'granted',
  'revoked',
  'read',
  'denied',
] as const satisfies readonly `${EvictionLocationAccessAction}`[];

export const JURISDICTION_RESOURCE_TYPES = [
  'legal_aid',
  'tenant_union',
  'emergency_housing',
  'official_info',
] as const;

/**
 * The narrowest disc the board ever publishes, in metres.
 *
 * ~300 m in a dense European city covers a few hundred dwellings, which is what
 * makes the published centre a neighbourhood statement rather than a pointer.
 * `db/evictions/locationApproximation.ts` widens it wherever Homiio's own
 * address data says the area is sparser than that.
 */
export const EVICTION_MIN_PUBLIC_RADIUS_METERS = 300;

/** The widest disc the board publishes, and the column default. */
export const EVICTION_MAX_PUBLIC_RADIUS_METERS = 2500;

/**
 * The organising collective, kept strictly apart from `agencies`.
 *
 * `agencies` is who is CARRYING OUT the eviction. This is who is resisting it,
 * and conflating the two on one table would produce a join that reads as if the
 * bailiff's employer organised the picket.
 *
 * `verified_at` is never written by any API route — see the table's own
 * verification note in `@homiio/shared-types`. Anybody may name an organisation
 * on their own case; nobody can make one verified by doing so.
 */
export const evictionOrganizations = pgTable(
  'eviction_organizations',
  {
    id: generatedId(),
    name: text().notNull(),
    /** Casefolded dedup key, so two spellings do not become two collectives. */
    normalizedName: text().notNull(),
    description: text(),
    /**
     * The collective's own published channels, as
     * `EvictionOrganizationChannel[]`.
     *
     * Served ONLY when `verified_at` is set. An unverified row's channels are a
     * third party's contact details published on the say-so of somebody who is
     * not that third party, which ADR 0003 §4.5 forbids — so the column may hold
     * them and the serializer still refuses.
     */
    publicChannels: jsonb().$type<EvictionOrganizationChannel[]>().notNull().default([]),
    verifiedAt: timestamptz(),
    /** The public source that was checked. Meaningless without `verified_at`. */
    verificationSource: text(),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('eviction_organizations_normalized_name_key').on(table.normalizedName),
    /**
     * A source is what makes a verification checkable, so a verified row without
     * one is a claim nobody can audit. Stated as a biconditional in ONE
     * direction only — a source with no verification is a note somebody left
     * while checking, which is harmless.
     */
    check(
      'eviction_organizations_verified_source_check',
      sql`${table.verifiedAt} is null or ${table.verificationSource} is not null`,
    ),
  ],
);

export const evictionCases = pgTable(
  'eviction_cases',
  {
    id: generatedId(),

    /** The organiser. */
    oxyUserId: text().notNull(),

    title: text().notNull(),
    description: text().notNull(),

    // ── PUBLIC location ──
    //
    // Everything a board or detail response may carry. The label is sanitised
    // to a street-or-coarser form before it lands here (ADR 0003 §7.1, F9):
    // rounding a coordinate while publishing "Carrer de X 42, 3r 2a" as free
    // text is theatre.
    locationLabel: text().notNull(),
    /**
     * The PUBLISHED centre — a fresh random offset from the true point, not the
     * true point rounded.
     *
     * NAMED columns, replacing Mongo's positional `[lng, lat]` array, for the
     * same reason `addresses` has them: an ordered pair is transposable and a
     * named pair is not, and a lat/lon swap does not look wrong — it yields a
     * plausible point in the wrong hemisphere. On a board whose entire purpose
     * is telling people WHERE to turn up, that is the worst kind of silent
     * error.
     */
    locationLongitude: doublePrecision().notNull(),
    locationLatitude: doublePrecision().notNull(),
    /**
     * How far the true point may be from the published centre, in metres.
     *
     * Published alongside the centre so a map draws the honest uncertainty
     * instead of a pin that looks exact. Widened server-side in low-density
     * areas, where a small disc contains few enough homes to be an enumeration.
     *
     * The DEFAULT is the WIDEST radius the product ever publishes, not the
     * narrowest, and the direction is the whole point: a row that reaches this
     * table without a computed radius is a row nobody measured the density
     * around, and the honest answer to "how far might the true point be" is
     * then "as far as this board ever admits".
     */
    locationRadiusMeters: integer().notNull().default(EVICTION_MAX_PUBLIC_RADIUS_METERS),
    /**
     * The spatial index, GENERATED from the PUBLIC pair and never written.
     *
     * Generated rather than hand-maintained for the reason `addresses.geo`
     * documents: two representations of one fact can disagree. Over the PUBLIC
     * pair because a spatial predicate is an oracle — a bbox query against the
     * exact point would let a caller bisect a rectangle down to the true
     * coordinate without ever being served it.
     *
     * `ST_MakePoint` and the `geometry → geography` cast are both IMMUTABLE in
     * PostGIS 3.5, which is what a generated column requires, and
     * `__tests__/db/postgis.test.ts` asserts it against `pg_proc` rather than
     * taking it on trust. Declared BARE rather than `geography(Point, 4326)` for
     * the drizzle-kit typmod reason `addresses.geo` explains.
     */
    locationGeo: geography().generatedAlwaysAs(
      sql`ST_MakePoint(location_longitude, location_latitude)::geography`,
    ),
    locationPrecision: text({ enum: EVICTION_PUBLIC_PRECISIONS })
      .notNull()
      .default('approximate_radius'),
    locationCity: text(),
    /**
     * ISO-3166-1 alpha-2, uppercased at the call site.
     *
     * No format CHECK, matching `countries.code`: `CONVENTIONS.md` defers format
     * validators, and applying one here but not there would leave the same rule
     * enforced in one place and not the other for no reason a reader could find.
     */
    locationCountryCode: text(),

    // ── PRIVATE location — ALL THREE PROTECTED, see `protectedColumns.ts` ──
    //
    // NULL unless the affected household authorised exact disclosure. Not
    // "withheld": never stored. ADR 0003 §7.3 makes the household's own request
    // the single authorisation event, and §3.3 names this table as the example
    // of the store-nothing-you-do-not-need rule.
    locationExactLongitude: doublePrecision(),
    locationExactLatitude: doublePrecision(),
    locationExactAddress: text(),
    /** When the affected household authorised it. NULL means they did not. */
    locationHouseholdAuthorizedAt: timestamptz(),

    scheduledAt: timestamptz().notNull(),
    status: text({ enum: EVICTION_CASE_STATUSES }).notNull().default('upcoming'),

    // ── moderation state, which is NOT a status ──
    //
    // A case can be `upcoming` AND held. Folding "held" into `status` would make
    // the status column mean two things and break the transition table.
    /** Precision reduced and description withheld pending the organiser's reply. */
    precautionaryHoldAt: timestamptz(),
    /** Enough reports that the case's accuracy is publicly in question. */
    disputedAt: timestamptz(),

    /**
     * The agency carrying out the eviction, when one is named.
     *
     * SET NULL, matching `properties.agency_id` and `reviews.agency_id`:
     * deleting an agency must not delete the notices that name it, and NULL
     * already means "no agency named".
     */
    agencyId: text().references(() => agencies.id, { onDelete: 'set null' }),

    /** The collective coordinating the response. NOT the evicting agency. */
    organizationId: text().references(() => evictionOrganizations.id, {
      onDelete: 'set null',
    }),

    // ── contactInfo — ALL FIVE PROTECTED, see `protectedColumns.ts` ──
    contactPhone: text(),
    contactEmail: text(),
    contactTelegram: text(),
    contactWhatsapp: text(),
    contactInstructions: text(),

    /**
     * How old a supporter's Homiio profile must be, in days, before an RSVP
     * unlocks the organiser's contact on THIS case.
     *
     * ADR 0003 §7.3.1 lets an organiser raise the bar for their own case. It is
     * a policy number, not a per-person decision, precisely because a per-person
     * approval would require showing the organiser the roster — which §7.4
     * forbids.
     */
    contactUnlockMinTenureDays: integer().notNull().default(7),

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

    /**
     * When the case was archived: it leaves the board and search, the contact
     * block is DELETED rather than hidden, and the location drops to
     * `neighborhood` (ADR 0003 §7.5). Set by the sweep in `services/cron.ts`.
     */
    archivedAt: timestamptz(),

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
    // The bbox / nearby board query. GiST over the generated PUBLIC point.
    index('eviction_cases_location_geo_gist').using('gist', table.locationGeo),
    // "Recently updated" ordering, and the archival sweep's scan.
    index('eviction_cases_updated_idx').on(sql`${table.updatedAt} desc`),
    // Mongo's standalone `{ agencyId: 1 }`, kept partial: an agency is named on
    // a minority of cases and the index has no reason to hold a NULL for the rest.
    index('eviction_cases_agency_id_idx')
      .on(table.agencyId)
      .where(sql`${table.agencyId} is not null`),
    index('eviction_cases_organization_id_idx')
      .on(table.organizationId)
      .where(sql`${table.organizationId} is not null`),
    check(
      'eviction_cases_status_check',
      sql`${table.status} in (${sql.raw(inList(EVICTION_CASE_STATUSES))})`,
    ),
    check(
      'eviction_cases_location_precision_check',
      sql`${table.locationPrecision} in (${sql.raw(inList(EVICTION_PUBLIC_PRECISIONS))})`,
    ),
    /**
     * The coordinate bounds, and the one place `CONVENTIONS.md` says a range
     * CHECK is mandatory rather than deferred.
     *
     * `geography` does NOT validate its input — measured on PostGIS 3.5:
     * `ST_MakePoint(0, 100)::geography` emits a NOTICE, coerces latitude 100 to
     * **80** by wrapping over the pole, and the insert SUCCEEDS. Dropping
     * Mongo's validator without replacing it would turn a loud rejection into a
     * gathering advertised at a different, entirely plausible place.
     */
    check(
      'eviction_cases_coordinates_range_check',
      sql`${table.locationLongitude} between -180 and 180
        and ${table.locationLatitude} between -90 and 90`,
    ),
    /** The same bound on the private pair, which is nullable and must stay sane. */
    check(
      'eviction_cases_exact_coordinates_range_check',
      sql`(${table.locationExactLongitude} is null
            or ${table.locationExactLongitude} between -180 and 180)
        and (${table.locationExactLatitude} is null
            or ${table.locationExactLatitude} between -90 and 90)`,
    ),
    /**
     * The exact pair exists ONLY under a household authorisation, and both
     * halves of a coordinate arrive together.
     *
     * Written as an implication rather than a biconditional, deliberately: an
     * authorisation with no exact coordinate yet is a legitimate intermediate
     * state (the household said yes; the organiser has not typed the address).
     * A biconditional would refuse it, which is the shape of constraint that
     * looks obvious from the flattened columns and is wrong about the writers —
     * see `CONVENTIONS.md` on reading the writers before believing a shape.
     */
    check(
      'eviction_cases_exact_location_authorized_check',
      sql`(${table.locationExactLongitude} is null) = (${table.locationExactLatitude} is null)
        and (
          ${table.locationHouseholdAuthorizedAt} is not null
          or (${table.locationExactLongitude} is null
              and ${table.locationExactAddress} is null)
        )`,
    ),
    /** A published disc with no radius is a pin pretending to be honest. */
    check(
      'eviction_cases_radius_positive_check',
      sql`${table.locationRadiusMeters} > 0`,
    ),
    check(
      'eviction_cases_contact_tenure_check',
      sql`${table.contactUnlockMinTenureDays} >= 0`,
    ),
  ],
);

/**
 * The immutable timeline: what happened to a case, and when.
 *
 * ## Two things make this an AUDIT rather than a log
 *
 * **`position` is computed in SQL**, as `coalesce(max(position), 0) + 1` inside
 * the INSERT, and a unique index on `(case_id, position)` turns a concurrent
 * append into a `23505` rather than a duplicate. Computing it in JavaScript
 * would be the `bigint`-decodes-as-string trap: postgres.js returns `int8` as a
 * STRING, `max + 1` type-checks clean, and the second appended row lands at
 * position `11` instead of `2`. A test that appends ONCE cannot see it.
 *
 * **An `UPDATE` is refused by a trigger** (`eviction_case_updates_immutable`, in
 * migration 0013). There is no route that edits an entry, but "no route" is a
 * property of today's code and this is a property of the table. `DELETE` is left
 * alone because the case's `ON DELETE CASCADE` needs it.
 */
export const evictionCaseUpdates = pgTable(
  'eviction_case_updates',
  {
    id: generatedId(),
    caseId: text()
      .notNull()
      .references(() => evictionCases.id, { onDelete: 'cascade' }),
    /** Monotonic within a case. See the header: computed in SQL, never in JS. */
    position: bigint({ mode: 'number' }).notNull(),
    eventType: text({ enum: EVICTION_TIMELINE_EVENT_TYPES }).notNull().default('note'),
    /**
     * The organiser, or NULL for a system event.
     *
     * NULL is the `system` actor and it is the only anonymous one: a report
     * threshold firing must not become "these three people reported this"
     * (ADR 0003 §5.8).
     */
    actorOxyUserId: text(),
    message: text().notNull(),
    newScheduledAt: timestamptz(),
    newStatus: text({ enum: EVICTION_CASE_STATUSES }),
    createdAt: createdAt(),
  },
  (table) => [
    index('eviction_case_updates_case_position_idx').on(
      table.caseId,
      sql`${table.position} desc`,
    ),
    uniqueIndex('eviction_case_updates_case_position_key').on(table.caseId, table.position),
    check(
      'eviction_case_updates_new_status_check',
      sql`${table.newStatus} in (${sql.raw(inList(EVICTION_CASE_STATUSES))})`,
    ),
    check(
      'eviction_case_updates_event_type_check',
      sql`${table.eventType} in (${sql.raw(inList(EVICTION_TIMELINE_EVENT_TYPES))})`,
    ),
    check('eviction_case_updates_position_check', sql`${table.position} >= 1`),
  ],
);

/**
 * `attendees[]` — who said they will be there, and whether they are CONFIRMED.
 *
 * The table that replaces a `select: false` column; see the module header. ADR
 * 0003 §7.4 then goes further: the roster is disclosed to nobody, the organiser
 * included, because a list of people who turned up to resist an eviction is a
 * target list. Only `count(*)` is published.
 *
 * ## Why an RSVP alone no longer unlocks the organiser's contact
 *
 * It used to (F8 in ADR 0003 §1.2): one tap on "attend" returned the organiser's
 * phone, email, Telegram and WhatsApp to any signed-in caller. That is a
 * one-tap contact harvest, and the organiser is exactly the person a landlord's
 * agent most wants to reach. §7.3.1 requires a SECOND factor, and the two this
 * deployment can actually observe are recorded in `confirmation_basis`:
 *
 *  - `account_tenure` — the caller's Homiio profile is older than the case's own
 *    `contact_unlock_min_tenure_days`.
 *  - `supporter_vouch` — an already-confirmed supporter of THIS case vouched for
 *    them.
 *
 * An Oxy `account_verified` signal is the third factor the ADR names and it is
 * NOT implemented here: the session object this backend receives
 * (`OxyRequestUser`) carries no verification field, so wiring it means changing
 * `@oxyhq/core`, not this table. Recorded rather than faked — a basis value that
 * nothing can ever write would look like coverage.
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
    /** When the second factor was satisfied. NULL means RSVP'd but not confirmed. */
    confirmedAt: timestamptz(),
    confirmationBasis: text({ enum: ['account_tenure', 'supporter_vouch'] }),
    /** The organiser withdrew this person's confirmed access. */
    revokedAt: timestamptz(),
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
    /** A confirmation with no basis is a confirmation nobody can account for. */
    check(
      'eviction_case_attendees_confirmation_check',
      sql`(${table.confirmedAt} is null) = (${table.confirmationBasis} is null)`,
    ),
  ],
);

/**
 * One confirmed supporter vouching for another person on the same case.
 *
 * The vouch is what lets somebody with no Homiio tenure be confirmed without an
 * organiser approving them individually — which would require showing the
 * organiser the roster §7.4 forbids. The voucher learns one identity, the person
 * who asked them; nobody learns the list.
 */
export const evictionSupporterVouches = pgTable(
  'eviction_supporter_vouches',
  {
    id: generatedId(),
    caseId: text()
      .notNull()
      .references(() => evictionCases.id, { onDelete: 'cascade' }),
    voucherOxyUserId: text().notNull(),
    vouchedOxyUserId: text().notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('eviction_supporter_vouches_key').on(
      table.caseId,
      table.voucherOxyUserId,
      table.vouchedOxyUserId,
    ),
    index('eviction_supporter_vouches_vouched_idx').on(table.caseId, table.vouchedOxyUserId),
    check(
      'eviction_supporter_vouches_distinct_check',
      sql`${table.voucherOxyUserId} <> ${table.vouchedOxyUserId}`,
    ),
  ],
);

/**
 * Who asked to be told when a case changes.
 *
 * Deliberately NOT the RSVP roster. "I will be there" and "tell me if the date
 * moves" are different statements, and a board that conflates them either
 * spams people who only wanted to watch or silences people who are coming.
 */
export const evictionCaseFollowers = pgTable(
  'eviction_case_followers',
  {
    id: generatedId(),
    caseId: text()
      .notNull()
      .references(() => evictionCases.id, { onDelete: 'cascade' }),
    oxyUserId: text().notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('eviction_case_followers_case_user_key').on(table.caseId, table.oxyUserId),
    index('eviction_case_followers_user_idx').on(table.oxyUserId),
  ],
);

/**
 * One dispatch of one timeline event to one recipient — the idempotency record.
 *
 * "Update de fecha notificado una sola vez" is a database fact rather than a
 * best effort: the fan-out inserts here with `ON CONFLICT DO NOTHING RETURNING`,
 * and only the rows that were actually inserted get a notification. A retry, a
 * second cron tick, or two API processes racing all converge on one message.
 *
 * `ON DELETE CASCADE` from the timeline entry, which cascades from the case.
 */
export const evictionUpdateNotifications = pgTable(
  'eviction_update_notifications',
  {
    id: generatedId(),
    updateId: text()
      .notNull()
      .references(() => evictionCaseUpdates.id, { onDelete: 'cascade' }),
    recipientOxyUserId: text().notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('eviction_update_notifications_key').on(table.updateId, table.recipientOxyUserId),
  ],
);

/** What a case needs from the people reading it. */
export const evictionCaseHelpNeeds = pgTable(
  'eviction_case_help_needs',
  {
    id: generatedId(),
    caseId: text()
      .notNull()
      .references(() => evictionCases.id, { onDelete: 'cascade' }),
    needType: text({ enum: EVICTION_HELP_NEED_TYPES }).notNull(),
    /** A public note from the organiser. Never a private contact. */
    note: text(),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex('eviction_case_help_needs_key').on(table.caseId, table.needType),
    index('eviction_case_help_needs_type_idx').on(table.needType),
    check(
      'eviction_case_help_needs_type_check',
      sql`${table.needType} in (${sql.raw(inList(EVICTION_HELP_NEED_TYPES))})`,
    ),
  ],
);

/**
 * One actor's time-bounded, revocable permission to read a case's EXACT
 * location.
 *
 * ADR 0003 §10 in table form: the permission is relationship-derived (the
 * organiser grants it), purpose-bound, time-bound, revocable, and every use of
 * it is audited. There is no role, flag or column anywhere that confers standing
 * access; a grant is the only route, and it expires.
 *
 * The partial unique means ONE live grant per (case, grantee): re-granting
 * extends the existing row through `ON CONFLICT DO UPDATE`, and revoking frees
 * the slot for a fresh one. Note the arbiter predicate is mandatory on the
 * conflict target — omitting it against a PARTIAL unique index is `42P10` at
 * runtime with a clean `tsc`.
 */
export const evictionLocationGrants = pgTable(
  'eviction_location_grants',
  {
    id: generatedId(),
    caseId: text()
      .notNull()
      .references(() => evictionCases.id, { onDelete: 'cascade' }),
    granteeOxyUserId: text().notNull(),
    grantedByOxyUserId: text().notNull(),
    purpose: text({ enum: EVICTION_LOCATION_ACCESS_PURPOSES }).notNull(),
    grantedAt: createdAt(),
    expiresAt: timestamptz().notNull(),
    revokedAt: timestamptz(),
  },
  (table) => [
    uniqueIndex('eviction_location_grants_live_key')
      .on(table.caseId, table.granteeOxyUserId)
      .where(sql`${table.revokedAt} is null`),
    index('eviction_location_grants_case_idx').on(table.caseId),
    check(
      'eviction_location_grants_purpose_check',
      sql`${table.purpose} in (${sql.raw(inList(EVICTION_LOCATION_ACCESS_PURPOSES))})`,
    ),
    /** A grant that expires before it is issued is a grant nobody meant to make. */
    check(
      'eviction_location_grants_window_check',
      sql`${table.expiresAt} > ${table.grantedAt}`,
    ),
  ],
);

/**
 * Append-only record of every grant, revocation, read and refusal.
 *
 * Carries NO foreign key to the grant, on purpose: a denial has no grant to
 * point at, and the record of what was refused is exactly the row somebody will
 * want after a grant is deleted. Same reasoning as
 * `moderation_reports.reported_id`.
 *
 * Readable by the case's organiser — the accountable party — because ADR 0003
 * §10.6 puts the audit in the hands of whoever has the strongest interest in
 * noticing an improper access, and the affected household is deliberately not a
 * stored actor (§7.2), so there is nobody else it can be handed to.
 */
export const evictionLocationAccessAudit = pgTable(
  'eviction_location_access_audit',
  {
    id: generatedId(),
    caseId: text()
      .notNull()
      .references(() => evictionCases.id, { onDelete: 'cascade' }),
    actorOxyUserId: text().notNull(),
    action: text({ enum: EVICTION_LOCATION_ACCESS_ACTIONS }).notNull(),
    purpose: text({ enum: EVICTION_LOCATION_ACCESS_PURPOSES }),
    denialReason: text({
      enum: ['no_grant', 'expired', 'revoked', 'not_authorized_by_household'],
    }),
    createdAt: createdAt(),
  },
  (table) => [
    index('eviction_location_access_audit_case_created_idx').on(
      table.caseId,
      sql`${table.createdAt} desc`,
    ),
    check(
      'eviction_location_access_audit_action_check',
      sql`${table.action} in (${sql.raw(inList(EVICTION_LOCATION_ACCESS_ACTIONS))})`,
    ),
    /** A denial says why; anything else has nothing to explain. */
    check(
      'eviction_location_access_audit_denial_check',
      sql`(${table.action} = 'denied') = (${table.denialReason} is not null)`,
    ),
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
 * `eviction_reports` — a community report against a case.
 *
 * Its OWN reason vocabulary rather than the listing one. "This location is too
 * precise" and "this exposes personal data" have no counterpart on a property
 * ad, and they are the two that carry a consequence beyond a counter: the first
 * report of either applies a PRECAUTIONARY HOLD, which reduces the published
 * precision and withholds the description until the organiser answers. It does
 * not delete the case and it is not a moderator action — no human reviews a
 * queue, the threshold does it.
 *
 * The statuses stay `listing_reports`', because those genuinely are one set.
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
     * an organiser deleting their own notice.
     */
    caseId: text()
      .notNull()
      .references(() => evictionCases.id, { onDelete: 'cascade' }),
    reporterOxyUserId: text().notNull(),
    reason: text({ enum: EVICTION_REPORT_REASONS }).notNull(),
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
      sql`${table.reason} in (${sql.raw(inList(EVICTION_REPORT_REASONS))})`,
    ),
    check(
      'eviction_reports_status_check',
      sql`${table.status} in (${sql.raw(inList(LISTING_REPORT_STATUSES))})`,
    ),
  ],
);

/**
 * Legal and housing resources, scoped to the jurisdiction they apply in.
 *
 * CURATED REFERENCE DATA, like `countries` and `cities`. There is no API route
 * that writes this table, and that is the whole design: Homiio must not invent
 * legal advice, so a row exists only when somebody checked a named public source
 * and recorded when they checked it. `valid_until` makes a stale row disappear
 * rather than quietly keep asserting itself.
 *
 * `regions` is SET NULL rather than CASCADE: a resource that names a region
 * Homiio later reorganises is still a real national resource, and deleting it
 * would silently narrow what a household is shown.
 */
export const jurisdictionResources = pgTable(
  'jurisdiction_resources',
  {
    id: generatedId(),
    /** ISO-3166-1 alpha-2, uppercase. */
    countryCode: text().notNull(),
    regionId: text().references(() => regions.id, { onDelete: 'set null' }),
    resourceType: text({ enum: JURISDICTION_RESOURCE_TYPES }).notNull(),
    title: text().notNull(),
    url: text().notNull(),
    /** Who published it — an organisation or an authority, never "the internet". */
    source: text().notNull(),
    verifiedAt: timestamptz().notNull(),
    validUntil: timestamptz(),
    /** BCP-47 tags. */
    languages: text().array().notNull(),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index('jurisdiction_resources_country_type_idx').on(table.countryCode, table.resourceType),
    index('jurisdiction_resources_region_idx')
      .on(table.regionId)
      .where(sql`${table.regionId} is not null`),
    /** One row per source URL per jurisdiction, so a re-seed converges. */
    uniqueIndex('jurisdiction_resources_country_url_key').on(table.countryCode, table.url),
    check(
      'jurisdiction_resources_type_check',
      sql`${table.resourceType} in (${sql.raw(inList(JURISDICTION_RESOURCE_TYPES))})`,
    ),
    /**
     * `cardinality`, NOT `array_length`.
     *
     * `array_length(languages, 1)` returns **NULL** on an empty array, `NULL >= 1`
     * is NULL, and a CHECK rejects only FALSE — so the obvious spelling ACCEPTS
     * the `{}` it exists to forbid. `cardinality` returns 0 and behaves.
     */
    check('jurisdiction_resources_languages_check', sql`cardinality(${table.languages}) >= 1`),
    /** A resource that expired before it was verified was never valid. */
    check(
      'jurisdiction_resources_validity_check',
      sql`${table.validUntil} is null or ${table.validUntil} > ${table.verifiedAt}`,
    ),
  ],
);
