/**
 * `leases` row + children → the wire DTO the contracts screens read.
 *
 * Replaces `controllers/lease/toLeaseDTO.ts`, which reshaped a Mongoose
 * document. Two things it has to do that a `.toJSON()` did for free:
 *
 * **Re-nest the flattened columns.** `db/schema/CONVENTIONS.md` flattens
 * `leaseTerms.startDate` to `lease_terms_start_date`, and the wire shape is
 * still `leaseTerms: { startDate }` — the frontend and `Lease` in
 * `@homiio/shared-types` are unchanged by this migration, so the nesting is
 * rebuilt here rather than pushed onto every consumer.
 *
 * **Compute the four VIRTUALS.** `leaseDuration`, `formattedRent`,
 * `isFullySigned` and `daysUntilExpiration` were Mongoose virtuals; Postgres has
 * no counterpart, so they are derived here. `db/MIGRATION-CONTRACT.md` lists
 * them under "Virtuals a DTO has to compute".
 *
 * ## Signature material is excluded at the TYPE level, not by omission here
 *
 * `signatures_landlord_digital_signature` and its tenant counterpart are in
 * `db/schema/protectedColumns.ts`. Reads go through `publicColumns(leases)`, so
 * the columns are not in {@link LeaseRow} at all and this module could not emit
 * them if it tried — which is the point. Mongoose hid them only by their absence
 * from `toLeaseDTO`'s field list, i.e. by nobody having added them.
 */

import type { InferSelectModel } from 'drizzle-orm';
import { publicColumns } from '../schema/protectedColumns';
import type {
  leaseCoTenants,
  leaseDocuments,
  leaseInspectionFindings,
  leaseInspections,
  leasePaymentSchedule,
  leaseSharedUtilityCosts,
  leases,
} from '../schema';
import { leases as leasesTable } from '../schema';

/** The sanctioned selection — every column except the two signatures. */
export function leaseSelection() {
  return publicColumns(leasesTable);
}

/** A lease row as this module receives it — no digital signatures. */
export type LeaseRow = Omit<
  InferSelectModel<typeof leases>,
  'signaturesLandlordDigitalSignature' | 'signaturesTenantDigitalSignature'
>;

export type LeaseCoTenantRow = InferSelectModel<typeof leaseCoTenants>;
export type LeasePaymentRow = InferSelectModel<typeof leasePaymentSchedule>;
export type LeaseDocumentRow = InferSelectModel<typeof leaseDocuments>;
export type LeaseInspectionRow = InferSelectModel<typeof leaseInspections>;
export type LeaseInspectionFindingRow = InferSelectModel<typeof leaseInspectionFindings>;
export type LeaseSharedUtilityCostRow = InferSelectModel<typeof leaseSharedUtilityCosts>;

/** One lease plus everything a response carries with it. */
export interface HydratedLease {
  lease: LeaseRow;
  coTenants: readonly LeaseCoTenantRow[];
  paymentSchedule: readonly LeasePaymentRow[];
  documents: readonly LeaseDocumentRow[];
  inspections: readonly LeaseInspectionRow[];
  inspectionFindings: readonly LeaseInspectionFindingRow[];
  sharedUtilityCosts: readonly LeaseSharedUtilityCostRow[];
  /** The listing, when the caller asked for it hydrated. */
  property?: Record<string, unknown>;
}

const MILLISECONDS_PER_DAY = 1000 * 60 * 60 * 24;

/**
 * `leaseDuration` — whole days between the two dates.
 *
 * `Math.ceil` over an ABSOLUTE difference, exactly as the virtual had it. The
 * absolute value is now unreachable (`leases_term_order_check` refuses an
 * inverted term) but is kept so the function answers the same thing the virtual
 * did for any input.
 */
function leaseDuration(row: LeaseRow): number {
  const diff = Math.abs(
    row.leaseTermsEndDate.getTime() - row.leaseTermsStartDate.getTime(),
  );
  return Math.ceil(diff / MILLISECONDS_PER_DAY);
}

/**
 * `daysUntilExpiration` — signed, so a lease that has already ended is negative.
 *
 * Never `null` here, where the virtual could be: it returned `null` only when
 * `endDate` was absent, and the column is `NOT NULL`.
 */
function daysUntilExpiration(row: LeaseRow): number {
  const diff = row.leaseTermsEndDate.getTime() - Date.now();
  return Math.ceil(diff / MILLISECONDS_PER_DAY);
}

/** `formattedRent` — the monthly rent in its own currency, `en-US` formatting. */
function formattedRent(row: LeaseRow): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: row.rentDetailsCurrency,
  }).format(row.rentDetailsMonthlyRent);
}

/**
 * `isFullySigned` — both parties AND every co-tenant.
 *
 * **This deliberately disagrees with `status`, exactly as the source did.**
 * `signAsLandlord`/`signAsTenant` set `status = 'active'` as soon as the OTHER
 * principal has signed, consulting no co-tenant; this virtual consults all of
 * them. So a lease with an unsigned co-tenant reads `status: 'active'` and
 * `isFullySigned: false`, and it did in Mongo too. It is NOT expressed as a
 * CHECK for that reason: a coherence constraint can only be written where the
 * application states ONE rule, and here it states two.
 */
function isFullySigned(row: LeaseRow, coTenants: readonly LeaseCoTenantRow[]): boolean {
  return (
    row.signaturesLandlordSigned &&
    row.signaturesTenantSigned &&
    coTenants.every((coTenant) => coTenant.status === 'signed')
  );
}

