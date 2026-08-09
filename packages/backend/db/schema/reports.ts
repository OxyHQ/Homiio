/**
 * `listing_reports` — a trust & safety report against a property listing.
 *
 * Ported from `models/schemas/ListingReportSchema.ts`. Empty in production.
 *
 * Distinct from `reviews` (a public address rating) and from
 * `moderation_reports` (the durable record of what a report DID, which the
 * CrowdSource pipeline drains). This one is the intake form, and it keeps the
 * shape and the semantics it already had.
 *
 * The two vocabularies live here rather than in `evictions.ts` because
 * `EvictionReportSchema` imports them from the same shared-types enums —
 * `ListingReportReason` and `ListingReportStatus` — and two tuples meant to be
 * identical are two tuples that can drift.
 */

import { check, index, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { createdAt, generatedId, inList, updatedAt } from '@oxyhq/db';
import type { ListingReportReason, ListingReportStatus } from '@homiio/shared-types';
import { properties } from './properties';

export const LISTING_REPORT_REASONS = [
  'inaccurate',
  'scam',
  'inappropriate',
  'unavailable',
  'privacy',
  'unsafe',
  'other',
] as const satisfies readonly `${ListingReportReason}`[];

export const LISTING_REPORT_STATUSES = [
  'open',
  'reviewing',
  'resolved',
  'dismissed',
] as const satisfies readonly `${ListingReportStatus}`[];

export const listingReports = pgTable(
  'listing_reports',
  {
    id: generatedId(),

    /**
     * CASCADE — the ONE reference to `properties` in this migration that is not
     * RESTRICT, and the reason is the expiry sweep.
     *
     * Every other transactional table (`leases`, `reservations`,
     * `tenant_applications`, `viewing_requests`, `exchange_requests`,
     * `commissions`) can only ever name an INTERNAL listing, which carries no
     * `expires_at`. A T&S report cannot: reporting an external aggregator ad is
     * exactly what this form is for, and those rows are hard-deleted continuously
     * by `sweepExpiredRows`. RESTRICT there would let one open report abort a
     * whole sweep batch — silently, on a schedule, growing the table it was
     * meant to reap.
     *
     * The durable trace survives: `moderation_reports.reported_id` carries no
     * foreign key by design, so what was DELIVERED and DECIDED about a listing
     * outlives the listing.
     */
    propertyId: text()
      .notNull()
      .references(() => properties.id, { onDelete: 'cascade' }),

    reporterOxyUserId: text().notNull(),
    reason: text({ enum: LISTING_REPORT_REASONS }).notNull(),
    /** Stored at the SOURCE surface's limit (4,000 chars) and truncated at delivery. */
    details: text(),
    contactEmail: text(),
    status: text({ enum: LISTING_REPORT_STATUSES }).notNull().default('open'),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    // The triage queue, oldest attention first.
    index('listing_reports_status_created_idx').on(table.status, sql`${table.createdAt} desc`),
    index('listing_reports_property_status_idx').on(table.propertyId, table.status),
    /**
     * One OPEN report per reporter per property — Mongo's
     * `partialFilterExpression: { status: 'open' }`, ported directly.
     *
     * Partial, and the partiality is load-bearing: once a report is resolved or
     * dismissed the same person must be able to file again if the listing is
     * still wrong.
     */
    uniqueIndex('listing_reports_open_reporter_key')
      .on(table.propertyId, table.reporterOxyUserId)
      .where(sql`${table.status} = 'open'`),
    check(
      'listing_reports_reason_check',
      sql`${table.reason} in (${sql.raw(inList(LISTING_REPORT_REASONS))})`,
    ),
    check(
      'listing_reports_status_check',
      sql`${table.status} in (${sql.raw(inList(LISTING_REPORT_STATUSES))})`,
    ),
  ],
);
