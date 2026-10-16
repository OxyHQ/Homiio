/**
 * Exchange tools → `domain/exchanges.ts`, as `context.accountId`.
 *
 * Writes run the route's own validation chains first, so a tool refuses
 * exactly what the route refuses. The route's single PATCH is four tools here
 * (confirm, decline, cancel, complete), each the same domain transition with
 * its status fixed. An external target listing answers the typed
 * `{ status: 'external_listing', sourceUrl }` instead of the route's 400.
 */

import { ExchangeRequestStatus } from '@homiio/shared-types';

import {
  exchangePage,
  getExchangeRequest,
  listExchangeReviews,
  listMyExchangeRequests,
  listUserExchangeReviews,
  requestExchange,
  updateExchangeRequest,
  writeExchangeReview,
} from '../../domain/exchanges';
import * as validation from '../../middlewares/validation';
import { pageBody } from './bookingBodies';
import {
  type HomiioToolHandler,
  type HomiioToolHandlers,
  optionalBoolean,
  optionalString,
  requiredString,
} from './context';
import { runRouteValidation } from './routeValidation';

function transitionTo(status: string): HomiioToolHandler {
  return async (input, { accountId }) => {
    const exchangeRequestId = requiredString(input, 'exchangeRequestId');
    const message = optionalString(input, 'message');
    await runRouteValidation(validation.validateExchangeUpdate, {
      params: { id: exchangeRequestId },
      body: { status, ...(message !== undefined ? { message } : {}) },
    });
    const outcome = await updateExchangeRequest(accountId, {
      exchangeRequestId,
      status,
      message,
      guestPointsIdempotencyKey: input.guestPointsIdempotencyKey,
    });
    return { data: outcome.exchangeRequest, alreadyCancelled: outcome.alreadyCancelled };
  };
}

export const EXCHANGE_HANDLERS: HomiioToolHandlers = {
  async requestExchange(input, { accountId }) {
    await runRouteValidation(validation.validateExchangeRequest, { body: { ...input } });
    const outcome = await requestExchange(accountId, { ...input });
    return outcome.status === 'external_listing'
      ? { ...outcome }
      : { status: outcome.status, data: outcome.exchangeRequest };
  },

  async listMyExchangeRequests(input, { accountId }) {
    const result = await listMyExchangeRequests(accountId, {
      ...exchangePage(input.page, input.limit),
      status: optionalString(input, 'status'),
      asHost: optionalBoolean(input, 'asHost') === true,
    });
    return pageBody(result.rows, result.page, result.limit, result.total);
  },

  async getExchangeRequest(input, { accountId }) {
    return {
      data: await getExchangeRequest(accountId, {
        exchangeRequestId: requiredString(input, 'exchangeRequestId'),
      }),
    };
  },

  confirmExchange: transitionTo(ExchangeRequestStatus.CONFIRMED),
  declineExchange: transitionTo(ExchangeRequestStatus.DECLINED),
  cancelExchange: transitionTo(ExchangeRequestStatus.CANCELLED),
  completeExchange: transitionTo(ExchangeRequestStatus.COMPLETED),

  async writeExchangeReview(input, { accountId }) {
    const exchangeRequestId = requiredString(input, 'exchangeRequestId');
    const { rating, comment, categories } = input;
    await runRouteValidation(validation.validateExchangeReview, {
      params: { id: exchangeRequestId },
      body: { rating, comment, categories },
    });
    return {
      data: await writeExchangeReview(accountId, {
        exchangeRequestId,
        rating,
        comment,
        categories,
      }),
    };
  },

  async listExchangeReviews(input, { accountId }) {
    return {
      data: await listExchangeReviews(accountId, {
        exchangeRequestId: requiredString(input, 'exchangeRequestId'),
      }),
    };
  },

  async listUserExchangeReviews(input) {
    const result = await listUserExchangeReviews({
      subjectOxyUserId: requiredString(input, 'oxyUserId'),
      ...exchangePage(input.page, input.limit),
    });
    return pageBody(result.rows, result.page, result.limit, result.total, {
      meta: { averageRating: result.averageRating, reviewCount: result.total },
    });
  },
};
