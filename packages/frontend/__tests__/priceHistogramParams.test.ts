/**
 * `buildPriceHistogramParams` / `priceHistogramQueryKey` — the histogram asks
 * about the search's scope and filters, never its price bounds, and its cache
 * key carries no coordinate.
 */
import { OfferingType, PropertyType, type LocationSelection } from '@homiio/shared-types';
import {
  buildPriceHistogramParams,
  buildSearchParams,
  priceHistogramQueryKey,
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

const nearMe: LocationSelection = {
  kind: 'current_location',
  center: { latitude: 41.387412, longitude: 2.168568 },
  radiusMeters: 5000,
} as LocationSelection;

const SPAN = { histogramMin: 0, histogramMax: 5000, histogramBuckets: 32, currency: 'EUR' };

describe('buildPriceHistogramParams', () => {
  it('keeps the scope and every non-price filter the search sends', () => {
    const query = baseQuery({
      location: nearMe,
      propertyTypes: [PropertyType.APARTMENT],
      amenities: ['wifi', 'parking'],
      bedrooms: 2,
      petFriendly: true,
    });
    const search = buildSearchParams(query);
    const histogram = buildPriceHistogramParams(query);

    expect(histogram).toMatchObject({
      offering: OfferingType.LONG_TERM_RENT,
      lat: search.lat,
      lng: search.lng,
      radius: search.radius,
      propertyType: 'apartment',
      amenities: 'wifi,parking',
      bedrooms: 2,
      petFriendly: 'true',
    });
    expect(histogram).not.toHaveProperty('page');
    expect(histogram).not.toHaveProperty('limit');
    expect(histogram).not.toHaveProperty('sortBy');
  });

  it.each([
    ['rent', OfferingType.LONG_TERM_RENT, ['priceMin', 'priceMax']],
    ['sale', OfferingType.SALE, ['minSalePrice', 'maxSalePrice']],
  ])('drops the %s price bounds', (_label, offering, keys) => {
    const query = baseQuery({ offering, priceMin: 500, priceMax: 1500 });
    // The search DOES carry them — without this the drop below proves nothing.
    for (const key of keys) expect(buildSearchParams(query)).toHaveProperty(key);
    for (const key of keys) expect(buildPriceHistogramParams(query)).not.toHaveProperty(key);
  });
});

describe('priceHistogramQueryKey', () => {
  it('is unchanged by moving the price thumbs', () => {
    expect(priceHistogramQueryKey(baseQuery({ priceMin: 100 }), SPAN)).toEqual(
      priceHistogramQueryKey(baseQuery({ priceMax: 900 }), SPAN),
    );
  });

  it('changes with a filter that narrows the scope', () => {
    expect(priceHistogramQueryKey(baseQuery(), SPAN)).not.toEqual(
      priceHistogramQueryKey(baseQuery({ amenities: ['wifi'] }), SPAN),
    );
  });

  it('carries no device coordinate', () => {
    const serialized = JSON.stringify(priceHistogramQueryKey(baseQuery({ location: nearMe }), SPAN));
    expect(serialized).not.toContain('41.387');
    expect(serialized).not.toContain('2.168');
  });
});
