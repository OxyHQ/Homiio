/**
 * Room Controller
 *
 * Rooms are not a distinct collection: a "room" is a Property whose `type` is
 * PropertyType.ROOM (see @homiio/shared-types and models/Property). This
 * controller exposes the flat `/rooms` route contract
 * (GET /, POST /, GET /:id, PUT /:id, DELETE /:id) on top of the Property model,
 * scoping every query to room-type properties.
 */

const { Property, Address, Profile } = require('../models');
const { PropertyType, ProfileType } = require('@homiio/shared-types');
const { logger, businessLogger } = require('../middlewares/logging');
const { AppError, successResponse, paginationResponse } = require('../middlewares/errorHandler');

const ROOM_TYPE = PropertyType.ROOM;

class RoomController {
  /**
   * List rooms (room-type properties) with filtering and pagination.
   *
   * Public-facing listing: excludes draft rooms by default and supports the
   * common property filters (rent range, address/city, amenities, furnished,
   * availability) plus owner scoping via `profileId`.
   */
  async getRooms(req, res, next) {
    try {
      const {
        page = 1,
        limit = 10,
        minRent,
        maxRent,
        city,
        state,
        furnishedStatus,
        amenities,
        status,
        profileId,
        sortBy = 'createdAt',
        sortOrder = 'desc',
      } = req.query;

      const pageNumber = Math.max(1, parseInt(String(page), 10) || 1);
      const limitNumber = Math.min(100, Math.max(1, parseInt(String(limit), 10) || 10));
      const skip = (pageNumber - 1) * limitNumber;

      const filters: Record<string, unknown> = { type: ROOM_TYPE };

      if (profileId) filters.profileId = profileId;

      // Resolve city/state to address ids, matching the property list handler.
      if (city || state) {
        const addressQuery: Record<string, unknown> = {};
        if (city) addressQuery.city = new RegExp(String(city), 'i');
        if (state) addressQuery.state = new RegExp(String(state), 'i');

        const matchingAddresses = await Address.find(addressQuery).select('_id').lean();
        const addressIds = matchingAddresses.map((addr: { _id: unknown }) => addr._id);

        if (addressIds.length === 0) {
          return res.json(paginationResponse([], pageNumber, limitNumber, 0, 'No rooms found'));
        }
        filters.addressId = { $in: addressIds };
      }

      if (minRent !== undefined || maxRent !== undefined) {
        const rentFilter: Record<string, number> = {};
        if (minRent !== undefined) rentFilter.$gte = parseFloat(String(minRent));
        if (maxRent !== undefined) rentFilter.$lte = parseFloat(String(maxRent));
        filters['longTermRent.monthlyAmount'] = rentFilter;
      }

      if (furnishedStatus) filters.furnishedStatus = String(furnishedStatus);

      if (amenities) {
        const amenityList = String(amenities).split(',').map((a) => a.trim().toLowerCase()).filter(Boolean);
        if (amenityList.length > 0) filters.amenities = { $in: amenityList };
      }

      if (status) {
        filters.status = String(status);
      } else {
        // Exclude drafts from public listings unless explicitly requested.
        filters.status = { $ne: 'draft' };
      }

      const sortOptions: Record<string, 1 | -1> = {};
      sortOptions[String(sortBy)] = sortOrder === 'desc' ? -1 : 1;

      const [rooms, total] = await Promise.all([
        Property.find(filters)
          .populate('addressId')
          .sort(sortOptions)
          .skip(skip)
          .limit(limitNumber)
          .lean(),
        Property.countDocuments(filters),
      ]);

      logger.info('Rooms retrieved', { total, page: pageNumber, limit: limitNumber });

      res.json(paginationResponse(rooms, pageNumber, limitNumber, total, 'Rooms retrieved successfully'));
    } catch (error) {
      next(error);
    }
  }

  /**
   * Create a room (a room-type property) owned by the authenticated user.
   */
  async createRoom(req, res, next) {
    try {
      const oxyUserId = req.user?.id || req.user?._id || req.userId;
      if (!oxyUserId) {
        return next(new AppError('Authentication required', 401, 'AUTHENTICATION_REQUIRED'));
      }

      // Resolve (or lazily create) the active profile that will own the room.
      let profileId = req.body.profileId;
      if (!profileId) {
        let activeProfile = await Profile.findActiveByOxyUserId(oxyUserId);
        if (!activeProfile) {
          activeProfile = await Profile.create({
            oxyUserId,
            profileType: ProfileType.PERSONAL,
            isPrimary: true,
            isActive: true,
            personalProfile: {},
          });
        }
        profileId = activeProfile._id;
      }

      // Resolve the address (either a full address object or an existing id).
      let addressId;
      if (req.body.address) {
        const address = await Address.findOrCreateCanonical(req.body.address);
        addressId = address._id;
      } else if (req.body.addressId) {
        addressId = req.body.addressId;
      } else {
        return next(new AppError('Address information is required', 400, 'MISSING_ADDRESS'));
      }

      const roomData = { ...req.body };
      delete roomData.address;
      delete roomData.location;

      const room = new Property({
        ...roomData,
        profileId,
        addressId,
        type: ROOM_TYPE,
      });

      const savedRoom = await room.save();
      await savedRoom.populate('addressId');

      logger.info('Room created', { roomId: savedRoom._id, profileId });
      businessLogger.info('Room created', {
        roomId: savedRoom._id,
        profileId,
        rent: savedRoom.rent?.amount,
      });

      res.status(201).json(successResponse(savedRoom.toJSON(), 'Room created successfully'));
    } catch (error) {
      if (error.name === 'ValidationError') {
        const validationErrors = Object.values(error.errors || {}).map(
          (err: { message?: string }) => err.message
        );
        const validationError: AppErrorWithDetails = new AppError(
          'Room validation failed',
          400,
          'VALIDATION_ERROR'
        );
        validationError.details = validationErrors;
        return next(validationError);
      }
      next(error);
    }
  }