/** A `lease_payment_schedule` row, as the payments endpoint returns it. */
export function serializeLeasePayment(row: LeasePaymentRow): Record<string, unknown> {
  return {
    id: row.id,
    dueDate: row.dueDate,
    amount: row.amount,
    type: row.type,
    description: row.description,
    status: row.status,
    paidDate: row.paidDate,
    paidAmount: row.paidAmount,
    paymentMethod: row.paymentMethod,
    transactionId: row.transactionId,
  };
}

/** A `lease_documents` row, as the documents endpoint returns it. */
export function serializeLeaseDocument(row: LeaseDocumentRow): Record<string, unknown> {
  return {
    id: row.id,
    name: row.name,
    url: row.url,
    type: row.type,
    // The column was RENAMED from Mongo's `uploadedBy` so `isOxyAccountColumn`
    // could classify it (`db/MIGRATION-CONTRACT.md`); the wire keeps the old
    // name, because renaming a response field is a frontend change and this
    // migration is not one.
    uploadedBy: row.uploadedByOxyUserId,
    uploadedDate: row.uploadedDate,
  };
}

function serializeInspection(
  row: LeaseInspectionRow,
  findings: readonly LeaseInspectionFindingRow[],
): Record<string, unknown> {
  return {
    id: row.id,
    type: row.type,
    scheduledDate: row.scheduledDate,
    completedDate: row.completedDate,
    inspector: row.inspector,
    notes: row.notes,
    signedByTenant: row.signedByTenant,
    signedByLandlord: row.signedByLandlord,
    findings: findings.map((finding) => ({
      id: finding.id,
      area: finding.area,
      condition: finding.condition,
      description: finding.description,
      photos: finding.photos,
    })),
  };
}

/** The full lease DTO. */
export function serializeLease(hydrated: HydratedLease): Record<string, unknown> {
  const row = hydrated.lease;
  const findingsByInspection = new Map<string, LeaseInspectionFindingRow[]>();
  for (const finding of hydrated.inspectionFindings) {
    const existing = findingsByInspection.get(finding.inspectionId);
    if (existing) existing.push(finding);
    else findingsByInspection.set(finding.inspectionId, [finding]);
  }

  return {
    id: row.id,
    propertyId: row.propertyId,
    property: hydrated.property,
    roomId: row.roomId,
    landlordOxyUserId: row.landlordOxyUserId,
    tenantOxyUserId: row.tenantOxyUserId,

    leaseTerms: {
      startDate: row.leaseTermsStartDate,
      endDate: row.leaseTermsEndDate,
      renewalOptions: row.leaseTermsRenewalOptions,
      renewalNoticeRequired: row.leaseTermsRenewalNoticeRequired,
      terminationNoticeRequired: row.leaseTermsTerminationNoticeRequired,
    },

    rentDetails: {
      monthlyRent: row.rentDetailsMonthlyRent,
      currency: row.rentDetailsCurrency,
      dueDate: row.rentDetailsDueDate,
      lateFeeAmount: row.rentDetailsLateFeeAmount,
      lateFeeGracePeriod: row.rentDetailsLateFeeGracePeriod,
      securityDeposit: row.rentDetailsSecurityDeposit,
      petDeposit: row.rentDetailsPetDeposit,
    },

    utilities: {
      included: row.utilitiesIncluded,
      tenantResponsible: row.utilitiesTenantResponsible,
      sharedCosts: hydrated.sharedUtilityCosts.map((cost) => ({
        id: cost.id,
        utility: cost.utility,
        splitPercentage: cost.splitPercentage,
      })),
    },

    rules: {
      pets: {
        allowed: row.rulesPetsAllowed,
        types: row.rulesPetsTypes,
        maxNumber: row.rulesPetsMaxNumber,
        restrictions: row.rulesPetsRestrictions,
      },
      smoking: row.rulesSmoking,
      guests: {
        overnightAllowed: row.rulesGuestsOvernightAllowed,
        maxConsecutiveDays: row.rulesGuestsOvernightMaxConsecutiveDays,
        maxDaysPerMonth: row.rulesGuestsOvernightMaxDaysPerMonth,
        parties: row.rulesGuestsParties,
      },
      subletting: row.rulesSubletting,
      alterations: row.rulesAlterations,
    },

    // The two `digitalSignature` fields are absent from `LeaseRow` itself, so
    // this block cannot leak them — see the header.
    signatures: {
      landlord: {
        signed: row.signaturesLandlordSigned,
        signedDate: row.signaturesLandlordSignedDate,
      },
      tenant: {
        signed: row.signaturesTenantSigned,
        signedDate: row.signaturesTenantSignedDate,
      },
    },

    status: row.status,
    notes: row.notes,

    terminationNotice: {
      givenBy: row.terminationNoticeGivenByOxyUserId,
      givenDate: row.terminationNoticeGivenDate,
      effectiveDate: row.terminationNoticeEffectiveDate,
      reason: row.terminationNoticeReason,
      acknowledged: row.terminationNoticeAcknowledged,
      acknowledgedDate: row.terminationNoticeAcknowledgedDate,
    },

    coTenants: hydrated.coTenants.map((coTenant) => ({
      id: coTenant.id,
      oxyUserId: coTenant.oxyUserId,
      role: coTenant.role,
      signedDate: coTenant.signedDate,
      status: coTenant.status,
    })),
    paymentSchedule: hydrated.paymentSchedule.map(serializeLeasePayment),
    documents: hydrated.documents.map(serializeLeaseDocument),
    inspections: hydrated.inspections.map((inspection) =>
      serializeInspection(inspection, findingsByInspection.get(inspection.id) ?? []),
    ),

    // The four Mongoose virtuals.
    leaseDuration: leaseDuration(row),
    formattedRent: formattedRent(row),
    isFullySigned: isFullySigned(row, hydrated.coTenants),
    daysUntilExpiration: daysUntilExpiration(row),

    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
