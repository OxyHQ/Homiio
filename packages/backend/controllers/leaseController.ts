/**
 * Lease Controller
 *
 * Lease management, persisted in PostgreSQL (`db/schema/leases.ts`, read and
 * written through `db/leases/leaseReads.ts`, serialized by
 * `db/leases/leaseSerializer.ts`).
 *
 * ## What the port changed
 *
 * **Signature material can no longer be returned by accident.** The two
 * `digital_signature` columns are protected (`db/schema/protectedColumns.ts`)
 * and reads go through `publicColumns(leases)`, so they are absent from the row
 * TYPE — a serializer that tried to emit one would fail `tsc`. Under Mongoose
 * they were hidden only by their absence from `toLeaseDTO`'s field list.
 *
 * **`renewLease` no longer copies a document.** It read the whole lease with
 * `toObject()`, deleted six keys and spread the rest into a new one — which
 * silently carries any field added later, including ones a renewal must not
 * inherit. The Postgres version names the columns it copies.
 *
 * **`getLeasePayments` paginates in SQL.** It used to load every instalment,
 * filter in memory and `slice` — fine for a 12-row schedule and wrong in
 * principle, and `lease_payment_schedule_lease_due_idx` serves the ordering for
 * free.
 *
 * **`property` is no longer populated.** The `.populate('propertyId')` call put
 * the whole listing on every lease in a list response. Hydrating it now means
 * `db/properties`' serializer, and a lease list is not a listing feed — the DTO
 * keeps `propertyId` and drops the nested copy. Recorded rather than silent: a
 * client that read `lease.property` gets `undefined` and must fetch the listing
 * it already has the id for.
 */

import path from 'path';

import type { Request, Response, NextFunction } from 'express';
import { LeaseStatus } from '@homiio/shared-types';

import { successResponse, paginationResponse, AppError } from '../middlewares/errorHandler';
import { logger } from '../middlewares/logging';

import { getDb } from '../db/postgres';
import {
  addLeaseDocument,
  addLeasePayment,
  createLease,
  deleteLease,
  findLeaseAccess,
  findLeaseById,
  findLeaseDocument,
  findPropertyLeaseBasis,
  listLeaseDocuments,
  listLeasePayments,
  listLeases,
  signLease,
  terminateLease,
  updateLease,
  type LeasePaymentStatusValue,
  type LeaseStatusValue,
} from '../db/leases/leaseReads';
import {
  serializeLease,
  serializeLeaseDocument,
  serializeLeasePayment,
} from '../db/leases/leaseSerializer';
import {
  LEASE_DOCUMENT_TYPES,
  LEASE_PAYMENT_STATUSES,
  LEASE_PAYMENT_TYPES,
} from '../db/schema/leases';
import { requireSessionOxyUserId } from '../utils/sessionUser';
import { pickFields } from '../utils/pickFields';
import { CREATABLE_LEASE_FIELDS, EDITABLE_LEASE_FIELDS } from './lease/editableFields';
import {
  toCoTenantRows,
  toLeaseColumns,
  toSharedUtilityCostRows,
} from './lease/leaseWriteColumns';
import { notificationDispatchService } from '../services/notificationDispatchService';
import imageUploadService from '../services/imageUploadService';
import { storedDocumentKey } from '../utils/storedDocumentKey';
import { SERVABLE_DOCUMENT_CONTENT_TYPES } from '../utils/imageStoreKey';
import config from '../config';

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
 * The document types a lease may carry, mapped to the extension their bytes are
 * stored under.
 *
 * `routes/leases.ts` refuses everything else at the multer `fileFilter`; this
 * map is the second half of the same decision, and the handler consults it so a
 * type accepted there can never reach storage with no extension to serve it
 * back under. PDF is the one that matters: a tenancy agreement is a PDF more
 * often than it is a photograph of one.
 */
const LEASE_DOCUMENT_EXTENSIONS: Readonly<Record<string, string>> = {
  'application/pdf': '.pdf',
  'image/jpeg': '.jpeg',
  'image/jpg': '.jpeg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/heic': '.heic',
  'image/heif': '.heif',
};

