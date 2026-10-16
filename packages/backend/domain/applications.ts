/**
 * Tenant applications — the long-term rent application lifecycle, as use cases.
 *
 * `controllers/applicationController.ts` (the routes) and
 * `capabilities/handlers/applications.ts` (the catalogue tools) both call these,
 * so a route and its tool share one implementation. Every function takes the
 * acting person's Oxy id explicitly and never reads a request.
 *
 * Distinct from:
 *  - `Reservation`     (vacation/short-term booking)
 *  - `ViewingRequest`  (in-person tour, precedes the application)
 *  - `Lease`           (signed contract, follows an approved application)
 *
 * Status transitions: submitted -> reviewing -> approved | rejected
 *                     submitted -> withdrawn (applicant)
 */

import { PAYMENT_CURRENCIES } from '@homiio/shared-types';
import {
  TenantApplicationStatus,
  OfferingType,
  LeaseStatus,
  DOCUMENT_VERIFICATION_STATUSES,
  type DocumentVerificationStatus,
} from '@homiio/shared-types';

import config from '../config';
import { getDb } from '../db/postgres';
import {
  ACTIVE_APPLICATION_STATUSES,
  createApplication,
  decideApplication,
  findActiveApplicationForApplicant,
  findApplicationById,
  isApplicationStatus,
  listApplications,
  setDocumentVerification,
  serializeApplication,
  type TenantApplicationStatusValue,
} from '../db/applications/applicationReads';
import {
  createLease,
  findLeaseForTenant,
  findPropertyLeaseBasis,
  type LeaseStatusValue,
} from '../db/leases/leaseReads';
import { serializeLease } from '../db/leases/leaseSerializer';
import { findPropertyBookingBasis } from '../db/properties/propertyBookingBasis';
import { TENANT_APPLICATION_DOCUMENT_TYPES } from '../db/schema/applications';
import { REFERENCE_RELATIONSHIPS } from '../db/schema/profiles';
import { AppError } from '../middlewares/errorHandler';
import { logger } from '../middlewares/logging';
import imageUploadService from '../services/imageUploadService';
import { storedDocumentKey } from '../utils/storedDocumentKey';
import { type ExternalListingOutcome, externalListingOutcome } from './bookingOutcomes';

// ── The document upload contract, shared by the route and the tool ─────────

/**
 * The MIME types an application document may be. `routes/applications.ts`
 * enforces it at multer's `fileFilter`; {@link documentFileFromBase64} enforces
 * the same set for a document that arrives through a catalogue tool.
 */
export const ALLOWED_DOCUMENT_MIME_TYPES: ReadonlySet<string> = new Set([
  'application/pdf',
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/gif',
]);

/** 10 MB per document. */
export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
/** At most 10 documents per application. */
export const MAX_DOCUMENT_COUNT = 10;

/** The file shape multer produces and the upload below consumes. */
export interface UploadedApplicationFile {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
  size: number;
}

/**
 * A document sent as base64 (a catalogue tool's input), turned into exactly the
 * file object multer would have produced for the same upload — same MIME
 * allowlist, same size cap — so it is stored and served like an app upload.
 */
export function documentFileFromBase64(input: {
  filename: string;
  mimeType: string;
  contentBase64: string;
}): UploadedApplicationFile {
  if (!ALLOWED_DOCUMENT_MIME_TYPES.has(input.mimeType)) {
    throw new AppError(
      'Invalid file type. Only PDF and common image formats are allowed.',
      400,
      'INVALID_FILE_TYPE',
    );
  }
  const buffer = Buffer.from(input.contentBase64, 'base64');
  if (buffer.length === 0) {
    throw new AppError('A document has no content', 400, 'INVALID_DOCUMENTS');
  }
  if (buffer.length > MAX_DOCUMENT_BYTES) {
    throw new AppError('File too large', 400, 'FILE_TOO_LARGE');
  }
  return {
    buffer,
    mimetype: input.mimeType,
    originalname: input.filename,
    size: buffer.length,
  };
}

// ── Parsing ────────────────────────────────────────────────────────────────

/** Currency codes the Lease `rentDetails` block accepts (schema enum). */
const LEASE_CURRENCIES = new Set<string>(PAYMENT_CURRENCIES);
const ACTIVE_LEASE_STATUSES: readonly LeaseStatusValue[] = [
  LeaseStatus.DRAFT,
  LeaseStatus.PENDING_SIGNATURES,
  LeaseStatus.ACTIVE,
];

