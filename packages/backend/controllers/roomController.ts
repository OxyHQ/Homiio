/**
 * Room Controller
 *
 * Rooms are not a distinct collection: a "room" is a Property whose `type` is
 * PropertyType.ROOM (see @homiio/shared-types and models/Property). This
 * controller exposes the flat `/rooms` route contract
 * (GET /, POST /, GET /:id, PUT /:id, DELETE /:id) on top of the Property model,
 * scoping every query to room-type properties.
 */

import type { Request, Response, NextFunction } from 'express';

import { Property, Address, Profile } from '../models';
import { PropertyType, PropertyStatus, ProfileType } from '@homiio/shared-types';
import { logger } from '../middlewares/logging';
import { AppError, successResponse, paginationResponse } from '../middlewares/errorHandler';
import {
  CREATABLE_PROPERTY_FIELDS,
  EDITABLE_PROPERTY_FIELDS,
} from './property/editableFields';
import { pickFields } from '../utils/pickFields';
import { onPropertyTransacted } from '../services/commissionService';

const ROOM_TYPE = PropertyType.ROOM;

/** Statuses that close a deal and (for sourced rooms) earn a commission. */
const TERMINAL_STATUSES: ReadonlyArray<string> = [PropertyStatus.RENTED, PropertyStatus.SOLD];

