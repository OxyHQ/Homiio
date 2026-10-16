/**
 * Reservation tools → `domain/reservations.ts`, as `context.accountId`.
 *
 * `createReservation` runs the route's own `validateReservation` chain first,
 * so a tool refuses exactly what the route refuses. The route's single PATCH is
 * three tools here — confirm and decline (host), cancel (guest or host) — each
 * the same domain transition with its status fixed, so a model never has to
 * know the status vocabulary. An external listing answers the typed
 * `{ status: 'external_listing', sourceUrl }` instead of the route's 400.
 */

import { ReservationStatus } from '@homiio/shared-types';

import {
  createReservation,
  getListingAvailability,
  getReservation,
  listMyReservations,
  reservationPage,
  updateReservationStatus,
} from '../../domain/reservations';
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
    const reservationId = requiredString(input, 'reservationId');
    await runRouteValidation(validation.validateReservationUpdate, {
      params: { id: reservationId },
      body: { status },
    });
    const outcome = await updateReservationStatus(accountId, { reservationId, status });
    return { data: outcome.reservation, alreadyCancelled: outcome.alreadyCancelled };
  };
}

export const RESERVATION_HANDLERS: HomiioToolHandlers = {
  async createReservation(input, { accountId }) {
    await runRouteValidation(validation.validateReservation, { body: { ...input } });
    const outcome = await createReservation(accountId, {
      propertyId: input.propertyId,
      checkIn: input.checkIn,
      checkOut: input.checkOut,
      guestCount: input.guestCount,
      specialRequests: input.specialRequests,
    });
    return outcome.status === 'external_listing'
      ? { ...outcome }
      : { status: outcome.status, data: outcome.reservation };
  },

  async listMyReservations(input, { accountId }) {
    const result = await listMyReservations(accountId, {
      ...reservationPage(input.page, input.limit),
      status: optionalString(input, 'status'),
      asHost: optionalBoolean(input, 'asHost') === true,
    });
    return pageBody(result.rows, result.page, result.limit, result.total);
  },

  async getReservation(input, { accountId }) {
    return {
      data: await getReservation(accountId, {
        reservationId: requiredString(input, 'reservationId'),
      }),
    };
  },

  confirmReservation: transitionTo(ReservationStatus.CONFIRMED),
  declineReservation: transitionTo(ReservationStatus.DECLINED),
  cancelReservation: transitionTo(ReservationStatus.CANCELLED),

  async getListingAvailability(input) {
    return {
      data: await getListingAvailability({ propertyId: requiredString(input, 'propertyId') }),
    };
  },
};
