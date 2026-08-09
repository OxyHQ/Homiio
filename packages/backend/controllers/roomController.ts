/**
 * Room Controller
 *
 * Rooms are not a distinct collection: a "room" is a property whose `type` is
 * `PropertyType.ROOM`. This controller exposes the flat `/rooms` route contract
 * (GET /, POST /, GET /:id, PUT /:id, DELETE /:id) on top of the property
 * tables, scoping every query to room-type listings.
 *
 * Reads go through `db/properties/propertyReads`, writes through
 * `db/properties/propertyWrites` — the same two modules the `/properties`
 * endpoints use. That is the point of a room not being its own collection: a
 * second read path for the same rows would be a second place for the
 * `has_images` sort, the address join and the wire shape to drift.
 */

import type { Request, Response, NextFunction } from 'express';

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
import { resolveCityId, resolveRegionId } from '../services/geoQueryService';
import { findOrCreateCanonicalAddress } from '../services/addressService';
import {
  allOf,
  countProperties,
  findProperties,
  findPropertyById,
  nullsLast,
  propertyOrderBy,
} from '../db/properties/propertyReads';
import {
  furnishedStatusIs,
  hasAnyAmenity,
  inCity,
  inRange,
  inRegion,
  ownedBy,
  statusIs,
  statusIsNot,
  typeIn,
} from '../db/properties/propertyFilters';
import { serializeProperty } from '../db/properties/propertySerializer';
import {
  incrementPropertyViews,
  insertProperty,
  softDeleteProperty,
  updateProperty,
  type PropertyWriteInput,
} from '../db/properties/propertyWrites';
import { properties } from '../db/schema';

const ROOM_TYPE = PropertyType.ROOM;

/** Statuses that close a deal and (for sourced rooms) earn a commission. */
const TERMINAL_STATUSES: ReadonlyArray<string> = [PropertyStatus.RENTED, PropertyStatus.SOLD];

/**
 * The sortable columns the room feed accepts.
 *
 * An ALLOW-LIST, not a lookup with a fallback: `sortBy` comes straight off the
 * query string, and the Mongo version interpolated it into a sort document,
 * where an unknown field sorted by nothing. Against SQL a column name has to be
 * resolved to a real column, so an unknown one is answered with the default
 * rather than reaching the statement.
 */
const ROOM_SORT_COLUMNS = {
  createdAt: properties.createdAt,
  updatedAt: properties.updatedAt,
  'longTermRent.monthlyAmount': properties.longTermRentMonthlyAmount,
  squareFootage: properties.squareFootage,
  bedrooms: properties.bedrooms,
  bathrooms: properties.bathrooms,
} as const;

