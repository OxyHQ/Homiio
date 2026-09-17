/**
 * A saved search reopens through the same URL writer as every other search, and
 * a saved search that cannot state its place never opens at all (ADR 0002).
 *
 * The Saved screen's `SavedSearchCard` presses go through `savedSearchTarget`.
 * The failure this guards is the quiet one: a legacy row (a place LABEL in
 * `query`, no location) or a drawn polygon turned into `/explore?q=Madrid` or a
 * bare `/explore`, which answers globally under the saved search's name.
 */
import { OfferingType, PropertyType, type LocationSelection } from '@homiio/shared-types';

import type { SavedSearch } from '@/store/savedSearchesStore';
import {
  savedSearchCriteria,
  savedSearchFiltersToQuery,
  savedSearchTarget,
} from '@/utils/savedSearchQuery';

const barcelona: LocationSelection = {
  kind: 'place',
  source: { kind: 'homiio', entity: 'city', id: '01H8XQ7C2R9V6WQ2N4M0KJ3ZTA' },
  placeType: 'city',
  label: { primary: 'Barcelona', secondary: 'Catalonia, Spain', kind: 'place' },
  admin: { countryCode: 'ES', regionName: 'Catalonia', cityName: 'Barcelona' },
  center: { longitude: 2.1734, latitude: 41.3851 },
  precision: 'centroid',
};

const polygon: LocationSelection = {
  kind: 'polygon',
  polygon: {
    type: 'Polygon',
    coordinates: [[[2.0, 41.3], [2.3, 41.3], [2.3, 41.5], [2.0, 41.5], [2.0, 41.3]]],
  },
  bounds: { west: 2.0, south: 41.3, east: 2.3, north: 41.5 },
  label: { primary: 'search.summary.drawnArea', kind: 'generated' },
  precision: 'area',
};

function saved(overrides: Partial<SavedSearch> = {}): SavedSearch {
  return {
    id: 's1',
    name: 'Flats in Barcelona',
    query: '',
    location: barcelona,
    locationStatus: 'resolved',
    notifications: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

/** A `t` that echoes its key (and count) so assertions read the choice made. */
const t = ((key: string, options?: { count?: number }) =>
  options?.count !== undefined ? `${key}:${options.count}` : key) as never;

describe('savedSearchTarget', () => {
  it('reopens a resolved search through exploreHref, filters included', () => {
    const target = savedSearchTarget(
      saved({
        filters: {
          offering: OfferingType.SALE,
          priceMax: 300000,
          bedrooms: 2,
          propertyTypes: [PropertyType.APARTMENT],
        },
      }),
    );
    expect(target.kind).toBe('href');
    if (target.kind !== 'href') return;
    const url = new URL(target.href, 'https://homiio.test');
    expect(url.pathname).toBe('/explore');
    expect(url.searchParams.get('loc')).toBeTruthy();
    expect(url.searchParams.get('offering')).toBe(OfferingType.SALE);
    expect(url.searchParams.get('priceMax')).toBe('300000');
    expect(url.searchParams.get('bedrooms')).toBe('2');
    expect(url.searchParams.get('propertyType')).toBe(PropertyType.APARTMENT);
  });

  it('refuses a legacy row rather than running its label as free text', () => {
    const legacy = saved({ query: 'Madrid', location: null, locationStatus: 'needs_confirmation' });
    expect(savedSearchTarget(legacy)).toEqual({ kind: 'needs_place' });
  });

  it('refuses a row whose status says confirm, even if a location is present', () => {
    expect(savedSearchTarget(saved({ locationStatus: 'needs_confirmation' }))).toEqual({
      kind: 'needs_place',
    });
  });

  it('refuses a drawn polygon instead of opening without its location', () => {
    expect(savedSearchTarget(saved({ location: polygon }))).toEqual({ kind: 'unshareable' });
  });
});

describe('savedSearchFiltersToQuery', () => {
  it('reads the older field spellings rows were written with', () => {
    const query = savedSearchFiltersToQuery({
      query: '',
      filters: {
        offering: OfferingType.SHORT_TERM_RENT,
        type: [PropertyType.HOUSE],
        minPrice: 50,
        maxPrice: 120,
        checkIn: '2026-10-12',
        checkOut: '2026-10-17',
      },
    });
    expect(query.propertyTypes).toEqual([PropertyType.HOUSE]);
    expect(query.priceMin).toBe(50);
    expect(query.priceMax).toBe(120);
    expect(query.dates).toEqual({ start: '2026-10-12', end: '2026-10-17' });
  });

  it('falls back to long-term rent for an unknown offering', () => {
    expect(savedSearchFiltersToQuery({ query: '', filters: { offering: 'lease' } }).offering).toBe(
      OfferingType.LONG_TERM_RENT,
    );
  });
});

describe('savedSearchCriteria', () => {
  it('states the place first, then the mode, then only what it narrows by', () => {
    const chips = savedSearchCriteria(saved({ filters: { bedrooms: 3 } }), t, 'en');
    expect(chips).toEqual(['Barcelona', 'search.mode.longTerm', 'listing.card.beds:3']);
  });

  it('shows a legacy row its stored label, never "Anywhere"', () => {
    const chips = savedSearchCriteria(
      saved({ query: 'Madrid', location: null, locationStatus: 'needs_confirmation' }),
      t,
      'en',
    );
    expect(chips[0]).toBe('Madrid');
  });
});
