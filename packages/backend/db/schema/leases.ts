/**
 * `leases` and its six child tables — the tenancy contract.
 *
 * Ported from `models/schemas/LeaseSchema.ts` (561 lines). Empty in production.
 *
 * ## Two findings this port fixes rather than carries
 *
 * **`roomId` referenced a model that does not exist.** Mongo declared
 * `{ ref: 'Room' }` and there is no `Room` model registered anywhere in this
 * package — `roomController.createRoom` creates a **Property** with
 * `type: 'room'` and a `parentPropertyId`. Nothing populates the path, which is
 * why `MissingSchemaError` never fired. The LINK is real; only the name was
 * wrong, so it becomes a foreign key into `properties`. The prime directive is
 * that no relational link is lost, and this one was already half lost.
 *
 * **A payment could be marked paid without a payment.** `recordPayment` sets
 * `status`, `paidDate`, `paidAmount` and `paymentMethod` together, and Mongo
 * enforced no relationship between them, so a `paid` row carrying none of the
 * three was representable. The CHECK on `lease_payment_schedule` states it.
 *
 * ## Nullability follows the measured mongoose rule, and it produces one oddity
 *
 * `leaseTerms`, `rentDetails`, `utilities`, `rules`, `signatures` and
 * `terminationNotice` are NESTED PATHS carrying defaults, not sub-schemas
 * declared `default: undefined` — so mongoose materializes every one of them on
 * construction and their defaults really are in the stored BSON.
 * `CONVENTIONS.md` records that measurement; the consequence here is that
 * `termination_notice_acknowledged` is `NOT NULL DEFAULT false` on every lease,
 * including the overwhelming majority that have no termination notice at all.
 * That is faithful rather than tidy: it is exactly what the source holds, and
 * the notice's PRESENCE is read from `termination_notice_given_date`, not from
 * this flag.
 *
 * ## Signature material is PROTECTED
 *
 * `signatures_landlord_digital_signature` and its tenant counterpart are in
 * `protectedColumns.ts`. Mongoose hid them only by their absence from
 * `toLeaseDTO`'s field list; a bare drizzle `select()` returns them.
 */

import { bigint, boolean, check, doublePrecision, index, pgTable, text } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { createdAt, generatedId, inList, textArrayLiteral, timestamptz, updatedAt } from '@oxyhq/db';
import { PAYMENT_CURRENCIES, type LeaseDocumentType, type LeaseStatus } from '@homiio/shared-types';
import { properties } from './properties';

export const LEASE_STATUSES = [
  'draft',
  'pending_signatures',
  'active',
  'expired',
  'terminated',
  'cancelled',
] as const satisfies readonly `${LeaseStatus}`[];

export const LEASE_RENEWAL_OPTIONS = ['none', 'automatic', 'optional'] as const;

export const LEASE_CO_TENANT_ROLES = ['primary', 'secondary', 'guarantor'] as const;
export const LEASE_CO_TENANT_STATUSES = ['pending', 'signed', 'declined'] as const;

export const LEASE_PAYMENT_TYPES = ['rent', 'deposit', 'fee', 'utility'] as const;
export const LEASE_PAYMENT_STATUSES = ['pending', 'paid', 'overdue', 'cancelled'] as const;
export const LEASE_PAYMENT_METHODS = [
  'cash',
  'check',
  'bank_transfer',
  'credit_card',
  'debit_card',
  'digital_wallet',
] as const;

export const LEASE_DOCUMENT_TYPES = [
  'lease_agreement',
  'addendum',
  'inspection_report',
  'insurance',
  'other',
] as const satisfies readonly LeaseDocumentType[];

export const LEASE_UTILITIES = [
  'electricity',
  'gas',
  'water',
  'trash',
  'internet',
  'cable',
  'heat',
  'air_conditioning',
] as const;

export const LEASE_PET_TYPES = ['dog', 'cat', 'bird', 'fish', 'reptile', 'other'] as const;

export const LEASE_INSPECTION_TYPES = ['move_in', 'move_out', 'periodic', 'maintenance'] as const;
export const LEASE_INSPECTION_CONDITIONS = [
  'excellent',
  'good',
  'fair',
  'poor',
  'needs_repair',
] as const;