class RoomController {
  /**
   * List rooms (room-type properties) with filtering and pagination.
   *
   * Public-facing listing: excludes draft rooms by default and supports the
   * common property filters (rent range, city/state, amenities, furnished,
   * status) plus owner scoping via `oxyUserId`.
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

      const conditions = [typeIn([ROOM_TYPE])];

      if (ownerOxyUserId) conditions.push(ownedBy(String(ownerOxyUserId)));

      // City and state filter via RELATIONAL geo — the same resolution the
      // property feed uses. It replaces `resolveGeoFilterAddressIds`, which
      // loaded every address id in the city into an uncapped `$in`.
      if (city) {
        const cityId = await resolveCityId(String(city));
        if (!cityId) {
          return res.json(paginationResponse([], pageNumber, limitNumber, 0, 'No rooms found'));
        }
        conditions.push(inCity(cityId));
      }
      if (state) {
        const regionId = await resolveRegionId(String(state));
        if (!regionId) {
          return res.json(paginationResponse([], pageNumber, limitNumber, 0, 'No rooms found'));
        }
        conditions.push(inRegion(regionId));
      }

      if (minRent !== undefined || maxRent !== undefined) {
        conditions.push(
          inRange(
            properties.longTermRentMonthlyAmount,
            minRent === undefined ? undefined : parseFloat(String(minRent)),
            maxRent === undefined ? undefined : parseFloat(String(maxRent)),
          ),
        );
      }

      if (furnishedStatus) conditions.push(furnishedStatusIs(String(furnishedStatus)));

      if (amenities) {
        const amenityList = String(amenities).split(',').map((a) => a.trim().toLowerCase()).filter(Boolean);
        conditions.push(hasAnyAmenity(amenityList));
      }

      // Exclude drafts from public listings unless explicitly requested.
      conditions.push(status ? statusIs(String(status)) : statusIsNot('draft'));

      const where = allOf(conditions);

      // Image-bearing listings first (the product rule `propertyOrderBy`
      // carries), then the requested order. NULLs sort last in both directions
      // for the same reason the property feed states: a room with no price must
      // not lead "cheapest first".
      const direction = sortOrder === 'desc' ? 'desc' : 'asc';
      const sortColumn =
        ROOM_SORT_COLUMNS[String(sortBy) as keyof typeof ROOM_SORT_COLUMNS] ?? properties.createdAt;
      const orderBy = propertyOrderBy(nullsLast(sortColumn, direction));

      const [rooms, total] = await Promise.all([
        findProperties({ where, orderBy, limit: limitNumber, offset: skip }),
        countProperties(where),
      ]);

      logger.info('Rooms retrieved', { total, page: pageNumber, limit: limitNumber });

      res.json(
        paginationResponse(
          rooms.map(serializeProperty),
          pageNumber,
          limitNumber,
          total,
          'Rooms retrieved successfully',
        ),
      );
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
      const parent = await findPropertyById(String(parentPropertyId));
      if (!parent || parent.property.oxyUserId !== oxyUserId) {
        return next(new AppError('Parent property not found', 404, 'PARENT_PROPERTY_NOT_FOUND'));
      }
      let addressId: string;
      if (req.body.address) {
        const address = await findOrCreateCanonicalAddress(req.body.address);
        addressId = address.id;
      } else if (req.body.addressId) {
        addressId = String(req.body.addressId);
      } else {
        // A room with no address of its own is in its parent's building, which
        // is why this fallback exists and why the parent's `address_id` is
        // `NOT NULL` — there is always one to inherit.
        addressId = parent.property.addressId;
      }
      const roomData = pickFields<PropertyWriteInput>(req.body, CREATABLE_PROPERTY_FIELDS);
      const created = await insertProperty({
        ...roomData,
        oxyUserId,
        addressId,
        parentPropertyId: parent.property.id,
        type: ROOM_TYPE,
      });
      const savedRoom = serializeProperty(created);
      logger.info('Room created', {
        roomId: created.property.id,
        oxyUserId,
        monthlyAmount: created.property.longTermRentMonthlyAmount,
      });
      res.status(201).json(successResponse(savedRoom, 'Room created successfully'));
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get a single room by id.
   */
  async getRoomById(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const { id } = req.params;

      const hydrated = await findPropertyById(id);
      if (!hydrated || hydrated.property.type !== ROOM_TYPE) {
        return next(new AppError('Room not found', 404, 'NOT_FOUND'));
      }

      // Best-effort view counter, consistent with property retrieval.
      void incrementPropertyViews(id).catch((error: unknown) => {
        logger.warn('Failed to increment room view count', { roomId: id, error });
      });

      res.json(successResponse(serializeProperty(hydrated), 'Room retrieved successfully'));
    } catch (error) {
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
      const existing = await findPropertyById(id);
      if (
        !existing ||
        existing.property.type !== ROOM_TYPE ||
        existing.property.oxyUserId !== oxyUserId
      ) {
        return next(new AppError('Room not found', 404, 'NOT_FOUND'));
      }
      const updateData = pickFields<PropertyWriteInput>(req.body, EDITABLE_PROPERTY_FIELDS);
      const previousStatus = existing.property.status;
      const updated = await updateProperty(id, updateData, { ownedBy: oxyUserId });
      if (!updated) return next(new AppError('Room not found', 404, 'NOT_FOUND'));
      const updatedRoom = serializeProperty(updated);

      const transitionedToTerminal =
        previousStatus !== updated.property.status &&
        TERMINAL_STATUSES.includes(updated.property.status);
      if (transitionedToTerminal && updated.property.sourcedByPartnerId) {
        try {
          await onPropertyTransacted({
            ...updatedRoom,
            _id: updated.property.id,
            sourcedByPartner: updated.property.sourcedByPartnerId,
          });
        } catch (commissionError) {
          logger.error('Failed to process commission on room close', {
            roomId: id,
            error: commissionError instanceof Error ? commissionError.message : String(commissionError),
          });
        }
      }
      logger.info('Room updated', { roomId: id, oxyUserId, updatedFields: Object.keys(updateData) });
      res.json(successResponse(updatedRoom, 'Room updated successfully'));
    } catch (error) {
      next(error);
    }
  }

  /**
   * Delete (archive) a room owned by the authenticated user.
   *
   * Archives AND stamps `deleted_at`, where the Mongo version set only the
   * status. That is a deliberate correction, not a drift: every catalogue read
   * filters on `deleted_at IS NULL`, so a room archived without the stamp stays
   * visible to any read that does not also exclude archived rows — and the
   * property delete endpoint next door has always set both.
   */
  async deleteRoom(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const oxyUserId = requireSessionOxyUserId(req);
      const { id } = req.params;
      const existing = await findPropertyById(id);
      if (!existing || existing.property.type !== ROOM_TYPE) {
        return next(new AppError('Room not found', 404, 'NOT_FOUND'));
      }
      const deleted = await softDeleteProperty(id, { ownedBy: oxyUserId });
      if (!deleted) return next(new AppError('Room not found', 404, 'NOT_FOUND'));
      logger.info('Room deleted', { roomId: id, oxyUserId });
      res.json(successResponse(null, 'Room deleted successfully'));
    } catch (error) {
      next(error);
    }
  }
}

export default new RoomController();
