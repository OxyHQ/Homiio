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

import {
  bigint,
  boolean,
  check,
  doublePrecision,
  foreignKey,
  index,
  pgTable,
  text,
  uniqueIndex,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { createdAt, generatedId, inList, textArrayLiteral, timestamptz, updatedAt } from '@oxy.so/db';
import {
  LEASE_MOVEMENT_DIRECTIONS,
  LEASE_MOVEMENT_STATES,
  LEASE_PAYMENT_KINDS,
  PAYMENT_CURRENCIES,
  type LeaseDocumentType,
  type LeaseStatus,
} from '@homiio/shared-types';
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
    //
    // **A CACHE of `lease_signatures`, not the truth** (#518 §7.4). The truth is
    // one row per signature, naming what was signed; these four columns are the
    // two principals' entries denormalized onto the lease, and `signLease`
    // writes them in the SAME statement as the row they summarize. They are kept
    // rather than derived because the status transition, `leases_term_range_gist`
    // and the wire shape all read them, and an aggregate over a child table on
    // every lease read buys nothing.
    //
    // Two sources of truth that can drift is the outcome to avoid, so the drift
    // is asserted rather than hoped for: `__tests__/integration/
    // leaseSignatureBinding.test.ts` re-reads both after every signing path.
    signaturesLandlordSigned: boolean().notNull().default(false),
    signaturesLandlordSignedDate: timestamptz(),
    /**
     * PROTECTED (`protectedColumns.ts`), and DEAD since #518 §7.4.
     *
     * It held whatever string the client posted — `'accepted-in-app'`, a
     * literal in `app/contracts/[id].tsx` — and was excluded from every read,
     * so nothing could ever display what was supposedly signed. What actually
     * happened is now recorded as `lease_signatures.method`, and nothing writes
     * this column any more.
     *
     * Not dropped HERE because dropping it is a `post`-phase change: a `pre`
     * migration runs while the previous image is still serving, and that image's
     * `signLease` still writes this column. The drop is a follow-up migration,
     * not a silent leftover.
     */
    signaturesLandlordDigitalSignature: text(),
    signaturesTenantSigned: boolean().notNull().default(false),
    signaturesTenantSignedDate: timestamptz(),
    /** PROTECTED and DEAD — see the landlord counterpart above. */
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
 *
 * ## A co-tenant SIGNS (#518 §7.4)
 *
 * `signed_date` and `status` were ported from Mongo and had no writer at all:
 * `signLease` never touched them and `leaseController` refused a co-tenant's
 * signature outright, while `partyFilter` treated them as a party for reads and
 * `isFullySigned` read the status they could never reach. Two columns that
 * looked like an oversight, and the honest fix is the one the columns already
 * describe — a person named on a tenancy contract signs it.
 *
 * So the lease now becomes `active` only once the landlord, the tenant AND
 * every co-tenant has signed. That ends the disagreement `leaseSerializer.ts`
 * documented between `status` and `isFullySigned` — faithful to Mongo, and a
 * lease reading `active` while a named tenant has not signed is the same
 * confident lie the rent ledger removed from the payment side.
 *
 * These two columns are a CACHE of `lease_signatures`, exactly as the lease's
 * own booleans are. The set is REPLACED wholesale by an amendment
 * (`updateLease`), which would otherwise reset a co-tenant's signature to
 * `pending` and quietly deactivate the lease — so the replacement re-derives
 * both columns from `lease_signatures` in the same transaction. The signature
 * row deliberately carries no foreign key to this table for the same reason:
 * it has to outlive a co-tenant being removed.
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

/**
 * `documents[]` — the signed PDF and its addenda.
 *
 * ## `content_sha256` is what a signature can point at (#518 §7.4, #519 §7.4)
 *
 * A row names an object in a private bucket, and an object is a location rather
 * than a fact: "the tenant signed document `abc`" says nothing about what `abc`
 * held at the time. The digest of the bytes that were actually STORED says it —
 * which is why it is written by the upload path, from the processed buffer,
 * rather than from whatever arrived: an image is re-encoded to WebP on the way
 * in, so hashing the upload would record a digest of bytes nobody can ever be
 * shown.
 *
 * **Nullable, and that nullability is a fact rather than a gap.** Every row
 * written before this column existed has no digest and cannot be given one
 * without reading every object back out of S3. `lease_signatures` therefore has
 * three representable bindings and the constraints there — not the callers —
 * decide which is which: no document at all, a document whose bytes are
 * recorded, and a document that predates content hashing.
 */
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
    /** SHA-256 of the STORED bytes, lowercase hex. NULL before this column existed. */
    contentSha256: text(),
  },
  (table) => [
    index('lease_documents_lease_id_idx').on(table.leaseId),
    /**
     * The composite key `lease_signatures` points at.
     *
     * `id` is already unique on its own, so this index constrains nothing new —
     * it exists because Postgres requires a unique constraint over exactly the
     * referenced columns before `(document_id, document_sha256)` can be a
     * foreign key, and that foreign key is what stops a signature from naming
     * a digest its document never had.
     */
    uniqueIndex('lease_documents_id_content_key').on(table.id, table.contentSha256),
    check(
      'lease_documents_type_check',
      sql`${table.type} in (${sql.raw(inList(LEASE_DOCUMENT_TYPES))})`,
    ),
    /**
     * A digest is 64 lowercase hex characters or it is absent.
     *
     * `CONVENTIONS.md` defers FORMAT validators on a ported column because a
     * CHECK would reject production rows the census has not measured. This
     * column is not ported: it is new, it is written by exactly one function in
     * this package, and every existing row is NULL, which the constraint
     * permits. What it refuses is the half-value — a truncated digest, or the
     * uppercase spelling `crypto` does not produce — which would compare
     * unequal to the real one and read as a tampered document.
     */
    check(
      'lease_documents_content_sha256_check',
      sql`${table.contentSha256} is null or ${table.contentSha256} ~ '^[0-9a-f]{64}$'`,
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

/**
 * `lease_payment_movements` — the rent LEDGER (#518 §7.2, #519 §7.2).
 *
 * ## Why this table and not four more columns on the obligation
 *
 * `lease_payment_schedule` is a list of things OWED. It could be marked `paid`
 * with a date, an amount and a method, and the one function that did that —
 * `recordPayment` — had no caller anywhere in the package. So the obligation's
 * `paid_*` columns describe a payment Homiio has never recorded.
 *
 * Both epics require the split: obligation, attempt, confirmed payment, manual
 * record, partial, failure, refund, outstanding balance. None of those fit on
 * the obligation, because several of them are MANY per obligation — two
 * partials, a failed attempt then a successful one, a payment and its refund —
 * and a row that can only hold one is a row that loses the rest.
 *
 * ## A refund is a ROW, never an edit
 *
 * `direction: 'refund'` with `reverses_movement_id` set. The original stays
 * `succeeded` forever. A ledger that rewrites a settled payment to say it was
 * reversed has destroyed the record of the original, and reconciling against a
 * processor then has nothing to reconcile against.
 *
 * ## The obligation's own `status` is NOT the answer to "is it paid"
 *
 * The balance is derived from this table
 * (`shared-types/leasePayment.ts#leaseObligationSettlement`), and the
 * obligation's `status` column keeps only what the ledger cannot express —
 * `cancelled`, and the `overdue` marking. `recordPayment` is DELETED in the
 * same change, so nothing can write `paid` behind the ledger's back; the
 * `paid_*` columns stay null and the CHECK that ties them together now guards
 * a path with no writer, which is the strongest state it has ever been in.
 *
 * ## No card or bank detail exists in this schema
 *
 * `processor_reference` is a foreign system's opaque id. #518 §7.2 forbids
 * storing credentials outright, and there is nowhere here to put one.
 */
export const leasePaymentMovements = pgTable(
  'lease_payment_movements',
  {
    id: generatedId(),
    leaseId: text()
      .notNull()
      .references(() => leases.id, { onDelete: 'cascade' }),
    /** The obligation this pays or refunds. */
    obligationId: text()
      .notNull()
      .references(() => leasePaymentSchedule.id, { onDelete: 'cascade' }),

    direction: text({ enum: LEASE_MOVEMENT_DIRECTIONS }).notNull().default('payment'),
    kind: text({ enum: LEASE_PAYMENT_KINDS }).notNull(),
    state: text({ enum: LEASE_MOVEMENT_STATES }).notNull().default('pending'),

    /** Always positive; the DIRECTION is what makes a refund subtract. */
    amount: doublePrecision().notNull(),
    /**
     * Resolved from `leases.rent_details_currency` by the repository, never
     * taken from a request body.
     *
     * Stored on the movement rather than read through the lease because a
     * lease's currency could in principle be corrected, and a payment that
     * silently changed currency afterwards would be a different amount of
     * money. What settled, settled in what it settled in.
     */
    currency: text({ enum: PAYMENT_CURRENCIES }).notNull(),

    createdByOxyUserId: text().notNull(),
    confirmedByOxyUserId: text(),
    confirmedAt: timestamptz(),

    /** The processor's own opaque reference. NEVER a credential. */
    processorReference: text(),
    failureReason: text(),
    /**
     * Present on a refund: the movement it reverses.
     *
     * A REAL self-referencing foreign key, `CASCADE`: a refund of a payment
     * that no longer exists is a movement with no subject, and the lease's own
     * cascade removes both together anyway. The `AnyPgColumn` annotation is
     * what drizzle needs to type a self-reference.
     */
    reversesMovementId: text().references((): AnyPgColumn => leasePaymentMovements.id, {
      onDelete: 'cascade',
    }),
    note: text(),

    /**
     * The caller's own key, unique per lease.
     *
     * The dedupe for all four cases #518 §7.2 lists — creation, a double tap,
     * a checkout return and a duplicate or out-of-order webhook — because each
     * of them resolves to the row that already exists rather than to a second
     * one. A generated id could not do this: the point is that the SECOND
     * request carries the same key as the first.
     */
    idempotencyKey: text().notNull(),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index('lease_payment_movements_obligation_idx').on(table.obligationId, table.createdAt),
    index('lease_payment_movements_lease_idx').on(table.leaseId, table.createdAt),
    /** One movement per key per lease. The whole of the idempotency guarantee. */
    uniqueIndex('lease_payment_movements_idempotency_key').on(
      table.leaseId,
      table.idempotencyKey,
    ),
    /**
     * A processor reference identifies ONE movement.
     *
     * Partial, because it is null for every declaration — a total unique index
     * would let exactly one declaration exist across the whole table. The
     * reference is what makes a replayed webhook land on the row it already
     * created even when the caller lost its idempotency key.
     */
    uniqueIndex('lease_payment_movements_processor_reference_key')
      .on(table.processorReference)
      .where(sql`${table.processorReference} is not null`),
    check(
      'lease_payment_movements_direction_check',
      sql`${table.direction} in (${sql.raw(inList(LEASE_MOVEMENT_DIRECTIONS))})`,
    ),
    check(
      'lease_payment_movements_kind_check',
      sql`${table.kind} in (${sql.raw(inList(LEASE_PAYMENT_KINDS))})`,
    ),
    check(
      'lease_payment_movements_state_check',
      sql`${table.state} in (${sql.raw(inList(LEASE_MOVEMENT_STATES))})`,
    ),
    /** Money does not move by zero, and a negative amount is a refund's job. */
    check('lease_payment_movements_amount_check', sql`${table.amount} > 0`),
    /**
     * A refund reverses something; a payment reverses nothing.
     *
     * Both directions, because both are wrong and both would render: a refund
     * with nothing to reverse is money leaving against no record, and a
     * payment carrying a reversal pointer is a movement that would be counted
     * twice by anything walking the chain.
     */
    check(
      'lease_payment_movements_refund_target_check',
      sql`(${table.direction} = 'refund') = (${table.reversesMovementId} is not null)`,
    ),
    /**
     * A settled movement says WHEN it settled.
     *
     * One-way: a `pending` movement legitimately has no confirmation, and a
     * `failed` one never will. The reverse — a confirmation on something not
     * succeeded — is the shape that lets a screen show a date beside a payment
     * that did not happen, so it is refused too.
     */
    check(
      'lease_payment_movements_confirmed_check',
      sql`(${table.state} = 'succeeded') = (${table.confirmedAt} is not null)`,
    ),
    /** A failure says why. An unexplained failure is a support ticket. */
    check(
      'lease_payment_movements_failure_check',
      sql`${table.state} <> 'failed' or ${table.failureReason} is not null`,
    ),
    /**
     * A declaration has no processor reference.
     *
     * The one that stops "the tenant says they sent a transfer" from being
     * stored in a shape indistinguishable from "the processor settled it",
     * which is the confusion #518 §7.2 spends a paragraph on.
     */
    check(
      'lease_payment_movements_declaration_check',
      sql`${table.kind} <> 'manual_declaration' or ${table.processorReference} is null`,
    ),
  ],
);

/** Which party's seat on the lease a signature was made from. */
export const LEASE_SIGNATURE_PARTIES = ['landlord', 'tenant', 'co_tenant'] as const;

/**
 * HOW somebody signed.
 *
 * One value today, and it is the honest one: a person pressed "I accept" in the
 * app after being shown the terms. The column exists because the thing it
 * replaces did not say that — it said `'accepted-in-app'`, a string the CLIENT
 * chose and the server stored verbatim, which a different client could have set
 * to anything at all. A closed set means adding a hand-drawn mark or an
 * eIDAS-qualified signature later is a value plus a CHECK, not a re-reading of
 * free text.
 */
export const LEASE_SIGNATURE_METHODS = ['in_app_acceptance'] as const;

/**
 * `lease_signatures` — a signature bound to WHAT WAS SIGNED (#518 §7.4, #519 §7.4).
 *
 * §7.4 asks that "las firmas se vinculan a la versión/documento mostrados y a
 * los participantes". A signature used to be six columns on `leases`: two
 * booleans, two dates and two strings the client supplied. It named no
 * document, no version and no content, and a co-tenant had no way to make one
 * at all. Whether a lease was signed was recorded; WHAT was signed was not.
 *
 * ## The binding is OPTIONAL on the document and MANDATORY on the terms
 *
 * A lease may legitimately have no document. Homiio generates no contract PDF,
 * and the ordinary path — an approved application becomes a lease through
 * `/contracts/new?application=<id>` — produces a lease whose terms live in the
 * `leases` columns and nowhere else. Requiring a document before signing would
 * therefore not be "you cannot sign a contract that does not exist"; it would
 * make signing impossible for every lease Homiio can currently create, until
 * somebody uploaded a file by hand. That is why the document binding is
 * optional.
 *
 * What is never optional is the VERSION. `terms_sha256` is the digest of the
 * lease's own terms, canonicalized by `db/leases/leaseTerms.ts`, and it is
 * `NOT NULL`: every signature names the version it was made against, document
 * or no document. A landlord may still amend a lease that is awaiting
 * signatures, so this is the column that makes a stale signature VISIBLE rather
 * than letting an amendment silently inherit one.
 *
 * ## Three bindings, and the CONSTRAINTS decide which — not the caller
 *
 *  1. **No document.** `document_id` and `document_sha256` both NULL. The
 *     signature stands on the terms alone.
 *  2. **Bound to bytes.** Both set, and the composite foreign key
 *     `(document_id, document_sha256) → lease_documents(id, content_sha256)`
 *     means the digest is THAT document's, checked by Postgres. A caller cannot
 *     invent one, copy another document's, or record a stale one.
 *  3. **A document that predates content hashing.** `document_id` set,
 *     `document_sha256` NULL. `MATCH SIMPLE` — Postgres's default — satisfies a
 *     composite foreign key whenever any of its columns is NULL, so this shape
 *     is admitted deliberately rather than by omission, and the single-column
 *     foreign key beside it still proves the document exists. It is the weakest
 *     binding the schema can express and it says so out loud: that document's
 *     bytes were never recorded, so a later substitution of them is
 *     undetectable. Refusing it instead would have stranded every document
 *     uploaded before migration 0028.
 *
 * The one shape with no meaning — a digest naming no document — is refused by
 * `lease_signatures_document_hash_check`.
 *
 * ## Append-only, by trigger
 *
 * A signature that can be UPDATEd binds to nothing, because the binding itself
 * is editable. Migration 0028 installs a `BEFORE UPDATE` trigger that refuses
 * one, the same mechanism `eviction_case_updates` uses. `DELETE` is left alone:
 * the lease's own `ON DELETE CASCADE` needs it.
 */
export const leaseSignatures = pgTable(
  'lease_signatures',
  {
    id: generatedId(),
    leaseId: text()
      .notNull()
      .references(() => leases.id, { onDelete: 'cascade' }),
    /**
     * WHO signed — the participant half of §7.4's requirement.
     *
     * Resolved from the session by `requireSessionOxyUserId` and matched
     * against the lease's own party columns inside the signing transaction,
     * never taken from a request body.
     */
    signerOxyUserId: text().notNull(),
    /**
     * Which seat they signed from.
     *
     * Stored rather than re-derived from the lease on read: the co-tenant set
     * is replaced wholesale by an amendment, so a signature whose role had to
     * be looked up in `lease_co_tenants` would become unattributable the moment
     * somebody was removed from the lease.
     */
    party: text({ enum: LEASE_SIGNATURE_PARTIES }).notNull(),
    method: text({ enum: LEASE_SIGNATURE_METHODS }).notNull().default('in_app_acceptance'),
    signedAt: createdAt(),
    /** The version. See the header — `NOT NULL`, always. */
    termsSha256: text().notNull(),
    /**
     * The contract document, when the lease has one.
     *
     * `RESTRICT`, because deleting a document somebody signed destroys the
     * evidence rather than the file. Nothing deletes one today; the constraint
     * is a property of the table rather than of this week's routes. Deleting
     * the LEASE still works — both this table and `lease_documents` cascade from
     * it, and Postgres queues the cascades ahead of the referential check, which
     * `leaseSignatureBinding.test.ts` pins against a real server rather than
     * assuming.
     */
    documentId: text().references(() => leaseDocuments.id, { onDelete: 'restrict' }),
    /** The digest of that document's bytes. See the header's three bindings. */
    documentSha256: text(),
  },
  (table) => [
    /**
     * One signature per person per lease.
     *
     * TOTAL, not partial: both columns are `NOT NULL`, so there is no set of
     * rows for a predicate to carve out. It is what makes a double tap and two
     * concurrent requests land on one row instead of two signatures from the
     * same person.
     */
    uniqueIndex('lease_signatures_lease_signer_key').on(table.leaseId, table.signerOxyUserId),
    index('lease_signatures_lease_signed_idx').on(table.leaseId, table.signedAt),
    /**
     * The digest belongs to the document. `MATCH SIMPLE`, deliberately — see
     * the header's third binding.
     */
    foreignKey({
      name: 'lease_signatures_document_content_fk',
      columns: [table.documentId, table.documentSha256],
      foreignColumns: [leaseDocuments.id, leaseDocuments.contentSha256],
    }).onDelete('restrict'),
    check(
      'lease_signatures_party_check',
      sql`${table.party} in (${sql.raw(inList(LEASE_SIGNATURE_PARTIES))})`,
    ),
    check(
      'lease_signatures_method_check',
      sql`${table.method} in (${sql.raw(inList(LEASE_SIGNATURE_METHODS))})`,
    ),
    check('lease_signatures_terms_sha256_check', sql`${table.termsSha256} ~ '^[0-9a-f]{64}$'`),
    /**
     * A digest that names no document is a claim about nothing.
     *
     * Written one-way on purpose: the reverse — a document with no digest — is
     * the third binding above and is legitimate.
     */
    check(
      'lease_signatures_document_hash_check',
      sql`${table.documentSha256} is null or ${table.documentId} is not null`,
    ),
  ],
);

/**
 * What a tenancy timeline is made of (#518 §7.4, #519 §7.4).
 *
 * Only what this package actually WRITES. A value nothing can produce would
 * read as coverage on a screen that can never show it — the same reason
 * `eviction_case_attendees.confirmation_basis` omits `account_verified`.
 */
export const LEASE_EVENT_TYPES = [
  'created',
  'amended',
  'signed',
  'activated',
  'document_added',
  'terminated',
  'renewed',
] as const;

/**
 * `lease_events` — the tenancy timeline, as things that HAPPENED (#518 §7.4).
 *
 * §7.4 asks that "el timeline muestra eventos reales". It did not: the client
 * rebuilt roughly five entries on every render out of `created_at`, the two
 * signature booleans and the two term dates. Uploading a document, serving a
 * termination notice or amending a lease somebody had already signed left no
 * trace anybody could see, because there was nowhere for one to go.
 *
 * ## An audit, not a log
 *
 * `position` is computed in SQL as `coalesce(max(position), 0) + 1` inside the
 * INSERT, and a unique index on `(lease_id, position)` turns a concurrent
 * append into a `23505` rather than a duplicate — the same shape and the same
 * reason as `eviction_case_updates`, including the trap that computing it in
 * JavaScript reads `int8` back as a STRING and appends `'1' + 1 = '11'`. An
 * `UPDATE` is refused by a trigger installed in migration 0028.
 *
 * **`maintenance_request_events` orders by `created_at` and this one cannot.**
 * `signed` and `activated` are written in ONE transaction, and
 * `date_trunc('milliseconds', now())` is the TRANSACTION's clock — so both rows
 * carry the identical instant and a timestamp ordering renders "the lease
 * became active" above "the last party signed" on roughly half of all reads.
 * The position is the only thing that can order them.
 *
 * ## Why `detail` is text and not a foreign key
 *
 * An event is a statement about the past. A pointer into a table whose rows can
 * be removed is not: a `document_added` row whose `document_id` had gone would
 * either vanish with it (CASCADE, destroying the history) or become an event
 * about nothing (SET NULL). `detail` holds the datum that made the event
 * legible AT THE TIME — the document's name, the reason given for a
 * termination — and never a translated phrase, because the reader's language is
 * not a property of what happened. The frontend renders `event_type` through
 * i18n and `detail` verbatim.
 */
export const leaseEvents = pgTable(
  'lease_events',
  {
    id: generatedId(),
    leaseId: text()
      .notNull()
      .references(() => leases.id, { onDelete: 'cascade' }),
    /** Monotonic within a lease. Computed in SQL, never in JS — see the header. */
    position: bigint({ mode: 'number' }).notNull(),
    eventType: text({ enum: LEASE_EVENT_TYPES }).notNull(),
    /**
     * Who did it, or NULL for an event the system produced.
     *
     * `activated` is the one that has no actor and must not borrow one: the
     * lease became active because the LAST signature arrived, and attributing
     * that to whoever happened to sign last would credit them with a transition
     * every party caused together.
     */
    actorOxyUserId: text(),
    /** The document's name, the termination's reason. Never a translated phrase. */
    detail: text(),
    occurredAt: createdAt(),
  },
  (table) => [
    index('lease_events_lease_position_idx').on(table.leaseId, sql`${table.position} desc`),
    uniqueIndex('lease_events_lease_position_key').on(table.leaseId, table.position),
    check(
      'lease_events_type_check',
      sql`${table.eventType} in (${sql.raw(inList(LEASE_EVENT_TYPES))})`,
    ),
    check('lease_events_position_check', sql`${table.position} >= 1`),
  ],
);
