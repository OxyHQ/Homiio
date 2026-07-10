/**
 * Viewing Controller
 * Handles viewing request lifecycle (create, list, approve, decline, cancel)
 */

import type { Request, Response, NextFunction } from 'express';

import { Property, ViewingRequest, Profile } from '../models';
import { PropertyStatus } from '@homiio/shared-types';
import { logger } from '../middlewares/logging';
import { AppError, successResponse, paginationResponse } from '../middlewares/errorHandler';
import { notificationDispatchService } from '../services/notificationDispatchService';

class ViewingController {
  /**
   * Create a new viewing request for a property
   */
  async createViewingRequest(req: Request, res: Response, next: NextFunction): Promise<void | Response> {
    try {
      const { propertyId } = req.params;
      const { date, time, message } = req.body;

      const oxyUserId = req.user?.id || req.user?._id || req.userId;
      if (!oxyUserId) {
        return next(new AppError('Authentication required', 401, 'AUTHENTICATION_REQUIRED'));
      }

      const property = await Property.findById(propertyId).lean();
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
// Build scheduledAt from date (YYYY-MM-DD) and time (HH:mm)
      // Create date in local timezone first
      const localDate = new Date(`${date}T${time}`);
      // Convert to UTC ISO string
      const scheduledAtString = localDate.toISOString();
      const scheduledAt = new Date(scheduledAtString);
      if (Number.isNaN(scheduledAt.getTime())) {
        return next(new AppError('Invalid date or time', 400, 'INVALID_DATETIME'));
      }

      const now = new Date();
      if (scheduledAt.getTime() <= now.getTime()) {
        return next(new AppError('Scheduled time must be in the future', 400, 'TIME_IN_PAST'));
      }

      // Prevent multiple active (pending/approved) viewing requests for the same property by the same profile
      const existingActiveForProfile = await ViewingRequest.findOne({
        propertyId,
        requesterOxyUserId,
        status: { $in: ['pending', 'approved'] },
      }).lean();

      if (existingActiveForProfile) {
        return next(new AppError('You already have an active viewing request for this property', 409, 'ALREADY_REQUESTED'));
      }

      // Check for conflicts for the same property/time with non-cancelled/declined status
      const conflict = await ViewingRequest.findOne({
        propertyId,
        scheduledAt,
        status: { $in: ['pending', 'approved'] },
      }).lean();

      if (conflict) {
        return next(new AppError('Time slot is no longer available', 409, 'TIME_CONFLICT'));
      }

      const viewing = await ViewingRequest.create({
        propertyId,
        requesterOxyUserId,
        ownerOxyUserId,
        scheduledAt,
        message,
        status: 'pending',
      });

      logger.info('Viewing request created', { viewingId: viewing._id, propertyId, requesterOxyUserId, ownerOxyUserId });

      // Notify the property owner that someone requested a viewing.
      await notificationDispatchService.createForUser(ownerOxyUserId, {
        type: 'property',
        title: 'New viewing request',
        message: 'Someone requested a viewing for your property.',
        priority: 'high',
        data: { viewingId: viewing._id.toString(), propertyId: String(propertyId), screen: '/viewings' },
      });

      res.status(201).json(successResponse(viewing.toJSON(), 'Viewing request created'));
    } catch (error) {
      next(error);
    }
  }

