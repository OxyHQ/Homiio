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
 * ## Two fields a screen cannot compute for itself (#518 §7.4)
 *
 * `termsSha256` and each signature's `bindsCurrentTerms` are derived here
 * because they are derived from the ROWS, and the rows are what this module
 * holds. A client given only the raw digests would have to re-implement
 * `leaseTerms.ts`'s canonicalization to use them — and a client that got that
 * subtly wrong would draw "signed" over a version nobody signed.
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
  leaseEvents,
  leaseInspectionFindings,
  leaseInspections,
  leasePaymentSchedule,
  leaseSharedUtilityCosts,
  leaseSignatures,
  leases,
} from '../schema';
import { leases as leasesTable } from '../schema';
import { leaseTermsFingerprint } from './leaseTerms';

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
export type LeaseSignatureRow = InferSelectModel<typeof leaseSignatures>;
export type LeaseEventRow = InferSelectModel<typeof leaseEvents>;

/** One lease plus everything a response carries with it. */
export interface HydratedLease {
  lease: LeaseRow;
  coTenants: readonly LeaseCoTenantRow[];
  paymentSchedule: readonly LeasePaymentRow[];
  documents: readonly LeaseDocumentRow[];
  inspections: readonly LeaseInspectionRow[];
  inspectionFindings: readonly LeaseInspectionFindingRow[];
  sharedUtilityCosts: readonly LeaseSharedUtilityCostRow[];
  /**
   * The signature records, when the caller asked for them (#518 §7.4).
   *
   * `undefined` means NOT LOADED and is a different fact from `[]`, which means
   * nobody has signed. The DTO keeps that distinction — it omits the field
   * entirely rather than publishing an empty list a screen would render as "no
   * signatures" on a lease that has several.
   */
  signatures?: readonly LeaseSignatureRow[];
  /** The timeline, when the caller asked for it. Same `undefined` vs `[]` rule. */
  events?: readonly LeaseEventRow[];
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
 * **It used to disagree with `status` on purpose, and no longer does** (#518
 * §7.4). Mongo's `signAsLandlord`/`signAsTenant` set `status = 'active'` as soon
 * as the OTHER principal had signed, consulting no co-tenant, while this virtual
 * consulted all of them — so a lease with an unsigned co-tenant read
 * `status: 'active'` and `isFullySigned: false`. That was faithful to the source
 * and it was a lease calling itself active while a person named on it had not
 * signed, in a schema where that person had no way to sign at all. `signLease`
 * now waits for every party, so the two answers agree.
 *
 * It is still NOT a CHECK, and the reason has changed: the rule spans
 * `leases`, `lease_co_tenants` and `lease_signatures`, and a CHECK sees one row
 * of one table. What guards it instead is that ONE function computes both.
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

/**
 * A `lease_documents` row, as the documents endpoint returns it.
 *
 * ## `url` is gone, and that is the point (#518 §7.4)
 *
 * The column still holds one — the bytes did not move and no migration was
 * needed — but it pointed at `<publicUrl>/api/images/file/<key>`, the
 * unauthenticated route that also serves listing photos. Emitting it handed
 * every reader of a lease a permanent, cacheable link to the tenancy agreement,
 * the inspection report and the insurance certificate, which anyone they then
 * forwarded it to could open with no session at all. Keeping the field "for
 * compatibility" would keep the leak, because the leak IS the field.
 *
 * `downloadPath` is a request to make, not a link to follow: the handler behind
 * it proves the viewer is a party to this lease before a byte moves. See
 * `frontend/utils/privateDocument.ts` for why it cannot be opened with
 * `Linking.openURL`.
 */
export function serializeLeaseDocument(row: LeaseDocumentRow): Record<string, unknown> {
  return {
    id: row.id,
    name: row.name,
    downloadPath: `/api/leases/${row.leaseId}/documents/${row.id}`,
    type: row.type,
    /**
     * The digest of the stored bytes (#518 §7.4), or absent on a document
     * uploaded before migration 0028.
     *
     * Published rather than kept server-side because it is what lets a party
     * see that the document they are looking at is the one somebody signed —
     * the comparison is against `signatures[].documentSha256`, and a client
     * that could not see both could only be told the answer.
     */
    contentSha256: row.contentSha256 ?? undefined,
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

/**
 * One signature, as the contract screen reads it (#518 §7.4).
 *
 * `bindsCurrentTerms` is computed here rather than published as two digests for
 * the client to compare, because the comparison is the answer and a client that
 * got it wrong would render "signed" over a version nobody signed. The raw
 * `termsSha256` travels anyway: a party is entitled to see the value itself,
 * and it is the only thing that makes the claim checkable.
 *
 * `documentName` is denormalized onto the signature so a screen can say WHICH
 * document was signed without looking one up in a list that may not carry it —
 * the reader of a signature is asking about the past, and the document list is
 * about the present.
 */
function serializeLeaseSignature(
  row: LeaseSignatureRow,
  currentTermsSha256: string,
  documentNames: ReadonlyMap<string, string>,
): Record<string, unknown> {
  return {
    id: row.id,
    party: row.party,
    signerOxyUserId: row.signerOxyUserId,
    method: row.method,
    signedAt: row.signedAt,
    termsSha256: row.termsSha256,
    bindsCurrentTerms: row.termsSha256 === currentTermsSha256,
    documentId: row.documentId ?? undefined,
    documentName: row.documentId ? documentNames.get(row.documentId) : undefined,
    /**
     * Absent in two DIFFERENT cases, and the pair `documentId`/`documentSha256`
     * is what tells them apart: no document at all (both absent), and a
     * document whose bytes were never hashed (an id with no digest). The
     * schema's header calls the second one the weakest binding it can express;
     * the wire keeps it distinguishable rather than flattening both to "not
     * bound".
     */
    documentSha256: row.documentSha256 ?? undefined,
  };
}

/** One timeline entry. `detail` is never a translated phrase — see the schema. */
function serializeLeaseEvent(row: LeaseEventRow): Record<string, unknown> {
  return {
    id: row.id,
    position: row.position,
    type: row.eventType,
    actorOxyUserId: row.actorOxyUserId ?? undefined,
    detail: row.detail ?? undefined,
    occurredAt: row.occurredAt,
  };
}

/** The full lease DTO. */
export function serializeLease(hydrated: HydratedLease): Record<string, unknown> {
  const row = hydrated.lease;
  const termsSha256 = leaseTermsFingerprint(hydrated);
  const documentNames = new Map(hydrated.documents.map((document) => [document.id, document.name]));
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
    // this block cannot leak them — see the header. It is the CACHE of
    // `lease_signatures` (see `db/schema/leases.ts`), kept on the wire because
    // every existing screen reads it; `signatureRecords` below is the truth.
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

    /**
     * The version a signature can name (#518 §7.4).
     *
     * Recomputed from the rows in this very response, so it is the digest of
     * exactly what the client is about to render — which is what makes it
     * meaningful for the client to send back on `POST /:id/sign`.
     */
    termsSha256,

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
    // Omitted rather than emptied when the read did not ask for them: `[]`
    // would be a claim that nobody has signed and that nothing has happened.
    ...(hydrated.signatures
      ? {
          signatureRecords: hydrated.signatures.map((signature) =>
            serializeLeaseSignature(signature, termsSha256, documentNames),
          ),
        }
      : {}),
    ...(hydrated.events ? { events: hydrated.events.map(serializeLeaseEvent) } : {}),

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
