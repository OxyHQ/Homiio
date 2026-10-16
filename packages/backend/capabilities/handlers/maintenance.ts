/**
 * Maintenance tools → `domain/maintenance.ts`, as the effective account.
 *
 * Each answers the route's body minus `success`, `message` and `meta`: the
 * list is built with the same `paginationResponse` the route uses, so its
 * `pagination` block is the route's exactly.
 */

import {
  commentOnMaintenanceRequest,
  createMaintenanceRequest,
  getMaintenanceRequest,
  listMyMaintenanceRequests,
  transitionMaintenanceRequest,
} from '../../domain/maintenance';
import { parsePagination } from '../../domain/evictions/shared';
import { paginationResponse } from '../../middlewares/errorHandler';
import {
  type HomiioToolHandlers,
  optionalBoolean,
  optionalString,
  requiredString,
} from './context';

export const MAINTENANCE_HANDLERS: HomiioToolHandlers = {
  async listMyMaintenanceRequests(input, { accountId }) {
    const { page, limit } = parsePagination(input);
    const leaseId = optionalString(input, 'leaseId');
    const propertyId = optionalString(input, 'propertyId');
    const result = await listMyMaintenanceRequests(accountId, {
      ...(leaseId === undefined ? {} : { leaseId }),
      ...(propertyId === undefined ? {} : { propertyId }),
      openOnly: optionalBoolean(input, 'openOnly') === true,
      page,
      limit,
    });
    const { data, pagination } = paginationResponse(result.requests, page, limit, result.total);
    return { data, pagination };
  },

  async getMaintenanceRequest(input, { accountId }) {
    return { data: await getMaintenanceRequest(accountId, requiredString(input, 'requestId')) };
  },

  async createMaintenanceRequest(input, { accountId }) {
    return {
      data: await createMaintenanceRequest(accountId, {
        leaseId: input.leaseId,
        category: input.category,
        urgency: input.urgency,
        title: input.title,
        description: input.description,
      }),
    };
  },

  async commentOnMaintenanceRequest(input, { accountId }) {
    return {
      data: await commentOnMaintenanceRequest(accountId, requiredString(input, 'requestId'), {
        body: input.body,
      }),
    };
  },

  async transitionMaintenanceRequest(input, { accountId }) {
    return {
      data: await transitionMaintenanceRequest(accountId, requiredString(input, 'requestId'), {
        status: input.status,
        scheduledFor: input.scheduledFor,
      }),
    };
  },
};
