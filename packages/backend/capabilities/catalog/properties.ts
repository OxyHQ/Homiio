import type { CatalogTool } from '@oxy.so/contracts';
import {
  actTool,
  enumInput,
  idInput,
  limitInput,
  objectInput,
  openObjectInput,
  optionalTextInput,
  pageInput,
  readTool,
} from './define';

/**
 * The owner side of a listing (`domain/properties.ts`), rooms
 * (`domain/rooms.ts`) and the analytics a person reads (`domain/analytics.ts`).
 *
 * Every write acts on the effective account's OWN listings: a listing that is
 * someone else's answers PROPERTY_NOT_FOUND / NOT_FOUND, exactly like the
 * route, except `markPropertyTransacted`, which has always answered 403.
 */

const PROPERTY_BODY = openObjectInput(
  'The listing as the app sends it to POST/PUT /api/properties: `type`, `offerings` (non-empty; each with its priced block: `longTermRent.monthlyAmount`, `shortTermRent.nightlyRate`, `sale.price`, `exchange.mode`), an inline `address` { street, city, state, postal_code, country } (+ optional `location` { type: "Point", coordinates: [lng, lat] }) or an `addressId`, and any whitelisted listing field (description, bedrooms, bathrooms, squareFootage, amenities, images the app already uploaded, status, availableFrom, …). Fields outside the whitelist are ignored.',
);

const ROOM_BODY = openObjectInput(
  'The room as the app sends it to /api/rooms: whitelisted listing fields (description, longTermRent, amenities, images, status, …). On create, `parentPropertyId` names one of the person’s own listings and the room inherits its address unless an `address` or `addressId` is given.',
);

const page = { page: pageInput, limit: limitInput };

