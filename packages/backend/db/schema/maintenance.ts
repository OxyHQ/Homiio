/**
 * `maintenance_requests` and its two child tables — repairs, from reported to
 * closed (#518 §7.1, #519 §7.1).
 *
 * ## A new domain, not a port
 *
 * There is no Mongo predecessor. Homiio had no maintenance anything, and
 * `app/my-home.tsx` said so in its own header while both epics rejected that as
 * an ending. The nearest existing rows are `lease_inspections` — a landlord's
 * scheduled walkthrough — which is a different fact reported by a different
 * person about a building that is not yet broken.
 *
 * ## The parent is the LEASE
 *
 * Not the property, and the choice is load-bearing in two directions.
 *
 * A property outlives every tenancy in it: a repair somebody reported in 2019
 * is not the business of whoever rents the flat today, and hanging requests off
 * `properties` would make "my repairs" a question about a building rather than
 * about a tenancy. It would also put them under the expiry sweep's reach, since
 * `properties` is hard-deleted continuously for external listings.
 *
 * And the lease is where the participants already are. Authorization reads
 * `findLeaseAccess` — landlord, tenant, co-tenants — so there is no second
 * membership list to drift out of step with the first.
 *
 * `CASCADE` from `leases` follows the convention for child tables: a repair
 * request has no meaning without the tenancy it was raised under. Nothing
 * deletes a lease today (`deleteLease` exists and is not reachable from a
 * route), so this is the shape rather than a live behaviour.
 *
 * ## `property_id` is DENORMALIZED, deliberately
 *
 * It is `leases.property_id` copied at insert time. The landlord's surface
 * lists requests across every lease on a building, and reaching that through a
 * join on every read — for a column that cannot change, since a lease's
 * property is immutable — buys nothing. It carries its own foreign key with
 * `RESTRICT`, matching every other table that records a human transaction
 * against a listing: a repair request is a record of something that happened to
 * somebody, not a copy of an advertisement.
 *
 * ## No attachments yet, and the reason is not oversight
 *
 * Both epics ask for photos on a request, and both also say the evidence for a
 * tenancy may not go through the PUBLIC image endpoint. Homiio's image pipeline
 * is public delivery by construction — `imageUploadService` writes
 * `Cache-Control: public, max-age=31536000` and serves through the CDN — so
 * there is no private object path to attach to. Adding one is its own change
 * with its own access model; shipping "attach a photo" onto the public bucket
 * would put a picture of somebody's bathroom on a guessable URL.
 *
 * Recorded in `docs/housing-parity.md` as the open half of this row.
 */

import { check, index, pgTable, text } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { createdAt, generatedId, inList, timestamptz, updatedAt } from '@oxy.so/db';
import {
  MAINTENANCE_CATEGORIES,
  MAINTENANCE_STATUSES,
  MAINTENANCE_URGENCIES,
  type MaintenanceCategory,
  type MaintenanceStatus,
  type MaintenanceUrgency,
} from '@homiio/shared-types';

import { leases } from './leases';
import { properties } from './properties';

/**
 * The vocabularies, re-declared as `satisfies` the shared unions.
 *
 * The tuple is what the CHECK is built from, and the `satisfies` is what makes
 * adding a value to the shared contract without adding it here a compile error
 * rather than a row the database refuses at runtime.
 */
export const MAINTENANCE_CATEGORY_VALUES = MAINTENANCE_CATEGORIES satisfies readonly MaintenanceCategory[];
export const MAINTENANCE_URGENCY_VALUES = MAINTENANCE_URGENCIES satisfies readonly MaintenanceUrgency[];
export const MAINTENANCE_STATUS_VALUES = MAINTENANCE_STATUSES satisfies readonly MaintenanceStatus[];

/** Which side of the lease an author is on. Resolved server-side, never sent. */
export const MAINTENANCE_ROLES = ['tenant', 'landlord'] as const;

