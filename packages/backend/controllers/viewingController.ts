/**
 * Viewing Controller
 * Handles viewing request lifecycle (create, list, approve, decline, cancel).
 *
 * Persisted in PostgreSQL (`db/schema/bookings.ts`, read and written through
 * `db/bookings/viewingReads.ts`).
 *
 * ## What the port changed
 *
 * **`cancelledBy` and `status` move in one statement.**
 * `viewing_requests_cancelled_by_status_check` makes them an equivalence, so a
 * cancellation that failed to record WHO cancelled is now a `23514` rather than
 * a row nobody can attribute. The repository is the only writer of either.
 *
 * **Every transition carries its precondition in the `UPDATE`'s predicate.**
 * The Mongoose version read the document, checked `status === 'pending'` in JS,
 * assigned and saved — a window in which two owners could both approve. The
 * read is still there, because it is what decides WHICH error the caller sees
 * (404 vs 403 vs 400), but the write no longer trusts it.
 *
 * **The property read is a narrow projection**
 * (`db/properties/propertyBookingBasis.ts`): the questions are "is this
 * bookable?" and "who owns it?", and a viewing request is not a listing page.
 */

import type { Request, Response, NextFunction } from 'express';

import { PropertyStatus } from '@homiio/shared-types';
import { getDb } from '../db/postgres';
import {
  cancelViewing,
  createViewing,
  decideViewing,
  findActiveViewingForRequester,
  findViewingAtInstant,
  findViewingById,
  isViewingStatus,
  listViewings,
  rescheduleViewing,
  serializeViewing,
} from '../db/bookings/viewingReads';
import { findPropertyBookingBasis } from '../db/properties/propertyBookingBasis';
import { logger } from '../middlewares/logging';
import { AppError, successResponse, paginationResponse } from '../middlewares/errorHandler';
import { notificationDispatchService } from '../services/notificationDispatchService';

/** Resolve the caller from the session, in the shape the auth layer sets. */
function callerOf(req: Request): string | undefined {
  return req.user?.id || req.user?._id || req.userId || undefined;
}

function parsePagination(query: Request['query']): { page: number; limit: number; skip: number } {
  const page = parseInt(String(query.page ?? ''), 10) || 1;
  const limit = parseInt(String(query.limit ?? ''), 10) || 10;
  return { page, limit, skip: (page - 1) * limit };
}

/**
 * Build the scheduled instant from a `YYYY-MM-DD` date and an `HH:mm` time.
 *
 * `new Date('2026-01-01T10:00')` — no zone suffix — is parsed in the SERVER's
 * local zone. That is what the Mongoose handler did and it is preserved, which
 * is the opposite call to the lease payment schedule and deliberately so: there,
 * the zone silently changed a COMPUTED series of instalments; here it fixes one
 * instant a human picked, nothing is derived from it, and re-anchoring it to UTC
 * would move every appointment by the server's offset.
 */