export const leases = pgTable(
  'leases',
  {
    id: generatedId(),

    /**
     * RESTRICT, and — as on `commissions` — it cannot collide with the
     * `properties` expiry sweep. A lease requires a landlord, so its property
     * carries an `oxy_user_id`; `expires_at` is set only for `isExternal`
     * listings, from which the same `pre('save')` hook strips `oxy_user_id`. The
     * two sets are disjoint by construction. `deleteProperty` is a SOFT delete
     * (status → `archived`), so nothing else hard-deletes a property either.
     *
     * CASCADE would be wrong for the obvious reason: a signed tenancy contract
     * is not a copy of an advertisement.
     */
    propertyId: text()
      .notNull()
      .references(() => properties.id, { onDelete: 'restrict' }),

    /**
     * The room within the property, for a room-level tenancy.
     *
     * A `properties.id`, NOT a reference to a `Room` table — see the header.
     * RESTRICT for the same reason as `property_id`; a room is a property.
     */
    roomId: text().references(() => properties.id, { onDelete: 'restrict' }),

    landlordOxyUserId: text().notNull(),
    tenantOxyUserId: text().notNull(),

    // ── leaseTerms ──
    leaseTermsStartDate: timestamptz().notNull(),
    leaseTermsEndDate: timestamptz().notNull(),
    leaseTermsRenewalOptions: text({ enum: LEASE_RENEWAL_OPTIONS }).notNull().default('none'),
    /** Days of notice. Application-generated whole days, so `bigint`. */
    leaseTermsRenewalNoticeRequired: bigint({ mode: 'number' }).notNull().default(30),
    leaseTermsTerminationNoticeRequired: bigint({ mode: 'number' }).notNull().default(30),

    // ── rentDetails ──
    rentDetailsMonthlyRent: doublePrecision().notNull(),
    rentDetailsCurrency: text({ enum: PAYMENT_CURRENCIES }).notNull().default('USD'),
    /** Day of the month rent falls due, 1-31. */
    rentDetailsDueDate: bigint({ mode: 'number' }).notNull().default(1),
    rentDetailsLateFeeAmount: doublePrecision().notNull().default(0),
    rentDetailsLateFeeGracePeriod: bigint({ mode: 'number' }).notNull().default(5),
    rentDetailsSecurityDeposit: doublePrecision().notNull().default(0),
    rentDetailsPetDeposit: doublePrecision().notNull().default(0),

    // ── utilities ──
    //
    // Two scalar arrays, read whole and never queried by element. `sharedCosts`
    // is the third member of this block and carries STRUCTURE, so it is a child
    // table (`lease_shared_utility_costs`) rather than a third array.
    utilitiesIncluded: text().array().notNull().default(sql`'{}'::text[]`),
    utilitiesTenantResponsible: text().array().notNull().default(sql`'{}'::text[]`),

    // ── rules ──
    rulesPetsAllowed: boolean().notNull().default(false),
    rulesPetsTypes: text().array().notNull().default(sql`'{}'::text[]`),
    rulesPetsMaxNumber: bigint({ mode: 'number' }).notNull().default(0),
    /** Free text ("no breeds over 20 kg"), so no vocabulary CHECK. */
    rulesPetsRestrictions: text().array().notNull().default(sql`'{}'::text[]`),
    rulesSmoking: boolean().notNull().default(false),
    rulesGuestsOvernightAllowed: boolean().notNull().default(true),
    rulesGuestsOvernightMaxConsecutiveDays: bigint({ mode: 'number' }).notNull().default(7),
    rulesGuestsOvernightMaxDaysPerMonth: bigint({ mode: 'number' }).notNull().default(14),
    rulesGuestsParties: boolean().notNull().default(false),
    rulesSubletting: boolean().notNull().default(false),
    rulesAlterations: boolean().notNull().default(false),

    // ── signatures ──
    signaturesLandlordSigned: boolean().notNull().default(false),
    signaturesLandlordSignedDate: timestamptz(),
    /** PROTECTED — see `protectedColumns.ts`. */
    signaturesLandlordDigitalSignature: text(),
    signaturesTenantSigned: boolean().notNull().default(false),
    signaturesTenantSignedDate: timestamptz(),
    /** PROTECTED — see `protectedColumns.ts`. */
    signaturesTenantDigitalSignature: text(),

    status: text({ enum: LEASE_STATUSES }).notNull().default('draft'),
    notes: text(),

    // ── terminationNotice ──
    /** The Oxy account that served notice (`leaseController` writes the session id). */
    terminationNoticeGivenByOxyUserId: text(),
    terminationNoticeGivenDate: timestamptz(),
    terminationNoticeEffectiveDate: timestamptz(),
    terminationNoticeReason: text(),
    terminationNoticeAcknowledged: boolean().notNull().default(false),
    terminationNoticeAcknowledgedDate: timestamptz(),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index('leases_property_status_idx').on(table.propertyId, table.status),
    index('leases_landlord_status_idx').on(table.landlordOxyUserId, table.status),
    index('leases_tenant_status_idx').on(table.tenantOxyUserId, table.status),

    /**
     * `findActive` asks "is `now()` inside this lease's term?", which is a
     * CONTAINMENT question, and Mongo's `{ startDate: 1, endDate: 1 }` compound
     * cannot answer it: a btree narrows by start OR by end and filters the rest
     * by hand. That index is NOT ported; this one answers `@> now()` directly.
     *
     * **CLOSED bounds `'[]'`, unlike `property_availability_windows`' `'[)'`,**
     * and the difference is the source rather than a preference: `findActive`
     * reads `$lte: now` / `$gte: now`, so a lease is active THROUGH its end
     * instant. The availability window's `[)` comes from the `AvailabilityWindow`
     * contract in shared-types, which says adjacent windows must not overlap. A
     * range's bound flag is part of its meaning; copying one table's spelling
     * into the other would silently move a tenancy's last day.
     */
    index('leases_term_range_gist').using(
      'gist',
      sql`tstzrange(${table.leaseTermsStartDate}, ${table.leaseTermsEndDate}, '[]')`,
    ),
    /**
     * `findExpiringSoon` — active leases ending inside a window. A range index
     * cannot serve this one (it is an ordinary range scan on one endpoint), and
     * the partial predicate keeps it the size of the set anybody queries.
     */
    index('leases_active_end_date_idx')
      .on(table.leaseTermsEndDate)
      .where(sql`${table.status} = 'active'`),

    check('leases_status_check', sql`${table.status} in (${sql.raw(inList(LEASE_STATUSES))})`),
    check(
      'leases_renewal_options_check',
      sql`${table.leaseTermsRenewalOptions} in (${sql.raw(inList(LEASE_RENEWAL_OPTIONS))})`,
    ),
    check(
      'leases_rent_currency_check',
      sql`${table.rentDetailsCurrency} in (${sql.raw(inList(PAYMENT_CURRENCIES))})`,
    ),
    check(
      'leases_utilities_included_check',
      sql`${table.utilitiesIncluded} <@ ${sql.raw(textArrayLiteral(LEASE_UTILITIES))}`,
    ),
    check(
      'leases_utilities_tenant_responsible_check',
      sql`${table.utilitiesTenantResponsible} <@ ${sql.raw(textArrayLiteral(LEASE_UTILITIES))}`,
    ),
    check(
      'leases_rules_pets_types_check',
      sql`${table.rulesPetsTypes} <@ ${sql.raw(textArrayLiteral(LEASE_PET_TYPES))}`,
    ),
    /**
     * Mongoose declared `min: 1, max: 31` on `rentDetails.dueDate` — a range
     * validator, which `CONVENTIONS.md` normally defers because a CHECK would
     * reject production rows the census has not measured. Expressed here because
     * the table is EMPTY: there is nothing to reject, and the alternative is a
     * payment schedule generated against day 0 or day 47 of a month.
     */
    check(
      'leases_rent_due_date_check',
      sql`${table.rentDetailsDueDate} between 1 and 31`,
    ),
    /**
     * Mongo's own validator lived on `Reservation.checkOut` and on the exchange
     * window but NOT here — a lease could end before it started. Same reasoning
     * as the row above: zero rows, and `generatePaymentSchedule` loops from
     * `startDate` to `endDate`, so an inverted term silently produces an empty
     * schedule and a lease nobody ever has to pay.
     */
    check('leases_term_order_check', sql`${table.leaseTermsEndDate} > ${table.leaseTermsStartDate}`),
  ],
);

