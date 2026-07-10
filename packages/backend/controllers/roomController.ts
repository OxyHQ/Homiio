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

import { Property, Address } from '../models';
import { PropertyType, PropertyStatus } from '@homiio/shared-types';
import { logger } from '../middlewares/logging';
import { AppError, successResponse, paginationResponse } from '../middlewares/errorHandler';
import { requireSessionOxyUserId } from '../utils/sessionUser';
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
        oxyUserId: ownerOxyUserId,
        sortBy = 'createdAt',
        sortOrder = 'desc',
      } = req.query;

      const pageNumber = Math.max(1, parseInt(String(page), 10) || 1);
      const limitNumber = Math.min(100, Math.max(1, parseInt(String(limit), 10) || 10));
      const skip = (pageNumber - 1) * limitNumber;

      const filters: Record<string, unknown> = { type: ROOM_TYPE };

      if (ownerOxyUserId) filters.oxyUserId = String(ownerOxyUserId);

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
      const oxyUserId = requireSessionOxyUserId(req);
      const { parentPropertyId } = req.body;
      if (!parentPropertyId) {
        return next(new AppError('parentPropertyId is required to create a room', 400, 'VALIDATION_ERROR'));
      }
      const parent = await Property.findOne({ _id: parentPropertyId, oxyUserId });
      if (!parent) {
        return next(new AppError('Parent property not found', 404, 'PARENT_PROPERTY_NOT_FOUND'));
      }
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
      const roomData = pickFields(req.body, CREATABLE_PROPERTY_FIELDS);
      const room = new Property({
        ...roomData,
        oxyUserId,
        addressId,
        parentPropertyId: parent._id,
        type: ROOM_TYPE,
      });
      const savedRoom = await room.save();
      await savedRoom.populate('addressId');
      logger.info('Room created', { roomId: savedRoom._id, oxyUserId, monthlyAmount: savedRoom.longTermRent?.monthlyAmount });
      res.status(201).json(successResponse(savedRoom.toJSON(), 'Room created successfully'));
    } catch (error) {
      if (errorName(error) === 'ValidationError') {
        const validationErrors = Object.values(errorValidationErrors(error)).map((err) => err.message);
        const validationError: AppErrorWithDetails = new AppError('Room validation failed', 400, 'VALIDATION_ERROR');
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
      const oxyUserId = requireSessionOxyUserId(req);
      const { id } = req.params;
      const room = await Property.findOne({ _id: id, type: ROOM_TYPE, oxyUserId });
      if (!room) {
        return next(new AppError('Room not found', 404, 'NOT_FOUND'));
      }
      const updateData = pickFields(req.body, EDITABLE_PROPERTY_FIELDS);
      const previousStatus = room.status;
      Object.assign(room, updateData);
      const updatedRoom = await room.save();
      await updatedRoom.populate('addressId');
      const transitionedToTerminal = previousStatus !== updatedRoom.status && TERMINAL_STATUSES.includes(updatedRoom.status);
      if (transitionedToTerminal && updatedRoom.sourcedByPartner) {
        try { await onPropertyTransacted(updatedRoom); } catch (commissionError) {
          logger.error('Failed to process commission on room close', { roomId: id, error: commissionError instanceof Error ? commissionError.message : String(commissionError) });
        }
      }
      logger.info('Room updated', { roomId: id, oxyUserId, updatedFields: Object.keys(updateData) });
      res.json(successResponse(updatedRoom.toJSON(), 'Room updated successfully'));
    } catch (error) {
      if (errorName(error) === 'ValidationError') return next(new AppError('Room validation failed', 400, 'VALIDATION_ERROR'));
      if (errorName(error) === 'CastError') return next(new AppError('Invalid room ID', 400, 'INVALID_ID'));
      next(error);
    }
  }

  /**
   * Delete (archive) a room owned by the authenticated user.
   */
    async deleteRoom(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const oxyUserId = requireSessionOxyUserId(req);
      const { id } = req.params;
      const room = await Property.findOne({ _id: id, type: ROOM_TYPE, oxyUserId });
      if (!room) return next(new AppError('Room not found', 404, 'NOT_FOUND'));
      room.status = PropertyStatus.ARCHIVED;
      await room.save();
      logger.info('Room deleted', { roomId: id, oxyUserId });
      res.json(successResponse(null, 'Room deleted successfully'));
    } catch (error) {
      if (errorName(error) === 'CastError') return next(new AppError('Invalid room ID', 400, 'INVALID_ID'));
      next(error);
    }
  }
}

interface AppErrorWithDetails extends Error {
  details?: unknown;
}

module.exports = new RoomController();