  /**
   * Get a single room by id.
   */
  async getRoomById(req, res, next) {
    try {
      const { id } = req.params;

      const room = await Property.findOne({ _id: id, type: ROOM_TYPE })
        .populate('addressId')
        .lean();

      if (!room) {
        return next(new AppError('Room not found', 404, 'NOT_FOUND'));
      }

      // Best-effort view counter, consistent with property retrieval.
      Property.findByIdAndUpdate(id, { $inc: { views: 1 } }).catch((error: Error) => {
        logger.warn('Failed to increment room view count', { roomId: id, error: error.message });
      });

      res.json(successResponse({ ...room }, 'Room retrieved successfully'));
    } catch (error) {
      if (error.name === 'CastError') {
        return next(new AppError('Invalid room ID', 400, 'INVALID_ID'));
      }
      next(error);
    }
  }

  /**
   * Update a room owned by the authenticated user.
   */
  async updateRoom(req, res, next) {
    try {
      const oxyUserId = req.user?.id || req.user?._id || req.userId;
      if (!oxyUserId) {
        return next(new AppError('Authentication required', 401, 'AUTHENTICATION_REQUIRED'));
      }

      const { id } = req.params;

      const room = await Property.findOne({ _id: id, type: ROOM_TYPE });
      if (!room) {
        return next(new AppError('Room not found', 404, 'NOT_FOUND'));
      }

      const activeProfile = await Profile.findActiveByOxyUserId(oxyUserId);
      if (!activeProfile || String(room.profileId) !== String(activeProfile._id)) {
        return next(new AppError('Access denied to this room', 403, 'FORBIDDEN'));
      }

      const updateData = { ...req.body };
      // Type, ownership and address linkage are immutable through this endpoint.
      delete updateData.type;
      delete updateData.profileId;
      delete updateData.addressId;
      delete updateData.address;

      Object.assign(room, updateData);
      const updatedRoom = await room.save();
      await updatedRoom.populate('addressId');

      logger.info('Room updated', {
        roomId: id,
        profileId: activeProfile._id,
        updatedFields: Object.keys(updateData),
      });

      res.json(successResponse(updatedRoom.toJSON(), 'Room updated successfully'));
    } catch (error) {
      if (error.name === 'ValidationError') {
        return next(new AppError('Room validation failed', 400, 'VALIDATION_ERROR'));
      }
      if (error.name === 'CastError') {
        return next(new AppError('Invalid room ID', 400, 'INVALID_ID'));
      }
      next(error);
    }
  }

  /**
   * Delete (archive) a room owned by the authenticated user.
   */
  async deleteRoom(req, res, next) {
    try {
      const oxyUserId = req.user?.id || req.user?._id || req.userId;
      if (!oxyUserId) {
        return next(new AppError('Authentication required', 401, 'AUTHENTICATION_REQUIRED'));
      }

      const { id } = req.params;

      const room = await Property.findOne({ _id: id, type: ROOM_TYPE });
      if (!room) {
        return next(new AppError('Room not found', 404, 'NOT_FOUND'));
      }

      const activeProfile = await Profile.findActiveByOxyUserId(oxyUserId);
      if (!activeProfile || String(room.profileId) !== String(activeProfile._id)) {
        return next(new AppError('Access denied to this room', 403, 'FORBIDDEN'));
      }

      // Soft delete by archiving, consistent with property lifecycle.
      room.status = 'archived';
      await room.save();

      logger.info('Room deleted', { roomId: id, profileId: activeProfile._id });
      businessLogger.info('Room deleted', { roomId: id, profileId: activeProfile._id });

      res.json(successResponse(null, 'Room deleted successfully'));
    } catch (error) {
      if (error.name === 'CastError') {
        return next(new AppError('Invalid room ID', 400, 'INVALID_ID'));
      }
      next(error);
    }
  }
}

interface AppErrorWithDetails extends Error {
  details?: unknown;
}

module.exports = new RoomController();
