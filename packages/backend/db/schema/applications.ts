/**
 * `tenant_applications` and its two child tables — the long-term rent
 * application (Idealista-style).
 *
 * Ported from `models/schemas/TenantApplicationSchema.ts`. Empty in production.
 *
 * Distinct from `reservations` (a paid short stay) and `viewing_requests` (an
 * in-person tour): this is the form a prospective tenant submits before a
 * `leases` row exists, and the landlord's decision on it is what creates one.
 */

import { bigint, check, doublePrecision, index, pgTable, text } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { createdAt, generatedId, inList, timestamptz, updatedAt } from '@oxyhq/db';
import type {
  TenantApplicationDocumentType,
  TenantApplicationStatus,
} from '@homiio/shared-types';
import { EMPLOYMENT_STATUSES, REFERENCE_RELATIONSHIPS } from './profiles';
import { properties } from './properties';

export const TENANT_APPLICATION_STATUSES = [
  'submitted',
  'reviewing',
  'approved',
  'rejected',
  'withdrawn',
] as const satisfies readonly `${TenantApplicationStatus}`[];

export const TENANT_APPLICATION_DOCUMENT_TYPES = [
  'id',
  'income',
  'reference',
  'other',
] as const satisfies readonly `${TenantApplicationDocumentType}`[];

/**
 * The three statuses `pre('save')` stamps `decidedAt` on.
 *
 * Declared here rather than inlined into the CHECK because the hook and the
 * constraint have to name the same set — a hook is bypassable (this package runs
 * updates with `runValidators` off) and the CHECK is not, so if they disagreed
 * the constraint would reject writes the application believes are correct.
 */
export const TENANT_APPLICATION_TERMINAL_STATUSES = [
  'approved',
  'rejected',
  'withdrawn',
] as const satisfies readonly (typeof TENANT_APPLICATION_STATUSES)[number][];

export const tenantApplications = pgTable(
  'tenant_applications',
  {
    id: generatedId(),

    /**
     * RESTRICT. An application is a record of a person asking for a home, not a
     * copy of the advertisement — and it is only ever filed against an internal
     * listing, which carries no `expires_at` (see `leases.property_id` for the
     * full argument).
     */
    propertyId: text()
      .notNull()
      .references(() => properties.id, { onDelete: 'restrict' }),

    applicantOxyUserId: text().notNull(),
    landlordOxyUserId: text().notNull(),

    moveInDate: timestamptz().notNull(),
    /** Whole months. Application-supplied and validated as an integer, so `bigint`. */
    leaseTermMonths: bigint({ mode: 'number' }).notNull(),
    monthlyIncome: doublePrecision().notNull(),
    employmentStatus: text({ enum: EMPLOYMENT_STATUSES }).notNull(),

    status: text({ enum: TENANT_APPLICATION_STATUSES }).notNull().default('submitted'),
    notes: text(),
    /**
     * Kept ALONGSIDE `created_at` rather than collapsed into it, the same call
     * `cities.last_updated` gets: Mongo declared both, they are written by
     * different things (`submittedAt` has `default: Date.now`, `createdAt` comes
     * from `timestamps: true`), and a resubmission flow could legitimately move
     * one and not the other.
     */
    submittedAt: timestamptz().notNull(),
    /** Stamped by `pre('save')` on the first move into a terminal status. */
    decidedAt: timestamptz(),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index('tenant_applications_property_status_idx').on(table.propertyId, table.status),
    index('tenant_applications_applicant_status_idx').on(table.applicantOxyUserId, table.status),
    index('tenant_applications_landlord_status_submitted_idx').on(
      table.landlordOxyUserId,
      table.status,
      sql`${table.submittedAt} desc`,
    ),
    check(
      'tenant_applications_status_check',
      sql`${table.status} in (${sql.raw(inList(TENANT_APPLICATION_STATUSES))})`,
    ),
    check(
      'tenant_applications_employment_status_check',
      sql`${table.employmentStatus} in (${sql.raw(inList(EMPLOYMENT_STATUSES))})`,
    ),
    /**
     * A decided application has a decision date, and an undecided one does not.
     *
     * The `pre('save')` hook writes `decidedAt` on the transition — and it is a
     * SAVE hook, so `findOneAndUpdate` bypasses it entirely, which is how a
     * `rejected` application with no `decided_at` reaches the landlord's
     * dashboard sorted as if it were still open. Empty table, so the constraint
     * rejects nothing that exists.
     */
    check(
      'tenant_applications_decided_at_check',
      sql`(${table.status} in (${sql.raw(inList(TENANT_APPLICATION_TERMINAL_STATUSES))}))
        = (${table.decidedAt} is not null)`,
    ),
  ],
);

/**
 * `referenceContacts[]` — the referees the applicant names.
 *
 * Declared `{ _id: false }` in Mongo, so these subdocuments have NO id to
 * preserve and the backfill MINTS a uuid v7 for each. That is not a remap — it
 * is an id where there was none, and nothing references an application reference
 * by construction. See `db/MIGRATION-CONTRACT.md` for the full list of arrays in
 * this class.
 */
export const tenantApplicationReferences = pgTable(
  'tenant_application_references',
  {
    id: generatedId(),
    applicationId: text()
      .notNull()
      .references(() => tenantApplications.id, { onDelete: 'cascade' }),
    name: text().notNull(),
    relationship: text({ enum: REFERENCE_RELATIONSHIPS }).notNull(),
    /** Required here, unlike `profile_references.phone` — an application referee must be reachable. */
    phone: text().notNull(),
    email: text().notNull(),
  },
  (table) => [
    index('tenant_application_references_application_id_idx').on(table.applicationId),
    check(
      'tenant_application_references_relationship_check',
      sql`${table.relationship} in (${sql.raw(inList(REFERENCE_RELATIONSHIPS))})`,
    ),
  ],
);

/** `documents[]` — payslips, an id, a landlord reference. Also `{ _id: false }`. */
export const tenantApplicationDocuments = pgTable(
  'tenant_application_documents',
  {
    id: generatedId(),
    applicationId: text()
      .notNull()
      .references(() => tenantApplications.id, { onDelete: 'cascade' }),
    type: text({ enum: TENANT_APPLICATION_DOCUMENT_TYPES }).notNull(),
    url: text().notNull(),
    filename: text().notNull(),
  },
  (table) => [
    index('tenant_application_documents_application_id_idx').on(table.applicationId),
    check(
      'tenant_application_documents_type_check',
      sql`${table.type} in (${sql.raw(inList(TENANT_APPLICATION_DOCUMENT_TYPES))})`,
    ),
  ],
);