function errorName(error: unknown): string | undefined {
  if (error && typeof error === 'object' && 'name' in error) {
    const name = (error as { name: unknown }).name;
    return typeof name === 'string' ? name : undefined;
  }
  return undefined;
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function errorValidationErrors(error: unknown): Record<string, { message?: string }> {
  if (error && typeof error === 'object' && 'errors' in error) {
    const errs = (error as { errors?: unknown }).errors;
    if (errs && typeof errs === 'object') {
      return errs as Record<string, { message?: string }>;
    }
  }
  return {};
}

class RoomController {
  /**
   * List rooms (room-type properties) with filtering and pagination.
   *
   * Public-facing listing: excludes draft rooms by default and supports the
   * common property filters (rent range, address/city, amenities, furnished,
   * availability) plus owner scoping via `profileId`.
   */
  async getRooms(req: Request, res: Response, next: NextFunction): Promise<void | Response> {
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

      // Resolve city/state to address ids via RELATIONAL geo, matching the
      // property list handler (no free-text city/state matching on the Address).
      if (city || state) {
        const { resolveGeoFilterAddressIds } = require('../services/geoQueryService');
        const addressIds = await resolveGeoFilterAddressIds({
          city: city ? String(city) : undefined,
          state: state ? String(state) : undefined,
        });
        if (addressIds === null || addressIds.length === 0) {
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
  async createRoom(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const oxyUserId = req.user?.id || req.user?._id || req.userId;
      if (!oxyUserId) {
        return next(new AppError('Authentication required', 401, 'AUTHENTICATION_REQUIRED'));
      }

      // Ownership: a room is ALWAYS owned by the authenticated user's active
      // profile. The client cannot choose `profileId` (IDOR / mass-assignment) —
      // it is resolved strictly server-side, creating the personal profile
      // lazily if the user has none yet.
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
      const profileId = activeProfile._id;

      // A room is ALWAYS part of a parent property the caller owns. Resolve and
      // ownership-check the parent server-side — attaching a room to a property
      // you don't own would be an IDOR. The parent is mandatory (the schema
      // requires `parentPropertyId` for room-type properties).
      const { parentPropertyId } = req.body;
      if (!parentPropertyId) {
        return next(new AppError('parentPropertyId is required to create a room', 400, 'VALIDATION_ERROR'));
      }
      const parent = await Property.findById(parentPropertyId);
      if (!parent) {
        return next(new AppError('Parent property not found', 404, 'PARENT_PROPERTY_NOT_FOUND'));
      }
      if (String(parent.profileId) !== String(profileId)) {
        return next(new AppError('Access denied - you can only add rooms to your own property', 403, 'FORBIDDEN'));
      }

      // Resolve the address (either a full address object or an existing id),
      // falling back to the parent property's address when none is supplied.
      let addressId;
      if (req.body.address) {
        const address = await Address.findOrCreateCanonical(req.body.address);
        addressId = address._id;
      } else if (req.body.addressId) {
        addressId = req.body.addressId;
      } else if (parent.addressId) {
        addressId = parent.addressId;
      } else {
        return next(new AppError('Address information is required', 400, 'MISSING_ADDRESS'));
      }

      // Build the room from an explicit field whitelist; never spread
      // `req.body`. Ownership, address linkage, parent linkage and the room type
      // are all set server-side below.
      const roomData = pickFields(req.body, CREATABLE_PROPERTY_FIELDS);

      const room = new Property({
        ...roomData,
        profileId,
        addressId,
        parentPropertyId: parent._id,
        type: ROOM_TYPE,
      });

      const savedRoom = await room.save();
      await savedRoom.populate('addressId');

      logger.info('Room created', {
        roomId: savedRoom._id,
        profileId,
        monthlyAmount: savedRoom.longTermRent?.monthlyAmount,
      });

      res.status(201).json(successResponse(savedRoom.toJSON(), 'Room created successfully'));
    } catch (error) {
      if (errorName(error) === 'ValidationError') {
        const validationErrors = Object.values(errorValidationErrors(error)).map(
          (err) => err.message
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
  async getRoomById(req: Request, res: Response, next: NextFunction): Promise<void> {
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
      if (errorName(error) === 'CastError') {
        return next(new AppError('Invalid room ID', 400, 'INVALID_ID'));
      }
      next(error);
    }
  }

  /**
   * Update a room owned by the authenticated user.
   */
  async updateRoom(req: Request, res: Response, next: NextFunction): Promise<void> {
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

      // Whitelist the editable fields; never spread `req.body`. Type, ownership
      // (`profileId`) and address linkage (`addressId`) are not whitelisted, so
      // they are immutable through this endpoint — no owner reassignment or
      // mass-assignment is possible.
      const updateData = pickFields(req.body, EDITABLE_PROPERTY_FIELDS);

      // Capture the pre-update status so we can detect a deal-closing transition
      // below (a room is a Property, so it closes deals identically to a full
      // listing — mirroring updateProperty in property/updateDelete).
      const previousStatus = room.status;

      Object.assign(room, updateData);
      const updatedRoom = await room.save();
      await updatedRoom.populate('addressId');

      // When this edit closes the deal (status → rented/sold) on a room sourced
      // by a partner, fire the commission trigger — exactly as updateProperty
      // does. It is idempotent (at most one commission per property, ever) and a
      // no-op for the common case where the room carries no partner attribution.
      const transitionedToTerminal =
        previousStatus !== updatedRoom.status && TERMINAL_STATUSES.includes(updatedRoom.status);
      if (transitionedToTerminal && updatedRoom.sourcedByPartner) {
        try {
          await onPropertyTransacted(updatedRoom);
        } catch (commissionError) {
          // A commission failure must not fail the room update itself.
          logger.error('Failed to process commission on room close', {
            roomId: id,
            error: commissionError instanceof Error ? commissionError.message : String(commissionError),
          });
        }
      }

      logger.info('Room updated', {
        roomId: id,
        profileId: activeProfile._id,
        updatedFields: Object.keys(updateData),
      });

      res.json(successResponse(updatedRoom.toJSON(), 'Room updated successfully'));
    } catch (error) {
      if (errorName(error) === 'ValidationError') {
        return next(new AppError('Room validation failed', 400, 'VALIDATION_ERROR'));
      }
      if (errorName(error) === 'CastError') {
        return next(new AppError('Invalid room ID', 400, 'INVALID_ID'));
      }
      next(error);
    }
  }

  /**
   * Delete (archive) a room owned by the authenticated user.
   */
  async deleteRoom(req: Request, res: Response, next: NextFunction): Promise<void> {
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
      room.status = PropertyStatus.ARCHIVED;
      await room.save();

      logger.info('Room deleted', { roomId: id, profileId: activeProfile._id });

      res.json(successResponse(null, 'Room deleted successfully'));
    } catch (error) {
      if (errorName(error) === 'CastError') {
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
