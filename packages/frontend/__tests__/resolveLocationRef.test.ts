/**
 * `resolveLocationRef` — the module that turns a `loc` token into a committed
 * selection, and the one place the contract's central claim lives: **failure is
 * a value here, never an absence.**
 *
 * ## Why this file exists at all
 *
 * It did not, until a reviewer noticed. The module implements the rule that a
 * failed lookup must not fall through to "no location" and run the query
 * unrestricted, and not one of its branches was exercised — which is also
 * exactly how its antimeridian bug survived: the `bounds` branch computed a
 * midpoint 13,000 km from the box and nothing looked.
 *
 * So the assertions here are on the RESOLUTION and on the committed selection,
 * never on "a value came back". Every failure mode of this module returns a
 * perfectly well-formed object; what distinguishes right from wrong is which
 * variant it is and what is inside it.
 */
import type { CityLookupResult, LocationRef } from '@homiio/shared-types';

import { resolveLegacyCityParam, resolveLocationRef } from '@/utils/resolveLocationRef';
import { cityService } from '@/services/cityService';

jest.mock('@/services/cityService', () => ({
  cityService: { lookupCity: jest.fn() },
}));

const lookupCity = cityService.lookupCity as jest.MockedFunction<
  (token: string) => Promise<CityLookupResult>
>;

/** Barcelona, Catalonia — a city WITH a centre. */
const BARCELONA_ES = {
  id: 'CITY-ES',
  source: { kind: 'homiio', entity: 'city', id: 'CITY-ES' },
  placeType: 'city',
  label: { primary: 'Barcelona', secondary: 'Catalonia, Spain', kind: 'place' },
  admin: { countryCode: 'ES', regionName: 'Catalonia', cityName: 'Barcelona' },
  countryId: 'C-ES',
  regionId: 'R-CAT',
  slug: 'barcelona',
  qualifiedSlug: 'barcelona-catalonia-es',
  center: { longitude: 2.1734, latitude: 41.3851 },
  precision: 'centroid',
  propertiesCount: 812,
  matchedOn: 'name',
} as const;

/** Barcelona, Anzoátegui — a DIFFERENT city sharing the name. */
const BARCELONA_VE = {
  ...BARCELONA_ES,
  id: 'CITY-VE',
  source: { kind: 'homiio', entity: 'city', id: 'CITY-VE' },
  label: { primary: 'Barcelona', secondary: 'Anzoátegui, Venezuela', kind: 'place' },
  admin: { countryCode: 'VE', regionName: 'Anzoátegui', cityName: 'Barcelona' },
  center: { longitude: -64.7, latitude: 10.13 },
  propertiesCount: 4,
} as const;

/** A city Homiio knows by id and has NO coordinates for — legitimate, per #389. */
const RIVERSIDE_NO_GEOMETRY = {
  ...BARCELONA_ES,
  id: 'CITY-RIV',
  source: { kind: 'homiio', entity: 'city', id: 'CITY-RIV' },
  label: { primary: 'Riverside', kind: 'place' },
  admin: { countryCode: 'US' },
  center: undefined,
  precision: 'area',
} as const;

beforeEach(() => {
  lookupCity.mockReset();
});

