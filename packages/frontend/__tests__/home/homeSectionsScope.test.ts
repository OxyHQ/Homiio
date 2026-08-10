/**
 * Home's sections stay attached to the scope they were fetched for (#353).
 *
 * Four separate mechanisms, each with its own failure:
 *
 *  1. **The query key** — a scope change re-keys, so a response in flight for
 *     the previous city can never render under the new one. This is the
 *     "cambio de ciudad y cancelación del request anterior" case, satisfied by
 *     cache identity rather than by an abort signal: React Query resolves the
 *     old response into the old entry and reads the new one.
 *  2. **The request parameters** — a scope that cannot be serialised RAISES
 *     instead of quietly omitting `loc`, which the server would read as "no
 *     location requested" and answer globally.
 *  3. **The offline snapshot** — keyed by scope, so a Madrid launch is never
 *     shown yesterday's Barcelona under a Madrid heading.
 *  4. **Freshness** — live, cached and stale are three distinguishable states,
 *     and a restored payload is never presented as current.
 */

import {
  homeSectionsQueryKey,
  resolveFreshness,
  STALE_AFTER_MS,
} from '@/hooks/useHomeSections';
import {
  buildHomeSectionsParams,
  UnscopableLocationError,
} from '@/services/homeSectionsService';
import { readHomeSnapshot, type HomeSnapshot } from '@/store/homeSectionsCacheStore';
import { describeScope } from '@/components/location/LocationScopeBar';
import { OfferingType, locationKey, type LocationSelection } from '@homiio/shared-types';

function city(id: string, name: string): LocationSelection {
  return {
    kind: 'place',
    source: { kind: 'homiio', entity: 'city', id },
    placeType: 'city',
    label: { primary: name, kind: 'place' },
    admin: { countryCode: 'ES', cityName: name },
    precision: 'centroid',
    center: { longitude: 2.1686, latitude: 41.3874 },
  };
}

const BARCELONA = city('city-barcelona', 'Barcelona');
const MADRID = city('city-madrid', 'Madrid');

const DEVICE: LocationSelection = {
  kind: 'current_location',
  center: { longitude: 2.1734035, latitude: 41.3850639 },
  radiusMeters: 25_000,
  precision: 'exact',
};

describe('the query key follows the scope', () => {
  it('gives two cities two different keys', () => {
    // The mechanism behind "a late Madrid response cannot land under Barcelona":
    // they are different cache entries, so there is nothing to overwrite.
    expect(homeSectionsQueryKey(BARCELONA, OfferingType.LONG_TERM_RENT)).not.toEqual(
      homeSectionsQueryKey(MADRID, OfferingType.LONG_TERM_RENT),
    );
  });

  it('gives the SAME scope the same key twice, so a refresh reuses the entry', () => {
    // Pull-to-refresh refetches this key. If the key were not stable across two
    // calls with the same scope, a refresh would start a new entry — and a new
    // entry is a new load, which is how a "refresh" quietly becomes a re-resolve.
    expect(homeSectionsQueryKey(BARCELONA, OfferingType.LONG_TERM_RENT)).toEqual(
      homeSectionsQueryKey(city('city-barcelona', 'Barcelona'), OfferingType.LONG_TERM_RENT),
    );
  });

  it('keys two cities called Barcelona differently, because they are different places', () => {
    const catalonia = city('city-barcelona-es', 'Barcelona');
    const venezuela = city('city-barcelona-ve', 'Barcelona');
    expect(homeSectionsQueryKey(catalonia, OfferingType.LONG_TERM_RENT)).not.toEqual(
      homeSectionsQueryKey(venezuela, OfferingType.LONG_TERM_RENT),
    );
  });
});

describe('the request parameters', () => {
  it('sends no loc for an explicit global scope', () => {
    // The ONLY input that produces a request with no `loc`. Reaching it requires
    // `selection === null`, which the ladder produces only for `explicitGlobal`.
    expect(buildHomeSectionsParams(null, OfferingType.LONG_TERM_RENT)).toEqual({
      offering: OfferingType.LONG_TERM_RENT,
    });
  });

  it('sends a city as its loc token and nothing else', () => {
    const params = buildHomeSectionsParams(BARCELONA, OfferingType.LONG_TERM_RENT);

    expect(params.loc).toBe('city.homiio.city-barcelona');
    expect(params.lat).toBeUndefined();
    expect(params.lng).toBeUndefined();
  });

  it('sends a device scope as here.<radius> PLUS the position', () => {
    const params = buildHomeSectionsParams(DEVICE, OfferingType.LONG_TERM_RENT);

    // The token carries no coordinate by design — ADR 0002 decision 8 — so the
    // position rides beside it, in the request only.
    expect(params.loc).toBe('here.25000');
    expect(params.loc).not.toContain('41.385');
    expect(params.lat).toBe(41.3850639);
    expect(params.lng).toBe(2.1734035);
  });

  it('RAISES for a scope the grammar cannot express, rather than dropping it', () => {
    // A polygon: ADR §2.1 reserves its wire format. Omitting `loc` would be read
    // by the server as "no location requested" and answered globally — the
    // failure this whole contract exists to prevent, arriving through the one
    // path nobody inspects.
    const polygon: LocationSelection = {
      kind: 'polygon',
      polygon: {
        type: 'Polygon',
        coordinates: [[[2.1, 41.3], [2.2, 41.3], [2.2, 41.4], [2.1, 41.3]]],
      },
      bounds: { west: 2.1, south: 41.3, east: 2.2, north: 41.4 },
      label: { primary: 'Drawn area', kind: 'generated' },
      precision: 'area',
    };

    expect(() => buildHomeSectionsParams(polygon, OfferingType.LONG_TERM_RENT)).toThrow(
      UnscopableLocationError,
    );
  });
});