const APPLICATION_DOCUMENTS_FOLDER = 'applications/documents';

/** The most a rejection reason may carry. */
const DOCUMENT_REJECTION_REASON_MAX = 500;

type ApplicationDocumentType = (typeof TENANT_APPLICATION_DOCUMENT_TYPES)[number];

/** Whether `value` is one of the four declared document types. */
function isApplicationDocumentType(value: unknown): value is ApplicationDocumentType {
  return (
    typeof value === 'string' &&
    (TENANT_APPLICATION_DOCUMENT_TYPES as readonly string[]).includes(value)
  );
}

function isDocumentVerificationStatus(value: unknown): value is DocumentVerificationStatus {
  return (
    typeof value === 'string' &&
    (DOCUMENT_VERIFICATION_STATUSES as readonly string[]).includes(value)
  );
}

/**
 * A filename safe to write to a device and to show on a row.
 *
 * `filename` comes from the uploader's own device and is stored verbatim, so it
 * can hold a path separator, a NUL or a leading dot — and the client writes it
 * into a cache directory before opening it. Keeping a conservative set and
 * capping the length is enough: this is a label on a file, not data anybody
 * parses, and the server is the last place that can make it safe for every
 * client that will ever read the row.
 */
function safeFilename(filename: string): string {
  const cleaned = filename.replace(/[^A-Za-z0-9._ -]/g, '_').slice(0, 120);
  return cleaned.length > 0 ? cleaned : 'document';
}

interface ParsedReferenceContact {
  name: string;
  relationship: (typeof REFERENCE_RELATIONSHIPS)[number];
  phone: string;
  email: string;
}

interface ParsedDocument {
  type: ApplicationDocumentType;
  url: string;
  filename: string;
}

/** Whether `value` is one of the four declared referee relationships. */
function isReferenceRelationship(
  value: unknown,
): value is (typeof REFERENCE_RELATIONSHIPS)[number] {
  return (
    typeof value === 'string' && (REFERENCE_RELATIONSHIPS as readonly string[]).includes(value)
  );
}

/**
 * Parse `referenceContacts`. Accepts:
 *   - JSON array (application/json request, or a tool input)
 *   - JSON string (multipart/form-data — common pattern when a field is a list)
 */
function parseReferenceContacts(raw: unknown): ParsedReferenceContact[] {
  if (!raw) return [];
  let value: unknown = raw;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      throw new AppError(
        'referenceContacts must be valid JSON or an array',
        400,
        'INVALID_REFERENCES',
      );
    }
  }
  if (!Array.isArray(value)) {
    throw new AppError('referenceContacts must be an array', 400, 'INVALID_REFERENCES');
  }
  return value.map((item, index) => {
    const ref = item as Partial<ParsedReferenceContact>;
    if (!ref?.name || !ref?.relationship || !ref?.phone || !ref?.email) {
      throw new AppError(
        `referenceContacts[${index}] is missing required fields`,
        400,
        'INVALID_REFERENCES',
      );
    }
    // Narrowed HERE rather than left to `tenant_application_references_
    // relationship_check`: an undeclared value arriving as a `23514` would be a 500 where the caller
    // earned a 400 naming the field.
    if (!isReferenceRelationship(ref.relationship)) {
      throw new AppError(
        `referenceContacts[${index}] has invalid relationship "${String(ref.relationship)}"`,
        400,
        'INVALID_REFERENCES',
      );
    }
    return {
      name: String(ref.name).trim(),
      relationship: ref.relationship,
      phone: String(ref.phone).trim(),
      email: String(ref.email).trim().toLowerCase(),
    };
  });
}

/**
 * Parse document metadata from the request body. JSON requests can supply
 * the full `documents[]` array directly. Multipart requests must supply a
 * parallel `documentTypes[]` field, one per uploaded file.
 */