/**
 * `coTenants[]` — the other people on the lease.
 *
 * Every child table below CASCADEs from `leases`: mongoose deleted these with
 * the parent document by construction, and none of them has meaning without it.
 */
export const leaseCoTenants = pgTable(
  'lease_co_tenants',
  {
    id: generatedId(),
    leaseId: text()
      .notNull()
      .references(() => leases.id, { onDelete: 'cascade' }),
    oxyUserId: text().notNull(),
    role: text({ enum: LEASE_CO_TENANT_ROLES }).notNull().default('secondary'),
    signedDate: timestamptz(),
    status: text({ enum: LEASE_CO_TENANT_STATUSES }).notNull().default('pending'),
  },
  (table) => [
    /**
     * One row per person per lease. Mongo could not express it, and the
     * `isFullySigned` virtual reads `coTenants.every(status === 'signed')` — a
     * duplicated co-tenant makes that answer depend on which copy was updated.
     */
    index('lease_co_tenants_lease_id_idx').on(table.leaseId),
    check(
      'lease_co_tenants_role_check',
      sql`${table.role} in (${sql.raw(inList(LEASE_CO_TENANT_ROLES))})`,
    ),
    check(
      'lease_co_tenants_status_check',
      sql`${table.status} in (${sql.raw(inList(LEASE_CO_TENANT_STATUSES))})`,
    ),
  ],
);