describe('a map viewport resolves to itself, with a WRAP-AWARE centre', () => {
  it('puts an antimeridian box at ±180, not at 0', async () => {
    // The bug this file was written too late to prevent. `(west + east) / 2`
    // for `170 → -170` is longitude 0 — the Gulf of Guinea, 13,000 km from a
    // box over Fiji. It fails in the worst direction: PostGIS reads the wrap
    // correctly, so the LIST is right and only the map camera is wrong, which
    // presents as a successful request showing the wrong place.
    const ref: LocationRef = {
      kind: 'bounds',
      bounds: { west: 170, south: -20, east: -170, north: -16 },
    };

    const result = await resolveLocationRef(ref, null);

    expect(result.status).toBe('resolved');
    if (result.status !== 'resolved') throw new Error('unreachable');
    expect(result.selection.kind).toBe('map_bounds');
    if (result.selection.kind !== 'map_bounds') throw new Error('unreachable');

    expect(Math.abs(result.selection.center.longitude)).toBe(180);
    expect(result.selection.center.latitude).toBe(-18);
    // The box itself is carried through untouched — a "fix" that normalised
    // west/east into order would invert the query into its complement.
    expect(result.selection.bounds).toEqual({ west: 170, south: -20, east: -170, north: -16 });
  });

  it('leaves an ORDINARY box exactly where it always was', async () => {
    // The floor for the case above: the wrap-aware midpoint must be identical
    // to the naive one for every box that does not wrap, or the fix is a
    // behaviour change to every search rather than a repair to one.
    const result = await resolveLocationRef(
      { kind: 'bounds', bounds: { west: -3.75, south: 40.38, east: -3.65, north: 40.45 } },
      null,
    );

    expect(result.status).toBe('resolved');
    if (result.status !== 'resolved' || result.selection.kind !== 'map_bounds') {
      throw new Error('unreachable');
    }
    expect(result.selection.center.longitude).toBeCloseTo(-3.7, 10);
    expect(result.selection.center.latitude).toBeCloseTo(40.415, 10);
  });

  it('never names a viewport — the label stays GENERATED', async () => {
    const result = await resolveLocationRef(
      { kind: 'bounds', bounds: { west: 2.05, south: 41.32, east: 2.23, north: 41.47 } },
      null,
    );
    if (result.status !== 'resolved' || result.selection.kind !== 'map_bounds') {
      throw new Error('unreachable');
    }
    // A generated label is never sent as free text and never re-geocoded, so a
    // panned map cannot become a place with a name.
    expect(result.selection.label.kind).toBe('generated');
  });
});

describe('a device lens', () => {
  it('resolves from the fix the CALLER supplies', async () => {
    const result = await resolveLocationRef(
      { kind: 'device', radiusMeters: 25_000 },
      { latitude: 41.3851, longitude: 2.1734 },
    );

    expect(result).toEqual({
      status: 'resolved',
      selection: {
        kind: 'current_location',
        center: { longitude: 2.1734, latitude: 41.3851 },
        radiusMeters: 25_000,
        precision: 'exact',
      },
    });
  });

  it('fails with `position_unavailable` rather than resolving to nothing', async () => {
    // The distinction that matters: no fix is a FAILURE, not "search
    // everywhere". A resolution of `null` here would run a global query under
    // a "Near you" heading.
    const result = await resolveLocationRef({ kind: 'device', radiusMeters: 25_000 }, null);
    expect(result).toEqual({ status: 'failed', reason: 'position_unavailable' });
  });
});

