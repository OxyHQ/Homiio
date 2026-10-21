/**
 * Leases — the tenancy contract after an approved application, as use cases.
 *
 * `controllers/leaseController.ts` (the routes) and
 * `capabilities/handlers/leases.ts` (the catalogue tools) both call these. Every
 * function takes the acting person's Oxy id explicitly and never reads a
 * request. Persistence is `db/leases/leaseReads.ts`; the rules here are the
 * ones the controller used to hold:
 *
 *  - a party (landlord, tenant or co-tenant) may read a lease; anybody else gets
 *    403 — except for a document's bytes, reached by guessing a URL, which
 *    answers 404 so a stranger learns nothing;
 *  - only the landlord edits, deletes or renews, and only while the status
 *    allows (re-checked in each write's own predicate);
 *  - edits pass `controllers/lease/editableFields.ts`'s whitelist;
 *  - the signing seat is resolved from the LEASE against the acting id, never
 *    from input;
 *  - notifications go through `notificationDispatchService` only.
 */

import path from 'node:path';

import { LeaseStatus } from '@homiio/shared-types';

import { CREATABLE_LEASE_FIELDS, EDITABLE_LEASE_FIELDS } from '../controllers/lease/editableFields';
import {
  toCoTenantRows,
  toLeaseColumns,
  toSharedUtilityCostRows,
} from '../controllers/lease/leaseWriteColumns';
import { appendLeaseEvent } from '../db/leases/leaseEvents';
import {
  addLeaseDocument,
  createLease,
  deleteLease as deleteLeaseRow,
  findLeaseAccess,
  findLeaseById,
  findLeaseDocument,
  findPropertyLeaseBasis,
  listLeaseDocuments as listLeaseDocumentRows,
  listLeases,
  signLease as signLeaseRow,
  terminateLease as terminateLeaseRow,
  updateLease as updateLeaseRow,
  type LeaseSignatory,
  type LeaseStatusValue,
} from '../db/leases/leaseReads';
import { serializeLease, serializeLeaseDocument } from '../db/leases/leaseSerializer';
import { getDb } from '../db/postgres';
import { LEASE_DOCUMENT_TYPES } from '../db/schema/leases';
import { AppError } from '../middlewares/errorHandler';
import { logger } from '../middlewares/logging';
import {
  privateDocumentRefFromRowUrl,
  privateDocumentRowUrl,
  readPrivateDocument,
  storePrivateUpload,
} from '../services/files/privateDocuments';
import { notificationDispatchService } from '../services/notificationDispatchService';
import { SERVABLE_DOCUMENT_CONTENT_TYPES } from '../utils/imageStoreKey';
import { pickFields } from '../utils/pickFields';

const MAX_PAGE_SIZE = 100;
const DEFAULT_PAGE_SIZE = 10;

const EDITABLE_STATUSES: readonly LeaseStatusValue[] = [
  LeaseStatus.DRAFT,
  LeaseStatus.PENDING_SIGNATURES,
];
const DELETABLE_STATUSES: readonly LeaseStatusValue[] = [
  LeaseStatus.DRAFT,
  LeaseStatus.PENDING_SIGNATURES,
];
/**
 * The statuses in which a signature can still MOVE the lease. A signature is
 * recorded whatever the status — a co-tenant signing an already active lease is
 * a real thing to record — but only a lease still awaiting signatures
 * transitions.
 */
const SIGNABLE_STATUSES: readonly LeaseStatusValue[] = [
  LeaseStatus.DRAFT,
  LeaseStatus.PENDING_SIGNATURES,
];

/** 10 MB, one file per request: the bound that keeps a base64 response ~13 MB. */
export const MAX_LEASE_DOCUMENT_BYTES = 10 * 1024 * 1024;

/**
 * The document types a lease may carry, mapped to the extension their bytes are
 * stored under. `routes/leases.ts` refuses everything else at multer's
 * `fileFilter`; this map is the second half of the same decision.
 */
export const LEASE_DOCUMENT_EXTENSIONS: Readonly<Record<string, string>> = {
  'application/pdf': '.pdf',
  'image/jpeg': '.jpeg',
  'image/jpg': '.jpeg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/heic': '.heic',
  'image/heif': '.heif',
};