/** The multer file shape this controller reads, without pulling multer's types in. */
interface UploadedDocumentFile {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
}

/**
 * A stored document NAME, stripped of anything that is not a name.
 *
 * It is displayed in a list and, via {@link downloadFilename}, written to a file
 * on a phone — so path separators, control characters and a 300-character title
 * are all things it must not carry.
 */
function safeDocumentName(raw: string): string {
  const cleaned = raw.replace(/[^A-Za-z0-9._ -]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 120);
  return cleaned.length > 0 ? cleaned : 'document';
}

/**
 * The extension a given content type is written out under.
 *
 * `SERVABLE_DOCUMENT_CONTENT_TYPES` maps the other way and is not invertible:
 * `.jpg` and `.jpeg` both mean `image/jpeg`, so deriving this by searching it
 * would make the answer depend on key order. Stated explicitly instead.
 */
const DOWNLOAD_EXTENSIONS: Readonly<Record<string, string>> = {
  'application/pdf': '.pdf',
  'image/jpeg': '.jpeg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
};

/**
 * The filename the client saves the bytes under.
 *
 * The stored name is a label a person typed and need not end in anything, while
 * the platform decides how to open a file largely by its extension — so one
 * matching the content type the store actually returned is appended when the
 * name does not already carry an equivalent. Taken from the CONTENT TYPE rather
 * than from the name, because the name is the part a person can get wrong.
 */
function downloadFilename(name: string, contentType: string): string {
  const safe = safeDocumentName(name);
  const extension = DOWNLOAD_EXTENSIONS[contentType];
  if (!extension) return safe;
  const current = path.posix.extname(safe).toLowerCase();
  // `.jpg` on an `image/jpeg` is already right; only a missing or mismatched
  // extension is worth correcting.
  if (SERVABLE_DOCUMENT_CONTENT_TYPES[current] === contentType) return safe;
  return `${safe}${extension}`;
}

function parsePagination(query: Request['query']): { page: number; limit: number; skip: number } {
  const rawPage = parseInt(String(query.page ?? ''), 10);
  const rawLimit = parseInt(String(query.limit ?? ''), 10);
  const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1;
  const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, MAX_PAGE_SIZE) : DEFAULT_PAGE_SIZE;
  return { page, limit, skip: (page - 1) * limit };
}

/** The lease access row, narrowed to the three party questions. */
interface LeaseParties {
  landlordOxyUserId: string;
  tenantOxyUserId: string;
  coTenantOxyUserIds: readonly string[];
}

function isLandlord(lease: LeaseParties, oxyUserId: string): boolean {
  return lease.landlordOxyUserId === oxyUserId;
}

function isTenant(lease: LeaseParties, oxyUserId: string): boolean {
  return lease.tenantOxyUserId === oxyUserId || lease.coTenantOxyUserIds.includes(oxyUserId);
}

function isParty(lease: LeaseParties, oxyUserId: string): boolean {
  return isLandlord(lease, oxyUserId) || isTenant(lease, oxyUserId);
}

/** A `?status=` filter, or `undefined` when absent or not a declared value. */
function leaseStatusFilter(value: unknown): LeaseStatusValue | undefined {
  const statuses: readonly string[] = Object.values(LeaseStatus);
  return typeof value === 'string' && statuses.includes(value)
    ? (value as LeaseStatusValue)
    : undefined;
}

