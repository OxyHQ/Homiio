/**
 * Tenant Application Controller
 *
 * Handles the long-term rent application lifecycle (Idealista-style).
 *
 * Distinct from:
 *  - `Reservation`     (vacation/short-term booking)
 *  - `ViewingRequest`  (in-person tour, precedes the application)
 *  - `Lease`           (signed contract, follows an approved application)
 *
 * Status transitions: submitted -> reviewing -> approved | rejected
 *                     submitted -> withdrawn (applicant)
 */

import type { Request, Response, NextFunction } from 'express';
import { PAYMENT_CURRENCIES } from '@homiio/shared-types';
import { getDb } from '../db/postgres';
import {
  ACTIVE_APPLICATION_STATUSES,
  createApplication,
  decideApplication,
  findActiveApplicationForApplicant,
  findApplicationById,
  isApplicationStatus,
  listApplications,
  serializeApplication,
  type TenantApplicationStatusValue,
} from '../db/applications/applicationReads';
import { findPropertyBookingBasis } from '../db/properties/propertyBookingBasis';
import { TENANT_APPLICATION_DOCUMENT_TYPES } from '../db/schema/applications';
import { REFERENCE_RELATIONSHIPS } from '../db/schema/profiles';
import {
  createLease,
  findLeaseForTenant,
  findPropertyLeaseBasis,
  type LeaseStatusValue,
} from '../db/leases/leaseReads';
import { serializeLease } from '../db/leases/leaseSerializer';
import { logger } from '../middlewares/logging';
import { AppError, successResponse, paginationResponse } from '../middlewares/errorHandler';
import imageUploadService from '../services/imageUploadService';
import { requireSessionOxyUserId } from '../utils/sessionUser';
import {
  TenantApplicationStatus,
  OfferingType,
  LeaseStatus,
} from '@homiio/shared-types';

/** Currency codes the Lease `rentDetails` block accepts (schema enum). */
const LEASE_CURRENCIES = new Set<string>(PAYMENT_CURRENCIES);
const ACTIVE_LEASE_STATUSES: readonly LeaseStatusValue[] = [
  LeaseStatus.DRAFT,
  LeaseStatus.PENDING_SIGNATURES,
  LeaseStatus.ACTIVE,
];

const APPLICATION_DOCUMENTS_FOLDER = 'applications/documents';

interface ParsedReferenceContact {
  name: string;
  relationship: (typeof REFERENCE_RELATIONSHIPS)[number];
  phone: string;
  email: string;
}

interface ParsedDocument {
  type: (typeof TENANT_APPLICATION_DOCUMENT_TYPES)[number];
  url: string;
  filename: string;
}

/** Whether `value` is one of the four declared referee relationships. */
function isReferenceRelationship(
  value: unknown,
): value is (typeof REFERENCE_RELATIONSHIPS)[number] {
  return typeof value === 'string' && (REFERENCE_RELATIONSHIPS as readonly string[]).includes(value);
}

/** Whether `value` is one of the four declared document types. */
function isApplicationDocumentType(
  value: unknown,
): value is (typeof TENANT_APPLICATION_DOCUMENT_TYPES)[number] {
  return (
    typeof value === 'string' &&
    (TENANT_APPLICATION_DOCUMENT_TYPES as readonly string[]).includes(value)
  );
}

/**
 * Parse `referenceContacts` from the request body. Accepts:
 *   - JSON array (application/json request)
 *   - JSON string (multipart/form-data — common pattern when a field is a list)
 */
function parseReferenceContacts(raw: unknown): ParsedReferenceContact[] {
  if (!raw) return [];
  let value: unknown = raw;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      throw new AppError('referenceContacts must be valid JSON or an array', 400, 'INVALID_REFERENCES');
    }
  }
  if (!Array.isArray(value)) {
    throw new AppError('referenceContacts must be an array', 400, 'INVALID_REFERENCES');
  }
  return value.map((item, index) => {
    const ref = item as Partial<ParsedReferenceContact>;
    if (!ref?.name || !ref?.relationship || !ref?.phone || !ref?.email) {
      throw new AppError(`referenceContacts[${index}] is missing required fields`, 400, 'INVALID_REFERENCES');
    }
    // Narrowed HERE rather than left to `tenant_application_references_
    // relationship_check`: Mongoose validated this enum on `create`, and an
    // undeclared value arriving as a `23514` would be a 500 where the caller
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
      email: String(ref.email).trim().toLowerCase()
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
      throw new AppError(`documents[${index}] is missing required fields`, 400, 'INVALID_DOCUMENTS');
    }
    if (!isApplicationDocumentType(doc.type)) {
      throw new AppError(`documents[${index}] has invalid type "${String(doc.type)}"`, 400, 'INVALID_DOCUMENT_TYPE');
    }
    return {
      type: doc.type,
      url: doc.url,
      filename: doc.filename
    };
  });
}