  /**
   * List viewing requests for current user (requester)
   */
  async listMyViewingRequests(req: Request, res: Response, next: NextFunction): Promise<void | Response> {
    try {
      const { page = 1, limit = 10, status } = req.query;
      const oxyUserId = req.user?.id || req.user?._id || req.userId;
      if (!oxyUserId) return next(new AppError('Authentication required', 401, 'AUTHENTICATION_REQUIRED'));

      const query: Record<string, unknown> = { requesterOxyUserId: oxyUserId };
      if (status) query.status = status;

      const pageNumber = parseInt(String(page), 10) || 1;
      const limitNumber = parseInt(String(limit), 10) || 10;
      const skip = (pageNumber - 1) * limitNumber;

      const [items, total] = await Promise.all([
        ViewingRequest.find(query)
          .sort({ scheduledAt: 1 })
          .skip(skip)
          .limit(limitNumber)
          .lean(),
        ViewingRequest.countDocuments(query),
      ]);

      res.json(paginationResponse(items, pageNumber, limitNumber, total, 'Viewing requests retrieved'));
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
      const { page = 1, limit = 10, status } = req.query;
      const oxyUserId = req.user?.id || req.user?._id || req.userId;
      if (!oxyUserId) return next(new AppError('Authentication required', 401, 'AUTHENTICATION_REQUIRED'));

      const property = await Property.findById(propertyId).lean();
      if (!property) return next(new AppError('Property not found', 404, 'NOT_FOUND'));

      const isOwner = property.oxyUserId === oxyUserId;

      const query: Record<string, unknown> = { propertyId };
      if (!isOwner) {
        query.requesterOxyUserId = oxyUserId;
      }
      if (status) query.status = status;

      const pageNumber = parseInt(String(page), 10) || 1;
      const limitNumber = parseInt(String(limit), 10) || 10;
      const skip = (pageNumber - 1) * limitNumber;

      const [items, total] = await Promise.all([
        ViewingRequest.find(query)
          .sort({ scheduledAt: 1 })
          .skip(skip)
          .limit(limitNumber)
          .lean(),
        ViewingRequest.countDocuments(query),
      ]);

      res.json(paginationResponse(items, pageNumber, limitNumber, total, 'Viewing requests retrieved'));
    } catch (error) {
      next(error);
    }
  }

  /** Approve a pending viewing request (owner only) */
  async approveViewingRequest(req: Request, res: Response, next: NextFunction): Promise<void | Response> {
    try {
      const { viewingId } = req.params;
      const oxyUserId = req.user?.id || req.user?._id || req.userId;
      if (!oxyUserId) return next(new AppError('Authentication required', 401, 'AUTHENTICATION_REQUIRED'));

      const viewing = await ViewingRequest.findById(viewingId);
      if (!viewing) return next(new AppError('Viewing request not found', 404, 'NOT_FOUND'));

      if (String(viewing.ownerOxyUserId) !== String(oxyUserId)) {
        return next(new AppError('Only the property owner can approve', 403, 'FORBIDDEN'));
      }
      if (viewing.status !== 'pending') {
        return next(new AppError('Only pending requests can be approved', 400, 'INVALID_STATE'));
      }

      // Ensure no other approved request exists for same property/time
      const conflict = await ViewingRequest.findOne({
        _id: { $ne: viewing._id },
        propertyId: viewing.propertyId,
        scheduledAt: viewing.scheduledAt,
        status: 'approved',
      }).lean();
      if (conflict) return next(new AppError('Time slot already approved for another request', 409, 'TIME_CONFLICT'));

      viewing.status = 'approved';
      await viewing.save();

      // Notify the requester that their viewing was approved.
      await notificationDispatchService.createForUser(String(viewing.requesterOxyUserId), {
        type: 'property',
        title: 'Viewing approved',
        message: 'Your viewing request was approved.',
        priority: 'high',
        data: {
          viewingId: viewing._id.toString(),
          propertyId: String(viewing.propertyId),
          screen: '/viewings',
        },
      });

      res.json(successResponse(viewing.toJSON(), 'Viewing request approved'));
    } catch (error) {
      next(error);
    }
  }

  /** Decline a pending viewing request (owner only) */
  async declineViewingRequest(req: Request, res: Response, next: NextFunction): Promise<void | Response> {
    try {
      const { viewingId } = req.params;
      const oxyUserId = req.user?.id || req.user?._id || req.userId;
      if (!oxyUserId) return next(new AppError('Authentication required', 401, 'AUTHENTICATION_REQUIRED'));

      const viewing = await ViewingRequest.findById(viewingId);
      if (!viewing) return next(new AppError('Viewing request not found', 404, 'NOT_FOUND'));

      if (String(viewing.ownerOxyUserId) !== String(oxyUserId)) {
        return next(new AppError('Only the property owner can decline', 403, 'FORBIDDEN'));
      }
      if (viewing.status !== 'pending') {
        return next(new AppError('Only pending requests can be declined', 400, 'INVALID_STATE'));
      }

      viewing.status = 'declined';
      await viewing.save();

      // Notify the requester that their viewing was declined.
      await notificationDispatchService.createForUser(String(viewing.requesterOxyUserId), {
        type: 'property',
        title: 'Viewing declined',
        message: 'Your viewing request was declined.',
        priority: 'medium',
        data: {
          viewingId: viewing._id.toString(),
          propertyId: String(viewing.propertyId),
          screen: '/viewings',
        },
      });

      res.json(successResponse(viewing.toJSON(), 'Viewing request declined'));
    } catch (error) {
      next(error);
    }
  }