export const PROPERTY_TOOLS: readonly CatalogTool[] = [
  readTool({
    name: 'listMyProperties',
    description:
      "List the person's own listings, newest first, drafts included and archived excluded, at the owner's exact precision. Paginated.",
    capability: 'housing.properties.read',
    input: objectInput(page),
  }),
  readTool({
    name: 'getMyProperty',
    description:
      "Read one of the person's own listings at the owner's exact precision. Someone else's listing answers PROPERTY_NOT_FOUND; use getListing for the public view.",
    capability: 'housing.properties.read',
    input: objectInput({ propertyId: idInput }, ['propertyId']),
  }),
  readTool({
    name: 'listPropertiesByOwner',
    description:
      "List what a landlord is offering: another owner's PUBLISHED, visible listings at the public precision. `exclude` leaves one listing out (e.g. the one being viewed).",
    capability: 'housing.properties.read',
    input: objectInput({ oxyUserId: idInput, exclude: idInput, ...page }, ['oxyUserId']),
  }),
  actTool({
    name: 'createProperty',
    description:
      'Create a listing owned by the person, validated exactly like the app’s listing form (address, type and offerings are required; offering rules and the field whitelist apply). `status: "published"` publishes it at once; `"draft"` keeps it private.',
    capability: 'housing.properties.manage',
    capabilityPackage: 'publish',
    input: objectInput({ property: PROPERTY_BODY }, ['property']),
  }),
  actTool({
    name: 'updateProperty',
    description:
      "Edit one of the person's own listings with the same body the app's edit form sends (the form's full validation applies, so send address, type and offerings again). Only whitelisted fields change. Someone else's listing answers PROPERTY_NOT_FOUND.",
    capability: 'housing.properties.manage',
    capabilityPackage: 'administer',
    input: objectInput({ propertyId: idInput, property: PROPERTY_BODY }, [
      'propertyId',
      'property',
    ]),
  }),
  actTool({
    name: 'publishProperty',
    description:
      "Publish one of the person's own listings (status `published`) so it appears in search. The listing's offering rules are checked against what it already stores. Someone else's listing answers PROPERTY_NOT_FOUND.",
    capability: 'housing.properties.publish',
    capabilityPackage: 'publish',
    rollback: 'manual',
    input: objectInput({ propertyId: idInput }, ['propertyId']),
  }),
  actTool({
    name: 'unpublishProperty',
    description:
      "Withdraw one of the person's own listings from search by returning it to `draft`; it stays in their list and can be published again. Someone else's listing answers PROPERTY_NOT_FOUND.",
    capability: 'housing.properties.publish',
    capabilityPackage: 'administer',
    rollback: 'manual',
    input: objectInput({ propertyId: idInput }, ['propertyId']),
  }),
  actTool({
    name: 'deleteProperty',
    description:
      "Delete (archive) one of the person's own listings. It disappears from every feed and from their list. Someone else's listing answers PROPERTY_NOT_FOUND.",
    capability: 'housing.properties.manage',
    capabilityPackage: 'administer',
    input: objectInput({ propertyId: idInput }, ['propertyId']),
  }),
  actTool({
    name: 'markPropertyTransacted',
    description:
      "Close the deal on one of the person's own listings: mark it `rented` or `sold` (inferred from its offerings when omitted) and settle the referring partner's commission, which is created at most once however often this is called. Someone else's listing answers FORBIDDEN (403).",
    capability: 'housing.properties.manage',
    capabilityPackage: 'administer',
    input: objectInput({ propertyId: idInput, status: enumInput(['rented', 'sold']) }, [
      'propertyId',
    ]),
  }),
  readTool({
    name: 'listRooms',
    description:
      'Search rooms (room-type listings) at the public precision: rent range, city, state, furnished status, amenities (all must match), status (drafts excluded unless asked), owner, sort. A city or state that resolves to no place answers an empty page.',
    capability: 'housing.rooms.read',
    input: objectInput({
      ...page,
      minRent: { type: 'number', minimum: 0 },
      maxRent: { type: 'number', minimum: 0 },
      city: optionalTextInput(200),
      state: optionalTextInput(200),
      furnishedStatus: optionalTextInput(50),
      amenities: { type: 'array', items: optionalTextInput(100), maxItems: 50 },
      status: optionalTextInput(50),
      oxyUserId: idInput,
      sortBy: enumInput([
        'createdAt',
        'updatedAt',
        'longTermRent.monthlyAmount',
        'squareFootage',
        'bedrooms',
        'bathrooms',
      ]),
      sortOrder: enumInput(['asc', 'desc']),
    }),
  }),
  readTool({
    name: 'getRoom',
    description:
      "Read one room: the owner's exact precision when it is the person's own room, the published precision otherwise. A non-room id answers NOT_FOUND.",
    capability: 'housing.rooms.read',
    input: objectInput({ roomId: idInput }, ['roomId']),
  }),
  actTool({
    name: 'createRoom',
    description:
      "Create a room under one of the person's own listings (`room.parentPropertyId`). A parent that is not theirs answers PARENT_PROPERTY_NOT_FOUND.",
    capability: 'housing.rooms.manage',
    capabilityPackage: 'publish',
    input: objectInput({ room: ROOM_BODY }, ['room']),
  }),
  actTool({
    name: 'updateRoom',
    description:
      "Edit one of the person's own rooms (whitelisted listing fields only). Someone else's room answers NOT_FOUND.",
    capability: 'housing.rooms.manage',
    capabilityPackage: 'administer',
    input: objectInput({ roomId: idInput, room: ROOM_BODY }, ['roomId', 'room']),
  }),
  actTool({
    name: 'deleteRoom',
    description:
      "Delete (archive) one of the person's own rooms. Someone else's room answers NOT_FOUND.",
    capability: 'housing.rooms.manage',
    capabilityPackage: 'administer',
    input: objectInput({ roomId: idInput }, ['roomId']),
  }),
  readTool({
    name: 'getMyAnalytics',
    description:
      "How the person's own listings are doing over a period (7d, 30d or 90d; default 30d): views and unique viewers, saves, viewing requests received by status, plus plain-language insights. Every figure is real platform data; nothing is estimated.",
    capability: 'housing.analytics.read',
    input: objectInput({ period: enumInput(['7d', '30d', '90d']) }),
  }),
  readTool({
    name: 'getAppStats',
    description:
      "Homiio's app-wide catalogue figures: listing and city totals, saves, rent average/min/max, top cities by listings with their average rent, and the rent band distribution.",
    capability: 'housing.analytics.read',
    input: objectInput({}),
  }),
];
