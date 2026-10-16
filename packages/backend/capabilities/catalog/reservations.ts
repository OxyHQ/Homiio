/**
 * Short-stay reservation tools. Handlers: `handlers/reservations.ts`; use
 * cases: `domain/reservations.ts`.
 */

import type { CatalogTool } from '@oxy.so/contracts';

import {
  actTool,
  booleanInput,
  enumInput,
  idInput,
  isoDateInput,
  limitInput,
  objectInput,
  optionalTextInput,
  pageInput,
  readTool,
} from './define';

const READ = 'housing.reservations.read';
const MANAGE = 'housing.reservations.manage';

const RESERVATION_STATUSES = [
  'pending',
  'confirmed',
  'declined',
  'cancelled',
  'completed',
] as const;
const reservationOnly = objectInput({ reservationId: idInput }, ['reservationId']);

export const RESERVATION_TOOLS: readonly CatalogTool[] = [
  actTool({
    name: 'createReservation',
    description:
      'Book a short stay on a listing offered for short-term rent, as the guest. The price is computed from the listing; it is confirmed at once when the listing has instant book, otherwise the host decides. No payment is taken. On an external listing nothing is booked: the result is { status: "external_listing", sourceUrl }.',
    capability: MANAGE,
    capabilityPackage: 'communicate',
    input: objectInput(
      {
        propertyId: idInput,
        checkIn: isoDateInput,
        checkOut: isoDateInput,
        guestCount: { type: 'integer', minimum: 1, maximum: 100 },
        specialRequests: optionalTextInput(2000),
      },
      ['propertyId', 'checkIn', 'checkOut', 'guestCount'],
    ),
  }),
  readTool({
    name: 'listMyReservations',
    description:
      "List the person's short-stay reservations as guest, or with asHost the reservations on their own listings.",
    capability: READ,
    input: objectInput({
      asHost: booleanInput,
      status: enumInput(RESERVATION_STATUSES),
      page: pageInput,
      limit: limitInput,
    }),
  }),
  readTool({
    name: 'getReservation',
    description: 'Read one reservation the person is the guest or the host of.',
    capability: READ,
    input: reservationOnly,
  }),
  actTool({
    name: 'confirmReservation',
    description:
      "Accept a pending reservation on the person's own listing. Refused when the dates are now taken, the stay has started, the guest count no longer fits or the listing was re-priced.",
    capability: MANAGE,
    capabilityPackage: 'administer',
    input: reservationOnly,
  }),
  actTool({
    name: 'declineReservation',
    description: "Decline a pending reservation on the person's own listing.",
    capability: MANAGE,
    capabilityPackage: 'administer',
    input: reservationOnly,
  }),
  actTool({
    name: 'cancelReservation',
    description:
      "Cancel a reservation as its guest (within the listing's cancellation policy) or as its host. Cancelling an already cancelled reservation is not an error.",
    capability: MANAGE,
    capabilityPackage: 'administer',
    input: reservationOnly,
  }),
  readTool({
    name: 'getListingAvailability',
    description:
      "A listing's stay calendar: the host's availability windows and the dates already booked (date ranges only, never who booked), plus its minimum and maximum nights, guest capacity, instant book and cancellation policy.",
    capability: READ,
    input: objectInput({ propertyId: idInput }, ['propertyId']),
  }),
];
