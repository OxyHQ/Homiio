/**
 * Rooms: a "room" is a property whose `type` is `PropertyType.ROOM`, written
 * under a parent listing its owner holds.
 *
 * `controllers/roomController.ts` (the flat `/api/rooms` contract) and the
 * room capability tools both call these. Reads go through
 * `db/properties/propertyReads`, writes through `db/properties/propertyWrites`
 * — the same two modules the `/properties` endpoints use, so a room has no
 * second read path for its sort, address join or wire shape to drift on.
 *
 * Writes take the acting account's `oxyUserId` explicitly, pick fields from
 * the listing whitelists, and carry ownership in the repository query, so a
 * room (or parent) that is not theirs answers not-found.
 */

import { PropertyStatus, PropertyType } from '@homiio/shared-types';

import {
  CREATABLE_PROPERTY_FIELDS,
  EDITABLE_PROPERTY_FIELDS,
  invalidAddressPublishedPrecision,
} from '../controllers/property/editableFields';
import { normalizePropertyPhotos } from '../controllers/property/photoIntake';
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
  hasAllAmenities,
  inCity,
  inRange,
  inRegion,
  ownedBy,
  statusIs,
  statusIsNot,
  typeIn,
} from '../db/properties/propertyFilters';
import { propertyAudienceFor, serializeProperty } from '../db/properties/propertySerializer';
import {
  incrementPropertyViews,
  insertProperty,
  softDeleteProperty,
  updateProperty,
  type PropertyWriteInput,
} from '../db/properties/propertyWrites';
import { properties } from '../db/schema';
import { AppError, describeErrorForLog } from '../middlewares/errorHandler';
import { logger } from '../middlewares/logging';
import { findOrCreateCanonicalAddress } from '../services/addressService';
import { onPropertyTransacted } from '../services/commissionService';
import { resolveCityId, resolveRegionId } from '../services/geoQueryService';
import { pickFields } from '../utils/pickFields';

const ROOM_TYPE = PropertyType.ROOM;

/** Statuses that close a deal and (for sourced rooms) earn a commission. */
const TERMINAL_STATUSES: ReadonlyArray<string> = [PropertyStatus.RENTED, PropertyStatus.SOLD];

/**
 * The sortable columns the room feed accepts. An ALLOW-LIST: `sortBy` comes
 * from the caller, so an unknown one is answered with the default rather than
 * reaching the statement.
 */
const ROOM_SORT_COLUMNS = {
  createdAt: properties.createdAt,
  updatedAt: properties.updatedAt,
  'longTermRent.monthlyAmount': properties.longTermRentMonthlyAmount,
  squareFootage: properties.squareFootage,
  bedrooms: properties.bedrooms,
  bathrooms: properties.bathrooms,
} as const;

type Body = Record<string, unknown>;
type CanonicalAddressInput = Parameters<typeof findOrCreateCanonicalAddress>[0];
export type SerializedRoom = ReturnType<typeof serializeProperty>;

export interface RoomFilters {
  page: number;
  limit: number;
  minRent?: number;
  maxRent?: number;
  city?: string;
  state?: string;
  furnishedStatus?: string;
  amenities?: string[];
  status?: string;
  ownerOxyUserId?: string;
  sortBy?: string;
  sortOrder?: string;
}

export interface RoomPage {
  readonly items: SerializedRoom[];
  readonly page: number;
  readonly limit: number;
  readonly total: number;
  /** A `city`/`state` that resolves to no place answers an empty page. */
  readonly unresolvedPlace: boolean;
}

/**
 * Rooms with filtering and pagination, at the public precision. Excludes drafts
 * unless a `status` is asked for explicitly.
 */
export async function listRooms(filters: RoomFilters): Promise<RoomPage> {
  const page = Math.max(1, Math.trunc(filters.page) || 1);
  const limit = Math.min(100, Math.max(1, Math.trunc(filters.limit) || 10));
  const empty: RoomPage = { items: [], page, limit, total: 0, unresolvedPlace: true };

  const conditions = [typeIn([ROOM_TYPE])];
  if (filters.ownerOxyUserId) conditions.push(ownedBy(filters.ownerOxyUserId));

  // City and state filter via RELATIONAL geo — the same resolution the
  // property feed uses.
  if (filters.city) {
    const cityId = await resolveCityId(filters.city);
    if (!cityId) return empty;
    conditions.push(inCity(cityId));
  }
  if (filters.state) {
    const regionId = await resolveRegionId(filters.state);
    if (!regionId) return empty;
    conditions.push(inRegion(regionId));
  }

  if (filters.minRent !== undefined || filters.maxRent !== undefined) {
    conditions.push(
      inRange(properties.longTermRentMonthlyAmount, filters.minRent, filters.maxRent),
    );
  }

  if (filters.furnishedStatus) conditions.push(furnishedStatusIs(filters.furnishedStatus));

  // ALL must match — the reading every catalogue feed shares.
  const amenityFilter = hasAllAmenities(filters.amenities ?? []);
  if (amenityFilter) conditions.push(amenityFilter);

  // Exclude drafts from public listings unless explicitly requested.
  conditions.push(filters.status ? statusIs(filters.status) : statusIsNot('draft'));

  const where = allOf(conditions);

  // Image-bearing listings first (the product rule `propertyOrderBy`
  // carries), then the requested order. NULLs sort last in both directions:
  // a room with no price must not lead "cheapest first".
  const direction = filters.sortOrder === 'desc' ? 'desc' : 'asc';
  const sortColumn =
    ROOM_SORT_COLUMNS[(filters.sortBy ?? 'createdAt') as keyof typeof ROOM_SORT_COLUMNS] ??
    properties.createdAt;
  const orderBy = propertyOrderBy(nullsLast(sortColumn, direction));

  const [rooms, total] = await Promise.all([
    findProperties({ where, orderBy, limit, offset: (page - 1) * limit }),
    countProperties(where),
  ]);

  logger.info('Rooms retrieved', { total, page, limit });

  return {
    items: rooms.map((listing) => serializeProperty(listing, 'public')),
    page,
    limit,
    total,
    unresolvedPlace: false,
  };
}

