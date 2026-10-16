/**
 * Home-exchange tools: swaps, free hosting (optionally paid in guest points),
 * and the reviews after a completed exchange. Handlers:
 * `handlers/exchanges.ts`; use cases: `domain/exchanges.ts`.
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

const READ = 'housing.exchanges.read';
const MANAGE = 'housing.exchanges.manage';

const EXCHANGE_STATUSES = ['pending', 'confirmed', 'declined', 'cancelled', 'completed'] as const;
const window = objectInput({ start: isoDateInput, end: isoDateInput }, ['start', 'end']);
const guestPointsKey = {
  type: 'string',
  pattern: '^[A-Za-z0-9_-]{8,64}$',
  description: 'A stable key for this guest-points intent, reused on a retry.',
} as const;
const transition = (extra: Record<string, unknown> = {}) =>
  objectInput({ exchangeRequestId: idInput, message: optionalTextInput(2000), ...extra }, [
    'exchangeRequestId',
  ]);
const rating = { type: 'integer', minimum: 1, maximum: 5 } as const;

export const EXCHANGE_TOOLS: readonly CatalogTool[] = [
  actTool({
    name: 'requestExchange',
    description:
      "Propose a home exchange on a listing open to exchange: a 'swap' (offer one of the person's own exchange listings for an offered window) or 'host' (a one-way stay, free, or paid in guest points with usesGuestPoints + guestPointsIdempotencyKey). The host decides. On an external listing nothing is requested: the result is { status: 'external_listing', sourceUrl }.",
    capability: MANAGE,
    capabilityPackage: 'communicate',
    input: objectInput(
      {
        propertyId: idInput,
        mode: enumInput(['swap', 'host']),
        requestedWindow: window,
        offeredPropertyId: idInput,
        offeredWindow: window,
        message: optionalTextInput(2000),
        usesGuestPoints: booleanInput,
        guestPointsIdempotencyKey: guestPointsKey,
      },
      ['propertyId', 'mode', 'requestedWindow'],
    ),
  }),
  readTool({
    name: 'listMyExchangeRequests',
    description:
      'List the exchange requests the person made, or with asHost the requests on their own listings.',
    capability: READ,
    input: objectInput({
      asHost: booleanInput,
      status: enumInput(EXCHANGE_STATUSES),
      page: pageInput,
      limit: limitInput,
    }),
  }),
  readTool({
    name: 'getExchangeRequest',
    description: 'Read one exchange request the person made or hosts.',
    capability: READ,
    input: objectInput({ exchangeRequestId: idInput }, ['exchangeRequestId']),
  }),
  actTool({
    name: 'confirmExchange',
    description:
      "Accept a pending exchange request on the person's own listing; a guest-points stay settles its points. Refused when either home is no longer free or no longer open to exchange.",
    capability: MANAGE,
    capabilityPackage: 'administer',
    input: transition({ guestPointsIdempotencyKey: guestPointsKey }),
  }),
  actTool({
    name: 'declineExchange',
    description:
      "Decline a pending exchange request on the person's own listing; reserved guest points go back to the guest.",
    capability: MANAGE,
    capabilityPackage: 'administer',
    input: transition(),
  }),
  actTool({
    name: 'cancelExchange',
    description:
      'Cancel an exchange the person requested (pending or confirmed). Cancelling an already cancelled request is not an error.',
    capability: MANAGE,
    capabilityPackage: 'administer',
    input: transition(),
  }),
  actTool({
    name: 'completeExchange',
    description:
      'Mark a confirmed exchange as completed once its stay window (both, for a swap) has ended, so both parties can review each other.',
    capability: MANAGE,
    capabilityPackage: 'administer',
    input: transition(),
  }),
  actTool({
    name: 'writeExchangeReview',
    description:
      'Review the other party of a completed exchange the person took part in (once per exchange): a 1–5 rating, an optional comment and optional 1–5 category ratings.',
    capability: MANAGE,
    capabilityPackage: 'publish',
    input: objectInput(
      {
        exchangeRequestId: idInput,
        rating,
        comment: optionalTextInput(2000),
        categories: objectInput({
          communication: rating,
          cleanliness: rating,
          accuracy: rating,
          hospitality: rating,
        }),
      },
      ['exchangeRequestId', 'rating'],
    ),
  }),
  readTool({
    name: 'listExchangeReviews',
    description: 'Both reviews of one exchange the person took part in.',
    capability: READ,
    input: objectInput({ exchangeRequestId: idInput }, ['exchangeRequestId']),
  }),
  readTool({
    name: 'listUserExchangeReviews',
    description:
      'The exchange reviews written about one person (by Oxy user id), newest first, with their average rating — to judge a host or guest before an exchange.',
    capability: READ,
    input: objectInput({ oxyUserId: idInput, page: pageInput, limit: limitInput }, ['oxyUserId']),
  }),
];