function parseDocumentsFromBody(raw: unknown): ParsedDocument[] {
  if (!raw) return [];
  let value: unknown = raw;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      throw new AppError('documents must be valid JSON or an array', 400, 'INVALID_DOCUMENTS');
    }
  }
  if (!Array.isArray(value)) {
    throw new AppError('documents must be an array', 400, 'INVALID_DOCUMENTS');
  }
  return value.map((item, index) => {
    const doc = item as Partial<ParsedDocument>;
    if (!doc?.type || !doc?.url || !doc?.filename) {
      throw new AppError(
        `documents[${index}] is missing required fields`,
        400,
        'INVALID_DOCUMENTS',
      );
    }
    if (!isApplicationDocumentType(doc.type)) {
      throw new AppError(
        `documents[${index}] has invalid type "${String(doc.type)}"`,
        400,
        'INVALID_DOCUMENT_TYPE',
      );
    }
    return {
      type: doc.type,
      url: doc.url,
      filename: doc.filename,
    };
  });
}

/**
 * Parse a parallel `documentTypes[]` field (multipart shape) — one string per
 * uploaded file (e.g. ["id", "income", "reference"]).
 */
function parseDocumentTypes(raw: unknown, count: number): ApplicationDocumentType[] {
  if (!raw && count === 0) return [];
  let value: unknown = raw;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      value = Array.isArray(parsed) ? parsed : [value];
    } catch {
      // Treat a bare string as a single-element array
      value = [value];
    }
  }
  if (!Array.isArray(value)) {
    throw new AppError(
      'documentTypes must be an array matching uploaded files',
      400,
      'INVALID_DOCUMENT_TYPES',
    );
  }
  if (value.length !== count) {
    throw new AppError(
      `documentTypes length (${value.length}) must match uploaded files length (${count})`,
      400,
      'INVALID_DOCUMENT_TYPES',
    );
  }
  return value.map((type, index) => {
    if (!isApplicationDocumentType(type)) {
      throw new AppError(
        `documentTypes[${index}] is not a valid document type`,
        400,
        'INVALID_DOCUMENT_TYPE',
      );
    }
    return type;
  });
}

/** Upload each file to the private store and return parsed document entries. */
async function uploadDocumentFiles(
  files: readonly UploadedApplicationFile[],
  types: readonly ApplicationDocumentType[],
): Promise<ParsedDocument[]> {
  const uploaded: ParsedDocument[] = [];
  for (let i = 0; i < files.length; i += 1) {
    const file = files[i];
    const type = types[i];
    const uploadedImage = await imageUploadService.uploadImage(file, APPLICATION_DOCUMENTS_FOLDER);
    const urls = imageUploadService.getAllImageUrls(uploadedImage);
    uploaded.push({
      type,
      url: urls.original,
      filename: file.originalname,
    });
  }
  return uploaded;
}

// ── Use cases ──────────────────────────────────────────────────────────────

export interface SubmitApplicationInput {
  propertyId: unknown;
  moveInDate: unknown;
  leaseTermMonths: unknown;
  monthlyIncome: unknown;
  employmentStatus: unknown;
  notes?: unknown;
  referenceContacts?: unknown;
  /** The JSON `documents[]` metadata path (route only). */
  documents?: unknown;
  /** One type per entry of `files`, as the multipart `documentTypes[]` field. */
  documentTypes?: unknown;
  /** Uploaded files, from multer or from {@link documentFileFromBase64}. */
  files?: readonly UploadedApplicationFile[];
}

export type SubmitApplicationOutcome =
  | { readonly kind: 'submitted'; readonly application: Record<string, unknown> }
  | { readonly kind: 'external_listing'; readonly outcome: ExternalListingOutcome };

/**
 * Submit a long-term rent application.
 *
 * An EXTERNAL listing never reaches an enquiry flow: the outcome is
 * `external_listing` with the advertiser's own page. The route keeps its
 * historical 400 for that case; the tool answers the typed outcome.
 */
