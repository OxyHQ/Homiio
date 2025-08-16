/**
 * Viewing Controller
 * Handles viewing request lifecycle (create, list, approve, decline, cancel)
 */

const { Property, ViewingRequest, Profile } = require('../models');
const { logger } = require('../middlewares/logging');
const { AppError, successResponse, paginationResponse } = require('../middlewares/errorHandler');

class ViewingController {
  /**
   * Create a new viewing request for a property
   */
  async createViewingRequest(req, res, next) {
    try {
      const { propertyId } = req.params;
      const { date, time, message } = req.body;

      const oxyUserId = req.user?.id || req.user?._id || req.userId;
      if (!oxyUserId) {
        return next(new AppError('Authentication required', 401, 'AUTHENTICATION_REQUIRED'));
      }

      const property = await Property.findById(propertyId).lean();
      if (!property) return next(new AppError('Property not found', 404, 'NOT_FOUND'));
      if (property.status !== 'active') return next(new AppError('Property is not active', 400, 'PROPERTY_INACTIVE'));

      // Get active profile for requester
      const activeProfile = await Profile.findActiveByOxyUserId(oxyUserId);
      if (!activeProfile) return next(new AppError('No active profile found', 404, 'PROFILE_NOT_FOUND'));

      const requesterProfileId = activeProfile._id;
      const ownerProfileId = property.profileId;

      // Prevent booking own property
      if (String(ownerProfileId) === String(requesterProfileId)) {
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
        requesterProfileId,
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
        requesterProfileId,
        ownerProfileId,
        scheduledAt,
        message,
        status: 'pending',
      });

      logger.info('Viewing request created', { viewingId: viewing._id, propertyId, requesterProfileId, ownerProfileId });
      res.status(201).json(successResponse(viewing.toJSON(), 'Viewing request created'));
    } catch (error) {
      next(error);
    }
  }

  /**
   * List viewing requests for current user (requester)
   */
  async listMyViewingRequests(req, res, next) {
    try {
      const { page = 1, limit = 10, status } = req.query;
      const oxyUserId = req.user?.id || req.user?._id || req.userId;
      if (!oxyUserId) return next(new AppError('Authentication required', 401, 'AUTHENTICATION_REQUIRED'));

      const activeProfile = await Profile.findActiveByOxyUserId(oxyUserId);
      if (!activeProfile) return res.json(paginationResponse([], 1, 10, 0, 'No profile found for user'));

      const query = { requesterProfileId: activeProfile._id } as any;
      if (status) query.status = status;

      const pageNumber = parseInt(page);
      const limitNumber = parseInt(limit);
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
  async listPropertyViewingRequests(req, res, next) {
    try {
      const { propertyId } = req.params;
      const { page = 1, limit = 10, status } = req.query;
      const oxyUserId = req.user?.id || req.user?._id || req.userId;
      if (!oxyUserId) return next(new AppError('Authentication required', 401, 'AUTHENTICATION_REQUIRED'));

      const property = await Property.findById(propertyId).lean();
      if (!property) return next(new AppError('Property not found', 404, 'NOT_FOUND'));

      const activeProfile = await Profile.findActiveByOxyUserId(oxyUserId);
      if (!activeProfile) return next(new AppError('No active profile found', 404, 'PROFILE_NOT_FOUND'));

      const isOwner = String(property.profileId) === String(activeProfile._id);

      const query = { propertyId } as any;
      if (!isOwner) {
        query.requesterProfileId = activeProfile._id;
      }
      if (status) query.status = status;

      const pageNumber = parseInt(page);
      const limitNumber = parseInt(limit);
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
  async approveViewingRequest(req, res, next) {
    try {
      const { viewingId } = req.params;
      const oxyUserId = req.user?.id || req.user?._id || req.userId;
      if (!oxyUserId) return next(new AppError('Authentication required', 401, 'AUTHENTICATION_REQUIRED'));

      const activeProfile = await Profile.findActiveByOxyUserId(oxyUserId);
      if (!activeProfile) return next(new AppError('No active profile found', 404, 'PROFILE_NOT_FOUND'));

      const viewing = await ViewingRequest.findById(viewingId);
      if (!viewing) return next(new AppError('Viewing request not found', 404, 'NOT_FOUND'));

      if (String(viewing.ownerProfileId) !== String(activeProfile._id)) {
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
      res.json(successResponse(viewing.toJSON(), 'Viewing request approved'));
    } catch (error) {
      next(error);
    }
  }

  /** Decline a pending viewing request (owner only) */
  async declineViewingRequest(req, res, next) {
    try {
      const { viewingId } = req.params;
      const oxyUserId = req.user?.id || req.user?._id || req.userId;
      if (!oxyUserId) return next(new AppError('Authentication required', 401, 'AUTHENTICATION_REQUIRED'));

      const activeProfile = await Profile.findActiveByOxyUserId(oxyUserId);
      if (!activeProfile) return next(new AppError('No active profile found', 404, 'PROFILE_NOT_FOUND'));

      const viewing = await ViewingRequest.findById(viewingId);
      if (!viewing) return next(new AppError('Viewing request not found', 404, 'NOT_FOUND'));

      if (String(viewing.ownerProfileId) !== String(activeProfile._id)) {
        return next(new AppError('Only the property owner can decline', 403, 'FORBIDDEN'));
      }
      if (viewing.status !== 'pending') {
        return next(new AppError('Only pending requests can be declined', 400, 'INVALID_STATE'));
      }

      viewing.status = 'declined';
      await viewing.save();
      res.json(successResponse(viewing.toJSON(), 'Viewing request declined'));
    } catch (error) {
      next(error);
    }
  }

  /** Cancel a viewing request (requester or owner) */
  async cancelViewingRequest(req, res, next) {
    try {
      const { viewingId } = req.params;
      const oxyUserId = req.user?.id || req.user?._id || req.userId;
      if (!oxyUserId) return next(new AppError('Authentication required', 401, 'AUTHENTICATION_REQUIRED'));

      const activeProfile = await Profile.findActiveByOxyUserId(oxyUserId);
      if (!activeProfile) return next(new AppError('No active profile found', 404, 'PROFILE_NOT_FOUND'));

      const viewing = await ViewingRequest.findById(viewingId);
      if (!viewing) return next(new AppError('Viewing request not found', 404, 'NOT_FOUND'));

      const isRequester = String(viewing.requesterProfileId) === String(activeProfile._id);
      const isOwner = String(viewing.ownerProfileId) === String(activeProfile._id);
      if (!isRequester && !isOwner) return next(new AppError('Not authorized to cancel this request', 403, 'FORBIDDEN'));

      if (viewing.status === 'cancelled') {
        return res.json(successResponse(viewing.toJSON(), 'Viewing request already cancelled'));
      }

      viewing.status = 'cancelled';
      viewing.cancelledBy = isOwner ? 'owner' : 'requester';
      await viewing.save();
      res.json(successResponse(viewing.toJSON(), 'Viewing request cancelled'));
    } catch (error) {
      next(error);
    }
  }

  /** Update a pending viewing request (requester only) */
  async updateViewingRequest(req, res, next) {
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
      const activeProfile = await Profile.findActiveByOxyUserId(oxyUserId);
      if (!activeProfile) return next(new AppError('No active profile found', 404, 'PROFILE_NOT_FOUND'));

      // Only allow requester to modify
      const isRequester = String(viewing.requesterProfileId) === String(activeProfile._id);
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


