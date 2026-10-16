/**
 * Room Controller
 *
 * Rooms are not a distinct collection: a "room" is a property whose `type` is
 * `PropertyType.ROOM`. This controller exposes the flat `/rooms` route contract
 * (GET /, POST /, GET /:id, PUT /:id, DELETE /:id) as thin adapters over
 * `domain/rooms.ts`, which the room capability tools call too.
 */

import type { Request, Response, NextFunction } from 'express';

import {
  createRoom as createRoomForOwner,
  deleteRoom as deleteRoomForOwner,
  getRoom,
  listRooms,
  updateRoom as updateRoomForOwner,
} from '../domain/rooms';
import { paginationResponse, successResponse } from '../middlewares/errorHandler';
import { requireSessionOxyUserId } from '../utils/sessionUser';
import { getAmenitiesParam } from './queryParams';

function optionalQuery(value: unknown): string | undefined {
  return value === undefined || value === null || value === '' ? undefined : String(value);
}

class RoomController {
  /**
   * List rooms (room-type properties) with filtering and pagination.
   *
   * Public-facing listing: excludes draft rooms by default and supports the
   * common property filters (rent range, city/state, amenities, furnished,
   * status) plus owner scoping via `oxyUserId`.
   */
  async getRooms(req: Request, res: Response, next: NextFunction): Promise<void> {
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

      const result = await listRooms({
        page: parseInt(String(page), 10),
        limit: parseInt(String(limit), 10),
        ...(minRent !== undefined ? { minRent: parseFloat(String(minRent)) } : {}),
        ...(maxRent !== undefined ? { maxRent: parseFloat(String(maxRent)) } : {}),
        city: optionalQuery(city),
        state: optionalQuery(state),
        furnishedStatus: optionalQuery(furnishedStatus),
        amenities: getAmenitiesParam(amenities),
        status: optionalQuery(status),
        ownerOxyUserId: optionalQuery(ownerOxyUserId),
        sortBy: String(sortBy),
        sortOrder: String(sortOrder),
      });

      res.json(
        paginationResponse(
          result.items,
          result.page,
          result.limit,
          result.total,
          result.unresolvedPlace ? 'No rooms found' : 'Rooms retrieved successfully',
        ),
      );
    } catch (error) {
      next(error);
    }
  }

  /** Create a room (a room-type property) owned by the authenticated user. */
  async createRoom(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const oxyUserId = requireSessionOxyUserId(req);
      const savedRoom = await createRoomForOwner(oxyUserId, req.body ?? {});
      res.status(201).json(successResponse(savedRoom, 'Room created successfully'));
    } catch (error) {
      next(error);
    }
  }

  /** Get a single room by id. */
  async getRoomById(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { room, audience } = await getRoom(req.user?.id || req.user?._id, req.params.id);
      if (audience === 'owner') res.set('Cache-Control', 'private, no-store');
      res.json(successResponse(room, 'Room retrieved successfully'));
    } catch (error) {
      next(error);
    }
  }

  /** Update a room owned by the authenticated user. */
  async updateRoom(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const oxyUserId = requireSessionOxyUserId(req);
      const updatedRoom = await updateRoomForOwner(oxyUserId, req.params.id, req.body ?? {});
      res.json(successResponse(updatedRoom, 'Room updated successfully'));
    } catch (error) {
      next(error);
    }
  }

  /** Delete (archive) a room owned by the authenticated user. */
  async deleteRoom(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const oxyUserId = requireSessionOxyUserId(req);
      await deleteRoomForOwner(oxyUserId, req.params.id);
      res.json(successResponse(null, 'Room deleted successfully'));
    } catch (error) {
      next(error);
    }
  }
}

export default new RoomController();
