import { ListingReportReason, OfferingType } from '@homiio/shared-types';
import type { CatalogTool } from '@oxy.so/contracts';

import {
  actTool,
  booleanInput,
  enumInput,
  idInput,
  limitInput,
  objectInput,
  optionalTextInput,
  pageInput,
  readTool,
  textInput,
} from './define';

const READ = 'housing.listings.read';

const latitude = { type: 'number', minimum: -90, maximum: 90 } as const;
const longitude = { type: 'number', minimum: -180, maximum: 180 } as const;
const amount = { type: 'number', minimum: 0 } as const;
const count = { type: 'integer', minimum: 0, maximum: 50 } as const;
const stringList = (description: string) =>
  ({
    type: 'array',
    items: { type: 'string', minLength: 1, maxLength: 100 },
    maxItems: 50,
    description,
  }) as const;

/** The filters both listing feeds share (`controllers/property/commonFilters.ts`). */
const COMMON_FILTERS = {
  type: optionalTextInput(50),
  bedrooms: count,
  minBedrooms: count,
  maxBedrooms: count,
  bathrooms: count,
  minBathrooms: count,
  maxBathrooms: count,
  minSquareFootage: amount,
  maxSquareFootage: amount,
  amenities: stringList('Every listed amenity must be present.'),
  hasPhotos: booleanInput,
  verified: booleanInput,
  eco: booleanInput,
  fairPrice: booleanInput,
  housingType: optionalTextInput(50),
  layoutType: optionalTextInput(50),
  furnishedStatus: optionalTextInput(50),
  petPolicy: optionalTextInput(50),
  leaseTerm: optionalTextInput(50),
  parkingType: optionalTextInput(50),
  petFriendly: booleanInput,
  utilitiesIncluded: booleanInput,
  availableFromAfter: optionalTextInput(40),
  availableFromBefore: optionalTextInput(40),
  excludeIds: stringList('Listing ids to leave out.'),
} as const;

export const LISTING_TOOLS: readonly CatalogTool[] = [
  readTool({
    name: 'searchListings',
    description:
      "Search Homiio's listings, exactly like the Explore screen. Say WHERE: a city/state/neighborhood/country (call resolvePlace first for a place name), a bounding box (swLat/swLng/neLat/neLng) or a centre and radius (lat/lng/radius in metres) — no location means every area, never an implied one. The answer's `location` echoes the scope that was applied; `location.status: 'unresolved'` means the named place was not understood and the page is empty, not that there are no homes.",
    capability: READ,
    input: objectInput({
      q: optionalTextInput(200),
      city: optionalTextInput(200),
      state: optionalTextInput(200),
      neighborhood: optionalTextInput(200),
      country: { type: 'string', minLength: 2, maxLength: 2, description: 'ISO-3166-1 alpha-2.' },
      swLat: latitude,
      swLng: longitude,
      neLat: latitude,
      neLng: longitude,
      lat: latitude,
      lng: longitude,
      radius: { type: 'number', minimum: 1, maximum: 200_000, description: 'Metres.' },
      offering: enumInput(Object.values(OfferingType)),
      propertyType: optionalTextInput(50),
      minRent: amount,
      maxRent: amount,
      priceMin: amount,
      priceMax: amount,
      priceCurrency: { type: 'string', minLength: 3, maxLength: 4 },
      minSalePrice: amount,
      maxSalePrice: amount,
      exchangeMode: optionalTextInput(50),
      sizeMin: amount,
      sizeMax: amount,
      floorMin: { type: 'integer', minimum: -5, maximum: 200 },
      floorMax: { type: 'integer', minimum: -5, maximum: 200 },
      groundFloor: booleanInput,
      hasElevator: booleanInput,
      availableNow: booleanInput,
      availableBy: optionalTextInput(40),
      checkIn: optionalTextInput(40),
      checkOut: optionalTextInput(40),
      guests: count,
      minGuests: count,
      instantBook: booleanInput,
      features: stringList('Housing features that must all be present.'),
      ...COMMON_FILTERS,
      // `salePrice` is not offered: the route lowercases `sortBy` before matching,
      // so it never matches the camel-cased field and falls back to newest.
      sortBy: enumInput(['createdAt', 'price', 'relevance', 'fairness']),
      sortOrder: enumInput(['asc', 'desc']),
      page: pageInput,
      limit: limitInput,
    }),
    limitKeys: [{ key: 'limit', kind: 'maximum_number' }],
  }),
  readTool({
    name: 'findNearbyListings',
    description:
      'Listings within a radius of a point (default 10 km), image-bearing first, then newest. Both coordinates are required.',
    capability: READ,
    input: objectInput(
      {
        latitude,
        longitude,
        maxDistance: { type: 'number', minimum: 1, maximum: 200_000, description: 'Metres.' },
        ...COMMON_FILTERS,
        page: pageInput,
        limit: limitInput,
      },
      ['latitude', 'longitude'],
    ),
    limitKeys: [{ key: 'limit', kind: 'maximum_number' }],
  }),
  readTool({
    name: 'getListing',
    description:
      "One listing with everything its page shows. The person's own listing comes at owner precision (exact floor and unit); anyone else's at the precision it publishes. A deleted or restricted listing is not found unless it is the person's own. External listings (`isExternal`) are advertised elsewhere: their `sourceUrl` is the only way to contact them.",
    capability: READ,
    input: objectInput({ propertyId: idInput }, ['propertyId']),
  }),
  readTool({
    name: 'resolvePlace',
    description:
      'Turn a city name the person said into the place Homiio searches. Answers `resolved` with `location` (pass its city id to searchListings), `ambiguous` with the candidates (ask the person which one — never pick), or `not_found`. Give `state` (a region name) to disambiguate.',
    capability: READ,
    input: objectInput({ city: textInput(200), state: optionalTextInput(200) }, ['city']),
  }),
  actTool({
    name: 'reportListing',
    description:
      'Report a problem with a listing to community moderation (`inaccurate`, `scam`, `inappropriate`, `unavailable`, `privacy` for an exposed home or address, `unsafe`, or `other` with `details`). Re-reporting while the person already has an open report returns that report instead of filing a second one.',
    capability: 'housing.listings.report',
    capabilityPackage: 'communicate',
    input: objectInput(
      {
        propertyId: idInput,
        reason: enumInput(Object.values(ListingReportReason)),
        details: optionalTextInput(4000),
        contactEmail: optionalTextInput(320),
      },
      ['propertyId', 'reason'],
    ),
  }),
];