/**
 * `utilities.sharedCosts[]` — a utility split between the parties.
 *
 * The one member of the `utilities` block that is not a scalar array, and
 * therefore the one that becomes a table rather than a `text[]`.
 */
export const leaseSharedUtilityCosts = pgTable(
  'lease_shared_utility_costs',
  {
    id: generatedId(),
    leaseId: text()
      .notNull()
      .references(() => leases.id, { onDelete: 'cascade' }),
    utility: text({ enum: LEASE_UTILITIES }),
    /** Percentage of the bill the tenant carries, 0-100. */
    splitPercentage: doublePrecision(),
  },
  (table) => [
    index('lease_shared_utility_costs_lease_id_idx').on(table.leaseId),
    check(
      'lease_shared_utility_costs_utility_check',
      sql`${table.utility} in (${sql.raw(inList(LEASE_UTILITIES))})`,
    ),
    check(
      'lease_shared_utility_costs_split_check',
      sql`${table.splitPercentage} between 0 and 100`,
    ),
  ],
);

/**
 * `paymentSchedule[]` — the rent, deposit and fee instalments.
 *
 * A child table for the reason `CONVENTIONS.md` gives and no other: Mongo
 * INDEXED it by element (`{ 'paymentSchedule.dueDate': 1,
 * 'paymentSchedule.status': 1 }`), so it is queried by element by definition.
 * Its subdocuments are declared `{ _id: true }`, so every row keeps the id
 * `recordPayment` already looks it up by.
 */
export const leasePaymentSchedule = pgTable(
  'lease_payment_schedule',
  {
    id: generatedId(),
    leaseId: text()
      .notNull()
      .references(() => leases.id, { onDelete: 'cascade' }),
    dueDate: timestamptz().notNull(),
    amount: doublePrecision().notNull(),
    type: text({ enum: LEASE_PAYMENT_TYPES }).notNull(),
    description: text(),
    status: text({ enum: LEASE_PAYMENT_STATUSES }).notNull().default('pending'),
    paidDate: timestamptz(),
    paidAmount: doublePrecision(),
    paymentMethod: text({ enum: LEASE_PAYMENT_METHODS }),
    /** The processor's reference. A foreign system's id; see `billing`. */
    transactionId: text(),
  },
  (table) => [
    // The port of Mongo's element index, plus the lease scope the array
    // membership used to supply implicitly.
    index('lease_payment_schedule_lease_due_idx').on(table.leaseId, table.dueDate),
    index('lease_payment_schedule_due_status_idx').on(table.dueDate, table.status),
    check(
      'lease_payment_schedule_type_check',
      sql`${table.type} in (${sql.raw(inList(LEASE_PAYMENT_TYPES))})`,
    ),
    check(
      'lease_payment_schedule_status_check',
      sql`${table.status} in (${sql.raw(inList(LEASE_PAYMENT_STATUSES))})`,
    ),
    check(
      'lease_payment_schedule_method_check',
      sql`${table.paymentMethod} in (${sql.raw(inList(LEASE_PAYMENT_METHODS))})`,
    ),
    /**
     * A `paid` instalment carries the evidence that it was paid.
     *
     * `recordPayment` writes all four together and Mongo enforced nothing, so a
     * row marked `paid` with no date, no amount and no method was representable —
     * and it is indistinguishable, afterwards, from a payment somebody recorded
     * by hand. The reverse half matters too: a `paid_date` on a `pending` row is
     * a payment nobody counted.
     */
    check(
      'lease_payment_schedule_paid_evidence_check',
      sql`(
        ${table.status} = 'paid'
          and ${table.paidDate} is not null and ${table.paidAmount} is not null
      ) or (
        ${table.status} <> 'paid'
          and ${table.paidDate} is null and ${table.paidAmount} is null
      )`,
    ),
  ],
);

