/**
 * Handlers for the owner side of a listing, rooms and analytics. Each calls the
 * domain use case the route calls, as `context.accountId` and never as an id
 * from the input; the output is the route's body minus `success`, `message`
 * and `meta`.
 */

import { getAppStats, getOwnerAnalytics } from '../../domain/analytics';
import {
  createProperty,
  deleteProperty,
  getMyProperty,
  listMyProperties,
  listPropertiesByOwner,
  markPropertyTransacted,
  setPropertyPublication,
  updateProperty,
} from '../../domain/properties';
import { createRoom, deleteRoom, getRoom, listRooms, updateRoom } from '../../domain/rooms';
import { paginationResponse } from '../../middlewares/errorHandler';
import * as validation from '../../middlewares/validation';
import {
  type HomiioToolHandlers,
  optionalInteger,
  optionalNumber,
  optionalString,
  optionalStringArray,
  requiredObject,
  requiredString,
  type ToolResult,
} from './context';
import { runRouteValidation } from './routeValidation';

/** `paginationResponse`'s body without its envelope, as the route answers it. */
function pageBody(items: unknown[], page: number, limit: number, total: number): ToolResult {
  const { data, pagination } = paginationResponse(items, page, limit, total);
  return { data, pagination };
}

export const PROPERTY_HANDLERS: HomiioToolHandlers = {
  async listMyProperties(input, { accountId }) {
    const result = await listMyProperties(accountId, {
      page: optionalInteger(input, 'page') ?? 1,
      limit: optionalInteger(input, 'limit') ?? 10,
    });
    return pageBody(result.items, result.page, result.limit, result.total);
  },

  async getMyProperty(input, { accountId }) {
    return { data: await getMyProperty(accountId, requiredString(input, 'propertyId')) };
  },

  async listPropertiesByOwner(input) {
    const exclude = optionalString(input, 'exclude');
    const result = await listPropertiesByOwner(requiredString(input, 'oxyUserId'), {
      page: optionalInteger(input, 'page') ?? 1,
      limit: optionalInteger(input, 'limit') ?? 10,
      ...(exclude ? { exclude } : {}),
    });
    return pageBody(result.items, result.page, result.limit, result.total);
  },

  async createProperty(input, { accountId }) {
    const body = requiredObject(input, 'property');
    await runRouteValidation(validation.validateProperty, { body });
    return { data: await createProperty(accountId, body) };
  },

  async updateProperty(input, { accountId }) {
    const propertyId = requiredString(input, 'propertyId');
    const body = requiredObject(input, 'property');
    await runRouteValidation(validation.validateProperty, { body, params: { propertyId } });
    return { data: await updateProperty(accountId, propertyId, body) };
  },

  async publishProperty(input, { accountId }) {
    return {
      data: await setPropertyPublication(accountId, requiredString(input, 'propertyId'), true),
    };
  },

  async unpublishProperty(input, { accountId }) {
    return {
      data: await setPropertyPublication(accountId, requiredString(input, 'propertyId'), false),
    };
  },

  async deleteProperty(input, { accountId }) {
    await deleteProperty(accountId, requiredString(input, 'propertyId'));
    return { data: null };
  },

  async markPropertyTransacted(input, { accountId }) {
    return {
      data: await markPropertyTransacted(
        accountId,
        requiredString(input, 'propertyId'),
        optionalString(input, 'status'),
      ),
    };
  },

  async listRooms(input) {
    const minRent = optionalNumber(input, 'minRent');
    const maxRent = optionalNumber(input, 'maxRent');
    const result = await listRooms({
      page: optionalInteger(input, 'page') ?? 1,
      limit: optionalInteger(input, 'limit') ?? 10,
      ...(minRent !== undefined ? { minRent } : {}),
      ...(maxRent !== undefined ? { maxRent } : {}),
      city: optionalString(input, 'city') || undefined,
      state: optionalString(input, 'state') || undefined,
      furnishedStatus: optionalString(input, 'furnishedStatus') || undefined,
      amenities: (optionalStringArray(input, 'amenities') ?? []).map((amenity) =>
        amenity.toLowerCase(),
      ),
      status: optionalString(input, 'status') || undefined,
      ownerOxyUserId: optionalString(input, 'oxyUserId') || undefined,
      sortBy: optionalString(input, 'sortBy') ?? 'createdAt',
      sortOrder: optionalString(input, 'sortOrder') ?? 'desc',
    });
    return pageBody(result.items, result.page, result.limit, result.total);
  },

  async getRoom(input, { accountId }) {
    const { room } = await getRoom(accountId, requiredString(input, 'roomId'));
    return { data: room };
  },

  async createRoom(input, { accountId }) {
    return { data: await createRoom(accountId, requiredObject(input, 'room')) };
  },

  async updateRoom(input, { accountId }) {
    return {
      data: await updateRoom(
        accountId,
        requiredString(input, 'roomId'),
        requiredObject(input, 'room'),
      ),
    };
  },

  async deleteRoom(input, { accountId }) {
    await deleteRoom(accountId, requiredString(input, 'roomId'));
    return { data: null };
  },

  async getMyAnalytics(input, { accountId }) {
    return { data: await getOwnerAnalytics(accountId, optionalString(input, 'period') ?? '30d') };
  },

  async getAppStats() {
    return { data: await getAppStats() };
  },
};