/** The MIME types a lease document may be (multer's allowlist). */
export const LEASE_DOCUMENT_MIME_TYPES: ReadonlySet<string> = new Set(
  Object.keys(LEASE_DOCUMENT_EXTENSIONS),
);

/** The file shape multer produces and the upload below consumes. */
export interface UploadedLeaseDocumentFile {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
}

/** A base64 document (a tool's input), as the file multer would have produced. */
export function leaseDocumentFileFromBase64(input: {
  filename: string;
  mimeType: string;
  contentBase64: string;
}): UploadedLeaseDocumentFile {
  if (!LEASE_DOCUMENT_MIME_TYPES.has(input.mimeType)) {
    throw new AppError(
      'Invalid file type. Only PDF and common image formats are allowed.',
      400,
      'INVALID_FILE_TYPE',
    );
  }
  const buffer = Buffer.from(input.contentBase64, 'base64');
  if (buffer.length === 0)
    throw new AppError('A document file is required', 400, 'VALIDATION_ERROR');
  if (buffer.length > MAX_LEASE_DOCUMENT_BYTES) {
    throw new AppError('File too large', 400, 'FILE_TOO_LARGE');
  }
  return { buffer, mimetype: input.mimeType, originalname: input.filename };
}

/**
 * A stored document NAME, stripped of anything that is not a name. It is
 * displayed in a list and written to a file on a phone.
 */