/**
 * Parse a parallel `documentTypes[]` field (multipart shape) — one string per
 * uploaded file (e.g. ["id", "income", "reference"]).
 */
function parseDocumentTypes(
  raw: unknown,
  count: number,
): (typeof TENANT_APPLICATION_DOCUMENT_TYPES)[number][] {
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
    throw new AppError('documentTypes must be an array matching uploaded files', 400, 'INVALID_DOCUMENT_TYPES');
  }
  if (value.length !== count) {
    throw new AppError(
      `documentTypes length (${value.length}) must match uploaded files length (${count})`,
      400,
      'INVALID_DOCUMENT_TYPES'
    );
  }
  return value.map((type, index) => {
    if (!isApplicationDocumentType(type)) {
      throw new AppError(`documentTypes[${index}] is not a valid document type`, 400, 'INVALID_DOCUMENT_TYPE');
    }
    return type;
  });
}

/**
 * Upload each multer file to S3 and return parsed document entries.
 */
async function uploadDocumentFiles(
  files: any[],
  types: readonly (typeof TENANT_APPLICATION_DOCUMENT_TYPES)[number][],
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
      filename: file.originalname
    });
  }
  return uploaded;
}

class ApplicationController {
  /**
   * POST /api/applications
   *
   * Multipart and JSON both supported. Multipart shape:
   *   propertyId        string
   *   moveInDate        ISO date
   *   leaseTermMonths   number
   *   monthlyIncome     number
   *   employmentStatus  enum
   *   referenceContacts JSON-encoded array
   *   documentTypes     JSON-encoded array (matches `documents[]` files)
   *   notes             string?
   *   documents         files[]  (multer field name)
   */
  async createApplication(req: any, res: any, next: any) {
    try {
      const oxyUserId = requireSessionOxyUserId(req);

      const {
        propertyId,
        moveInDate,
        leaseTermMonths,
        monthlyIncome,
        employmentStatus,
        notes,
        referenceContacts,
        documents,
        documentTypes
      } = req.body || {};

      const db = getDb();
      const property = await findPropertyBookingBasis(db, String(propertyId));
      if (!property) return next(new AppError('Property not found', 404, 'NOT_FOUND'));
      if (property.isExternal) return next(new AppError('Cannot apply to external listings', 400, 'EXTERNAL_PROPERTY'));
      if (!property.offerings.includes(OfferingType.LONG_TERM_RENT)) {
        return next(new AppError('This property is not offered for long-term rent and does not accept applications', 400, 'NOT_APPLICABLE'));
      }

      const landlordOxyUserId = property.oxyUserId;
      if (!landlordOxyUserId) return next(new AppError('Property has no landlord', 400, 'INVALID_PROPERTY'));
      if (landlordOxyUserId === oxyUserId) {
        return next(new AppError('You cannot apply to your own property', 403, 'FORBIDDEN'));
      }

      // Prevent duplicate active applications by the same applicant. A read
      // rather than an index: "active" is a status SET, and a partial unique
      // index over one would also forbid re-applying after a rejection.
      const existingActive = await findActiveApplicationForApplicant(
        db,
        String(propertyId),
        oxyUserId,
      );
      if (existingActive) {
        return next(new AppError('You already have an active application for this property', 409, 'ALREADY_APPLIED'));
      }

      const moveInDateParsed = new Date(moveInDate);
      if (Number.isNaN(moveInDateParsed.getTime())) {
        return next(new AppError('Invalid move-in date', 400, 'INVALID_DATE'));
      }

      const parsedReferences = parseReferenceContacts(referenceContacts);
      const parsedDocumentsFromBody = parseDocumentsFromBody(documents);

      const uploadedFiles: any[] = Array.isArray(req.files) ? req.files : [];
      let uploadedDocs: ParsedDocument[] = [];
      if (uploadedFiles.length > 0) {
        const types = parseDocumentTypes(documentTypes, uploadedFiles.length);
        uploadedDocs = await uploadDocumentFiles(uploadedFiles, types);
      }

      const allDocuments = [...parsedDocumentsFromBody, ...uploadedDocs];

      // One transaction: an application that committed without its references
      // is one a landlord judges on incomplete information.
      const hydrated = await db.transaction((tx) =>
        createApplication(tx, {
          columns: {
            propertyId: String(propertyId),
            applicantOxyUserId: oxyUserId,
            landlordOxyUserId,
            moveInDate: moveInDateParsed,
            leaseTermMonths: Number(leaseTermMonths),
            monthlyIncome: Number(monthlyIncome),
            employmentStatus,
            notes,
            status: TenantApplicationStatus.SUBMITTED,
            submittedAt: new Date(),
          },
          references: parsedReferences,
          documents: allDocuments,
        }),
      );

      logger.info('Tenant application created', {
        applicationId: hydrated.application.id,
        propertyId: String(propertyId),
        applicantOxyUserId: oxyUserId
      });

      res.status(201).json(successResponse(serializeApplication(hydrated), 'Application submitted'));
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/applications
   * List mine. Filter by role with ?asLandlord=true.
   */
  async listMyApplications(req: any, res: any, next: any) {
    try {
      const { page = 1, limit = 10, status, asLandlord } = req.query;
      const oxyUserId = requireSessionOxyUserId(req);

      const pageNumber = Math.max(1, parseInt(String(page)) || 1);
      const limitNumber = Math.min(100, Math.max(1, parseInt(String(limit)) || 10));
      const skip = (pageNumber - 1) * limitNumber;

      const asLandlordView = String(asLandlord) === 'true';
      const result = await listApplications(
        getDb(),
        {
          applicantOxyUserId: asLandlordView ? undefined : oxyUserId,
          landlordOxyUserId: asLandlordView ? oxyUserId : undefined,
          status: isApplicationStatus(status) ? status : undefined,
        },
        { limit: limitNumber, offset: skip },
      );

      res.json(paginationResponse(result.applications.map(serializeApplication), pageNumber, limitNumber, result.total, 'Applications retrieved'));
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/applications/:id
   */
  async getApplicationById(req: any, res: any, next: any) {
    try {
      const { id } = req.params;
      const oxyUserId = requireSessionOxyUserId(req);

      const hydrated = await findApplicationById(getDb(), id);
      if (!hydrated) return next(new AppError('Application not found', 404, 'NOT_FOUND'));

      const isApplicant = hydrated.application.applicantOxyUserId === oxyUserId;
      const isLandlord = hydrated.application.landlordOxyUserId === oxyUserId;
      if (!isApplicant && !isLandlord) {
        return next(new AppError('Not authorized to view this application', 403, 'FORBIDDEN'));
      }

      res.json(successResponse(serializeApplication(hydrated), 'Application retrieved'));
    } catch (error) {
      next(error);
    }
  }

  /**
   * PATCH /api/applications/:id
   *  - Landlord: approves / rejects / moves to reviewing
   *  - Applicant: withdraws (must be in submitted/reviewing)
   */
  async updateApplicationStatus(req: any, res: any, next: any) {
    try {
      const { id } = req.params;
      const { status: nextStatus, notes } = req.body;

      const oxyUserId = requireSessionOxyUserId(req);

      const db = getDb();
      const existing = await findApplicationById(db, id);
      if (!existing) return next(new AppError('Application not found', 404, 'NOT_FOUND'));

      const isApplicant = existing.application.applicantOxyUserId === oxyUserId;
      const isLandlord = existing.application.landlordOxyUserId === oxyUserId;
      if (!isApplicant && !isLandlord) {
        return next(new AppError('Not authorized to update this application', 403, 'FORBIDDEN'));
      }

      if (!isApplicationStatus(nextStatus)) {
        return next(new AppError('Unsupported status transition', 400, 'INVALID_STATE'));
      }

      const landlordTransitions = new Set<TenantApplicationStatusValue>([
        TenantApplicationStatus.REVIEWING,
        TenantApplicationStatus.APPROVED,
        TenantApplicationStatus.REJECTED
      ]);

      if (landlordTransitions.has(nextStatus)) {
        if (!isLandlord) return next(new AppError('Only the landlord can perform this transition', 403, 'FORBIDDEN'));
        if (!ACTIVE_APPLICATION_STATUSES.includes(existing.application.status)) {
          return next(new AppError('Application is no longer pending review', 400, 'INVALID_STATE'));
        }
      } else if (nextStatus === TenantApplicationStatus.WITHDRAWN) {
        if (!isApplicant) return next(new AppError('Only the applicant can withdraw the application', 403, 'FORBIDDEN'));
        if (!ACTIVE_APPLICATION_STATUSES.includes(existing.application.status)) {
          return next(new AppError('Application can no longer be withdrawn', 400, 'INVALID_STATE'));
        }
      } else {
        return next(new AppError('Unsupported status transition', 400, 'INVALID_STATE'));
      }

      // `decided_at` is stamped by the repository iff `nextStatus` is terminal —
      // the `pre('save')` hook that used to do it was bypassed by every
      // `findOneAndUpdate`, and `tenant_applications_decided_at_check` now makes
      // the pair an equivalence the write cannot get wrong.
      //
      // The permitted FROM statuses are in the `UPDATE`'s own predicate, so two
      // landlords deciding at once cannot both succeed; the read above chose the
      // error message, this chooses whether the write happens.
      const hydrated = await decideApplication(
        db,
        id,
        nextStatus,
        ACTIVE_APPLICATION_STATUSES,
        { notes: typeof notes === 'string' ? notes : undefined },
      );
      if (!hydrated) {
        return next(new AppError('Application is no longer pending review', 400, 'INVALID_STATE'));
      }

      logger.info('Tenant application status updated', {
        applicationId: hydrated.application.id,
        nextStatus,
        byLandlord: isLandlord,
        byApplicant: isApplicant
      });

      res.json(successResponse(serializeApplication(hydrated), 'Application updated'));
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/applications/:id/create-lease
   *
   * Landlord-only bridge: turn an APPROVED application into a DRAFT lease. All
   * owner ids and lifecycle fields are resolved server-side (no request body is
   * trusted) — the landlord edits the draft afterwards via PUT /api/leases/:id.
   * The lease terms are seeded from the application (move-in date + term months)
   * and the rent from the property's long-term-rent block.
   */
  async createLeaseFromApplication(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;
      const oxyUserId = requireSessionOxyUserId(req);

      const hydratedApplication = await findApplicationById(getDb(), id);
      if (!hydratedApplication) return next(new AppError('Application not found', 404, 'NOT_FOUND'));
      const application = hydratedApplication.application;

      if (application.landlordOxyUserId !== oxyUserId) {
        return next(new AppError('Only the landlord can create a lease from this application', 403, 'FORBIDDEN'));
      }
      if (application.status !== TenantApplicationStatus.APPROVED) {
        return next(new AppError('Application must be approved before creating a lease', 400, 'INVALID_STATE'));
      }

      // Both the application and the lease are Postgres now. The application is
      // only READ here — the lease is the single write — so this needs no
      // transaction spanning the two.
      const db = getDb();
      const property = await findPropertyLeaseBasis(db, String(application.propertyId));
      if (!property) return next(new AppError('Property not found', 404, 'NOT_FOUND'));

      const existingLease = await findLeaseForTenant(
        db,
        String(application.propertyId),
        String(application.applicantOxyUserId),
        ACTIVE_LEASE_STATUSES,
      );
      if (existingLease) {
        return next(new AppError('A lease already exists for this tenant and property', 409, 'LEASE_ALREADY_EXISTS'));
      }

      const startDate = new Date(application.moveInDate as string | number | Date);
      const endDate = new Date(startDate);
      endDate.setMonth(endDate.getMonth() + Number(application.leaseTermMonths || 0));

      // Narrowed into a local so the insert below sees `number` rather than
      // `number | null`. The column is nullable because `long_term_rent` is an
      // OPTIONAL block and nullness is the only representation of its absence
      // (`db/schema/CONVENTIONS.md`), so a listing with no long-term price is an
      // ordinary state rather than a defect.
      const monthlyRent = property.longTermRentMonthlyAmount;
      if (monthlyRent === null) {
        return next(new AppError('Property has no long-term rent price to base the lease on', 400, 'INVALID_PROPERTY'));
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
        landlordOxyUserId: oxyUserId
      });

      res.status(201).json(successResponse(serializeLease(hydrated), 'Lease draft created from application'));
    } catch (error) {
      next(error);
    }
  }
}

export default new ApplicationController();
