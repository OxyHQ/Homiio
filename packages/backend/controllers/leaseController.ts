/**
 * Lease Controller
 * Handles lease management operations with real persistence via the Lease model.
 */

import type { Request, Response, NextFunction } from 'express';
import { LeaseStatus } from '@homiio/shared-types';

import { successResponse, paginationResponse, AppError } from '../middlewares/errorHandler';
import { logger } from '../middlewares/logging';

import { Lease, Property } from '../models';
import type { ILease } from '../models';
import { requireSessionOxyUserId } from '../utils/sessionUser';
import { pickFields } from '../utils/pickFields';
import { CREATABLE_LEASE_FIELDS, EDITABLE_LEASE_FIELDS } from './lease/editableFields';
import { toLeaseDTO, refToId } from './lease/toLeaseDTO';
import { notificationDispatchService } from '../services/notificationDispatchService';

const MAX_PAGE_SIZE = 100;
const DEFAULT_PAGE_SIZE = 10;

const EDITABLE_STATUSES: ReadonlyArray<string> = [LeaseStatus.DRAFT, LeaseStatus.PENDING_SIGNATURES];
const DELETABLE_STATUSES: ReadonlyArray<string> = [LeaseStatus.DRAFT, LeaseStatus.PENDING_SIGNATURES];

/** Reference paths populated on list/detail reads so the DTO can carry nested docs. */
const LEASE_POPULATE = ['propertyId'];

function parsePagination(query: Request['query']): { page: number; limit: number; skip: number } {
  const rawPage = parseInt(String(query.page ?? ''), 10);
  const rawLimit = parseInt(String(query.limit ?? ''), 10);
  const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1;
  const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, MAX_PAGE_SIZE) : DEFAULT_PAGE_SIZE;
  return { page, limit, skip: (page - 1) * limit };
}

function isLandlord(lease: ILease, oxyUserId: string): boolean {
  return refToId(lease.landlordOxyUserId) === oxyUserId;
}

function isTenant(lease: ILease, oxyUserId: string): boolean {
  if (refToId(lease.tenantOxyUserId) === oxyUserId) {
    return true;
  }
  const coTenants = (lease.coTenants || []) as Array<{ oxyUserId?: unknown }>;
  return coTenants.some((ct) => refToId(ct.oxyUserId) === oxyUserId);
}

