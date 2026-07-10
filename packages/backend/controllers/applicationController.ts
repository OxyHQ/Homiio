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
import { Property, TenantApplication, Profile, Lease } from '../models';
import { logger } from '../middlewares/logging';
import { AppError, successResponse, paginationResponse } from '../middlewares/errorHandler';
import imageUploadService from '../services/imageUploadService';
import { toLeaseDTO } from './lease/toLeaseDTO';
const {
  TenantApplicationStatus,
  TenantApplicationDocumentType,
  OfferingType,
  LeaseStatus
} = require('@homiio/shared-types');

/** Currency codes the Lease `rentDetails` block accepts (schema enum). */
const LEASE_CURRENCIES = new Set(['USD', 'EUR', 'GBP', 'CAD']);
const ACTIVE_LEASE_STATUSES = [LeaseStatus.DRAFT, LeaseStatus.PENDING_SIGNATURES, LeaseStatus.ACTIVE];

const ALLOWED_DOCUMENT_TYPES = new Set(Object.values(TenantApplicationDocumentType));
const APPLICATION_DOCUMENTS_FOLDER = 'applications/documents';

interface ParsedReferenceContact {
  name: string;
  relationship: string;
  phone: string;
  email: string;
}

interface ParsedDocument {
  type: string;
  url: string;
  filename: string;
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
    return {
      name: String(ref.name).trim(),
      relationship: String(ref.relationship),
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
    if (!ALLOWED_DOCUMENT_TYPES.has(doc.type)) {
      throw new AppError(`documents[${index}] has invalid type "${doc.type}"`, 400, 'INVALID_DOCUMENT_TYPE');
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
function parseDocumentTypes(raw: unknown, count: number): string[] {
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
    if (typeof type !== 'string' || !ALLOWED_DOCUMENT_TYPES.has(type)) {
      throw new AppError(`documentTypes[${index}] is not a valid document type`, 400, 'INVALID_DOCUMENT_TYPE');
    }
    return type;
  });
}

/**
 * Upload each multer file to S3 and return parsed document entries.
 */
async function uploadDocumentFiles(files: any[], types: string[]): Promise<ParsedDocument[]> {
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
      const oxyUserId = req.user?.id || req.user?._id || req.userId;
      if (!oxyUserId) return next(new AppError('Authentication required', 401, 'AUTHENTICATION_REQUIRED'));

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

      const property = await Property.findById(propertyId).lean();
      if (!property) return next(new AppError('Property not found', 404, 'NOT_FOUND'));
      if (property.isExternal) return next(new AppError('Cannot apply to external listings', 400, 'EXTERNAL_PROPERTY'));
      const propertyOfferings = Array.isArray(property.offerings) ? property.offerings : [];
      if (!propertyOfferings.includes(OfferingType.LONG_TERM_RENT)) {
        return next(new AppError('This property is not offered for long-term rent and does not accept applications', 400, 'NOT_APPLICABLE'));
      }

      const applicantProfile = await Profile.findActiveByOxyUserId(oxyUserId);
      if (!applicantProfile) return next(new AppError('No active profile found', 404, 'PROFILE_NOT_FOUND'));

      const landlordProfileId = property.profileId;
      if (!landlordProfileId) return next(new AppError('Property has no landlord profile', 400, 'INVALID_PROPERTY'));
      if (String(landlordProfileId) === String(applicantProfile._id)) {
        return next(new AppError('You cannot apply to your own property', 403, 'FORBIDDEN'));
      }

      // Prevent duplicate active applications by the same applicant.
      const existingActive = await TenantApplication.findOne({
        propertyId,
        applicantProfileId: applicantProfile._id,
        status: { $in: [TenantApplicationStatus.SUBMITTED, TenantApplicationStatus.REVIEWING] }
      }).lean();
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

      const application = await TenantApplication.create({
        propertyId,
        applicantProfileId: applicantProfile._id,
        landlordProfileId,
        moveInDate: moveInDateParsed,
        leaseTermMonths: Number(leaseTermMonths),
        monthlyIncome: Number(monthlyIncome),
        employmentStatus,
        referenceContacts: parsedReferences,
        documents: allDocuments,
        notes,
        status: TenantApplicationStatus.SUBMITTED,
        submittedAt: new Date()
      });

      logger.info('Tenant application created', {
        applicationId: String(application._id),
        propertyId: String(propertyId),
        applicantProfileId: String(applicantProfile._id)
      });

      res.status(201).json(successResponse(application.toJSON(), 'Application submitted'));
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
      const oxyUserId = req.user?.id || req.user?._id || req.userId;
      if (!oxyUserId) return next(new AppError('Authentication required', 401, 'AUTHENTICATION_REQUIRED'));

      const activeProfile = await Profile.findActiveByOxyUserId(oxyUserId);
      if (!activeProfile) return res.json(paginationResponse([], 1, 10, 0, 'No profile found for user'));

      const query: Record<string, unknown> = {};
      if (String(asLandlord) === 'true') {
        query.landlordProfileId = activeProfile._id;
      } else {
        query.applicantProfileId = activeProfile._id;
      }
      if (status) query.status = status;

      const pageNumber = Math.max(1, parseInt(String(page)) || 1);
      const limitNumber = Math.min(100, Math.max(1, parseInt(String(limit)) || 10));
      const skip = (pageNumber - 1) * limitNumber;

      const [items, total] = await Promise.all([
        TenantApplication.find(query)
          .sort({ submittedAt: -1 })
          .skip(skip)
          .limit(limitNumber)
          .lean(),
        TenantApplication.countDocuments(query)
      ]);

      res.json(paginationResponse(items, pageNumber, limitNumber, total, 'Applications retrieved'));
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
      const oxyUserId = req.user?.id || req.user?._id || req.userId;
      if (!oxyUserId) return next(new AppError('Authentication required', 401, 'AUTHENTICATION_REQUIRED'));

      const activeProfile = await Profile.findActiveByOxyUserId(oxyUserId);
      if (!activeProfile) return next(new AppError('No active profile found', 404, 'PROFILE_NOT_FOUND'));

      const application = await TenantApplication.findById(id).lean();
      if (!application) return next(new AppError('Application not found', 404, 'NOT_FOUND'));

      const isApplicant = String(application.applicantProfileId) === String(activeProfile._id);
      const isLandlord = String(application.landlordProfileId) === String(activeProfile._id);
      if (!isApplicant && !isLandlord) {
        return next(new AppError('Not authorized to view this application', 403, 'FORBIDDEN'));
      }

      res.json(successResponse(application, 'Application retrieved'));
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

      const oxyUserId = req.user?.id || req.user?._id || req.userId;
      if (!oxyUserId) return next(new AppError('Authentication required', 401, 'AUTHENTICATION_REQUIRED'));

      const activeProfile = await Profile.findActiveByOxyUserId(oxyUserId);
      if (!activeProfile) return next(new AppError('No active profile found', 404, 'PROFILE_NOT_FOUND'));

      const application = await TenantApplication.findById(id);
      if (!application) return next(new AppError('Application not found', 404, 'NOT_FOUND'));

      const isApplicant = String(application.applicantProfileId) === String(activeProfile._id);
      const isLandlord = String(application.landlordProfileId) === String(activeProfile._id);
      if (!isApplicant && !isLandlord) {
        return next(new AppError('Not authorized to update this application', 403, 'FORBIDDEN'));
      }

      const landlordTransitions = new Set([
        TenantApplicationStatus.REVIEWING,
        TenantApplicationStatus.APPROVED,
        TenantApplicationStatus.REJECTED
      ]);

      if (landlordTransitions.has(nextStatus)) {
        if (!isLandlord) return next(new AppError('Only the landlord can perform this transition', 403, 'FORBIDDEN'));
        if (
          application.status !== TenantApplicationStatus.SUBMITTED &&
          application.status !== TenantApplicationStatus.REVIEWING
        ) {
          return next(new AppError('Application is no longer pending review', 400, 'INVALID_STATE'));
        }
      } else if (nextStatus === TenantApplicationStatus.WITHDRAWN) {
        if (!isApplicant) return next(new AppError('Only the applicant can withdraw the application', 403, 'FORBIDDEN'));
        if (
          application.status !== TenantApplicationStatus.SUBMITTED &&
          application.status !== TenantApplicationStatus.REVIEWING
        ) {
          return next(new AppError('Application can no longer be withdrawn', 400, 'INVALID_STATE'));
        }
      } else {
        return next(new AppError('Unsupported status transition', 400, 'INVALID_STATE'));
      }

      application.status = nextStatus;
      if (typeof notes === 'string') application.notes = notes;
      // decidedAt is stamped automatically by the pre-save hook in the schema.
      await application.save();

      logger.info('Tenant application status updated', {
        applicationId: String(application._id),
        nextStatus,
        byLandlord: isLandlord,
        byApplicant: isApplicant
      });

      res.json(successResponse(application.toJSON(), 'Application updated'));
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
      const oxyUserId = req.user?.id || req.user?._id || req.userId;
      if (!oxyUserId) return next(new AppError('Authentication required', 401, 'AUTHENTICATION_REQUIRED'));

      const activeProfile = await Profile.findActiveByOxyUserId(oxyUserId);
      if (!activeProfile) return next(new AppError('No active profile found', 404, 'PROFILE_NOT_FOUND'));

      const application = await TenantApplication.findById(id);
      if (!application) return next(new AppError('Application not found', 404, 'NOT_FOUND'));

      if (String(application.landlordProfileId) !== String(activeProfile._id)) {
        return next(new AppError('Only the landlord can create a lease from this application', 403, 'FORBIDDEN'));
      }
      if (application.status !== TenantApplicationStatus.APPROVED) {
        return next(new AppError('Application must be approved before creating a lease', 400, 'INVALID_STATE'));
      }

      const property = await Property.findById(application.propertyId);
      if (!property) return next(new AppError('Property not found', 404, 'NOT_FOUND'));

      const existing = await Lease.findOne({
        propertyId: application.propertyId,
        tenantProfileId: application.applicantProfileId,
        status: { $in: ACTIVE_LEASE_STATUSES }
      });
      if (existing) {
        return next(new AppError('A lease already exists for this tenant and property', 409, 'LEASE_ALREADY_EXISTS'));
      }

      const startDate = new Date(application.moveInDate as string | number | Date);
      const endDate = new Date(startDate);
      endDate.setMonth(endDate.getMonth() + Number(application.leaseTermMonths || 0));

      const rentBlock = (property.longTermRent || {}) as { monthlyAmount?: number; currency?: string };
      if (rentBlock.monthlyAmount === undefined || rentBlock.monthlyAmount === null) {
        return next(new AppError('Property has no long-term rent price to base the lease on', 400, 'INVALID_PROPERTY'));
      }
      const currency = rentBlock.currency && LEASE_CURRENCIES.has(rentBlock.currency) ? rentBlock.currency : 'USD';

      const lease = await Lease.create({
        propertyId: application.propertyId,
        landlordProfileId: activeProfile._id,
        tenantProfileId: application.applicantProfileId,
        status: LeaseStatus.DRAFT,
        leaseTerms: { startDate, endDate },
        rentDetails: { monthlyRent: rentBlock.monthlyAmount, currency }
      });

      logger.info('Lease draft created from application', {
        applicationId: String(application._id),
        leaseId: String(lease._id),
        landlordProfileId: String(activeProfile._id)
      });

      res.status(201).json(successResponse(toLeaseDTO(lease), 'Lease draft created from application'));
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new ApplicationController();
