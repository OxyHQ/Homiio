/**
 * Tenant Application Controller — the HTTP adapter over `domain/applications.ts`.
 *
 * Every rule (who may apply, who may decide, the lease bridge, the document
 * upload contract) lives in the domain module, which the catalogue tools call
 * too. This file reads the request, calls the use case and writes the
 * response the routes have always written.
 *
 * Status transitions: submitted -> reviewing -> approved | rejected
 *                     submitted -> withdrawn (applicant)
 */

import type { Request, Response, NextFunction } from 'express';

import {
  changeApplicationStatus,
  createLeaseFromApplication,
  getApplication,
  listMyApplications,
  readApplicationDocument,
  submitApplication,
  verifyApplicationDocument,
  type UploadedApplicationFile,
} from '../domain/applications';
import { AppError, successResponse, paginationResponse } from '../middlewares/errorHandler';
import { requireSessionOxyUserId } from '../utils/sessionUser';

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
   *
   * An external listing answers 400 `EXTERNAL_PROPERTY`, as it always has.
   */
  async createApplication(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const oxyUserId = requireSessionOxyUserId(req);
      const body = req.body || {};
      const files: UploadedApplicationFile[] = Array.isArray(req.files)
        ? (req.files as UploadedApplicationFile[])
        : [];
      const outcome = await submitApplication(oxyUserId, {
        propertyId: body.propertyId,
        moveInDate: body.moveInDate,
        leaseTermMonths: body.leaseTermMonths,
        monthlyIncome: body.monthlyIncome,
        employmentStatus: body.employmentStatus,
        notes: body.notes,
        referenceContacts: body.referenceContacts,
        documents: body.documents,
        documentTypes: body.documentTypes,
        files,
      });
      if (outcome.kind === 'external_listing') {
        throw new AppError('Cannot apply to external listings', 400, 'EXTERNAL_PROPERTY');
      }
      res.status(201).json(successResponse(outcome.application, 'Application submitted'));
    } catch (error) {
      next(error);
    }
  }

  /**
   * GET /api/applications
   * List mine. Filter by role with ?asLandlord=true.
   */
  async listMyApplications(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const oxyUserId = requireSessionOxyUserId(req);
      const { page, limit, status, asLandlord } = req.query;
      const result = await listMyApplications(oxyUserId, { page, limit, status, asLandlord });
      res.json(
        paginationResponse(
          result.applications,
          result.page,
          result.limit,
          result.total,
          'Applications retrieved',
        ),
      );
    } catch (error) {
      next(error);
    }
  }

  /**
   * `GET /api/applications/:id/documents/:documentId` — the bytes of ONE
   * attached document, to the two people entitled to them.
   *
   * On the AUTHENTICATED router: that placement is the authorization decision
   * (`AGENTS.md`). These documents used to be delivered by `routes/public.ts`.
   * Base64 in the ordinary envelope because the Oxy linked client owns auth and
   * is JSON-only; `Cache-Control: private, no-store` so no proxy keeps a copy.
   */
  async getApplicationDocument(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id, documentId } = req.params as { id: string; documentId: string };
      const oxyUserId = requireSessionOxyUserId(req);
      const document = await readApplicationDocument(oxyUserId, id, documentId);
      res.setHeader('Cache-Control', 'private, no-store');
      res.json(successResponse(document, 'Document retrieved'));
    } catch (error) {
      next(error);
    }
  }

  /**
   * `POST /api/applications/:id/documents/:documentId/verification` — the
   * landlord says whether a document is what they asked for.
   */
  async verifyApplicationDocument(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const oxyUserId = requireSessionOxyUserId(req);
      const { id, documentId } = req.params as { id: string; documentId: string };
      const body = req.body as { status?: unknown; reason?: unknown };
      const application = await verifyApplicationDocument(oxyUserId, {
        applicationId: id,
        documentId,
        status: body.status,
        reason: body.reason,
      });
      res.json(successResponse(application, 'Document verification updated'));
    } catch (error) {
      next(error);
    }
  }

  /** GET /api/applications/:id */
  async getApplicationById(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const oxyUserId = requireSessionOxyUserId(req);
      const application = await getApplication(oxyUserId, req.params.id);
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
  async updateApplicationStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const oxyUserId = requireSessionOxyUserId(req);
      const { status, notes } = req.body;
      const application = await changeApplicationStatus(oxyUserId, req.params.id, {
        status,
        notes,
      });
      res.json(successResponse(application, 'Application updated'));
    } catch (error) {
      next(error);
    }
  }

  /**
   * POST /api/applications/:id/create-lease
   *
   * Landlord-only bridge: turn an APPROVED application into a DRAFT lease.
   */
  async createLeaseFromApplication(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const oxyUserId = requireSessionOxyUserId(req);
      const lease = await createLeaseFromApplication(oxyUserId, req.params.id);
      res.status(201).json(successResponse(lease, 'Lease draft created from application'));
    } catch (error) {
      next(error);
    }
  }
}

export default new ApplicationController();