export async function submitApplication(
  oxyUserId: string,
  input: SubmitApplicationInput,
): Promise<SubmitApplicationOutcome> {
  const db = getDb();
  const propertyId = String(input.propertyId);
  const property = await findPropertyBookingBasis(db, propertyId);
  if (!property) throw new AppError('Property not found', 404, 'NOT_FOUND');
  if (property.isExternal) {
    return { kind: 'external_listing', outcome: await externalListingOutcome(db, propertyId) };
  }
  if (!property.offerings.includes(OfferingType.LONG_TERM_RENT)) {
    throw new AppError(
      'This property is not offered for long-term rent and does not accept applications',
      400,
      'NOT_APPLICABLE',
    );
  }

  const landlordOxyUserId = property.oxyUserId;
  if (!landlordOxyUserId) throw new AppError('Property has no landlord', 400, 'INVALID_PROPERTY');
  if (landlordOxyUserId === oxyUserId) {
    throw new AppError('You cannot apply to your own property', 403, 'FORBIDDEN');
  }

  // Prevent duplicate active applications by the same applicant. A read
  // rather than an index: "active" is a status SET, and a partial unique
  // index over one would also forbid re-applying after a rejection.
  const existingActive = await findActiveApplicationForApplicant(db, propertyId, oxyUserId);
  if (existingActive) {
    throw new AppError(
      'You already have an active application for this property',
      409,
      'ALREADY_APPLIED',
    );
  }

  const moveInDateParsed = new Date(input.moveInDate as string);
  if (Number.isNaN(moveInDateParsed.getTime())) {
    throw new AppError('Invalid move-in date', 400, 'INVALID_DATE');
  }

  const parsedReferences = parseReferenceContacts(input.referenceContacts);
  const parsedDocumentsFromBody = parseDocumentsFromBody(input.documents);

  const files = input.files ?? [];
  if (files.length > MAX_DOCUMENT_COUNT) {
    throw new AppError('Too many files', 400, 'TOO_MANY_FILES');
  }
  let uploadedDocs: ParsedDocument[] = [];
  if (files.length > 0) {
    const types = parseDocumentTypes(input.documentTypes, files.length);
    uploadedDocs = await uploadDocumentFiles(files, types);
  }

  const allDocuments = [...parsedDocumentsFromBody, ...uploadedDocs];

  // One transaction: an application that committed without its references
  // is one a landlord judges on incomplete information.
  const hydrated = await db.transaction((tx) =>
    createApplication(tx, {
      columns: {
        propertyId,
        applicantOxyUserId: oxyUserId,
        landlordOxyUserId,
        moveInDate: moveInDateParsed,
        leaseTermMonths: Number(input.leaseTermMonths),
        monthlyIncome: Number(input.monthlyIncome),
        employmentStatus: input.employmentStatus as never,
        notes: input.notes as string | undefined,
        status: TenantApplicationStatus.SUBMITTED,
        submittedAt: new Date(),
      },
      references: parsedReferences,
      documents: allDocuments,
    }),
  );

  logger.info('Tenant application created', {
    applicationId: hydrated.application.id,
    propertyId,
    applicantOxyUserId: oxyUserId,
  });

  return { kind: 'submitted', application: serializeApplication(hydrated) };
}

export interface ListApplicationsInput {
  page?: unknown;
  limit?: unknown;
  status?: unknown;
  asLandlord?: unknown;
}

/** My applications — as applicant, or with `asLandlord` the ones sent to me. */
export async function listMyApplications(oxyUserId: string, input: ListApplicationsInput) {
  const page = Math.max(1, parseInt(String(input.page ?? 1), 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(String(input.limit ?? 10), 10) || 10));
  const asLandlordView = String(input.asLandlord) === 'true';
  const result = await listApplications(
    getDb(),
    {
      applicantOxyUserId: asLandlordView ? undefined : oxyUserId,
      landlordOxyUserId: asLandlordView ? oxyUserId : undefined,
      status: isApplicationStatus(input.status) ? input.status : undefined,
    },
    { limit, offset: (page - 1) * limit },
  );
  return {
    applications: result.applications.map(serializeApplication),
    page,
    limit,
    total: result.total,
  };
}

/** One application, to its applicant or its landlord (403 for anybody else). */
export async function getApplication(oxyUserId: string, applicationId: string) {
  const hydrated = await findApplicationById(getDb(), applicationId);
  if (!hydrated) throw new AppError('Application not found', 404, 'NOT_FOUND');
  const isApplicant = hydrated.application.applicantOxyUserId === oxyUserId;
  const isLandlord = hydrated.application.landlordOxyUserId === oxyUserId;
  if (!isApplicant && !isLandlord) {
    throw new AppError('Not authorized to view this application', 403, 'FORBIDDEN');
  }
  return serializeApplication(hydrated);
}

/**
 * The bytes of ONE attached document, to the applicant or the landlord. One 404
 * for "no such application", "not yours" and "nothing stored".
 */