describe('a city token, and the homonym it must not resolve', () => {
  it('resolves a single match into a place keyed by IDENTITY', async () => {
    lookupCity.mockResolvedValue({ status: 'resolved', place: BARCELONA_ES } as CityLookupResult);

    const result = await resolveLocationRef(
      { kind: 'place', placeType: 'city', source: { kind: 'homiio' }, id: 'CITY-ES' },
      null,
    );

    expect(result.status).toBe('resolved');
    if (result.status !== 'resolved' || result.selection.kind !== 'place') {
      throw new Error('unreachable');
    }
    expect(result.selection.source).toEqual({ kind: 'homiio', entity: 'city', id: 'CITY-ES' });
    // Pre-split and carried across verbatim — nothing re-joins or re-splits it.
    expect(result.selection.label).toEqual(BARCELONA_ES.label);
  });

  it('refuses an AMBIGUOUS lookup instead of taking the first candidate', async () => {
    // The fixture puts the intended-wrong answer FIRST and gives it more
    // listings, because that is what the old `searchCities(name, 1)[0]` against
    // a count-ordered backend would have picked. A fixture where the first
    // candidate is also the right one cannot tell a correct implementation from
    // that one.
    lookupCity.mockResolvedValue({
      status: 'ambiguous',
      code: 'AMBIGUOUS_LOCATION',
      candidates: [BARCELONA_ES, BARCELONA_VE],
    } as CityLookupResult);

    const result = await resolveLocationRef(
      { kind: 'place', placeType: 'city', source: { kind: 'homiio' }, id: 'barcelona' },
      null,
    );

    expect(result).toEqual({ status: 'failed', reason: 'ambiguous' });
    // Emphatically not a resolution — a resolved status here is what silently
    // reopens somebody's saved search in another country.
    expect(result.status).not.toBe('resolved');
  });

  it('resolves a coordinate-less city, because the search scopes by id', async () => {
    // #389 returns such a city as a legitimate disambiguation candidate, and
    // refusing it here would remove a homonym the user can no longer reach.
    lookupCity.mockResolvedValue({
      status: 'resolved',
      place: RIVERSIDE_NO_GEOMETRY,
    } as CityLookupResult);

    const result = await resolveLocationRef(
      { kind: 'place', placeType: 'city', source: { kind: 'homiio' }, id: 'CITY-RIV' },
      null,
    );

    expect(result.status).toBe('resolved');
    if (result.status !== 'resolved' || result.selection.kind !== 'place') {
      throw new Error('unreachable');
    }
    expect(result.selection.precision).toBe('area');
    // `PlaceGeometry` forbids a centre on an `area` place; the selection must
    // not have acquired one on the way through.
    expect(result.selection).not.toHaveProperty('center');
  });

  it('maps `not_found` onto failed(no_results)', async () => {
    lookupCity.mockResolvedValue({ status: 'not_found' });
    const result = await resolveLocationRef(
      { kind: 'place', placeType: 'city', source: { kind: 'homiio' }, id: 'nowhere' },
      null,
    );
    expect(result).toEqual({ status: 'failed', reason: 'no_results' });
  });

  it('maps a thrown lookup onto failed(network), never onto a resolution', async () => {
    lookupCity.mockRejectedValue(new Error('gateway down'));

    const result = await resolveLocationRef(
      { kind: 'place', placeType: 'city', source: { kind: 'homiio' }, id: 'CITY-ES' },
      null,
    );

    // A network failure and "there is no such place" are DIFFERENT answers: one
    // offers a retry, the other offers a different place. Collapsing them puts
    // a retry button on a query that will never succeed.
    expect(result).toEqual({ status: 'failed', reason: 'network' });
  });

  it('refuses an EXTERNAL place ref rather than guessing one', async () => {
    const result = await resolveLocationRef(
      { kind: 'place', placeType: 'city', source: { kind: 'external', provider: 'osm' }, id: 'R349036' },
      null,
    );
    expect(result).toEqual({ status: 'failed', reason: 'unsupported' });
    expect(lookupCity).not.toHaveBeenCalled();
  });

  it('refuses a multi ref rather than resolving part of it', async () => {
    const result = await resolveLocationRef(
      { kind: 'multi', refs: [{ kind: 'bounds', bounds: { west: 1, south: 1, east: 2, north: 2 } }] },
      null,
    );
    expect(result).toEqual({ status: 'failed', reason: 'unsupported' });
  });
});

describe('the legacy ?city= param goes through the SAME lookup', () => {
  it('refuses an ambiguous legacy param exactly as the token path does', async () => {
    // One lookup for both paths is the point: a deep link acquiring different
    // homonym behaviour from the canonical route is how the bug comes back in
    // one place after being fixed in the other.
    lookupCity.mockResolvedValue({
      status: 'ambiguous',
      code: 'AMBIGUOUS_LOCATION',
      candidates: [BARCELONA_ES, BARCELONA_VE],
    } as CityLookupResult);

    await expect(resolveLegacyCityParam('barcelona')).resolves.toEqual({
      status: 'failed',
      reason: 'ambiguous',
    });
  });

  it('resolves an unambiguous one', async () => {
    lookupCity.mockResolvedValue({ status: 'resolved', place: BARCELONA_ES } as CityLookupResult);
    const result = await resolveLegacyCityParam('barcelona-catalonia-es');
    expect(result.status).toBe('resolved');
  });
});