export const maintenanceRequests = pgTable(
  'maintenance_requests',
  {
    id: generatedId(),

    leaseId: text()
      .notNull()
      .references(() => leases.id, { onDelete: 'cascade' }),
    /** `leases.property_id`, copied. Immutable, so the copy cannot go stale. */
    propertyId: text()
      .notNull()
      .references(() => properties.id, { onDelete: 'restrict' }),

    /** The Oxy account that raised it. A tenant or a co-tenant, in practice. */
    reportedByOxyUserId: text().notNull(),

    category: text({ enum: MAINTENANCE_CATEGORY_VALUES }).notNull(),
    /**
     * The REPORTER's reading of how urgent it is, never rewritten.
     *
     * A landlord who disagrees says so in the thread, where it is visible,
     * rather than editing what the tenant said. There is deliberately no
     * `landlord_urgency` column: two urgencies is a question about which one a
     * list sorts by, and the answer would be "the one the person looking at it
     * wrote", which is not a priority order at all.
     */
    urgency: text({ enum: MAINTENANCE_URGENCY_VALUES }).notNull().default('normal'),
    status: text({ enum: MAINTENANCE_STATUS_VALUES }).notNull().default('open'),

    title: text().notNull(),
    description: text().notNull(),

    /** When a visit or a trade is arranged. Set with the move to `scheduled`. */
    scheduledFor: timestamptz(),
    /**
     * When the landlord said it was fixed.
     *
     * Kept even after a reopen, and that is the point: "this was declared fixed
     * on the 3rd and was not" is the fact a tenant needs, and clearing the
     * column on reopen would erase it. The EVENT log carries the sequence; this
     * carries the most recent claim.
     */
    resolvedAt: timestamptz(),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    /**
     * A tenancy's requests, newest first — the My home list, which is the
     * common read by a wide margin.
     */
    index('maintenance_requests_lease_created_idx').on(table.leaseId, sql`${table.createdAt} desc`),
    /**
     * A building's OPEN requests, for the landlord's surface.
     *
     * Partial, because the landlord's question is "what needs doing?" and a
     * closed request has never been part of that answer. It is derived from
     * that call site rather than added speculatively — the convention forbids
     * the latter, and an unfiltered `(property_id, created_at)` would serve a
     * query nothing makes.
     */
    index('maintenance_requests_property_open_idx')
      .on(table.propertyId, sql`${table.createdAt} desc`)
      .where(sql`${table.status} not in ('closed', 'declined')`),
    check(
      'maintenance_requests_category_check',
      sql`${table.category} in (${sql.raw(inList(MAINTENANCE_CATEGORY_VALUES))})`,
    ),
    check(
      'maintenance_requests_urgency_check',
      sql`${table.urgency} in (${sql.raw(inList(MAINTENANCE_URGENCY_VALUES))})`,
    ),
    check(
      'maintenance_requests_status_check',
      sql`${table.status} in (${sql.raw(inList(MAINTENANCE_STATUS_VALUES))})`,
    ),
    /**
     * A `scheduled` request has a date, and nothing else does.
     *
     * Both directions, because both are wrong in a way a screen would render
     * confidently: a scheduled repair with no date is a promise with no day in
     * it, and a date on an `open` request reads as an appointment nobody made.
     * This is the `lease_payment_schedule` CHECK's shape — a status and the
     * columns that give it meaning, stated together.
     */
    check(
      'maintenance_requests_scheduled_coherence_check',
      sql`(${table.status} = 'scheduled') = (${table.scheduledFor} is not null)`,
    ),
    /**
     * `resolved_at` is set once the landlord has claimed a fix, and SURVIVES a
     * reopen — so the implication runs one way only.
     *
     * A two-way CHECK here would forbid the reopened state this domain exists
     * to support, which is the thing a tenant most needs to be able to do.
     */
    check(
      'maintenance_requests_resolved_at_check',
      sql`${table.status} <> 'resolved' or ${table.resolvedAt} is not null`,
    ),
  ],
);

export const maintenanceRequestComments = pgTable(
  'maintenance_request_comments',
  {
    id: generatedId(),
    requestId: text()
      .notNull()
      .references(() => maintenanceRequests.id, { onDelete: 'cascade' }),
    oxyUserId: text().notNull(),
    /** Resolved from the lease at write time, so a later role change is not retroactive. */
    role: text({ enum: MAINTENANCE_ROLES }).notNull(),
    body: text().notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    index('maintenance_request_comments_request_created_idx').on(
      table.requestId,
      table.createdAt,
    ),
    check(
      'maintenance_request_comments_role_check',
      sql`${table.role} in (${sql.raw(inList(MAINTENANCE_ROLES))})`,
    ),
  ],
);

/**
 * Every status change, in order.
 *
 * A separate table rather than columns on the request, because the question it
 * answers is "what happened, and who did it?" and that is a LIST. Two
 * timestamps on the parent cannot say that a request was resolved, reopened and
 * resolved again — which is exactly the history somebody arguing about a repair
 * needs.
 *
 * `from` is null on the creation row, the only entry with no previous status.
 */
export const maintenanceRequestEvents = pgTable(
  'maintenance_request_events',
  {
    id: generatedId(),
    requestId: text()
      .notNull()
      .references(() => maintenanceRequests.id, { onDelete: 'cascade' }),
    oxyUserId: text().notNull(),
    role: text({ enum: MAINTENANCE_ROLES }).notNull(),
    /** Null only on the creation entry. */
    fromStatus: text({ enum: MAINTENANCE_STATUS_VALUES }),
    toStatus: text({ enum: MAINTENANCE_STATUS_VALUES }).notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    index('maintenance_request_events_request_created_idx').on(table.requestId, table.createdAt),
    check(
      'maintenance_request_events_role_check',
      sql`${table.role} in (${sql.raw(inList(MAINTENANCE_ROLES))})`,
    ),
    check(
      'maintenance_request_events_from_check',
      sql`${table.fromStatus} is null or ${table.fromStatus} in (${sql.raw(inList(MAINTENANCE_STATUS_VALUES))})`,
    ),
    check(
      'maintenance_request_events_to_check',
      sql`${table.toStatus} in (${sql.raw(inList(MAINTENANCE_STATUS_VALUES))})`,
    ),
  ],
);