/** Create a room owned by `oxyUserId` under one of their own listings. */
export async function createRoom(oxyUserId: string, body: Body): Promise<SerializedRoom> {
  const { parentPropertyId } = body;
  if (!parentPropertyId) {
    throw new AppError('parentPropertyId is required to create a room', 400, 'VALIDATION_ERROR');
  }
  const parent = await findPropertyById(String(parentPropertyId));
  if (!parent || parent.property.oxyUserId !== oxyUserId) {
    throw new AppError('Parent property not found', 404, 'PARENT_PROPERTY_NOT_FOUND');
  }
  let addressId: string;
  if (body.address) {
    const address = await findOrCreateCanonicalAddress(
      body.address as unknown as CanonicalAddressInput,
    );
    addressId = address.id;
  } else if (body.addressId) {
    addressId = String(body.addressId);
  } else {
    // A room with no address of its own is in its parent's building, which
    // is why this fallback exists and why the parent's `address_id` is
    // `NOT NULL` — there is always one to inherit.
    addressId = parent.property.addressId;
  }
  const roomData = pickFields<PropertyWriteInput>(body, CREATABLE_PROPERTY_FIELDS);
  const precisionError = invalidAddressPublishedPrecision(roomData);
  if (precisionError) throw precisionError;
  // `images` is on the same whitelist the listing paths use, so a room
  // carrying a photo needs the same intake.
  await normalizePropertyPhotos(roomData);
  const created = await insertProperty({
    ...roomData,
    oxyUserId,
    addressId,
    parentPropertyId: parent.property.id,
    type: ROOM_TYPE,
  });
  logger.info('Room created', {
    roomId: created.property.id,
    oxyUserId,
    monthlyAmount: created.property.longTermRentMonthlyAmount,
  });
  return serializeProperty(created, 'owner');
}

/**
 * One room: owner-exact for its owner, the published precision for everybody
 * else. Counts a view, as the route always has.
 */
export async function getRoom(
  viewerOxyUserId: string | undefined,
  roomId: string,
): Promise<{ room: SerializedRoom; audience: string }> {
  const hydrated = await findPropertyById(roomId);
  if (!hydrated || hydrated.property.type !== ROOM_TYPE) {
    throw new AppError('Room not found', 404, 'NOT_FOUND');
  }

  // Best-effort view counter, consistent with property retrieval.
  void incrementPropertyViews(roomId).catch((error: unknown) => {
    logger.warn('Failed to increment room view count', { roomId, error });
  });

  const audience = propertyAudienceFor(hydrated, viewerOxyUserId);
  return { room: serializeProperty(hydrated, audience), audience };
}

/** Edit one of `oxyUserId`'s rooms (listing edit whitelist). */
export async function updateRoom(
  oxyUserId: string,
  roomId: string,
  body: Body,
): Promise<SerializedRoom> {
  const existing = await findPropertyById(roomId);
  if (
    !existing ||
    existing.property.type !== ROOM_TYPE ||
    existing.property.oxyUserId !== oxyUserId
  ) {
    throw new AppError('Room not found', 404, 'NOT_FOUND');
  }
  const updateData = pickFields<PropertyWriteInput>(body, EDITABLE_PROPERTY_FIELDS);
  const precisionError = invalidAddressPublishedPrecision(updateData);
  if (precisionError) throw precisionError;
  await normalizePropertyPhotos(updateData);
  const previousStatus = existing.property.status;
  const updated = await updateProperty(roomId, updateData, { ownedBy: oxyUserId });
  if (!updated) throw new AppError('Room not found', 404, 'NOT_FOUND');
  const updatedRoom = serializeProperty(updated, 'owner');

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
        roomId,
        error: describeErrorForLog(commissionError),
      });
    }
  }
  logger.info('Room updated', { roomId, oxyUserId, updatedFields: Object.keys(updateData) });
  return updatedRoom;
}

/**
 * Delete (archive and stamp `deleted_at`) one of `oxyUserId`'s rooms. Every
 * catalogue read filters on `deleted_at IS NULL`, which is why both are set.
 */
export async function deleteRoom(oxyUserId: string, roomId: string): Promise<void> {
  const existing = await findPropertyById(roomId);
  if (!existing || existing.property.type !== ROOM_TYPE) {
    throw new AppError('Room not found', 404, 'NOT_FOUND');
  }
  const deleted = await softDeleteProperty(roomId, { ownedBy: oxyUserId });
  if (!deleted) throw new AppError('Room not found', 404, 'NOT_FOUND');
  logger.info('Room deleted', { roomId, oxyUserId });
}
