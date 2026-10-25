import { sessionFileRequester } from '../services/files/requester';
/**
 * Lease Controller — the HTTP adapter over `domain/leases.ts` and the
 * obligation half of `domain/payments.ts`.
 *
 * Every rule (who is a party, who may edit/sign/renew, the field whitelist, the
 * document upload contract) lives in the domain modules, which the catalogue
 * tools call too. This file reads the request, calls the use case and writes
 * the response the routes have always written. Persistence is
 * `db/leases/leaseReads.ts`; the port notes that used to head this file are in
 * that module and in `domain/leases.ts`.
 */

import type { Request, Response, NextFunction } from 'express';

import {
  createLeaseDirect,
  deleteLease,
  getLease,
  listLeaseDocuments,
  listMyLeases,
  readLeaseDocument,
  renewLease,
  signLease,
  terminateLease,
  updateLease,
  uploadLeaseDocument,
  type UploadedLeaseDocumentFile,
} from '../domain/leases';
import { createLeasePaymentObligation, listLeasePayments } from '../domain/payments';
import { successResponse, paginationResponse } from '../middlewares/errorHandler';
import { requireSessionOxyUserId } from '../utils/sessionUser';

class LeaseController {
  /** Get the session person's leases (as landlord, tenant, or co-tenant). */
  async getLeases(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const oxyUserId = requireSessionOxyUserId(req);
      const { page, limit, status, propertyId } = req.query;
      const result = await listMyLeases(oxyUserId, { page, limit, status, propertyId });
      res.json(
        paginationResponse(
          result.leases,
          result.page,
          result.limit,
          result.total,
          'Leases retrieved successfully',
        ),
      );
    } catch (error) {
      next(error);
    }
  }

  /** Create a new lease. The requester must own the referenced property. */
  async createLease(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const oxyUserId = requireSessionOxyUserId(req);
      const lease = await createLeaseDirect(oxyUserId, req.body ?? {});
      res.status(201).json(successResponse(lease, 'Lease created successfully'));
    } catch (error) {
      next(error);
    }
  }

  /** Get a lease by ID. Only a party (landlord, tenant, or co-tenant) may view it. */
  async getLeaseById(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const oxyUserId = requireSessionOxyUserId(req);
      const lease = await getLease(oxyUserId, req.params.id);
      res.json(successResponse(lease, 'Lease retrieved successfully'));
    } catch (error) {
      next(error);
    }
  }

  /** Update a lease: the landlord only, while a draft or awaiting signatures. */
  async updateLease(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const oxyUserId = requireSessionOxyUserId(req);
      const lease = await updateLease(oxyUserId, req.params.id, req.body ?? {});
      res.json(successResponse(lease, 'Lease updated successfully'));
    } catch (error) {
      next(error);
    }
  }

  /** Delete a lease: the landlord only, while a draft or awaiting signatures. */
  async deleteLease(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const oxyUserId = requireSessionOxyUserId(req);
      await deleteLease(oxyUserId, req.params.id);
      res.json(successResponse(null, 'Lease deleted successfully'));
    } catch (error) {
      next(error);
    }
  }

  /**
   * `POST /api/leases/:id/sign` — sign a lease (#518 §7.4, #519 §7.4) from the
   * seat the session holds on it. `termsSha256` binds the signature to the
   * terms on screen (409 when they changed).
   */
  async signLease(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const oxyUserId = requireSessionOxyUserId(req);
      const { acceptTerms, termsSha256 } = req.body;
      const lease = await signLease(oxyUserId, req.params.id, { acceptTerms, termsSha256 });
      res.json(successResponse(lease, 'Lease signed successfully'));
    } catch (error) {
      next(error);
    }
  }

  /** Terminate a lease. Only a party may terminate. */
  async terminateLease(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const oxyUserId = requireSessionOxyUserId(req);
      const { reason, effectiveDate } = req.body;
      const lease = await terminateLease(oxyUserId, req.params.id, { reason, effectiveDate });
      res.json(successResponse(lease, 'Lease terminated successfully'));
    } catch (error) {
      next(error);
    }
  }

  /** Renew a lease into a new draft. Only the landlord may renew. */
  async renewLease(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const oxyUserId = requireSessionOxyUserId(req);
      const { newEndDate, monthlyRent, startDate } = req.body;
      const lease = await renewLease(oxyUserId, req.params.id, {
        newEndDate,
        monthlyRent,
        startDate,
      });
      res.status(201).json(successResponse(lease, 'Lease renewal created successfully'));
    } catch (error) {
      next(error);
    }
  }

  /** Get a lease's payment schedule. Only a party may view it. */
  async getLeasePayments(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const oxyUserId = requireSessionOxyUserId(req);
      const { page, limit, status } = req.query;
      const result = await listLeasePayments(oxyUserId, req.params.id, { page, limit, status });
      res.json(
        paginationResponse(
          result.payments,
          result.page,
          result.limit,
          result.total,
          'Lease payments retrieved successfully',
        ),
      );
    } catch (error) {
      next(error);
    }
  }

  /** Add a scheduled payment to a lease. Only the landlord may add one. */
  async createPayment(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const oxyUserId = requireSessionOxyUserId(req);
      const { dueDate, amount, type, description } = req.body;
      const payment = await createLeasePaymentObligation(oxyUserId, req.params.id, {
        dueDate,
        amount,
        type,
        description,
      });
      res.status(201).json(successResponse(payment, 'Payment created successfully'));
    } catch (error) {
      next(error);
    }
  }

  /** Get a lease's documents metadata. Only a party may view them. */
  async getLeaseDocuments(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const oxyUserId = requireSessionOxyUserId(req);
      const documents = await listLeaseDocuments(oxyUserId, req.params.id);
      res.json(successResponse(documents, 'Lease documents retrieved successfully'));
    } catch (error) {
      next(error);
    }
  }

  /**
   * `POST /api/leases/:id/documents` — attach a tenancy document (#518 §7.4).
   * The FILE arrives here (multer), never a URL.
   */
  async uploadLeaseDocument(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const oxyUserId = requireSessionOxyUserId(req);
      const file = (req as unknown as { file?: UploadedLeaseDocumentFile }).file;
      const document = await uploadLeaseDocument(oxyUserId, req.params.id, {
        file,
        requester: sessionFileRequester(req),
        type: req.body?.type,
        name: req.body?.name,
      });
      res.status(201).json(successResponse(document, 'Document added successfully'));
    } catch (error) {
      next(error);
    }
  }

  /**
   * `GET /api/leases/:id/documents/:documentId` — one document's bytes, to a
   * party and nobody else (404 otherwise). Base64 in the ordinary envelope;
   * `Cache-Control: private, no-store`.
   */
  async getLeaseDocument(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const oxyUserId = requireSessionOxyUserId(req);
      const document = await readLeaseDocument(
        oxyUserId,
        req.params.id,
        String(req.params.documentId),
      );
      res.setHeader('Cache-Control', 'private, no-store');
      res.json(successResponse(document, 'Document retrieved'));
    } catch (error) {
      next(error);
    }
  }
}

export default new LeaseController();