describe('the offline snapshot is scoped', () => {
  const snapshot: HomeSnapshot = {
    locationKey: locationKey(BARCELONA),
    offering: OfferingType.LONG_TERM_RENT,
    generatedAt: '2026-08-09T10:00:00.000Z',
    sections: [],
  };

  it('serves a snapshot for the scope it was taken in', () => {
    expect(
      readHomeSnapshot(snapshot, locationKey(BARCELONA), OfferingType.LONG_TERM_RENT),
    ).toBe(snapshot);
  });

  it('REFUSES a snapshot taken in another city', () => {
    // Opening the app offline in Madrid must not show yesterday's Barcelona
    // under a Madrid heading. It would look like a working app.
    expect(
      readHomeSnapshot(snapshot, locationKey(MADRID), OfferingType.LONG_TERM_RENT),
    ).toBeNull();
  });

  it('REFUSES a snapshot taken for another offering', () => {
    expect(readHomeSnapshot(snapshot, locationKey(BARCELONA), OfferingType.SALE)).toBeNull();
  });

  it('returns nothing when there is no snapshot at all', () => {
    expect(readHomeSnapshot(null, locationKey(BARCELONA), OfferingType.LONG_TERM_RENT)).toBeNull();
  });
});

describe('live, cached and stale are three different answers', () => {
  it('calls a fresh successful fetch live', () => {
    expect(
      resolveFreshness({ hasLiveData: true, servedFromSnapshot: false, failed: false, ageMs: 1000 }),
    ).toBe('live');
  });

  it('calls a restored snapshot CACHED, however recent it is', () => {
    // "No presentarla como actualizada": where it came from decides this, not
    // how old it is. A snapshot written seconds ago is still not a live answer
    // about the world.
    expect(
      resolveFreshness({ hasLiveData: false, servedFromSnapshot: true, failed: false, ageMs: 0 }),
    ).toBe('cached');
  });

  it('calls data STALE when the newest attempt failed', () => {
    // The data is real; it is just no longer known to be current. Saying "live"
    // would be a claim we cannot make.
    expect(
      resolveFreshness({ hasLiveData: true, servedFromSnapshot: false, failed: true, ageMs: 1000 }),
    ).toBe('stale');
  });

  it('calls data STALE once the SERVER stamped it long enough ago', () => {
    expect(
      resolveFreshness({
        hasLiveData: true,
        servedFromSnapshot: false,
        failed: false,
        ageMs: STALE_AFTER_MS + 1,
      }),
    ).toBe('stale');
  });

  it('does not call data stale one millisecond before the threshold', () => {
    // The floor for the previous case: without it, a function returning 'stale'
    // for everything would pass it.
    expect(
      resolveFreshness({
        hasLiveData: true,
        servedFromSnapshot: false,
        failed: false,
        ageMs: STALE_AFTER_MS - 1,
      }),
    ).toBe('live');
  });
});

describe('the scope LABEL tells "nothing chosen" from "everywhere"', () => {
  const t = (key: string): string => key;
  const formatDistanceValue = (metres: number): string => `${metres / 1000} km`;

  it('says NOT CHOSEN when no scope has been picked', () => {
    // The state a cold start lands in. Labelling it "Everywhere" would tell a
    // reader the app is showing them the world when it is showing them nothing —
    // this issue's failure arriving through a string instead of through a query.
    expect(describeScope({ selection: null, isGlobal: false, t, formatDistanceValue })).toBe(
      'location.scope.notChosen',
    );
  });

  it('says EVERYWHERE only when the user chose it', () => {
    expect(describeScope({ selection: null, isGlobal: true, t, formatDistanceValue })).toBe(
      'location.scope.everywhere',
    );
  });

  it('says "near you" for a device scope with NO reverse-geocoded place', () => {
    // The label degrades; the scope does not. A borrowed city name here would be
    // the invented content the issue forbids, in the most visible place on the
    // page.
    expect(describeScope({ selection: DEVICE, t, formatDistanceValue })).toBe(
      'location.scope.nearYou',
    );
  });

  it('names the place when a reverse geocode supplied one', () => {
    const nearbyPlace = {
      source: { kind: 'external', provider: 'osm', ref: 'R1' },
      placeType: 'city',
      label: { primary: 'Bucharest', kind: 'place' },
      admin: { countryCode: 'RO' },
      precision: 'centroid',
      center: { longitude: 26.1025, latitude: 44.4268 },
    } as const;

    expect(describeScope({ selection: DEVICE, nearbyPlace, t, formatDistanceValue })).toBe(
      'location.scope.nearPlace',
    );
  });
});