function toScheduledAt(date: unknown, time: unknown): Date | undefined {
  if (typeof date !== 'string' || typeof time !== 'string') return undefined;
  const parsed = new Date(`${date}T${time}`);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

class ViewingController {
  /**
   * Create a new viewing request for a property
   */
  async createViewingRequest(req: Request, res: Response, next: NextFunction): Promise<void | Response> {
    try {
      const { propertyId } = req.params;
      const { date, time, message } = req.body;

      const oxyUserId = callerOf(req);
      if (!oxyUserId) {
        return next(new AppError('Authentication required', 401, 'AUTHENTICATION_REQUIRED'));
      }

      const db = getDb();
      const property = await findPropertyBookingBasis(db, propertyId);
      if (!property) return next(new AppError('Property not found', 404, 'NOT_FOUND'));
      if (property.status !== PropertyStatus.PUBLISHED) return next(new AppError('Property is not active', 400, 'PROPERTY_INACTIVE'));
      if (property.isExternal) return next(new AppError('Cannot book viewings for external properties', 400, 'EXTERNAL_PROPERTY'));

      const requesterOxyUserId = oxyUserId;
      const ownerOxyUserId = property.oxyUserId;
      if (!ownerOxyUserId) return next(new AppError('Property has no owner', 400, 'INVALID_PROPERTY'));

      // Prevent booking own property
      if (ownerOxyUserId === oxyUserId) {
        return next(new AppError('You cannot book a viewing for your own property', 403, 'FORBIDDEN'));
      }

      const scheduledAt = toScheduledAt(date, time);
      if (!scheduledAt) {
        return next(new AppError('Invalid date or time', 400, 'INVALID_DATETIME'));
      }
      if (scheduledAt.getTime() <= Date.now()) {
        return next(new AppError('Scheduled time must be in the future', 400, 'TIME_IN_PAST'));
      }

      // One active request per person per property.
      const existingActiveForProfile = await findActiveViewingForRequester(
        db,
        propertyId,
        requesterOxyUserId,
      );
      if (existingActiveForProfile) {
        return next(new AppError('You already have an active viewing request for this property', 409, 'ALREADY_REQUESTED'));
      }

      // One active request per property per instant.
      const conflict = await findViewingAtInstant(db, propertyId, scheduledAt);
      if (conflict) {
        return next(new AppError('Time slot is no longer available', 409, 'TIME_CONFLICT'));
      }

      const viewing = await createViewing(db, {
        propertyId,
        requesterOxyUserId,
        ownerOxyUserId,
        scheduledAt,
        message: typeof message === 'string' ? message : undefined,
      });

      logger.info('Viewing request created', { viewingId: viewing.id, propertyId, requesterOxyUserId, ownerOxyUserId });

      // Notify the property owner that someone requested a viewing.
      await notificationDispatchService.createForUser(ownerOxyUserId, {
        type: 'property',
        title: 'New viewing request',
        message: 'Someone requested a viewing for your property.',
        priority: 'high',
        data: { viewingId: viewing.id, propertyId, screen: '/viewings' },
      });

      res.status(201).json(successResponse(serializeViewing(viewing), 'Viewing request created'));
    } catch (error) {
      next(error);
    }
  }

  /**
   * List viewing requests for current user (requester)
   */
  async listMyViewingRequests(req: Request, res: Response, next: NextFunction): Promise<void | Response> {
    try {
      const oxyUserId = callerOf(req);
      if (!oxyUserId) return next(new AppError('Authentication required', 401, 'AUTHENTICATION_REQUIRED'));

      const { status } = req.query;
      const { page, limit, skip } = parsePagination(req.query);

      const result = await listViewings(
        getDb(),
        {
          requesterOxyUserId: oxyUserId,
          status: isViewingStatus(status) ? status : undefined,
        },
        { limit, offset: skip },
      );

      res.json(paginationResponse(result.rows.map(serializeViewing), page, limit, result.total, 'Viewing requests retrieved'));
    } catch (error) {
      next(error);
    }
  }

  /**
   * List viewing requests for a property
   * If requester calls this, returns only their own requests for that property
   * If owner calls this, returns all requests for the property
   */
  async listPropertyViewingRequests(req: Request, res: Response, next: NextFunction): Promise<void | Response> {
    try {
      const { propertyId } = req.params;
      const oxyUserId = callerOf(req);
      if (!oxyUserId) return next(new AppError('Authentication required', 401, 'AUTHENTICATION_REQUIRED'));

      const db = getDb();
      const property = await findPropertyBookingBasis(db, propertyId);
      if (!property) return next(new AppError('Property not found', 404, 'NOT_FOUND'));

      const isOwner = property.oxyUserId === oxyUserId;
      const { status } = req.query;
      const { page, limit, skip } = parsePagination(req.query);

      const result = await listViewings(
        db,
        {
          propertyId,
          // A non-owner sees only their own requests — the scope IS the
          // authorisation, so it belongs in the predicate rather than in a
          // filter applied to the results.
          requesterOxyUserId: isOwner ? undefined : oxyUserId,
          status: isViewingStatus(status) ? status : undefined,
        },
        { limit, offset: skip },
      );

      res.json(paginationResponse(result.rows.map(serializeViewing), page, limit, result.total, 'Viewing requests retrieved'));
    } catch (error) {
      next(error);
    }
  }

  /** Approve a pending viewing request (owner only) */
  async approveViewingRequest(req: Request, res: Response, next: NextFunction): Promise<void | Response> {
    try {
      const { viewingId } = req.params;
      const oxyUserId = callerOf(req);
      if (!oxyUserId) return next(new AppError('Authentication required', 401, 'AUTHENTICATION_REQUIRED'));

      const db = getDb();
      const viewing = await findViewingById(db, viewingId);
      if (!viewing) return next(new AppError('Viewing request not found', 404, 'NOT_FOUND'));

      if (viewing.ownerOxyUserId !== oxyUserId) {
        return next(new AppError('Only the property owner can approve', 403, 'FORBIDDEN'));
      }
      if (viewing.status !== 'pending') {
        return next(new AppError('Only pending requests can be approved', 400, 'INVALID_STATE'));
      }

      // No OTHER approved request may already hold this instant.
      const conflict = await findViewingAtInstant(db, viewing.propertyId, viewing.scheduledAt, {
        excludeId: viewing.id,
        statuses: ['approved'],
      });
      if (conflict) return next(new AppError('Time slot already approved for another request', 409, 'TIME_CONFLICT'));

      const approved = await decideViewing(db, viewingId, oxyUserId, 'approved');
      if (!approved) return next(new AppError('Only pending requests can be approved', 400, 'INVALID_STATE'));

      // Notify the requester that their viewing was approved.
      await notificationDispatchService.createForUser(approved.requesterOxyUserId, {
        type: 'property',
        title: 'Viewing approved',
        message: 'Your viewing request was approved.',
        priority: 'high',
        data: {
          viewingId: approved.id,
          propertyId: approved.propertyId,
          screen: '/viewings',
        },
      });

      res.json(successResponse(serializeViewing(approved), 'Viewing request approved'));
    } catch (error) {
      next(error);
    }
  }

  /** Decline a pending viewing request (owner only) */
  async declineViewingRequest(req: Request, res: Response, next: NextFunction): Promise<void | Response> {
    try {
      const { viewingId } = req.params;
      const oxyUserId = callerOf(req);
      if (!oxyUserId) return next(new AppError('Authentication required', 401, 'AUTHENTICATION_REQUIRED'));

      const db = getDb();
      const viewing = await findViewingById(db, viewingId);
      if (!viewing) return next(new AppError('Viewing request not found', 404, 'NOT_FOUND'));

      if (viewing.ownerOxyUserId !== oxyUserId) {
        return next(new AppError('Only the property owner can decline', 403, 'FORBIDDEN'));
      }
      if (viewing.status !== 'pending') {
        return next(new AppError('Only pending requests can be declined', 400, 'INVALID_STATE'));
      }

      const declined = await decideViewing(db, viewingId, oxyUserId, 'declined');
      if (!declined) return next(new AppError('Only pending requests can be declined', 400, 'INVALID_STATE'));

      // Notify the requester that their viewing was declined.
      await notificationDispatchService.createForUser(declined.requesterOxyUserId, {
        type: 'property',
        title: 'Viewing declined',
        message: 'Your viewing request was declined.',
        priority: 'medium',
        data: {
          viewingId: declined.id,
          propertyId: declined.propertyId,
          screen: '/viewings',
        },
      });

      res.json(successResponse(serializeViewing(declined), 'Viewing request declined'));
    } catch (error) {
      next(error);
    }
  }

  /** Cancel a viewing request (requester or owner) */
  async cancelViewingRequest(req: Request, res: Response, next: NextFunction): Promise<void | Response> {
    try {
      const { viewingId } = req.params;
      const oxyUserId = callerOf(req);
      if (!oxyUserId) return next(new AppError('Authentication required', 401, 'AUTHENTICATION_REQUIRED'));

      const db = getDb();
      const viewing = await findViewingById(db, viewingId);
      if (!viewing) return next(new AppError('Viewing request not found', 404, 'NOT_FOUND'));

      const isRequester = viewing.requesterOxyUserId === oxyUserId;
      const isOwner = viewing.ownerOxyUserId === oxyUserId;
      if (!isRequester && !isOwner) return next(new AppError('Not authorized to cancel this request', 403, 'FORBIDDEN'));

      if (viewing.status === 'cancelled') {
        return res.json(successResponse(serializeViewing(viewing), 'Viewing request already cancelled'));
      }

      // Both columns in one statement — the CHECK is an equivalence.
      const cancelled = await cancelViewing(db, viewingId, isOwner ? 'owner' : 'requester');
      if (!cancelled) {
        // Somebody else cancelled between the read and the write; the outcome
        // the caller asked for already holds, so this is not an error.
        const current = await findViewingById(db, viewingId);
        if (!current) return next(new AppError('Viewing request not found', 404, 'NOT_FOUND'));
        return res.json(successResponse(serializeViewing(current), 'Viewing request already cancelled'));
      }

      // Notify the counterparty that the viewing was cancelled.
      const cancelRecipientOxyUserId = isOwner
        ? cancelled.requesterOxyUserId
        : cancelled.ownerOxyUserId;
      await notificationDispatchService.createForUser(cancelRecipientOxyUserId, {
        type: 'property',
        title: 'Viewing cancelled',
        message: isOwner
          ? 'The owner cancelled a viewing you requested.'
          : 'A viewing request for your property was cancelled.',
        priority: 'medium',
        data: {
          viewingId: cancelled.id,
          propertyId: cancelled.propertyId,
          screen: '/viewings',
        },
      });

      res.json(successResponse(serializeViewing(cancelled), 'Viewing request cancelled'));
    } catch (error) {
      next(error);
    }
  }

  /** Update a pending viewing request (requester only) */
  async updateViewingRequest(req: Request, res: Response, next: NextFunction): Promise<void | Response> {
    try {
      const { viewingId } = req.params;
      const { date, time, message } = req.body;
      const oxyUserId = callerOf(req);

      if (!oxyUserId) {
        return next(new AppError('Authentication required', 401, 'AUTHENTICATION_REQUIRED'));
      }

      const db = getDb();
      const viewing = await findViewingById(db, viewingId);
      if (!viewing) return next(new AppError('Viewing request not found', 404, 'NOT_FOUND'));

      // Only allow updating pending requests
      if (viewing.status !== 'pending') {
        return next(new AppError('Can only modify pending viewing requests', 400, 'CANNOT_MODIFY'));
      }

      // Only allow requester to modify
      if (viewing.requesterOxyUserId !== oxyUserId) {
        return next(new AppError('Not authorized to modify this viewing request', 403, 'FORBIDDEN'));
      }

      const scheduledAt = toScheduledAt(date, time);
      if (!scheduledAt) {
        return next(new AppError('Invalid date or time', 400, 'INVALID_DATETIME'));
      }
      if (scheduledAt.getTime() <= Date.now()) {
        return next(new AppError('Scheduled time must be in the future', 400, 'TIME_IN_PAST'));
      }

      const conflict = await findViewingAtInstant(db, viewing.propertyId, scheduledAt, {
        excludeId: viewingId,
      });
      if (conflict) {
        return next(new AppError('Time slot is no longer available', 409, 'TIME_CONFLICT'));
      }

      const updated = await rescheduleViewing(db, viewingId, oxyUserId, {
        scheduledAt,
        message: typeof message === 'string' ? message : undefined,
      });
      if (!updated) return next(new AppError('Can only modify pending viewing requests', 400, 'CANNOT_MODIFY'));

      logger.info('Viewing request updated', { viewingId, scheduledAt });
      res.json(successResponse(serializeViewing(updated), 'Viewing request updated'));
    } catch (error) {
      next(error);
    }
  }
}

export default new ViewingController();