export async function readApplicationDocument(
  oxyUserId: string,
  applicationId: string,
  documentId: string,
) {
  const hydrated = await findApplicationById(getDb(), applicationId);
  const mayRead =
    hydrated !== undefined &&
    (hydrated.application.applicantOxyUserId === oxyUserId ||
      hydrated.application.landlordOxyUserId === oxyUserId);
  if (!hydrated || !mayRead) throw new AppError('Document not found', 404, 'NOT_FOUND');

  const document = hydrated.documents.find((row) => row.id === documentId);
  if (!document) throw new AppError('Document not found', 404, 'NOT_FOUND');

  const key = storedDocumentKey(document.url, {
    bucketName: config.s3.bucketName,
    endpoint: config.s3.endpoint,
  });
  const file = key ? await imageUploadService.readPrivateDocument(key) : null;
  if (!file) throw new AppError('Document not found', 404, 'NOT_FOUND');

  return {
    id: document.id,
    type: document.type,
    filename: safeFilename(document.filename),
    contentType: file.contentType,
    /** The document's bytes. The client writes or opens them itself. */
    base64: file.buffer.toString('base64'),
  };
}

/**
 * The landlord's judgement of one document — the only way one reaches
 * `verified`. Ownership is in the repository's WHERE, so a stranger and a
 * landlord of another application both get 404.
 */
export async function verifyApplicationDocument(
  oxyUserId: string,
  input: { applicationId: string; documentId: string; status: unknown; reason?: unknown },
) {
  if (!isDocumentVerificationStatus(input.status)) {
    throw new AppError(
      `status must be one of: ${DOCUMENT_VERIFICATION_STATUSES.join(', ')}`,
      400,
      'VALIDATION_ERROR',
    );
  }
  const status = input.status;
  const reason = typeof input.reason === 'string' ? input.reason.trim() : '';
  if (status === 'rejected' && reason.length === 0) {
    throw new AppError('A rejection needs a reason', 400, 'VALIDATION_ERROR');
  }
  if (reason.length > DOCUMENT_REJECTION_REASON_MAX) {
    throw new AppError(
      `reason must be at most ${DOCUMENT_REJECTION_REASON_MAX} characters`,
      400,
      'VALIDATION_ERROR',
    );
  }

  const outcome = await setDocumentVerification(getDb(), {
    applicationId: input.applicationId,
    documentId: input.documentId,
    landlordOxyUserId: oxyUserId,
    status,
    ...(status === 'rejected' ? { rejectionReason: reason } : {}),
  });
  if (!outcome.ok) throw new AppError('Document not found', 404, 'NOT_FOUND');

  const hydrated = await findApplicationById(getDb(), input.applicationId);
  if (!hydrated) throw new AppError('Application not found', 404, 'NOT_FOUND');
  return serializeApplication(hydrated);
}

const LANDLORD_TRANSITIONS = new Set<TenantApplicationStatusValue>([
  TenantApplicationStatus.REVIEWING,
  TenantApplicationStatus.APPROVED,
  TenantApplicationStatus.REJECTED,
]);

/**
 * Move an application: the landlord to reviewing / approved / rejected, the
 * applicant to withdrawn. The permitted FROM statuses are in the UPDATE's own
 * predicate, so two concurrent decisions cannot both succeed.
 */