function isParty(lease: ILease, oxyUserId: string): boolean {
  return isLandlord(lease, oxyUserId) || isTenant(lease, oxyUserId);
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

      const filter: Record<string, unknown> = {
        $or: [
          { landlordOxyUserId: oxyUserId },
          { tenantOxyUserId: oxyUserId },
          { 'coTenants.oxyUserId': oxyUserId },
        ],
      };
      if (status) {
        filter.status = status;
      }
      if (propertyId) {
        filter.propertyId = propertyId;
      }

      const [leases, total] = await Promise.all([
        Lease.find(filter).populate(LEASE_POPULATE).sort({ createdAt: -1 }).skip(skip).limit(limit),
        Lease.countDocuments(filter),
      ]);

      res.json(paginationResponse(
        leases.map(toLeaseDTO),
        page,
        limit,
        total,
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

      const property = await Property.findById(propertyId);
      if (!property) {
        throw new AppError('Property not found', 404, 'PROPERTY_NOT_FOUND');
      }
      if (!property.oxyUserId || property.oxyUserId.toString() !== oxyUserId) {
        throw new AppError('Access denied - you can only create leases for your own properties', 403, 'FORBIDDEN');
      }

      const leaseData = pickFields<Record<string, unknown>>(req.body, CREATABLE_LEASE_FIELDS);
      const lease = await Lease.create({
        ...leaseData,
        propertyId,
        tenantOxyUserId,
        landlordOxyUserId: oxyUserId,
        status: LeaseStatus.DRAFT,
      });

      logger.info('Lease created', {
        leaseId: lease._id.toString(),
        landlordOxyUserId: oxyUserId,
        propertyId: String(propertyId),
      });

      res.status(201).json(successResponse(toLeaseDTO(lease), 'Lease created successfully'));
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
      const lease = await Lease.findById(req.params.id).populate(LEASE_POPULATE);
      if (!lease) {
        throw new AppError('Lease not found', 404, 'LEASE_NOT_FOUND');
      }
      if (!isParty(lease, oxyUserId)) {
        throw new AppError('Access denied - you are not a party to this lease', 403, 'FORBIDDEN');
      }

      res.json(successResponse(toLeaseDTO(lease), 'Lease retrieved successfully'));
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
      const lease = await Lease.findById(req.params.id);
      if (!lease) {
        throw new AppError('Lease not found', 404, 'LEASE_NOT_FOUND');
      }
      if (!isLandlord(lease, oxyUserId)) {
        throw new AppError('Access denied - only the landlord can update this lease', 403, 'FORBIDDEN');
      }
      if (!EDITABLE_STATUSES.includes(lease.status)) {
        throw new AppError('Cannot update a lease that is signed, active, or closed', 409, 'LEASE_NOT_EDITABLE');
      }

      const updates = pickFields<Record<string, unknown>>(req.body, EDITABLE_LEASE_FIELDS);
      Object.assign(lease, updates);
      await lease.save();

      logger.info('Lease updated', {
        leaseId: lease._id.toString(),
        updatedBy: oxyUserId,
      });

      res.json(successResponse(toLeaseDTO(lease), 'Lease updated successfully'));
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
      const lease = await Lease.findById(req.params.id);
      if (!lease) {
        throw new AppError('Lease not found', 404, 'LEASE_NOT_FOUND');
      }
      if (!isLandlord(lease, oxyUserId)) {
        throw new AppError('Access denied - only the landlord can delete this lease', 403, 'FORBIDDEN');
      }
      if (!DELETABLE_STATUSES.includes(lease.status)) {
        throw new AppError('Cannot delete a lease that is signed, active, or closed', 409, 'LEASE_NOT_DELETABLE');
      }

      await lease.deleteOne();

      logger.info('Lease deleted', {
        leaseId: lease._id.toString(),
        deletedBy: oxyUserId,
      });

      res.json(successResponse(null, 'Lease deleted successfully'));
    } catch (error) {
      next(error);
    }
  }

  /**
   * Sign a lease. The requester must be the landlord or tenant. Records the
   * signature; the schema's pre-save hook transitions the lease to active once
   * both parties have signed.
   */
  async signLease(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const oxyUserId = requireSessionOxyUserId(req);
      const { acceptTerms, signature } = req.body;
      if (!acceptTerms) {
        throw new AppError('Must accept terms to sign lease', 400, 'TERMS_NOT_ACCEPTED');
      }

      const lease = await Lease.findById(req.params.id);
      if (!lease) {
        throw new AppError('Lease not found', 404, 'LEASE_NOT_FOUND');
      }

      const ipAddress = req.ip;
      let counterpartyOxyUserId: string | undefined;
      if (isLandlord(lease, oxyUserId)) {
        await lease.signAsLandlord(ipAddress, signature);
        counterpartyOxyUserId = refToId(lease.tenantOxyUserId);
      } else if (refToId(lease.tenantOxyUserId) === oxyUserId) {
        await lease.signAsTenant(ipAddress, signature);
        counterpartyOxyUserId = refToId(lease.landlordOxyUserId);
      } else {
        throw new AppError('Access denied - you are not a party to this lease', 403, 'FORBIDDEN');
      }

      logger.info('Lease signed', {
        leaseId: lease._id.toString(),
        signedBy: oxyUserId,
      });

      // Notify the counterparty: either the lease is now fully signed/active,
      // or it awaits their signature. Best-effort — never blocks the response.
      const leaseId = lease._id.toString();
      const isActive = lease.status === LeaseStatus.ACTIVE;
      await notificationDispatchService.createForUser(counterpartyOxyUserId, {
        type: 'contract',
        title: isActive ? 'Lease is now active' : 'Lease awaiting your signature',
        message: isActive
          ? 'Both parties have signed. Your lease is now active.'
          : 'The other party signed the lease. Review and sign to activate it.',
        priority: isActive ? 'medium' : 'high',
        data: { leaseId, screen: '/contracts', propertyId: refToId(lease.propertyId) },
      });

      res.json(successResponse(toLeaseDTO(lease), 'Lease signed successfully'));
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
      const lease = await Lease.findById(req.params.id);
      if (!lease) {
        throw new AppError('Lease not found', 404, 'LEASE_NOT_FOUND');
      }
      if (!isParty(lease, oxyUserId)) {
        throw new AppError('Access denied - you are not a party to this lease', 403, 'FORBIDDEN');
      }
      if (lease.status === LeaseStatus.TERMINATED) {
        throw new AppError('Lease is already terminated', 409, 'LEASE_ALREADY_TERMINATED');
      }

      lease.terminationNotice = {
        givenBy: oxyUserId,
        givenDate: new Date(),
        effectiveDate: effectiveDate ? new Date(effectiveDate) : new Date(),
        reason: reason,
        acknowledged: false,
      };
      lease.status = LeaseStatus.TERMINATED;
      await lease.save();

      logger.info('Lease terminated', {
        leaseId: lease._id.toString(),
        terminatedBy: oxyUserId,
        reason: reason,
      });

      res.json(successResponse(toLeaseDTO(lease), 'Lease terminated successfully'));
    } catch (error) {
      next(error);
    }
  }

  /**
   * Renew a lease by creating a new lease document linked to the original via
   * roomId/property and inheriting its terms with a new end date. Only the
   * landlord may renew.
   */
  async renewLease(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const oxyUserId = requireSessionOxyUserId(req);
      const { newEndDate, monthlyRent, startDate } = req.body;
      if (!newEndDate) {
        throw new AppError('newEndDate is required', 400, 'VALIDATION_ERROR');
      }

      const original = await Lease.findById(req.params.id);
      if (!original) {
        throw new AppError('Lease not found', 404, 'LEASE_NOT_FOUND');
      }
      if (!isLandlord(original, oxyUserId)) {
        throw new AppError('Access denied - only the landlord can renew this lease', 403, 'FORBIDDEN');
      }

      const source = original.toObject() as Record<string, unknown>;
      delete source._id;
      delete source.id;
      delete source.createdAt;
      delete source.updatedAt;
      delete source.signatures;
      delete source.paymentSchedule;
      delete source.terminationNotice;
      delete source.inspections;
      const sourceLeaseTerms = (source.leaseTerms || {}) as { endDate?: Date };
      const sourceRentDetails = (source.rentDetails || {}) as { monthlyRent?: number };

      const originalLeaseTerms = (original.leaseTerms || {}) as { endDate?: Date };
      const renewal = await Lease.create({
        ...source,
        status: LeaseStatus.DRAFT,
        leaseTerms: {
          ...sourceLeaseTerms,
          startDate: startDate ? new Date(startDate) : originalLeaseTerms.endDate,
          endDate: new Date(newEndDate),
        },
        rentDetails: {
          ...sourceRentDetails,
          monthlyRent: monthlyRent !== undefined ? monthlyRent : sourceRentDetails.monthlyRent,
        },
      });

      logger.info('Lease renewal created', {
        originalLeaseId: original._id.toString(),
        renewalLeaseId: renewal._id.toString(),
        createdBy: oxyUserId,
      });

      res.status(201).json(successResponse(toLeaseDTO(renewal), 'Lease renewal created successfully'));
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
      const lease = await Lease.findById(req.params.id);
      if (!lease) {
        throw new AppError('Lease not found', 404, 'LEASE_NOT_FOUND');
      }
      if (!isParty(lease, oxyUserId)) {
        throw new AppError('Access denied - you are not a party to this lease', 403, 'FORBIDDEN');
      }

      const { page, limit, skip } = parsePagination(req.query);
      const { status } = req.query;
      let schedule: Array<Record<string, unknown>> = (lease.paymentSchedule || []).map(
        p => ({ ...p.toJSON(), id: refToId(p._id) })
      );
      if (status) {
        schedule = schedule.filter(p => p.status === status);
      }
      const total = schedule.length;
      const pageItems = schedule.slice(skip, skip + limit);

      res.json(paginationResponse(
        pageItems,
        page,
        limit,
        total,
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

      const lease = await Lease.findById(req.params.id);
      if (!lease) {
        throw new AppError('Lease not found', 404, 'LEASE_NOT_FOUND');
      }
      if (!isLandlord(lease, oxyUserId)) {
        throw new AppError('Access denied - only the landlord can add payments', 403, 'FORBIDDEN');
      }

      lease.paymentSchedule.push({
        dueDate: new Date(dueDate),
        amount,
        type,
        description,
        status: 'pending',
      });
      await lease.save();

      const created = lease.paymentSchedule[lease.paymentSchedule.length - 1];

      logger.info('Lease payment created', {
        leaseId: lease._id.toString(),
        paymentId: created._id.toString(),
        amount,
        createdBy: oxyUserId,
      });

      res.status(201).json(successResponse({ ...created.toJSON(), id: refToId(created._id) }, 'Payment created successfully'));
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
      const lease = await Lease.findById(req.params.id);
      if (!lease) {
        throw new AppError('Lease not found', 404, 'LEASE_NOT_FOUND');
      }
      if (!isParty(lease, oxyUserId)) {
        throw new AppError('Access denied - you are not a party to this lease', 403, 'FORBIDDEN');
      }

      res.json(successResponse(
        (lease.documents || []).map(doc => ({ ...doc.toJSON(), id: refToId(doc._id) })),
        'Lease documents retrieved successfully'
      ));
    } catch (error) {
      next(error);
    }
  }

  /**
   * Attach a document to a lease. Stores document metadata (name, url, type).
   * The caller supplies the already-uploaded file URL; no inline file storage
   * is wired for lease documents. Only a party may attach a document.
   */
  async uploadLeaseDocument(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const oxyUserId = requireSessionOxyUserId(req);
      const { name, url, type } = req.body;
      if (!name || !url) {
        throw new AppError('Document name and url are required', 400, 'VALIDATION_ERROR');
      }

      const lease = await Lease.findById(req.params.id);
      if (!lease) {
        throw new AppError('Lease not found', 404, 'LEASE_NOT_FOUND');
      }
      if (!isParty(lease, oxyUserId)) {
        throw new AppError('Access denied - you are not a party to this lease', 403, 'FORBIDDEN');
      }

      lease.documents.push({
        name,
        url,
        type: type || 'other',
        uploadedBy: oxyUserId,
        uploadedDate: new Date(),
      });
      await lease.save();

      const created = lease.documents[lease.documents.length - 1];

      logger.info('Lease document added', {
        leaseId: lease._id.toString(),
        documentId: created._id.toString(),
        uploadedBy: oxyUserId,
      });

      res.status(201).json(successResponse({ ...created.toJSON(), id: refToId(created._id) }, 'Document added successfully'));
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new LeaseController();