/** `documents[]` — the signed PDF and its addenda. */
export const leaseDocuments = pgTable(
  'lease_documents',
  {
    id: generatedId(),
    leaseId: text()
      .notNull()
      .references(() => leases.id, { onDelete: 'cascade' }),
    name: text().notNull(),
    url: text().notNull(),
    type: text({ enum: LEASE_DOCUMENT_TYPES }).notNull().default('other'),
    /** Mongo's `uploadedBy`, renamed: `leaseController` writes the session Oxy id. */
    uploadedByOxyUserId: text().notNull(),
    uploadedDate: timestamptz().notNull(),
  },
  (table) => [
    index('lease_documents_lease_id_idx').on(table.leaseId),
    check(
      'lease_documents_type_check',
      sql`${table.type} in (${sql.raw(inList(LEASE_DOCUMENT_TYPES))})`,
    ),
  ],
);

/** `inspections[]` — a move-in, move-out, periodic or maintenance walkthrough. */
export const leaseInspections = pgTable(
  'lease_inspections',
  {
    id: generatedId(),
    leaseId: text()
      .notNull()
      .references(() => leases.id, { onDelete: 'cascade' }),
    type: text({ enum: LEASE_INSPECTION_TYPES }).notNull(),
    scheduledDate: timestamptz().notNull(),
    completedDate: timestamptz(),
    /**
     * Required free text, and deliberately NOT treated as an Oxy account id.
     *
     * It has NO writer in this package — `scheduleInspection` is a method
     * nothing calls — so there is no evidence of what it holds, and classifying
     * it as an account id on the strength of its name would put it outside the
     * foreign-key gate on a guess. If the batch that ports this feature finds it
     * is an account id, renaming it is a one-line change on an empty table.
     */
    inspector: text().notNull(),
    notes: text(),
    signedByTenant: boolean().notNull().default(false),
    signedByLandlord: boolean().notNull().default(false),
  },
  (table) => [
    index('lease_inspections_lease_id_idx').on(table.leaseId),
    check(
      'lease_inspections_type_check',
      sql`${table.type} in (${sql.raw(inList(LEASE_INSPECTION_TYPES))})`,
    ),
  ],
);

/**
 * `inspections[].findings[]` — a grandchild, and the only two-level embedded
 * array in the whole migration.
 *
 * `photos` stays a native `text[]`: it is a list of URLs read whole, with no
 * per-element fact to record. That is the same call `reviews.images` gets, and
 * the opposite of the one `property_images` gets — there the elements are
 * references INTO `images` with a primary flag and an order.
 */
export const leaseInspectionFindings = pgTable(
  'lease_inspection_findings',
  {
    id: generatedId(),
    inspectionId: text()
      .notNull()
      .references(() => leaseInspections.id, { onDelete: 'cascade' }),
    area: text(),
    condition: text({ enum: LEASE_INSPECTION_CONDITIONS }),
    description: text(),
    photos: text().array().notNull().default(sql`'{}'::text[]`),
  },
  (table) => [
    index('lease_inspection_findings_inspection_id_idx').on(table.inspectionId),
    check(
      'lease_inspection_findings_condition_check',
      sql`${table.condition} in (${sql.raw(inList(LEASE_INSPECTION_CONDITIONS))})`,
    ),
  ],
);