export async function changeApplicationStatus(
  oxyUserId: string,
  applicationId: string,
  input: { status: unknown; notes?: unknown },
) {
  const db = getDb();
  const existing = await findApplicationById(db, applicationId);
  if (!existing) throw new AppError('Application not found', 404, 'NOT_FOUND');

  const isApplicant = existing.application.applicantOxyUserId === oxyUserId;
  const isLandlord = existing.application.landlordOxyUserId === oxyUserId;
  if (!isApplicant && !isLandlord) {
    throw new AppError('Not authorized to update this application', 403, 'FORBIDDEN');
  }

  const nextStatus = input.status;
  if (!isApplicationStatus(nextStatus)) {
    throw new AppError('Unsupported status transition', 400, 'INVALID_STATE');
  }

  if (LANDLORD_TRANSITIONS.has(nextStatus)) {
    if (!isLandlord) {
      throw new AppError('Only the landlord can perform this transition', 403, 'FORBIDDEN');
    }
    if (!ACTIVE_APPLICATION_STATUSES.includes(existing.application.status)) {
      throw new AppError('Application is no longer pending review', 400, 'INVALID_STATE');
    }
  } else if (nextStatus === TenantApplicationStatus.WITHDRAWN) {
    if (!isApplicant) {
      throw new AppError('Only the applicant can withdraw the application', 403, 'FORBIDDEN');
    }
    if (!ACTIVE_APPLICATION_STATUSES.includes(existing.application.status)) {
      throw new AppError('Application can no longer be withdrawn', 400, 'INVALID_STATE');
    }
  } else {
    throw new AppError('Unsupported status transition', 400, 'INVALID_STATE');
  }

  // `decided_at` is stamped by the repository iff `nextStatus` is terminal —
  // `tenant_applications_decided_at_check` makes the pair an equivalence the
  // write cannot get wrong.
  const hydrated = await decideApplication(
    db,
    applicationId,
    nextStatus,
    ACTIVE_APPLICATION_STATUSES,
    {
      notes: typeof input.notes === 'string' ? input.notes : undefined,
    },
  );
  if (!hydrated) {
    throw new AppError('Application is no longer pending review', 400, 'INVALID_STATE');
  }

  logger.info('Tenant application status updated', {
    applicationId: hydrated.application.id,
    nextStatus,
    byLandlord: isLandlord,
    byApplicant: isApplicant,
  });

  return serializeApplication(hydrated);
}

/**
 * Landlord-only bridge: turn an APPROVED application into a DRAFT lease. The
 * ONLY way a lease is created (AGENTS.md). Every owner id and lifecycle field
 * is resolved server-side; terms come from the application, rent from the
 * listing's long-term-rent block.
 */
export async function createLeaseFromApplication(oxyUserId: string, applicationId: string) {
  const hydratedApplication = await findApplicationById(getDb(), applicationId);
  if (!hydratedApplication) throw new AppError('Application not found', 404, 'NOT_FOUND');
  const application = hydratedApplication.application;

  if (application.landlordOxyUserId !== oxyUserId) {
    throw new AppError(
      'Only the landlord can create a lease from this application',
      403,
      'FORBIDDEN',
    );
  }
  if (application.status !== TenantApplicationStatus.APPROVED) {
    throw new AppError(
      'Application must be approved before creating a lease',
      400,
      'INVALID_STATE',
    );
  }

  const db = getDb();
  const property = await findPropertyLeaseBasis(db, String(application.propertyId));
  if (!property) throw new AppError('Property not found', 404, 'NOT_FOUND');

  const existingLease = await findLeaseForTenant(
    db,
    String(application.propertyId),
    String(application.applicantOxyUserId),
    ACTIVE_LEASE_STATUSES,
  );
  if (existingLease) {
    throw new AppError(
      'A lease already exists for this tenant and property',
      409,
      'LEASE_ALREADY_EXISTS',
    );
  }

  const startDate = new Date(application.moveInDate as string | number | Date);
  const endDate = new Date(startDate);
  endDate.setMonth(endDate.getMonth() + Number(application.leaseTermMonths || 0));

  // The column is nullable because `long_term_rent` is an OPTIONAL block, so a
  // listing with no long-term price is an ordinary state rather than a defect.
  const monthlyRent = property.longTermRentMonthlyAmount;
  if (monthlyRent === null) {
    throw new AppError(
      'Property has no long-term rent price to base the lease on',
      400,
      'INVALID_PROPERTY',
    );
  }
  const currency =
    property.longTermRentCurrency && LEASE_CURRENCIES.has(property.longTermRentCurrency)
      ? property.longTermRentCurrency
      : 'USD';

  const hydrated = await db.transaction((tx) =>
    createLease(tx, {
      columns: {
        propertyId: String(application.propertyId),
        landlordOxyUserId: oxyUserId,
        tenantOxyUserId: String(application.applicantOxyUserId),
        status: LeaseStatus.DRAFT,
        leaseTermsStartDate: startDate,
        leaseTermsEndDate: endDate,
        rentDetailsMonthlyRent: monthlyRent,
        rentDetailsCurrency: currency as (typeof PAYMENT_CURRENCIES)[number],
      },
      coTenants: [],
      sharedUtilityCosts: [],
    }),
  );

  logger.info('Lease draft created from application', {
    applicationId: application.id,
    leaseId: hydrated.lease.id,
    landlordOxyUserId: oxyUserId,
  });

  return serializeLease(hydrated);
}