function safeDocumentName(raw: string): string {
  const cleaned = raw
    .replace(/[^A-Za-z0-9._ -]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
  return cleaned.length > 0 ? cleaned : 'document';
}

/**
 * The extension a given content type is written out under. Stated explicitly:
 * `SERVABLE_DOCUMENT_CONTENT_TYPES` maps the other way and is not invertible.
 */
const DOWNLOAD_EXTENSIONS: Readonly<Record<string, string>> = {
  'application/pdf': '.pdf',
  'image/jpeg': '.jpeg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
};

/** The filename the client saves the bytes under (extension from the content type). */
function downloadFilename(name: string, contentType: string): string {
  const safe = safeDocumentName(name);
  const extension = DOWNLOAD_EXTENSIONS[contentType];
  if (!extension) return safe;
  const current = path.posix.extname(safe).toLowerCase();
  if (SERVABLE_DOCUMENT_CONTENT_TYPES[current] === contentType) return safe;
  return `${safe}${extension}`;
}

export interface PageInput {
  page?: unknown;
  limit?: unknown;
}

export function parsePagination(input: PageInput): { page: number; limit: number; skip: number } {
  const rawPage = parseInt(String(input.page ?? ''), 10);
  const rawLimit = parseInt(String(input.limit ?? ''), 10);
  const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1;
  const limit =
    Number.isFinite(rawLimit) && rawLimit > 0
      ? Math.min(rawLimit, MAX_PAGE_SIZE)
      : DEFAULT_PAGE_SIZE;
  return { page, limit, skip: (page - 1) * limit };
}

/** The lease access row, narrowed to the three party questions. */
export interface LeaseParties {
  landlordOxyUserId: string;
  tenantOxyUserId: string;
  coTenantOxyUserIds: readonly string[];
}

export function isLeaseLandlord(lease: LeaseParties, oxyUserId: string): boolean {
  return lease.landlordOxyUserId === oxyUserId;
}

function isTenant(lease: LeaseParties, oxyUserId: string): boolean {
  return lease.tenantOxyUserId === oxyUserId || lease.coTenantOxyUserIds.includes(oxyUserId);
}

export function isLeaseParty(lease: LeaseParties, oxyUserId: string): boolean {
  return isLeaseLandlord(lease, oxyUserId) || isTenant(lease, oxyUserId);
}

/** A `status` filter, or `undefined` when absent or not a declared value. */
function leaseStatusFilter(value: unknown): LeaseStatusValue | undefined {
  const statuses: readonly string[] = Object.values(LeaseStatus);
  return typeof value === 'string' && statuses.includes(value)
    ? (value as LeaseStatusValue)
    : undefined;
}

/**
 * The lease and the acting person's standing on it, or the 404/403 the lease
 * routes answer: 404 when it does not exist, 403 when the person is not a
 * party.
 */
async function requirePartyAccess(oxyUserId: string, leaseId: string) {
  const access = await findLeaseAccess(getDb(), leaseId);
  if (!access) throw new AppError('Lease not found', 404, 'LEASE_NOT_FOUND');
  if (!isLeaseParty(access, oxyUserId)) {
    throw new AppError('Access denied - you are not a party to this lease', 403, 'FORBIDDEN');
  }
  return access;
}

// ── Use cases ──────────────────────────────────────────────────────────────

/** My leases (as landlord, tenant or co-tenant), newest first. */
export async function listMyLeases(
  oxyUserId: string,
  input: PageInput & { status?: unknown; propertyId?: unknown },
) {
  const { page, limit, skip } = parsePagination(input);
  const result = await listLeases(
    getDb(),
    {
      oxyUserId,
      status: leaseStatusFilter(input.status),
      propertyId: input.propertyId === undefined ? undefined : String(input.propertyId),
    },
    { limit, offset: skip },
  );
  return { leases: result.leases.map(serializeLease), page, limit, total: result.total };
}

/**
 * Create a lease directly. Behind `POST /api/leases` only — the catalogue never
 * exposes it: a lease is created from an accepted application
 * (`createLeaseFromApplication`), the one entry point the app offers.
 */
export async function createLeaseDirect(oxyUserId: string, body: Record<string, unknown>) {
  const { propertyId, tenantOxyUserId } = body;
  const leaseTerms = body.leaseTerms as { startDate?: unknown; endDate?: unknown } | undefined;
  const rentDetails = body.rentDetails as { monthlyRent?: unknown } | undefined;

  if (!propertyId) throw new AppError('propertyId is required', 400, 'VALIDATION_ERROR');
  if (!tenantOxyUserId) throw new AppError('tenantOxyUserId is required', 400, 'VALIDATION_ERROR');
  if (!leaseTerms?.startDate || !leaseTerms?.endDate) {
    throw new AppError(
      'leaseTerms.startDate and leaseTerms.endDate are required',
      400,
      'VALIDATION_ERROR',
    );
  }
  if (rentDetails?.monthlyRent === undefined || rentDetails?.monthlyRent === null) {
    throw new AppError('rentDetails.monthlyRent is required', 400, 'VALIDATION_ERROR');
  }

  const db = getDb();
  const property = await findPropertyLeaseBasis(db, String(propertyId));
  if (!property) throw new AppError('Property not found', 404, 'PROPERTY_NOT_FOUND');
  if (!property.oxyUserId || property.oxyUserId !== oxyUserId) {
    throw new AppError(
      'Access denied - you can only create leases for your own properties',
      403,
      'FORBIDDEN',
    );
  }

  const picked = pickFields<Record<string, unknown>>(body, CREATABLE_LEASE_FIELDS);
  const columns = toLeaseColumns(picked);

  const startDate = columns.leaseTermsStartDate;
  const endDate = columns.leaseTermsEndDate;
  const monthlyRent = columns.rentDetailsMonthlyRent;
  if (!startDate || !endDate) {
    throw new AppError(
      'leaseTerms.startDate and leaseTerms.endDate must be valid dates',
      400,
      'VALIDATION_ERROR',
    );
  }
  if (monthlyRent === undefined) {
    throw new AppError('rentDetails.monthlyRent must be a number', 400, 'VALIDATION_ERROR');
  }

  // One transaction: a lease that committed without its co-tenants is one
  // whose `isFullySigned` is wrong from its first read.
  const hydrated = await db.transaction((tx) =>
    createLease(tx, {
      columns: {
        ...columns,
        leaseTermsStartDate: startDate,
        leaseTermsEndDate: endDate,
        rentDetailsMonthlyRent: monthlyRent,
        propertyId: String(propertyId),
        tenantOxyUserId: String(tenantOxyUserId),
        landlordOxyUserId: oxyUserId,
        status: LeaseStatus.DRAFT,
      },
      coTenants: toCoTenantRows(picked) ?? [],
      sharedUtilityCosts: toSharedUtilityCostRows(picked) ?? [],
    }),
  );

  logger.info('Lease created', {
    leaseId: hydrated.lease.id,
    landlordOxyUserId: oxyUserId,
    propertyId: String(propertyId),
  });
  return serializeLease(hydrated);
}

/** One lease with its timeline and signature records, to a party. */
export async function getLease(oxyUserId: string, leaseId: string) {
  await requirePartyAccess(oxyUserId, leaseId);
  // The detail read is the one that asks for the timeline and the signature
  // records: it is the only screen that draws them.
  const hydrated = await findLeaseById(getDb(), leaseId, { events: true, signatures: true });
  if (!hydrated) throw new AppError('Lease not found', 404, 'LEASE_NOT_FOUND');
  return serializeLease(hydrated);
}

/**
 * Edit a lease: the landlord only, while it is a draft or awaiting signatures,
 * and only the whitelisted fields. The status is re-checked inside the
 * UPDATE's own predicate.
 */
export async function updateLease(
  oxyUserId: string,
  leaseId: string,
  body: Record<string, unknown>,
) {
  const db = getDb();
  const access = await findLeaseAccess(db, leaseId);
  if (!access) throw new AppError('Lease not found', 404, 'LEASE_NOT_FOUND');
  if (!isLeaseLandlord(access, oxyUserId)) {
    throw new AppError('Access denied - only the landlord can update this lease', 403, 'FORBIDDEN');
  }
  if (!EDITABLE_STATUSES.includes(access.status as LeaseStatusValue)) {
    throw new AppError(
      'Cannot update a lease that is signed, active, or closed',
      409,
      'LEASE_NOT_EDITABLE',
    );
  }

  const picked = pickFields<Record<string, unknown>>(body, EDITABLE_LEASE_FIELDS);
  const hydrated = await db.transaction((tx) =>
    updateLeaseRow(tx, leaseId, oxyUserId, EDITABLE_STATUSES, {
      columns: toLeaseColumns(picked),
      coTenants: toCoTenantRows(picked),
      sharedUtilityCosts: toSharedUtilityCostRows(picked),
    }),
  );
  if (!hydrated) {
    throw new AppError(
      'Cannot update a lease that is signed, active, or closed',
      409,
      'LEASE_NOT_EDITABLE',
    );
  }
  logger.info('Lease updated', { leaseId: hydrated.lease.id, updatedBy: oxyUserId });
  return serializeLease(hydrated);
}

/** Delete a lease: the landlord only, while it is a draft or awaiting signatures. */
export async function deleteLease(oxyUserId: string, leaseId: string): Promise<null> {
  const db = getDb();
  const access = await findLeaseAccess(db, leaseId);
  if (!access) throw new AppError('Lease not found', 404, 'LEASE_NOT_FOUND');
  if (!isLeaseLandlord(access, oxyUserId)) {
    throw new AppError('Access denied - only the landlord can delete this lease', 403, 'FORBIDDEN');
  }
  if (!DELETABLE_STATUSES.includes(access.status as LeaseStatusValue)) {
    throw new AppError(
      'Cannot delete a lease that is signed, active, or closed',
      409,
      'LEASE_NOT_DELETABLE',
    );
  }
  // Every child table CASCADEs, so this one statement takes the co-tenants,
  // schedule, documents and inspections with it.
  const deleted = await deleteLeaseRow(db, leaseId, oxyUserId, DELETABLE_STATUSES);
  if (!deleted) {
    throw new AppError(
      'Cannot delete a lease that is signed, active, or closed',
      409,
      'LEASE_NOT_DELETABLE',
    );
  }
  logger.info('Lease deleted', { leaseId, deletedBy: oxyUserId });
  return null;
}

/**
 * Sign a lease as whichever party the acting person IS on it. `termsSha256`,
 * when sent, must match the current terms (409 `LEASE_TERMS_CHANGED`
 * otherwise), so a signature never binds to terms nobody was shown.
 */
export async function signLease(
  oxyUserId: string,
  leaseId: string,
  input: { acceptTerms?: unknown; termsSha256?: unknown },
) {
  if (!input.acceptTerms) {
    throw new AppError('Must accept terms to sign lease', 400, 'TERMS_NOT_ACCEPTED');
  }

  const db = getDb();
  const access = await findLeaseAccess(db, leaseId);
  if (!access) throw new AppError('Lease not found', 404, 'LEASE_NOT_FOUND');

  // Which seat the caller signs from: resolved from the LEASE against the
  // acting id — never from input — so a stranger matches no seat at all.
  let party: LeaseSignatory;
  let counterpartyOxyUserId: string;
  if (isLeaseLandlord(access, oxyUserId)) {
    party = 'landlord';
    counterpartyOxyUserId = access.tenantOxyUserId;
  } else if (access.tenantOxyUserId === oxyUserId) {
    party = 'tenant';
    counterpartyOxyUserId = access.landlordOxyUserId;
  } else if (access.coTenantOxyUserIds.includes(oxyUserId)) {
    party = 'co_tenant';
    // A co-tenant's counterparty is the landlord: the one who can amend it.
    counterpartyOxyUserId = access.landlordOxyUserId;
  } else {
    throw new AppError('Access denied - you are not a party to this lease', 403, 'FORBIDDEN');
  }

  // The signature, the status move, the cache, the timeline entries and the
  // payment schedule are one fact, so one transaction.
  const outcome = await db.transaction((tx) =>
    signLeaseRow(tx, {
      leaseId,
      signerOxyUserId: oxyUserId,
      party,
      expectedTermsSha256: typeof input.termsSha256 === 'string' ? input.termsSha256 : undefined,
      activeStatus: LeaseStatus.ACTIVE,
      pendingStatus: LeaseStatus.PENDING_SIGNATURES,
      signableStatuses: SIGNABLE_STATUSES,
    }),
  );
  if (outcome.kind === 'not_found') throw new AppError('Lease not found', 404, 'LEASE_NOT_FOUND');
  if (outcome.kind === 'terms_changed') {
    throw new AppError(
      'The lease changed since you opened it. Review the new terms and sign again.',
      409,
      'LEASE_TERMS_CHANGED',
    );
  }

  logger.info('Lease signed', {
    leaseId: outcome.lease.lease.id,
    signedBy: oxyUserId,
    party,
    recorded: outcome.recorded,
    activated: outcome.activated,
    boundDocumentId: outcome.signature.documentId ?? undefined,
    boundDocumentHashed: outcome.signature.documentSha256 !== null,
  });

  // Notify the counterparty. Skipped on a double tap, which recorded nothing.
  if (outcome.recorded) {
    await notificationDispatchService.createForUser(counterpartyOxyUserId, {
      type: 'contract',
      title: outcome.activated ? 'Lease is now active' : 'Lease awaiting signatures',
      message: outcome.activated
        ? 'Every party has signed. Your lease is now active.'
        : 'A party signed the lease. It becomes active once everyone has.',
      priority: outcome.activated ? 'medium' : 'high',
      data: {
        leaseId: outcome.lease.lease.id,
        screen: '/contracts',
        propertyId: outcome.lease.lease.propertyId,
      },
    });
  }

  return serializeLease(outcome.lease);
}

/** Serve a termination notice as any party, moving the lease to terminated. */
export async function terminateLease(
  oxyUserId: string,
  leaseId: string,
  input: { reason?: unknown; effectiveDate?: unknown },
) {
  const access = await requirePartyAccess(oxyUserId, leaseId);
  if (access.status === LeaseStatus.TERMINATED) {
    throw new AppError('Lease is already terminated', 409, 'LEASE_ALREADY_TERMINATED');
  }
  const parsedEffectiveDate = input.effectiveDate
    ? new Date(input.effectiveDate as string)
    : new Date();
  if (Number.isNaN(parsedEffectiveDate.getTime())) {
    throw new AppError('effectiveDate must be a valid date', 400, 'VALIDATION_ERROR');
  }

  // One transaction: the notice and the timeline entry that records it.
  const hydrated = await getDb().transaction((tx) =>
    terminateLeaseRow(tx, leaseId, {
      givenByOxyUserId: oxyUserId,
      effectiveDate: parsedEffectiveDate,
      reason: typeof input.reason === 'string' ? input.reason : undefined,
      terminatedStatus: LeaseStatus.TERMINATED,
    }),
  );
  if (!hydrated) throw new AppError('Lease not found', 404, 'LEASE_NOT_FOUND');

  logger.info('Lease terminated', {
    leaseId: hydrated.lease.id,
    terminatedBy: oxyUserId,
    reason: input.reason,
  });
  return serializeLease(hydrated);
}

/**
 * Renew a lease (landlord only): a NEW draft inheriting the original's named
 * terms with a new end date. Signatures are never inherited.
 */
export async function renewLease(
  oxyUserId: string,
  leaseId: string,
  input: { newEndDate?: unknown; monthlyRent?: unknown; startDate?: unknown },
) {
  if (!input.newEndDate) throw new AppError('newEndDate is required', 400, 'VALIDATION_ERROR');
  const parsedEndDate = new Date(input.newEndDate as string);
  if (Number.isNaN(parsedEndDate.getTime())) {
    throw new AppError('newEndDate must be a valid date', 400, 'VALIDATION_ERROR');
  }

  const db = getDb();
  const original = await findLeaseById(db, leaseId);
  if (!original) throw new AppError('Lease not found', 404, 'LEASE_NOT_FOUND');
  const source = original.lease;
  if (source.landlordOxyUserId !== oxyUserId) {
    throw new AppError('Access denied - only the landlord can renew this lease', 403, 'FORBIDDEN');
  }

  const parsedStartDate = input.startDate
    ? new Date(input.startDate as string)
    : source.leaseTermsEndDate;
  if (Number.isNaN(parsedStartDate.getTime())) {
    throw new AppError('startDate must be a valid date', 400, 'VALIDATION_ERROR');
  }

  // The columns are NAMED rather than spread, so a future field is never
  // carried into a renewal by default.
  const hydrated = await db.transaction(async (tx) => {
    const renewal = await createLease(tx, {
      columns: {
        propertyId: source.propertyId,
        roomId: source.roomId,
        landlordOxyUserId: source.landlordOxyUserId,
        tenantOxyUserId: source.tenantOxyUserId,
        leaseTermsStartDate: parsedStartDate,
        leaseTermsEndDate: parsedEndDate,
        leaseTermsRenewalOptions: source.leaseTermsRenewalOptions,
        leaseTermsRenewalNoticeRequired: source.leaseTermsRenewalNoticeRequired,
        leaseTermsTerminationNoticeRequired: source.leaseTermsTerminationNoticeRequired,
        rentDetailsMonthlyRent:
          typeof input.monthlyRent === 'number' ? input.monthlyRent : source.rentDetailsMonthlyRent,
        rentDetailsCurrency: source.rentDetailsCurrency,
        rentDetailsDueDate: source.rentDetailsDueDate,
        rentDetailsLateFeeAmount: source.rentDetailsLateFeeAmount,
        rentDetailsLateFeeGracePeriod: source.rentDetailsLateFeeGracePeriod,
        rentDetailsSecurityDeposit: source.rentDetailsSecurityDeposit,
        rentDetailsPetDeposit: source.rentDetailsPetDeposit,
        utilitiesIncluded: source.utilitiesIncluded,
        utilitiesTenantResponsible: source.utilitiesTenantResponsible,
        rulesPetsAllowed: source.rulesPetsAllowed,
        rulesPetsTypes: source.rulesPetsTypes,
        rulesPetsMaxNumber: source.rulesPetsMaxNumber,
        rulesPetsRestrictions: source.rulesPetsRestrictions,
        rulesSmoking: source.rulesSmoking,
        rulesGuestsOvernightAllowed: source.rulesGuestsOvernightAllowed,
        rulesGuestsOvernightMaxConsecutiveDays: source.rulesGuestsOvernightMaxConsecutiveDays,
        rulesGuestsOvernightMaxDaysPerMonth: source.rulesGuestsOvernightMaxDaysPerMonth,
        rulesGuestsParties: source.rulesGuestsParties,
        rulesSubletting: source.rulesSubletting,
        rulesAlterations: source.rulesAlterations,
        notes: source.notes,
        status: LeaseStatus.DRAFT,
      },
      // The roster is inherited; the SIGNATURES on it are not.
      coTenants: original.coTenants.map((coTenant) => ({
        oxyUserId: coTenant.oxyUserId,
        role: coTenant.role,
      })),
      sharedUtilityCosts: original.sharedUtilityCosts.map((cost) => ({
        utility: cost.utility,
        splitPercentage: cost.splitPercentage,
      })),
    });

    // On the ORIGINAL: the fact worth recording on the lease that is ending is
    // that it was renewed rather than allowed to lapse.
    await appendLeaseEvent(tx, {
      leaseId: source.id,
      eventType: 'renewed',
      actorOxyUserId: oxyUserId,
      detail: renewal.lease.id,
    });
    return renewal;
  });

  logger.info('Lease renewal created', {
    originalLeaseId: source.id,
    renewalLeaseId: hydrated.lease.id,
    createdBy: oxyUserId,
  });
  return serializeLease(hydrated);
}

/** A lease's documents, metadata only (no URL, no bytes), to a party. */
export async function listLeaseDocuments(oxyUserId: string, leaseId: string) {
  await requirePartyAccess(oxyUserId, leaseId);
  const documents = await listLeaseDocumentRows(getDb(), leaseId);
  return documents.map(serializeLeaseDocument);
}

/**
 * Attach a tenancy document as a party. Authorize, then store, then record: a
 * stranger's upload never reaches the bucket, and the row is written last. A
 * PDF is stored verbatim, an image re-encoded (dropping EXIF).
 */
export async function uploadLeaseDocument(
  oxyUserId: string,
  leaseId: string,
  input: { file?: UploadedLeaseDocumentFile; type?: unknown; name?: unknown },
) {
  const file = input.file;
  if (!file) throw new AppError('A document file is required', 400, 'VALIDATION_ERROR');
  const extension = LEASE_DOCUMENT_EXTENSIONS[file.mimetype];
  if (!extension) throw new AppError('Unsupported document type', 400, 'VALIDATION_ERROR');

  await requirePartyAccess(oxyUserId, leaseId);

  const documentTypes: readonly string[] = LEASE_DOCUMENT_TYPES;
  const documentType =
    typeof input.type === 'string' && documentTypes.includes(input.type)
      ? (input.type as (typeof LEASE_DOCUMENT_TYPES)[number])
      : 'other';
  const rawName = typeof input.name === 'string' ? input.name.trim() : '';
  const name = safeDocumentName(rawName.length > 0 ? rawName : file.originalname);

  // The party's own private document (`services/files/privateDocuments`):
  // a PDF verbatim, a photo re-encoded. Stored only after the party check.
  const stored = await storePrivateUpload(
    { ownerOxyUserId: oxyUserId, kind: 'lease', entityId: leaseId },
    file,
  );

  const created = await getDb().transaction(async (tx) => {
    const document = await addLeaseDocument(tx, leaseId, {
      name,
      // `oxy:<fileId>`, the uploader's private Oxy file; nothing serves it
      // publicly.
      url: privateDocumentRowUrl(stored.ref),
      type: documentType,
      // Server-resolved, never from input.
      uploadedByOxyUserId: oxyUserId,
      uploadedDate: new Date(),
      // The digest of the bytes that were STORED, not the upload's.
      contentSha256: stored.sha256,
    });
    await appendLeaseEvent(tx, {
      leaseId,
      eventType: 'document_added',
      actorOxyUserId: oxyUserId,
      detail: document.name,
    });
    return document;
  });

  logger.info('Lease document added', {
    leaseId,
    documentId: created.id,
    contentType: stored.contentType,
    bytes: stored.bytes,
    uploadedBy: oxyUserId,
  });
  return serializeLeaseDocument(created);
}

/**
 * One document's bytes, to a party only. Anybody else gets 404 (not 403): this
 * is reached by guessing a URL, and confirming the lease exists is an answer.
 */
export async function readLeaseDocument(oxyUserId: string, leaseId: string, documentId: string) {
  const db = getDb();
  const access = await findLeaseAccess(db, leaseId);
  if (!access || !isLeaseParty(access, oxyUserId)) {
    throw new AppError('Document not found', 404, 'NOT_FOUND');
  }
  const document = await findLeaseDocument(db, leaseId, documentId);
  if (!document) throw new AppError('Document not found', 404, 'NOT_FOUND');

  // The party check above is the authorization; this only fetches the bytes
  // (from the uploader's Oxy account, or the bucket for an unmigrated one).
  const ref = privateDocumentRefFromRowUrl(document.url);
  const file = ref ? await readPrivateDocument(ref) : null;
  if (!file) throw new AppError('Document not found', 404, 'NOT_FOUND');

  return {
    id: document.id,
    type: document.type,
    filename: downloadFilename(document.name, file.contentType),
    contentType: file.contentType,
    /** The document's bytes. The client writes or opens them itself. */
    base64: file.buffer.toString('base64'),
  };
}
