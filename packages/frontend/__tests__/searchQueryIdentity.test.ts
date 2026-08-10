/**
 * One search, one identity — the string the map, the list, the heading, the
 * count, the cache key and the server's echo all quote.
 *
 * The defect it exists for renders perfectly: the header says "Barcelona", the
 * map frames Barcelona, and the list is answering a request that still carries
 * Madrid's bounds. Nothing throws and no type is violated. The only way to see
 * it is to ask each surface which query it is showing and compare the answers,
 * which is impossible unless the answer is a single deterministic value derived
 * from the EFFECTIVE query rather than from whatever object each surface holds.
 *
 * Two properties are load-bearing, and they pull in opposite directions:
 *
 *  - **Total.** Any change that changes the results must change the id.
 *    Missing one merges two searches into a single cache entry and a single
 *    heading, silently.
 *  - **Coarse where it must be.** The device's own position never reaches it,
 *    for the same reason it never reaches `locationKey`, a URL or a log.
 */
import {
  OfferingType,
  PropertyType,
  isOpaqueId,
  type LocationSelection,
} from '@homiio/shared-types';
import {
  buildSearchParams,
  searchQueryDescriptor,
  searchQueryId,
} from '@/hooks/usePropertySearch';
import type { SearchQuery } from '@/components/search/types';

function baseQuery(overrides: Partial<SearchQuery> = {}): SearchQuery {
  return {
    offering: OfferingType.LONG_TERM_RENT,
    location: null,
    queryText: null,
    propertyTypes: [],
    amenities: [],
    sortBy: 'relevance',
    sortOrder: 'desc',
    ...overrides,
  };
}

const BARCELONA_CITY_ID = '01H8XQ7C2R9V6WQ2N4M0KJ3ZTA';

const barcelona: LocationSelection = {
  kind: 'place',
  source: { kind: 'homiio', entity: 'city', id: BARCELONA_CITY_ID },
  placeType: 'city',
  label: { primary: 'Barcelona', secondary: 'Catalonia, Spain', kind: 'place' },
  admin: { countryCode: 'ES', regionName: 'Catalonia', cityName: 'Barcelona' },
  center: { longitude: 2.1734035, latitude: 41.3850639 },
  bounds: { west: 2.05, south: 41.32, east: 2.23, north: 41.47 },
  precision: 'centroid',
};

const madridViewport: LocationSelection = {
  kind: 'map_bounds',
  bounds: { west: -3.75, south: 40.38, east: -3.65, north: 40.45 },
  center: { longitude: -3.7, latitude: 40.415 },
  label: { primary: 'search.summary.mapArea', kind: 'generated' },
  precision: 'area',
};

const deviceFix: LocationSelection = {
  kind: 'current_location',
  center: { longitude: 2.1734035, latitude: 41.3850639 },
  radiusMeters: 25_000,
  precision: 'exact',
};

