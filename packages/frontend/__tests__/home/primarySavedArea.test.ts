/**
 * The saved-area rung of the location ladder (#353's second rung, wired by #356).
 *
 * Two files decide what Home opens on, and this covers the half #353 left
 * deliberately inert: which saved search — if any — is a person's primary area,
 * and what happens while that answer is still unknown.
 *
 * ## Why the "no primary area" case is asserted as hard as the positive one
 *
 * `null` is the COMMON answer: most people never mark one. So a rule that
 * returned something plausible for everybody would look like it worked, and the
 * failure — somebody's Home silently scoped to a city they bookmarked once —
 * only shows up as a complaint nobody can reproduce. Every case below therefore
 * asserts what the rule REFUSES as well as what it picks.
 */

import { primaryAreaOf } from '@/hooks/useSavedSearches';
import type { SavedSearch } from '@/store/savedSearchesStore';
import type { LocationSelection } from '@homiio/shared-types';

const BARCELONA: LocationSelection = {
  kind: 'place',
  source: { kind: 'homiio', entity: 'city', id: 'city-barcelona' },
  placeType: 'city',
  label: { primary: 'Barcelona', secondary: 'Catalonia, Spain', kind: 'place' },
  admin: { countryCode: 'ES', cityName: 'Barcelona' },
  center: { longitude: 2.1734, latitude: 41.3851 },
  bounds: { west: 2.05, south: 41.32, east: 2.23, north: 41.47 },
  precision: 'centroid',
};

const MADRID: LocationSelection = {
  kind: 'place',
  source: { kind: 'homiio', entity: 'city', id: 'city-madrid' },
  placeType: 'city',
  label: { primary: 'Madrid', secondary: 'Spain', kind: 'place' },
  admin: { countryCode: 'ES', cityName: 'Madrid' },
  center: { longitude: -3.7038, latitude: 40.4168 },
  bounds: { west: -3.75, south: 40.39, east: -3.65, north: 40.45 },
  precision: 'centroid',
};

function watch(overrides: Partial<SavedSearch>): SavedSearch {
  return {
    id: `watch-${overrides.name ?? 'x'}`,
    name: 'A watch',
    query: '',
    location: BARCELONA,
    locationStatus: 'resolved',
    notifications: false,
    isPrimaryArea: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('primaryAreaOf', () => {
  it('returns the selection of the watch marked as the primary area', () => {
    const selection = primaryAreaOf([
      watch({ name: 'other', location: MADRID }),
      watch({ name: 'home', location: BARCELONA, isPrimaryArea: true }),
    ]);

    expect(selection).toEqual(BARCELONA);
  });

  it('returns null when nobody marked one — the common case', () => {
    expect(primaryAreaOf([watch({ name: 'a' }), watch({ name: 'b' })])).toBeNull();
  });

  it('returns null for a person with no saved searches at all', () => {
    expect(primaryAreaOf([])).toBeNull();
  });

  it('does NOT fall back to the most recently updated saved search', () => {
    // The substitute #353 refused, pinned here so #356 cannot quietly
    // reintroduce it. The fixture is built so the two rules DISAGREE: the newest
    // watch carries a perfectly usable location and is not the primary area, so
    // a "most recent wins" implementation returns Madrid where the correct
    // answer is null. Without the differing timestamps this case would pass
    // against either rule.
    const selection = primaryAreaOf([
      watch({ name: 'older', location: BARCELONA, updatedAt: '2026-01-01T00:00:00.000Z' }),
      watch({ name: 'newest', location: MADRID, updatedAt: '2026-08-10T00:00:00.000Z' }),
    ]);

    expect(selection).toBeNull();
  });

  it('picks the FLAGGED watch even when another was updated more recently', () => {
    // The other direction of the same distinction: the flag wins over recency,
    // rather than the two happening to agree because the fixture is tidy.
    const selection = primaryAreaOf([
      watch({
        name: 'flagged',
        location: BARCELONA,
        isPrimaryArea: true,
        updatedAt: '2026-01-01T00:00:00.000Z',
      }),
      watch({ name: 'newest', location: MADRID, updatedAt: '2026-08-10T00:00:00.000Z' }),
    ]);

    expect(selection).toEqual(BARCELONA);
  });

  it('skips a primary area whose location was never confirmed', () => {
    // A legacy row carries a place LABEL in `query`, not a place (ADR 0002 §11).
    // Scoping Home by it would mean re-geocoding that label and taking the first
    // hit — the homonym bug, applied to somebody's entire Home screen.
    const selection = primaryAreaOf([
      watch({
        name: 'legacy',
        isPrimaryArea: true,
        location: null,
        locationStatus: 'needs_confirmation',
        query: 'Barcelona',
      }),
    ]);

    expect(selection).toBeNull();
  });

  it('skips a flagged watch that reports `needs_confirmation` WITH a location present', () => {
    // The discriminating shape: an implementation checking only `location` (and
    // not `locationStatus`) passes the case above, because that fixture has
    // both absent. Here the two disagree, which is the only way to tell the two
    // implementations apart.
    const selection = primaryAreaOf([
      watch({
        name: 'unconfirmed',
        isPrimaryArea: true,
        location: BARCELONA,
        locationStatus: 'needs_confirmation',
      }),
    ]);

    expect(selection).toBeNull();
  });
});