  /** Cancel a viewing request (requester or owner) */
  async cancelViewingRequest(req: Request, res: Response, next: NextFunction): Promise<void | Response> {
    try {
      const { viewingId } = req.params;
      const oxyUserId = req.user?.id || req.user?._id || req.userId;
      if (!oxyUserId) return next(new AppError('Authentication required', 401, 'AUTHENTICATION_REQUIRED'));

      const viewing = await ViewingRequest.findById(viewingId);
      if (!viewing) return next(new AppError('Viewing request not found', 404, 'NOT_FOUND'));

      const isRequester = String(viewing.requesterOxyUserId) === String(oxyUserId);
      const isOwner = String(viewing.ownerOxyUserId) === String(oxyUserId);
      if (!isRequester && !isOwner) return next(new AppError('Not authorized to cancel this request', 403, 'FORBIDDEN'));

      if (viewing.status === 'cancelled') {
        return res.json(successResponse(viewing.toJSON(), 'Viewing request already cancelled'));
      }

      viewing.status = 'cancelled';
      viewing.cancelledBy = isOwner ? 'owner' : 'requester';
      await viewing.save();

      // Notify the counterparty that the viewing was cancelled.
      const cancelRecipientProfileId = isOwner
        ? String(viewing.requesterOxyUserId)
        : String(viewing.ownerOxyUserId);
      await notificationDispatchService.createForUser(cancelRecipientProfileId, {
        type: 'property',
        title: 'Viewing cancelled',
        message: isOwner
          ? 'The owner cancelled a viewing you requested.'
          : 'A viewing request for your property was cancelled.',
        priority: 'medium',
        data: {
          viewingId: viewing._id.toString(),
          propertyId: String(viewing.propertyId),
          screen: '/viewings',
        },
      });

      res.json(successResponse(viewing.toJSON(), 'Viewing request cancelled'));
    } catch (error) {
      next(error);
    }
  }

  /** Update a pending viewing request (requester only) */
  async updateViewingRequest(req: Request, res: Response, next: NextFunction): Promise<void | Response> {
    try {
      const { viewingId } = req.params;
      const { date, time, message } = req.body;
      const oxyUserId = req.user?.id || req.user?._id || req.userId;
      
      if (!oxyUserId) {
        return next(new AppError('Authentication required', 401, 'AUTHENTICATION_REQUIRED'));
      }

      const viewing = await ViewingRequest.findById(viewingId);
      if (!viewing) return next(new AppError('Viewing request not found', 404, 'NOT_FOUND'));

      // Only allow updating pending requests
      if (viewing.status !== 'pending') {
        return next(new AppError('Can only modify pending viewing requests', 400, 'CANNOT_MODIFY'));
      }

      // Get active profile for requester
      // Only allow requester to modify
      const isRequester = String(viewing.requesterOxyUserId) === String(oxyUserId);
      if (!isRequester) {
        return next(new AppError('Not authorized to modify this viewing request', 403, 'FORBIDDEN'));
      }

      // Build scheduledAt from date (YYYY-MM-DD) and time (HH:mm)
      // Create date in local timezone first
      const localDate = new Date(`${date}T${time}`);
      // Convert to UTC ISO string
      const scheduledAtString = localDate.toISOString();
      const scheduledAt = new Date(scheduledAtString);
      if (Number.isNaN(scheduledAt.getTime())) {
        return next(new AppError('Invalid date or time', 400, 'INVALID_DATETIME'));
      }

      const now = new Date();
      if (scheduledAt.getTime() <= now.getTime()) {
        return next(new AppError('Scheduled time must be in the future', 400, 'TIME_IN_PAST'));
      }

      // Check for conflicts for the same property/time with non-cancelled/declined status, excluding this request
      const conflict = await ViewingRequest.findOne({
        _id: { $ne: viewingId }, // Exclude this request
        propertyId: viewing.propertyId,
        scheduledAt,
        status: { $in: ['pending', 'approved'] },
      }).lean();

      if (conflict) {
        return next(new AppError('Time slot is no longer available', 409, 'TIME_CONFLICT'));
      }

      // Update the viewing request
      viewing.scheduledAt = scheduledAt;
      if (message !== undefined) viewing.message = message;
      await viewing.save();

      logger.info('Viewing request updated', { viewingId, scheduledAt });
      res.json(successResponse(viewing.toJSON(), 'Viewing request updated'));
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new ViewingController();