describe('searchQueryId', () => {
  it('is the one shape the observability contract accepts for an opaque id', () => {
    // Not cosmetic: the backend validates the echo with `isOpaqueId` before
    // writing it into a response body, and the analytics events in
    // `observability/schema` declare `queryId` with the same field kind. An id
    // in another shape would be dropped by the server and rejected by the
    // emitter, and both silently.
    expect(isOpaqueId(searchQueryId(baseQuery()))).toBe(true);
    expect(isOpaqueId(searchQueryId(baseQuery({ location: barcelona })))).toBe(true);
  });

  it('is stable for the same query', () => {
    expect(searchQueryId(baseQuery({ bedrooms: 2 }))).toBe(searchQueryId(baseQuery({ bedrooms: 2 })));
  });

  it('changes when the geographic scope is replaced', () => {
    // The Barcelona → Madrid case, at the identity layer: confirming a map
    // viewport must produce a DIFFERENT search, or the previous city's results
    // are served from cache under the new area's heading.
    expect(searchQueryId(baseQuery({ location: barcelona }))).not.toBe(
      searchQueryId(baseQuery({ location: madridViewport })),
    );
  });

  it('separates two cities that share a name', () => {
    // Identity comes from the canonical id, never the label — the two
    // Barcelonas differ nowhere else.
    const venezuelan: LocationSelection = {
      ...barcelona,
      source: { kind: 'homiio', entity: 'city', id: 'A_DIFFERENT_CITY_ID' },
      admin: { countryCode: 'VE', regionName: 'Anzoátegui', cityName: 'Barcelona' },
    };
    expect(searchQueryId(baseQuery({ location: barcelona }))).not.toBe(
      searchQueryId(baseQuery({ location: venezuelan })),
    );
  });

  it('separates free text from a place with the same spelling', () => {
    // "Barcelona" typed and Barcelona picked are different questions (ADR 0002
    // §4.1), so they are different searches and must not share a cache entry.
    expect(searchQueryId(baseQuery({ queryText: 'Barcelona' }))).not.toBe(
      searchQueryId(baseQuery({ location: barcelona })),
    );
  });

  describe('every dimension that changes the results changes the id', () => {
    // Each case is a query that differs from the base in exactly one respect.
    // A dimension missing from the descriptor would show up here as two
    // different searches sharing one id — which in production is one heading
    // and one count over the other query's rows.
    const cases: [string, Partial<SearchQuery>][] = [
      ['offering', { offering: OfferingType.SHORT_TERM_RENT }],
      ['free text', { queryText: 'loft with a terrace' }],
      ['property type', { propertyTypes: [PropertyType.APARTMENT] }],
      ['minimum price', { priceMin: 800 }],
      ['maximum price', { priceMax: 1400 }],
      ['bedrooms', { bedrooms: 2 }],
      ['bathrooms', { bathrooms: 2 }],
      ['amenities', { amenities: ['balcony'] }],
      ['guests', { guests: 3 }],
      ['dates', { dates: { start: '2026-06-01', end: '2026-06-08' } }],
      ['sort field', { sortBy: 'price' }],
      ['sort direction', { sortOrder: 'asc' }],
      ['fair price', { fairPrice: true }],
      ['instant book', { instantBook: true }],
      ['pet friendly', { petFriendly: true }],
      ['location', { location: barcelona }],
    ];

    const baseId = searchQueryId(baseQuery());

    it.each(cases)('%s', (_label, overrides) => {
      expect(searchQueryId(baseQuery(overrides))).not.toBe(baseId);
    });

    it('covers every param the request can carry', () => {
      // The floor that stops the list above from rotting into a subset. A
      // filter added to `buildSearchParams` and forgotten here would leave two
      // searches sharing an id and nothing would say so — so the params of a
      // fully-populated query are compared against what the cases produce,
      // and an unlisted one fails.
      const populated = baseQuery(
        cases.reduce<Partial<SearchQuery>>((acc, [, overrides]) => ({ ...acc, ...overrides }), {}),
      );
      const emitted = Object.keys(buildSearchParams(populated));
      // Paging is the infinite query's business and the geographic params are
      // the location dimension, which the `location` case covers.
      const accountedFor = new Set([
        'page',
        'limit',
        'offering',
        'sortBy',
        'sortOrder',
        'q',
        'propertyType',
        'priceMin',
        'priceMax',
        'minSalePrice',
        'maxSalePrice',
        'bedrooms',
        'bathrooms',
        'amenities',
        'guests',
        'checkIn',
        'checkOut',
        'fairPrice',
        'instantBook',
        'petFriendly',
        'exchangeMode',
        'city',
        'state',
        'neighborhood',
        'lat',
        'lng',
        'radius',
        'swLat',
        'swLng',
        'neLat',
        'neLng',
      ]);
      expect(emitted.filter((key) => !accountedFor.has(key))).toEqual([]);
      // …and the list really did populate the request, so the assertion above
      // is not passing over an almost-empty params object.
      expect(emitted.length).toBeGreaterThanOrEqual(18);
    });
  });

  describe('no coordinate of a person ever reaches it', () => {
    it('keys a device search by its RADIUS and nothing else', () => {
      const descriptor = searchQueryDescriptor(baseQuery({ location: deviceFix }));

      // The fix goes in the REQUEST — that is the one place it legitimately
      // goes — and nowhere near the identity.
      expect(buildSearchParams(baseQuery({ location: deviceFix }))).toMatchObject({
        lat: 41.3850639,
        lng: 2.1734035,
      });
      expect(JSON.stringify(descriptor)).not.toContain('41.3850639');
      expect(JSON.stringify(descriptor)).not.toContain('2.1734035');
      expect(descriptor.center).toBeUndefined();
      expect(descriptor.radiusKm).toBe(25);
      expect(descriptor.locationKind).toBe('radius');
    });

    it('keys a place by its id, not by its centre', () => {
      const descriptor = searchQueryDescriptor(baseQuery({ location: barcelona }));
      expect(descriptor.placeKey).toBe(`homiio:city:${BARCELONA_CITY_ID}`);
      expect(descriptor.center).toBeUndefined();
    });

    it('does carry a map viewport, which is not anybody position', () => {
      // The deliberate exception, stated so nobody "fixes" it: a confirmed
      // viewport IS the query, and an identity that dropped it could not tell
      // one area from another.
      const descriptor = searchQueryDescriptor(baseQuery({ location: madridViewport }));
      expect(descriptor.bounds).toEqual({ west: -3.75, south: 40.38, east: -3.65, north: 40.45 });
      expect(descriptor.locationKind).toBe('bbox');
    });
  });
});
