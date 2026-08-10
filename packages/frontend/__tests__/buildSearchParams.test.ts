/**
 * `buildSearchParams` / `searchQueryKey` — the request, not the results.
 *
 * Every assertion here is on the EMITTED PARAMS. That is the design of this
 * file and not a stylistic choice: in almost every failure the location
 * contract exists to prevent, results still come back — the wrong ones, or none
 * — so a test that checks "some listings arrived" cannot distinguish any of
 * them. The Barcelona → Madrid case below is the sharpest instance: the broken
 * behaviour returns **zero**, which is the plausible-looking answer, and reads
 * in the UI as "this area is empty".
 *
 * ## The inverted assertion
 *
 * This suite used to ASSERT the bug. `it('maps a bounding box to rounded sw/ne
 * corner params')` expected `q: 'Barcelona'` alongside the box, pinning the
 * behaviour where a place's label was also sent as free text. That expectation
 * is inverted here rather than deleted — deleting it would leave the most
 * important property of the change untested, and would look in a diff exactly
 * like the quiet removal of an inconvenient test.
 *
 * Importing the module also pulls the hook's dependency graph (the `api`
 * client, `react-native`, `@oxyhq/core`) through Jest's module resolver, so
 * this suite doubles as proof that the jest-expo transform and
 * `transformIgnorePatterns` handle the app's ESM/native packages.
 */
import {
  OfferingType,
  PropertyType,
  type GeoBounds,
  type LocationSelection,
} from '@homiio/shared-types';
import {
  buildSearchParams,
  isUnscopeableLocation,
  searchQueryKey,
} from '@/hooks/usePropertySearch';
import type { SearchQuery } from '@/components/search/types';

/** A minimal valid query: only the always-present fields are populated. */
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

/**
 * The two fixtures the discriminating cases turn on.
 *
 * Barcelona is a canonical Homiio CITY (so it goes out as an id) and Madrid is
 * a confirmed MAP VIEWPORT (so it goes out as a box). They are deliberately
 * different KINDS as well as different places: a fixture where both were cities
 * could not tell "the selection was replaced whole" from "the id was
 * overwritten and the box left behind".
 */
const BARCELONA_CITY_ID = '01H8XQ7C2R9V6WQ2N4M0KJ3ZTA';

const barcelona: LocationSelection = {
  kind: 'place',
  source: { kind: 'homiio', entity: 'city', id: BARCELONA_CITY_ID },
  placeType: 'city',
  label: { primary: 'Barcelona', secondary: 'Catalonia, Spain', kind: 'place' },
  admin: { countryCode: 'ES', regionName: 'Catalonia', cityName: 'Barcelona' },
  center: { longitude: 2.1734035, latitude: 41.3850639 },
  precision: 'centroid',
};

const MADRID_BOX: GeoBounds = { west: -3.75, south: 40.38, east: -3.65, north: 40.45 };