class LeaseController {
  /**
   * Get the active profile's leases (as landlord, tenant, or co-tenant).
   */
  async getLeases(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const oxyUserId = requireSessionOxyUserId(req);
      const { page, limit, skip } = parsePagination(req.query);
      const { status, propertyId } = req.query;

      const result = await listLeases(
        getDb(),
        {
          oxyUserId,
          status: leaseStatusFilter(status),
          propertyId: propertyId === undefined ? undefined : String(propertyId),
        },
        { limit, offset: skip },
      );

      res.json(paginationResponse(
        result.leases.map(serializeLease),
        page,
        limit,
        result.total,
        'Leases retrieved successfully'
      ));
    } catch (error) {
      next(error);
    }
  }

  /**
   * Create a new lease. The requester must own the referenced property.
   */
  async createLease(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const oxyUserId = requireSessionOxyUserId(req);
      const { propertyId, tenantOxyUserId, leaseTerms, rentDetails } = req.body;

      if (!propertyId) {
        throw new AppError('propertyId is required', 400, 'VALIDATION_ERROR');
      }
      if (!tenantOxyUserId) {
        throw new AppError('tenantOxyUserId is required', 400, 'VALIDATION_ERROR');
      }
      if (!leaseTerms?.startDate || !leaseTerms?.endDate) {
        throw new AppError('leaseTerms.startDate and leaseTerms.endDate are required', 400, 'VALIDATION_ERROR');
      }
      if (rentDetails?.monthlyRent === undefined || rentDetails?.monthlyRent === null) {
        throw new AppError('rentDetails.monthlyRent is required', 400, 'VALIDATION_ERROR');
      }

      const db = getDb();
      const property = await findPropertyLeaseBasis(db, String(propertyId));
      if (!property) {
        throw new AppError('Property not found', 404, 'PROPERTY_NOT_FOUND');
      }
      if (!property.oxyUserId || property.oxyUserId !== oxyUserId) {
        throw new AppError('Access denied - you can only create leases for your own properties', 403, 'FORBIDDEN');
      }

      const picked = pickFields<Record<string, unknown>>(req.body, CREATABLE_LEASE_FIELDS);
      const columns = toLeaseColumns(picked);

      const startDate = columns.leaseTermsStartDate;
      const endDate = columns.leaseTermsEndDate;
      const monthlyRent = columns.rentDetailsMonthlyRent;
      if (!startDate || !endDate) {
        throw new AppError('leaseTerms.startDate and leaseTerms.endDate must be valid dates', 400, 'VALIDATION_ERROR');
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

      res.status(201).json(successResponse(serializeLease(hydrated), 'Lease created successfully'));
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get a lease by ID. Only a party (landlord, tenant, or co-tenant) may view it.
   */
  async getLeaseById(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const oxyUserId = requireSessionOxyUserId(req);
      const db = getDb();
      const access = await findLeaseAccess(db, req.params.id);
      if (!access) {
        throw new AppError('Lease not found', 404, 'LEASE_NOT_FOUND');
      }
      if (!isParty(access, oxyUserId)) {
        throw new AppError('Access denied - you are not a party to this lease', 403, 'FORBIDDEN');
      }

      const hydrated = await findLeaseById(db, req.params.id);
      if (!hydrated) {
        throw new AppError('Lease not found', 404, 'LEASE_NOT_FOUND');
      }

      res.json(successResponse(serializeLease(hydrated), 'Lease retrieved successfully'));
    } catch (error) {
      next(error);
    }
  }

  /**
   * Update a lease. Only the landlord may update, and only while the lease is
   * still a draft or awaiting signatures.
   */
  async updateLease(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const oxyUserId = requireSessionOxyUserId(req);
      const db = getDb();
      const access = await findLeaseAccess(db, req.params.id);
      if (!access) {
        throw new AppError('Lease not found', 404, 'LEASE_NOT_FOUND');
      }
      if (!isLandlord(access, oxyUserId)) {
        throw new AppError('Access denied - only the landlord can update this lease', 403, 'FORBIDDEN');
      }
      if (!EDITABLE_STATUSES.includes(access.status as LeaseStatusValue)) {
        throw new AppError('Cannot update a lease that is signed, active, or closed', 409, 'LEASE_NOT_EDITABLE');
      }

      const picked = pickFields<Record<string, unknown>>(req.body, EDITABLE_LEASE_FIELDS);

      // The status is re-checked INSIDE the `UPDATE`'s own predicate, so a lease
      // signed between the read above and this write is not edited anyway — the
      // read decides the error message, the predicate decides the write.
      const hydrated = await db.transaction((tx) =>
        updateLease(tx, req.params.id, oxyUserId, EDITABLE_STATUSES, {
          columns: toLeaseColumns(picked),
          coTenants: toCoTenantRows(picked),
          sharedUtilityCosts: toSharedUtilityCostRows(picked),
        }),
      );
      if (!hydrated) {
        throw new AppError('Cannot update a lease that is signed, active, or closed', 409, 'LEASE_NOT_EDITABLE');
      }

      logger.info('Lease updated', { leaseId: hydrated.lease.id, updatedBy: oxyUserId });

      res.json(successResponse(serializeLease(hydrated), 'Lease updated successfully'));
    } catch (error) {
      next(error);
    }
  }

  /**
   * Delete a lease. Only the landlord may delete, and only while it is a draft
   * or awaiting signatures. Signed/active leases cannot be deleted.
   */
  async deleteLease(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const oxyUserId = requireSessionOxyUserId(req);
      const db = getDb();
      const access = await findLeaseAccess(db, req.params.id);
      if (!access) {
        throw new AppError('Lease not found', 404, 'LEASE_NOT_FOUND');
      }
      if (!isLandlord(access, oxyUserId)) {
        throw new AppError('Access denied - only the landlord can delete this lease', 403, 'FORBIDDEN');
      }
      if (!DELETABLE_STATUSES.includes(access.status as LeaseStatusValue)) {
        throw new AppError('Cannot delete a lease that is signed, active, or closed', 409, 'LEASE_NOT_DELETABLE');
      }

      // Every child table CASCADEs, so this one statement takes the co-tenants,
      // schedule, documents and inspections with it.
      const deleted = await deleteLease(db, req.params.id, oxyUserId, DELETABLE_STATUSES);
      if (!deleted) {
        throw new AppError('Cannot delete a lease that is signed, active, or closed', 409, 'LEASE_NOT_DELETABLE');
      }

      logger.info('Lease deleted', { leaseId: req.params.id, deletedBy: oxyUserId });

      res.json(successResponse(null, 'Lease deleted successfully'));
    } catch (error) {
      next(error);
    }
  }

  /**
   * Sign a lease. The requester must be the landlord or tenant. Records the
   * signature; the lease becomes active once both principals have signed, and
   * its payment schedule is generated at that moment.
   */
  async signLease(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const oxyUserId = requireSessionOxyUserId(req);
      const { acceptTerms, signature } = req.body;
      if (!acceptTerms) {
        throw new AppError('Must accept terms to sign lease', 400, 'TERMS_NOT_ACCEPTED');
      }

      const db = getDb();
      const access = await findLeaseAccess(db, req.params.id);
      if (!access) {
        throw new AppError('Lease not found', 404, 'LEASE_NOT_FOUND');
      }

      // A co-tenant is a party for READS and is not a signatory: only the two
      // principals have signature columns. `isTenant` includes co-tenants, so
      // the check here is deliberately the narrower one.
      let signatory: 'landlord' | 'tenant';
      let counterpartyOxyUserId: string;
      if (isLandlord(access, oxyUserId)) {
        signatory = 'landlord';
        counterpartyOxyUserId = access.tenantOxyUserId;
      } else if (access.tenantOxyUserId === oxyUserId) {
        signatory = 'tenant';
        counterpartyOxyUserId = access.landlordOxyUserId;
      } else {
        throw new AppError('Access denied - you are not a party to this lease', 403, 'FORBIDDEN');
      }

      // The signature, the status move and the payment schedule are one fact —
      // a lease that commits `active` with no schedule is the state
      // `generatePaymentSchedule` exists to prevent.
      const hydrated = await db.transaction((tx) =>
        signLease(
          tx,
          req.params.id,
          signatory,
          typeof signature === 'string' ? signature : undefined,
          LeaseStatus.ACTIVE,
          LeaseStatus.PENDING_SIGNATURES,
        ),
      );
      if (!hydrated) {
        throw new AppError('Lease not found', 404, 'LEASE_NOT_FOUND');
      }

      logger.info('Lease signed', { leaseId: hydrated.lease.id, signedBy: oxyUserId });

      // Notify the counterparty: either the lease is now fully signed/active,
      // or it awaits their signature. Best-effort — never blocks the response.
      const isActive = hydrated.lease.status === LeaseStatus.ACTIVE;
      await notificationDispatchService.createForUser(counterpartyOxyUserId, {
        type: 'contract',
        title: isActive ? 'Lease is now active' : 'Lease awaiting your signature',
        message: isActive
          ? 'Both parties have signed. Your lease is now active.'
          : 'The other party signed the lease. Review and sign to activate it.',
        priority: isActive ? 'medium' : 'high',
        data: {
          leaseId: hydrated.lease.id,
          screen: '/contracts',
          propertyId: hydrated.lease.propertyId,
        },
      });

      res.json(successResponse(serializeLease(hydrated), 'Lease signed successfully'));
    } catch (error) {
      next(error);
    }
  }

  /**
   * Terminate a lease. Only a party may terminate. Records a termination notice
   * and moves the lease to the terminated status.
   */
  async terminateLease(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const oxyUserId = requireSessionOxyUserId(req);
      const { reason, effectiveDate } = req.body;
      const db = getDb();
      const access = await findLeaseAccess(db, req.params.id);
      if (!access) {
        throw new AppError('Lease not found', 404, 'LEASE_NOT_FOUND');
      }
      if (!isParty(access, oxyUserId)) {
        throw new AppError('Access denied - you are not a party to this lease', 403, 'FORBIDDEN');
      }
      if (access.status === LeaseStatus.TERMINATED) {
        throw new AppError('Lease is already terminated', 409, 'LEASE_ALREADY_TERMINATED');
      }

      const parsedEffectiveDate = effectiveDate ? new Date(effectiveDate) : new Date();
      if (Number.isNaN(parsedEffectiveDate.getTime())) {
        throw new AppError('effectiveDate must be a valid date', 400, 'VALIDATION_ERROR');
      }

      const hydrated = await terminateLease(db, req.params.id, {
        givenByOxyUserId: oxyUserId,
        effectiveDate: parsedEffectiveDate,
        reason: typeof reason === 'string' ? reason : undefined,
        terminatedStatus: LeaseStatus.TERMINATED,
      });
      if (!hydrated) {
        throw new AppError('Lease not found', 404, 'LEASE_NOT_FOUND');
      }

      logger.info('Lease terminated', {
        leaseId: hydrated.lease.id,
        terminatedBy: oxyUserId,
        reason,
      });

      res.json(successResponse(serializeLease(hydrated), 'Lease terminated successfully'));
    } catch (error) {
      next(error);
    }
  }

  /**
   * Renew a lease by creating a new one that inherits the original's terms with
   * a new end date. Only the landlord may renew.
   */
  async renewLease(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const oxyUserId = requireSessionOxyUserId(req);
      const { newEndDate, monthlyRent, startDate } = req.body;
      if (!newEndDate) {
        throw new AppError('newEndDate is required', 400, 'VALIDATION_ERROR');
      }
      const parsedEndDate = new Date(newEndDate);
      if (Number.isNaN(parsedEndDate.getTime())) {
        throw new AppError('newEndDate must be a valid date', 400, 'VALIDATION_ERROR');
      }

      const db = getDb();
      const original = await findLeaseById(db, req.params.id);
      if (!original) {
        throw new AppError('Lease not found', 404, 'LEASE_NOT_FOUND');
      }
      const source = original.lease;
      if (source.landlordOxyUserId !== oxyUserId) {
        throw new AppError('Access denied - only the landlord can renew this lease', 403, 'FORBIDDEN');
      }

      const parsedStartDate = startDate ? new Date(startDate) : source.leaseTermsEndDate;
      if (Number.isNaN(parsedStartDate.getTime())) {
        throw new AppError('startDate must be a valid date', 400, 'VALIDATION_ERROR');
      }

      // The columns are NAMED rather than spread. `toObject()` plus six
      // `delete`s carried every future field into the renewal by default, which
      // is how a signature, a termination notice or a payment schedule ends up
      // on a draft nobody signed.
      const hydrated = await db.transaction((tx) =>
        createLease(tx, {
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
              typeof monthlyRent === 'number' ? monthlyRent : source.rentDetailsMonthlyRent,
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
          // The roster is inherited; the SIGNATURES on it are not — every
          // co-tenant starts `pending` on a renewal they have not signed.
          coTenants: original.coTenants.map((coTenant) => ({
            oxyUserId: coTenant.oxyUserId,
            role: coTenant.role,
          })),
          sharedUtilityCosts: original.sharedUtilityCosts.map((cost) => ({
            utility: cost.utility,
            splitPercentage: cost.splitPercentage,
          })),
        }),
      );

      logger.info('Lease renewal created', {
        originalLeaseId: source.id,
        renewalLeaseId: hydrated.lease.id,
        createdBy: oxyUserId,
      });

      res.status(201).json(successResponse(serializeLease(hydrated), 'Lease renewal created successfully'));
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get a lease's payment schedule. Only a party may view it.
   */
  async getLeasePayments(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const oxyUserId = requireSessionOxyUserId(req);
      const db = getDb();
      const access = await findLeaseAccess(db, req.params.id);
      if (!access) {
        throw new AppError('Lease not found', 404, 'LEASE_NOT_FOUND');
      }
      if (!isParty(access, oxyUserId)) {
        throw new AppError('Access denied - you are not a party to this lease', 403, 'FORBIDDEN');
      }

      const { page, limit, skip } = parsePagination(req.query);
      const { status } = req.query;
      const statuses: readonly string[] = LEASE_PAYMENT_STATUSES;
      const statusFilter =
        typeof status === 'string' && statuses.includes(status)
          ? (status as LeasePaymentStatusValue)
          : undefined;

      const result = await listLeasePayments(
        db,
        req.params.id,
        { status: statusFilter },
        { limit, offset: skip },
      );

      res.json(paginationResponse(
        result.rows.map(serializeLeasePayment),
        page,
        limit,
        result.total,
        'Lease payments retrieved successfully'
      ));
    } catch (error) {
      next(error);
    }
  }

  /**
   * Add a scheduled payment to a lease. Only the landlord may add one.
   */
  async createPayment(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const oxyUserId = requireSessionOxyUserId(req);
      const { dueDate, amount, type, description } = req.body;
      if (!dueDate || amount === undefined || amount === null || !type) {
        throw new AppError('dueDate, amount, and type are required', 400, 'VALIDATION_ERROR');
      }

      const parsedDueDate = new Date(dueDate);
      if (Number.isNaN(parsedDueDate.getTime())) {
        throw new AppError('dueDate must be a valid date', 400, 'VALIDATION_ERROR');
      }
      const parsedAmount = Number(amount);
      if (!Number.isFinite(parsedAmount)) {
        throw new AppError('amount must be a number', 400, 'VALIDATION_ERROR');
      }
      // Narrowed here rather than left to the CHECK: an undeclared type arrives
      // as a `23514` from the driver, which is a 500 where the caller earned a
      // 400 naming the field.
      const types: readonly string[] = LEASE_PAYMENT_TYPES;
      if (typeof type !== 'string' || !types.includes(type)) {
        throw new AppError('type must be one of rent, deposit, fee, utility', 400, 'VALIDATION_ERROR');
      }

      const db = getDb();
      const access = await findLeaseAccess(db, req.params.id);
      if (!access) {
        throw new AppError('Lease not found', 404, 'LEASE_NOT_FOUND');
      }
      if (!isLandlord(access, oxyUserId)) {
        throw new AppError('Access denied - only the landlord can add payments', 403, 'FORBIDDEN');
      }

      const created = await addLeasePayment(db, req.params.id, {
        dueDate: parsedDueDate,
        amount: parsedAmount,
        type: type as (typeof LEASE_PAYMENT_TYPES)[number],
        description: typeof description === 'string' ? description : undefined,
        status: 'pending',
      });

      logger.info('Lease payment created', {
        leaseId: req.params.id,
        paymentId: created.id,
        amount: parsedAmount,
        createdBy: oxyUserId,
      });

      res.status(201).json(successResponse(serializeLeasePayment(created), 'Payment created successfully'));
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get a lease's documents metadata. Only a party may view them.
   */
  async getLeaseDocuments(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const oxyUserId = requireSessionOxyUserId(req);
      const db = getDb();
      const access = await findLeaseAccess(db, req.params.id);
      if (!access) {
        throw new AppError('Lease not found', 404, 'LEASE_NOT_FOUND');
      }
      if (!isParty(access, oxyUserId)) {
        throw new AppError('Access denied - you are not a party to this lease', 403, 'FORBIDDEN');
      }

      const documents = await listLeaseDocuments(db, req.params.id);

      res.json(successResponse(
        documents.map(serializeLeaseDocument),
        'Lease documents retrieved successfully'
      ));
    } catch (error) {
      next(error);
    }
  }

  /**
   * `POST /api/leases/:id/documents` — attach a tenancy document (#518 §7.4).
   *
   * ## The file arrives HERE now, and no URL does
   *
   * This used to take `{name, url, type}` as JSON and store whatever string
   * `url` held, having checked only that it was truthy. The client uploaded the
   * file to the ordinary image endpoint first and posted the resulting
   * `/api/images/file/<key>` link back — so a lease document was delivered by
   * the PUBLIC route, and, on top of that, any party could point a lease row at
   * any URL they liked, including somebody else's object or an attacker's host.
   * Both halves close by the file coming through this handler: the bytes are
   * stored under a server-built private key, and nothing in the body names a
   * location any more.
   *
   * ## A tenancy contract is usually a PDF
   *
   * So a PDF is stored verbatim (`uploadPrivateDocument`) and an image is
   * re-encoded (`uploadPrivateImage`, which drops the EXIF a phone writes into
   * a photographed inspection). Forcing the PDF through Sharp would either
   * throw or quietly turn a twelve-page contract into a picture of page one.
   *
   * ## Order: authorize, then store, then record
   *
   * The party check runs before any object is written, so a stranger's upload
   * never reaches the bucket. The row is written last — an orphaned object
   * costs storage, while a row pointing at bytes that were never stored is a
   * document that silently never opens.
   */
  async uploadLeaseDocument(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const oxyUserId = requireSessionOxyUserId(req);
      const file = (req as unknown as { file?: UploadedDocumentFile }).file;
      if (!file) {
        throw new AppError('A document file is required', 400, 'VALIDATION_ERROR');
      }
      const extension = LEASE_DOCUMENT_EXTENSIONS[file.mimetype];
      if (!extension) {
        // The router's `fileFilter` refuses these first; this is the second
        // gate, so the mime map and the allowlist cannot drift into a type that
        // reaches storage with no extension to serve it back under.
        throw new AppError('Unsupported document type', 400, 'VALIDATION_ERROR');
      }

      const db = getDb();
      const access = await findLeaseAccess(db, req.params.id);
      if (!access) {
        throw new AppError('Lease not found', 404, 'LEASE_NOT_FOUND');
      }
      if (!isParty(access, oxyUserId)) {
        throw new AppError('Access denied - you are not a party to this lease', 403, 'FORBIDDEN');
      }

      const documentTypes: readonly string[] = LEASE_DOCUMENT_TYPES;
      const rawType = req.body?.type;
      const documentType =
        typeof rawType === 'string' && documentTypes.includes(rawType)
          ? (rawType as (typeof LEASE_DOCUMENT_TYPES)[number])
          : 'other';

      const rawName = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
      const name = safeDocumentName(rawName.length > 0 ? rawName : file.originalname);

      const stored =
        file.mimetype === 'application/pdf'
          ? await imageUploadService.uploadPrivateDocument(
              file.buffer,
              file.mimetype,
              `leases/${req.params.id}`,
              extension,
            )
          : await imageUploadService.uploadPrivateImage(
              file.buffer,
              file.mimetype,
              `leases/${req.params.id}`,
            );

      const created = await addLeaseDocument(db, req.params.id, {
        name,
        // The column holds a URL and this change carries no migration, so the
        // key travels inside the delivery-route shape `storedDocumentKey`
        // already reads — the same shape every application document carries.
        // Nothing SERVES that URL: it starts `private/`, which the public route
        // refuses. A `storage_key` column would be the better model and is
        // recorded as follow-up work rather than smuggled in here.
        url: imageUploadService.getImageUrl(stored.key),
        type: documentType,
        // Server-resolved, never from the body: `uploadedBy` is the one field on
        // a document that says who is accountable for it.
        uploadedByOxyUserId: oxyUserId,
        uploadedDate: new Date(),
      });

      logger.info('Lease document added', {
        leaseId: req.params.id,
        documentId: created.id,
        contentType: stored.contentType,
        bytes: stored.bytes,
        uploadedBy: oxyUserId,
      });

      res
        .status(201)
        .json(successResponse(serializeLeaseDocument(created), 'Document added successfully'));
    } catch (error) {
      next(error);
    }
  }

  /**
   * `GET /api/leases/:id/documents/:documentId` — one document's bytes, to a
   * party to the lease and to nobody else (#518 §7.4).
   *
   * Four things in order, the order `getApplicationDocument` uses:
   *
   *  1. The session says who is asking.
   *  2. That person is the landlord, the tenant or a co-tenant. Anybody else
   *     gets **404**, not 403 — "there is a tenancy here and you may not read
   *     it" tells a stranger the lease exists, which is itself a fact about two
   *     named people and an address. The sibling endpoints on this controller
   *     answer 403, and they are about a lease the caller already holds an id
   *     for from a list that was itself authorized; this one is reached by
   *     guessing a URL.
   *  3. The document belongs to THAT lease — enforced in the repository query,
   *     so an id from another tenancy resolves to nothing.
   *  4. Only then are the bytes read, with the key taken from the row rather
   *     than from the request.
   *
   * Base64 in the ordinary envelope, for the reason `applicationController`
   * gives at length: the Oxy linked client owns auth and is JSON-only, and
   * `AGENTS.md` forbids a second manual token path. The upload is capped, so
   * the response is bounded. `Cache-Control: private, no-store`, because moving
   * a tenancy agreement off the public route buys nothing if a proxy keeps a
   * copy of it.
   */
  async getLeaseDocument(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const oxyUserId = requireSessionOxyUserId(req);
      const db = getDb();

      const access = await findLeaseAccess(db, req.params.id);
      // One 404 for "no such lease" and for "not yours", written once so the
      // two cannot drift into distinguishable answers.
      if (!access || !isParty(access, oxyUserId)) {
        throw new AppError('Document not found', 404, 'NOT_FOUND');
      }

      const document = await findLeaseDocument(db, req.params.id, String(req.params.documentId));
      if (!document) {
        throw new AppError('Document not found', 404, 'NOT_FOUND');
      }

      const key = storedDocumentKey(document.url, {
        bucketName: config.s3.bucketName,
        endpoint: config.s3.endpoint,
      });
      const file = key ? await imageUploadService.readPrivateDocument(key) : null;
      if (!file) {
        // A row whose URL names nothing we store, or an object that is gone.
        // Both are "there is nothing to give you" and neither says which.
        throw new AppError('Document not found', 404, 'NOT_FOUND');
      }

      res.setHeader('Cache-Control', 'private, no-store');
      res.json(
        successResponse(
          {
            id: document.id,
            type: document.type,
            filename: downloadFilename(document.name, file.contentType),
            contentType: file.contentType,
            /** The document's bytes. The client writes or opens them itself. */
            base64: file.buffer.toString('base64'),
          },
          'Document retrieved',
        ),
      );
    } catch (error) {
      next(error);
    }
  }
}

export default new LeaseController();
