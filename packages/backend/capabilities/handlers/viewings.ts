/**
 * Viewing tools → `domain/viewings.ts`, as `context.accountId`.
 *
 * Each answers the route's body without its envelope. The one deliberate
 * difference from the route: an external listing answers the typed
 * `{ status: 'external_listing', sourceUrl }` (the route's 400 would leave an
 * agent with nothing to offer), and a successful request carries
 * `status: 'requested'` beside its `data` so the two are told apart.
 */

import {
  approveViewing,
  cancelViewing,
  declineViewing,
  getViewingAvailability,
  getViewingWindows,
  listListingViewingRequests,
  listMyViewingRequests,
  requestViewing,
  rescheduleViewing,
  setViewingWindows,
  viewingHorizonDays,
  viewingPage,
} from '../../domain/viewings';
import { pageBody } from './bookingBodies';
import { type HomiioToolHandlers, optionalString, requiredString } from './context';

export const VIEWING_HANDLERS: HomiioToolHandlers = {
  async requestViewing(input, { accountId }) {
    const outcome = await requestViewing(accountId, {
      propertyId: requiredString(input, 'propertyId'),
      date: input.date,
      time: input.time,
      modality: input.modality,
      message: input.message,
    });
    return outcome.status === 'external_listing'
      ? { ...outcome }
      : { status: outcome.status, data: outcome.viewing };
  },

  async listMyViewingRequests(input, { accountId }) {
    const result = await listMyViewingRequests(accountId, {
      ...viewingPage(input.page, input.limit),
      status: optionalString(input, 'status'),
    });
    return pageBody(result.rows, result.page, result.limit, result.total);
  },

  async listListingViewingRequests(input, { accountId }) {
    const result = await listListingViewingRequests(accountId, {
      propertyId: requiredString(input, 'propertyId'),
      ...viewingPage(input.page, input.limit),
      status: optionalString(input, 'status'),
    });
    return pageBody(result.rows, result.page, result.limit, result.total);
  },

  async approveViewing(input, { accountId }) {
    return {
      data: await approveViewing(accountId, {
        viewingId: requiredString(input, 'viewingId'),
        response: input.response,
      }),
    };
  },

  async declineViewing(input, { accountId }) {
    return {
      data: await declineViewing(accountId, {
        viewingId: requiredString(input, 'viewingId'),
        response: input.response,
      }),
    };
  },

  async cancelViewing(input, { accountId }) {
    const outcome = await cancelViewing(accountId, {
      viewingId: requiredString(input, 'viewingId'),
      response: input.response,
    });
    return { data: outcome.viewing, alreadyCancelled: outcome.alreadyCancelled };
  },

  async rescheduleViewing(input, { accountId }) {
    return {
      data: await rescheduleViewing(accountId, {
        viewingId: requiredString(input, 'viewingId'),
        date: input.date,
        time: input.time,
        modality: input.modality,
        message: input.message,
      }),
    };
  },

  async getViewingAvailability(input) {
    const outcome = await getViewingAvailability({
      propertyId: requiredString(input, 'propertyId'),
      days: viewingHorizonDays(input.days),
    });
    return outcome.status === 'external_listing' ? { ...outcome } : { data: outcome.availability };
  },

  async getViewingWindows(input, { accountId }) {
    return {
      data: await getViewingWindows(accountId, { propertyId: requiredString(input, 'propertyId') }),
    };
  },

  async setViewingWindows(input, { accountId }) {
    return {
      data: await setViewingWindows(accountId, {
        propertyId: requiredString(input, 'propertyId'),
        windows: input.windows,
        timeZone: input.timeZone,
      }),
    };
  },
};