const madridViewport: LocationSelection = {
  kind: 'map_bounds',
  bounds: MADRID_BOX,
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

describe('buildSearchParams', () => {
  it('always includes paging, offering and sort defaults', () => {
    expect(buildSearchParams(baseQuery())).toEqual({
      page: 1,
      limit: 24,
      offering: OfferingType.LONG_TERM_RENT,
      sortBy: 'relevance',
      sortOrder: 'desc',
    });
  });

  describe('`q` carries free text and nothing else', () => {
    it('does NOT send a place label as `q` (the inverted assertion)', () => {
      const params = buildSearchParams(baseQuery({ location: barcelona }));

      // The whole point. This used to be `q: 'Barcelona'`.
      expect(params).not.toHaveProperty('q');
      // …and the geographic intent still went out, so this does not pass by
      // virtue of emitting nothing at all.
      expect(params.city).toBe(BARCELONA_CITY_ID);
    });

    it('sends `q` when the user actually typed something', () => {
      const params = buildSearchParams(baseQuery({ queryText: 'apartamento luminoso' }));
      expect(params.q).toBe('apartamento luminoso');
    });

    it('sends BOTH dimensions when both are set, and both are meant', () => {
      // "apartamento luminoso" INSIDE Barcelona: a text match against listing
      // content, scoped to a city id. Two questions, both asked on purpose — as
      // opposed to the old behaviour, which asked one question twice and ANDed
      // the answers.
      const params = buildSearchParams(
        baseQuery({ location: barcelona, queryText: 'apartamento luminoso' }),
      );

      expect(params.q).toBe('apartamento luminoso');
      expect(params.city).toBe(BARCELONA_CITY_ID);
      expect(params).not.toHaveProperty('swLat');
    });
  });

  describe('one geographic scope per request, never two', () => {
    it('sends a canonical city id for a Homiio place, not its name or a box', () => {
      const params = buildSearchParams(baseQuery({ location: barcelona }));

      // The id is what makes two cities called Barcelona two different
      // requests. A name would make them one.
      expect(params.city).toBe(BARCELONA_CITY_ID);
      expect(params).not.toHaveProperty('swLat');
      expect(params).not.toHaveProperty('lat');
      expect(params).not.toHaveProperty('q');
    });

    it('sends a rounded box for a confirmed map viewport, and no centre', () => {
      const params = buildSearchParams(baseQuery({ location: madridViewport }));

      expect(params).toMatchObject({
        swLat: 40.38,
        swLng: -3.75,
        neLat: 40.45,
        neLng: -3.65,
      });
      // A box AND a centre in one request is `INVALID_LOCATION` server-side.
      expect(params).not.toHaveProperty('lat');
      expect(params).not.toHaveProperty('lng');
      expect(params).not.toHaveProperty('city');
    });

    it('sends the device fix at FULL precision with a radius in metres', () => {
      const params = buildSearchParams(baseQuery({ location: deviceFix }));

      // Full precision belongs in the request — it is the key, the URL and the
      // log that must never see it.
      expect(params.lat).toBeCloseTo(41.3850639, 6);
      expect(params.lng).toBeCloseTo(2.1734035, 6);
      expect(params.radius).toBe(25_000);
      expect(params).not.toHaveProperty('swLat');
    });
  });

  /**
   * ADR 0002 §12.1. Four distinct wrong implementations are enumerated there,
   * and each assertion below fails against a different one — which is why they
   * are spelled out separately rather than collapsed into one `toEqual`.
   */
  describe('Barcelona place → Madrid map bounds leaves NO Barcelona remnant', () => {
    it('carries the Madrid box and nothing of Barcelona', () => {
      const params = buildSearchParams(baseQuery({ location: madridViewport }));

      // (1) merged the box onto the old place → `city` would survive
      expect(params).not.toHaveProperty('city');
      // (2) kept the old centre → `lat`/`lng` would be Barcelona's
      expect(params).not.toHaveProperty('lat');
      expect(params).not.toHaveProperty('lng');
      // (3) still emitted the label as `q` → the request would ask for
      //     Barcelona-matching listings inside Madrid, whose answer is zero
      expect(params).not.toHaveProperty('q');
      // (4) …and the Madrid box really is there, so none of the above passes
      //     merely because the location was dropped altogether.
      expect(params.swLng).toBe(-3.75);
      expect(params.neLng).toBe(-3.65);
    });

    it('keeps the free text, which the user did not retract', () => {
      const params = buildSearchParams(
        baseQuery({ location: madridViewport, queryText: 'loft with terrace' }),
      );

      expect(params.q).toBe('loft with terrace');
      expect(params.swLng).toBe(-3.75);
      expect(params).not.toHaveProperty('city');
    });
  });

  describe('map bounds → a new city leaves no old bounds', () => {
    it('carries the city id and no box', () => {
      const params = buildSearchParams(baseQuery({ location: barcelona }));

      expect(params.city).toBe(BARCELONA_CITY_ID);
      expect(params).not.toHaveProperty('swLat');
      expect(params).not.toHaveProperty('swLng');
      expect(params).not.toHaveProperty('neLat');
      expect(params).not.toHaveProperty('neLng');
    });
  });

  it('serialises property types and amenities as comma lists', () => {
    const params = buildSearchParams(
      baseQuery({
        propertyTypes: [PropertyType.APARTMENT, PropertyType.STUDIO],
        amenities: ['wifi', 'parking'],
      }),
    );
    expect(params.propertyType).toBe('apartment,studio');
    expect(params.amenities).toBe('wifi,parking');
  });

  it('omits zero/undefined numeric filters but keeps positive ones', () => {
    const params = buildSearchParams(
      baseQuery({ bedrooms: 0, bathrooms: 2, priceMin: 500, guests: 0 }),
    );
    expect(params).not.toHaveProperty('bedrooms'); // 0 is dropped
    expect(params).not.toHaveProperty('guests'); // 0 is dropped
    expect(params.bathrooms).toBe(2);
    expect(params.priceMin).toBe(500);
    expect(params).not.toHaveProperty('priceMax');
  });

  it('routes the price range to sale-price params when the offering is sale', () => {
    const params = buildSearchParams(
      baseQuery({ offering: OfferingType.SALE, priceMin: 100000, priceMax: 400000 }),
    );
    expect(params.offering).toBe(OfferingType.SALE);
    expect(params.minSalePrice).toBe(100000);
    expect(params.maxSalePrice).toBe(400000);
    expect(params).not.toHaveProperty('priceMin');
    expect(params).not.toHaveProperty('priceMax');
  });

  it('includes short-term check-in/check-out dates when present', () => {
    const params = buildSearchParams(
      baseQuery({
        offering: OfferingType.SHORT_TERM_RENT,
        dates: { start: '2026-06-01', end: '2026-06-08' },
        guests: 2,
      }),
    );
    expect(params).toMatchObject({
      offering: OfferingType.SHORT_TERM_RENT,
      checkIn: '2026-06-01',
      checkOut: '2026-06-08',
      guests: 2,
    });
  });

  it('emits fairPrice and fairness sort params when requested', () => {
    const params = buildSearchParams(
      baseQuery({ fairPrice: true, sortBy: 'fairness', sortOrder: 'desc' }),
    );
    expect(params).toMatchObject({
      fairPrice: 'true',
      sortBy: 'fairness',
      sortOrder: 'desc',
    });
  });
});

describe('searchQueryKey', () => {
  it('drops page/limit so all pages of one search share a cache entry', () => {
    const [namespace, , rest] = searchQueryKey(baseQuery({ priceMin: 800 }));
    expect(namespace).toBe('propertySearch');
    expect(rest).not.toHaveProperty('page');
    expect(rest).not.toHaveProperty('limit');
    expect(rest).toMatchObject({ priceMin: 800, offering: OfferingType.LONG_TERM_RENT });
  });

  it('produces equal keys for equal queries (stable for React Query)', () => {
    expect(searchQueryKey(baseQuery({ bedrooms: 2 }))).toEqual(
      searchQueryKey(baseQuery({ bedrooms: 2 })),
    );
  });

  describe('no exact coordinate ever reaches a cache key', () => {
    it('keys a device search WITHOUT the device fix', () => {
      const serialised = JSON.stringify(searchQueryKey(baseQuery({ location: deviceFix })));

      // The fix is in the REQUEST (asserted above) and must not be in the key.
      // Asserting on the serialised key rather than field by field is
      // deliberate: a coordinate that reappeared under another name, or nested
      // one level deeper, would slip past a per-field check.
      expect(serialised).not.toContain('41.3850639');
      expect(serialised).not.toContain('2.1734035');
      // The radius is not a coordinate, and it is what distinguishes a 5 km
      // lens from a 25 km one, so it stays.
      expect(serialised).toContain('25000');
    });

    it('keys a place by identity, so two Barcelonas are two cache entries', () => {
      const other: LocationSelection = {
        ...barcelona,
        source: { kind: 'homiio', entity: 'city', id: 'A_DIFFERENT_CITY_ID' },
        label: { primary: 'Barcelona', secondary: 'Anzoátegui, Venezuela', kind: 'place' },
        admin: { countryCode: 'VE', regionName: 'Anzoátegui', cityName: 'Barcelona' },
      };

      expect(searchQueryKey(baseQuery({ location: barcelona }))).not.toEqual(
        searchQueryKey(baseQuery({ location: other })),
      );
    });

    it('gives a jittering map viewport ONE key, so panning does not thrash the cache', () => {
      const jittered: LocationSelection = {
        ...madridViewport,
        bounds: {
          west: MADRID_BOX.west + 0.00004,
          south: MADRID_BOX.south - 0.00002,
          east: MADRID_BOX.east + 0.00001,
          north: MADRID_BOX.north + 0.00003,
        },
      };

      expect(searchQueryKey(baseQuery({ location: madridViewport }))).toEqual(
        searchQueryKey(baseQuery({ location: jittered })),
      );
    });

    it('still re-keys when the box moves a real distance', () => {
      // The floor for the previous case: a grid coarse enough to absorb jitter
      // must not be so coarse that moving the map stops refetching.
      const moved: LocationSelection = {
        ...madridViewport,
        bounds: { west: -3.5, south: 40.38, east: -3.4, north: 40.45 },
      };

      expect(searchQueryKey(baseQuery({ location: madridViewport }))).not.toEqual(
        searchQueryKey(baseQuery({ location: moved })),
      );
    });
  });
});

/**
 * A place that cannot be scoped must REFUSE, not widen.
 *
 * The failure this guards is quieter than the one it replaced. Substituting
 * `(0,0)` for a missing centre returns a suspicious zero over the Gulf of
 * Guinea; emitting NOTHING returns a confident everything, under the name of
 * the place the user picked. Both are wrong and only the second looks fine.
 *
 * A homiio COUNTRY is the shape that reaches it: `/api/properties/search` takes
 * `city`, `state` and `neighborhood` and no country param, `precision: 'area'`
 * means it carries no centre, and its record may carry no bounds either — so
 * there is genuinely nothing to send, and the honest answer is not to send.
 */
describe('an unscopeable location refuses rather than widening', () => {
  const country: LocationSelection = {
    kind: 'place',
    source: { kind: 'homiio', entity: 'country', id: 'ES' },
    placeType: 'country',
    label: { primary: 'Spain', kind: 'place' },
    admin: { countryCode: 'ES' },
    precision: 'area',
  };

  it('reports a geometry-less country as unscopeable', () => {
    expect(isUnscopeableLocation(country)).toBe(true);
  });

  it('emits NO geographic params for it — which is why the query must not run', () => {
    const params = buildSearchParams(baseQuery({ location: country }));

    // Every geographic param absent. Sent as-is this is a global feed labelled
    // "Spain", so `usePropertySearch` gates `enabled` on the predicate above.
    for (const key of ['city', 'state', 'neighborhood', 'lat', 'lng', 'swLat', 'neLat']) {
      expect(params).not.toHaveProperty(key);
    }
  });

  it('becomes scopeable the moment it has bounds', () => {
    // The floor: the predicate must not be true of every country forever, or it
    // would be indistinguishable from "countries are unsupported".
    const withBounds: LocationSelection = {
      ...country,
      bounds: { west: -9.3, south: 36.0, east: 3.3, north: 43.8 },
    };

    expect(isUnscopeableLocation(withBounds)).toBe(false);
    expect(buildSearchParams(baseQuery({ location: withBounds }))).toMatchObject({
      swLng: -9.3,
      neLng: 3.3,
    });
  });

  it('scopes a NEIGHBORHOOD by its canonical id rather than its geometry', () => {
    // ADR §14.2 gives the endpoint `neighborhoodId`; without it a neighborhood
    // fell through to geometry and a coordinate-less one had nothing at all.
    const neighborhood: LocationSelection = {
      kind: 'place',
      source: { kind: 'homiio', entity: 'neighborhood', id: 'NBH-1' },
      placeType: 'neighborhood',
      label: { primary: 'Gràcia', secondary: 'Barcelona', kind: 'place' },
      admin: { countryCode: 'ES' },
      precision: 'area',
    };

    expect(isUnscopeableLocation(neighborhood)).toBe(false);
    expect(buildSearchParams(baseQuery({ location: neighborhood }))).toMatchObject({
      neighborhood: 'NBH-1',
    });
  });

  it('treats a normal city as scopeable even with no geometry at all', () => {
    // The case `isFramablePlace` exists to protect: Homiio knows the city by
    // id, the query filters by that id, and only the MAP has nothing to frame.
    const coordinatelessCity: LocationSelection = {
      kind: 'place',
      source: { kind: 'homiio', entity: 'city', id: 'CITY-1' },
      placeType: 'city',
      label: { primary: 'Riverside', kind: 'place' },
      admin: { countryCode: 'US' },
      precision: 'area',
    };

    expect(isUnscopeableLocation(coordinatelessCity)).toBe(false);
    expect(buildSearchParams(baseQuery({ location: coordinatelessCity }))).toMatchObject({
      city: 'CITY-1',
    });
  });
});
