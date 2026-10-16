/**
 * Viewing tools: asking to see a home, deciding on requests as its owner, and
 * the owner's published viewing schedule. Handlers: `handlers/viewings.ts`;
 * use cases: `domain/viewings.ts`.
 */

import type { CatalogTool } from '@oxy.so/contracts';
import {
  MAX_VIEWING_DURATION_MINUTES,
  MIN_VIEWING_DURATION_MINUTES,
  VIEWING_HORIZON_MAX_DAYS,
  VIEWING_MODALITIES,
  VIEWING_WINDOWS_MAX,
} from '@homiio/shared-types';

import {
  actTool,
  enumInput,
  idInput,
  limitInput,
  objectInput,
  optionalTextInput,
  pageInput,
  readTool,
} from './define';

const READ = 'housing.viewings.read';
const MANAGE = 'housing.viewings.manage';

const VIEWING_STATUSES = ['pending', 'approved', 'declined', 'cancelled'] as const;

const civilDate = {
  type: 'string',
  pattern: '^\\d{4}-\\d{2}-\\d{2}$',
  description: "Civil date YYYY-MM-DD in the listing's own time zone.",
} as const;
const civilTime = {
  type: 'string',
  pattern: '^\\d{2}:\\d{2}$',
  description: "Civil time HH:MM (24h) in the listing's own time zone.",
} as const;
const modality = { ...enumInput(VIEWING_MODALITIES), description: 'Defaults to in_person.' };
const ownerResponse = {
  ...optionalTextInput(2000),
  description: "The owner's own words to the requester, sent with the notification.",
};

const viewingWindow = objectInput(
  {
    weekday: { type: 'integer', minimum: 0, maximum: 6, description: '0 = Sunday … 6 = Saturday.' },
    startMinute: {
      type: 'integer',
      minimum: 0,
      maximum: 1439,
      description: 'Minutes after midnight.',
    },
    endMinute: {
      type: 'integer',
      minimum: 1,
      maximum: 1440,
      description: 'Minutes after midnight.',
    },
    slotMinutes: {
      type: 'integer',
      minimum: MIN_VIEWING_DURATION_MINUTES,
      maximum: MAX_VIEWING_DURATION_MINUTES,
    },
    modality: enumInput(VIEWING_MODALITIES),
  },
  ['weekday', 'startMinute', 'endMinute', 'modality'],
);

export const VIEWING_TOOLS: readonly CatalogTool[] = [
  actTool({
    name: 'requestViewing',
    description:
      "Ask a listing's owner for a viewing at a date and time (in the listing's time zone; use getViewingAvailability first when the owner publishes slots). The owner is notified. On an external listing nothing is requested: the result is { status: 'external_listing', sourceUrl } — send the person to that page.",
    capability: MANAGE,
    capabilityPackage: 'communicate',
    input: objectInput(
      {
        propertyId: idInput,
        date: civilDate,
        time: civilTime,
        modality,
        message: optionalTextInput(2000),
      },
      ['propertyId', 'date', 'time'],
    ),
  }),
  readTool({
    name: 'listMyViewingRequests',
    description:
      'List the viewing requests the person has made, newest first, optionally by status.',
    capability: READ,
    input: objectInput({ status: enumInput(VIEWING_STATUSES), page: pageInput, limit: limitInput }),
  }),
  readTool({
    name: 'listListingViewingRequests',
    description:
      "List viewing requests on one listing: every request when the person owns it, otherwise only the person's own requests for it.",
    capability: READ,
    input: objectInput(
      {
        propertyId: idInput,
        status: enumInput(VIEWING_STATUSES),
        page: pageInput,
        limit: limitInput,
      },
      ['propertyId'],
    ),
  }),
  actTool({
    name: 'approveViewing',
    description:
      "Approve a pending viewing request on the person's own listing, optionally with a reply. Refused when it is not their listing or another approved viewing overlaps.",
    capability: MANAGE,
    capabilityPackage: 'administer',
    input: objectInput({ viewingId: idInput, response: ownerResponse }, ['viewingId']),
  }),
  actTool({
    name: 'declineViewing',
    description:
      "Decline a pending viewing request on the person's own listing, optionally with a reply (for example another time that works).",
    capability: MANAGE,
    capabilityPackage: 'administer',
    input: objectInput({ viewingId: idInput, response: ownerResponse }, ['viewingId']),
  }),
  actTool({
    name: 'cancelViewing',
    description:
      'Cancel a viewing the person requested, or one on their own listing (the owner may add a reply). Cancelling an already cancelled viewing is not an error. The other party is notified.',
    capability: MANAGE,
    capabilityPackage: 'administer',
    input: objectInput({ viewingId: idInput, response: ownerResponse }, ['viewingId']),
  }),
  actTool({
    name: 'rescheduleViewing',
    description:
      'Move a pending viewing the person requested to another date and time, under the same rules as a new request.',
    capability: MANAGE,
    capabilityPackage: 'administer',
    input: objectInput(
      {
        viewingId: idInput,
        date: civilDate,
        time: civilTime,
        modality,
        message: optionalTextInput(2000),
      },
      ['viewingId', 'date', 'time'],
    ),
  }),
  readTool({
    name: 'getViewingAvailability',
    description:
      "The viewing slots a listing offers over the next days, in the listing's time zone. published: false means the owner has published no schedule and any future time may be proposed. External listings answer { status: 'external_listing', sourceUrl }.",
    capability: READ,
    input: objectInput(
      {
        propertyId: idInput,
        days: { type: 'integer', minimum: 1, maximum: VIEWING_HORIZON_MAX_DAYS },
      },
      ['propertyId'],
    ),
  }),
  readTool({
    name: 'getViewingWindows',
    description:
      "The weekly viewing schedule the person published for their own listing, with its time zone. Someone else's listing answers not found.",
    capability: READ,
    input: objectInput({ propertyId: idInput }, ['propertyId']),
  }),
  actTool({
    name: 'setViewingWindows',
    description:
      "Replace the weekly viewing schedule of the person's own listing (an empty list unpublishes it), and optionally its IANA time zone (null falls back to the city's zone). Visitors can then only pick offered slots.",
    capability: MANAGE,
    capabilityPackage: 'publish',
    input: objectInput(
      {
        propertyId: idInput,
        windows: { type: 'array', maxItems: VIEWING_WINDOWS_MAX, items: viewingWindow },
        timeZone: {
          type: ['string', 'null'],
          maxLength: 64,
          description: 'IANA zone, e.g. Europe/Madrid.',
        },
      },
      ['propertyId', 'windows'],
    ),
  }),
];
