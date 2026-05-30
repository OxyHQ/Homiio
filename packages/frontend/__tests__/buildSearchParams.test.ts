/**
 * Unit tests for the property-search query builder.
 *
 * `buildSearchParams` and `searchQueryKey` are pure, but importing the module
 * pulls the hook's dependency graph (the `api` client, `react-native`,
 * `@oxyhq/core`) through Jest's module resolver. So beyond asserting the
 * mapping logic, this suite also proves the jest-expo Babel transform +
 * `transformIgnorePatterns` correctly handle the app's ESM/native packages.
 */
import { PropertyType, RentMode } from '@homiio/shared-types';
import { buildSearchParams, searchQueryKey } from '@/hooks/usePropertySearch';
import type { SearchQuery } from '@/components/search/types';

/** A minimal valid query: only the always-present fields are populated. */
function baseQuery(overrides: Partial<SearchQuery> = {}): SearchQuery {
  return {
    rentMode: RentMode.LONG_TERM,
    propertyTypes: [],
    amenities: [],
    sortBy: 'relevance',
    sortOrder: 'desc',
    ...overrides,
  };
}

describe('buildSearchParams', () => {
  it('always includes paging, rentMode and sort defaults', () => {
    expect(buildSearchParams(baseQuery())).toEqual({
      page: 1,
      limit: 24,
      rentMode: RentMode.LONG_TERM,
      sortBy: 'relevance',
      sortOrder: 'desc',
    });
  });

  it('maps a bounding box to rounded sw/ne corner params', () => {
    const params = buildSearchParams(
      baseQuery({
        location: {
          label: 'Barcelona',
          shortLabel: 'Barcelona',
          center: [2.1734035, 41.3850639],
          bounds: { west: 2.0528, south: 41.3201, east: 2.2283, north: 41.4695 },
        },
      }),
    );
    expect(params).toMatchObject({
      swLat: 41.32,
      swLng: 2.053,
      neLat: 41.47,
      neLng: 2.228,
      q: 'Barcelona',
    });
    // Center should NOT be emitted when bounds are present.
    expect(params).not.toHaveProperty('lat');
    expect(params).not.toHaveProperty('lng');
  });

  it('falls back to center lat/lng when no bounds are given', () => {
    const params = buildSearchParams(
      baseQuery({
        location: {
          label: 'Madrid',
          shortLabel: 'Madrid',
          center: [-3.7037902, 40.4167754],
        },
      }),
    );
    // center is [lng, lat]; params split it accordingly.
    expect(params.lng).toBeCloseTo(-3.7037902, 6);
    expect(params.lat).toBeCloseTo(40.4167754, 6);
    expect(params).not.toHaveProperty('swLat');
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

  it('includes vacation check-in/check-out dates when present', () => {
    const params = buildSearchParams(
      baseQuery({
        rentMode: RentMode.VACATION,
        dates: { start: '2026-06-01', end: '2026-06-08' },
        guests: 2,
      }),
    );
    expect(params).toMatchObject({
      rentMode: RentMode.VACATION,
      checkIn: '2026-06-01',
      checkOut: '2026-06-08',
      guests: 2,
    });
  });
});

describe('searchQueryKey', () => {
  it('drops page/limit so all pages of one search share a cache entry', () => {
    const [namespace, rest] = searchQueryKey(baseQuery({ priceMin: 800 }));
    expect(namespace).toBe('propertySearch');
    expect(rest).not.toHaveProperty('page');
    expect(rest).not.toHaveProperty('limit');
    expect(rest).toMatchObject({ priceMin: 800, rentMode: RentMode.LONG_TERM });
  });

  it('produces equal keys for equal queries (stable for React Query)', () => {
    const a = searchQueryKey(baseQuery({ bedrooms: 2 }));
    const b = searchQueryKey(baseQuery({ bedrooms: 2 }));
    expect(a).toEqual(b);
  });
});
