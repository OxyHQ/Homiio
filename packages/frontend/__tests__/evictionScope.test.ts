/**
 * `selectionToBoardScope` — every selection kind is DECIDED, and no kind can
 * mis-scope the eviction board.
 *
 * ## Two different guarantees, and only one of them is a runtime test
 *
 * **A new kind must fail to compile.** That is the `never` guard inside
 * `selectionToBoardScope` plus `LOCATION_SELECTION_KINDS`' `satisfies`, and no
 * runtime assertion can express it — a TypeScript union does not exist at run
 * time. It was verified by MUTATION: before the guard, deleting the
 * `multi_area` arm produced no `tsc` error at all, because the function returns
 * `… | undefined` and an unhandled kind simply falls off the end.
 *
 * **Every kind must resolve to a scope or to NOTHING — never to the wrong
 * place.** That is what this file asserts, over one fixture per kind.
 *
 * The distinction matters because the failure being guarded against is not a
 * crash. An unhandled kind returned `undefined`, the board disabled its query
 * and showed the picker: safe, and completely silent. The same defect class in
 * the home-sections controller (three of six place types handled) looked like a
 * working feature until somebody picked the fourth.
 */

import {
  LOCATION_SELECTION_KINDS,
  selectionToBoardScope,
} from '@/components/evictions/evictionScope';
import type { LocationSelection } from '@homiio/shared-types';

const BOUNDS = { west: 2.05, south: 41.32, east: 2.23, north: 41.47 } as const;
const CENTRE = { longitude: 2.1686, latitude: 41.3874 } as const;

/** One fixture per kind, keyed so a missing entry is a compile error. */
const FIXTURES: Record<keyof typeof LOCATION_SELECTION_KINDS, LocationSelection> = {
  current_location: {
    kind: 'current_location',
    center: CENTRE,
    radiusMeters: 5_000,
    precision: 'approximate',
  },
  place: {
    kind: 'place',
    source: { kind: 'homiio', entity: 'city', id: 'city-1' },
    placeType: 'city',
    label: { primary: 'Barcelona', kind: 'place' },
    admin: { countryCode: 'ES', cityName: 'Barcelona' },
    precision: 'centroid',
    center: CENTRE,
  },
  address_candidate: {
    kind: 'address_candidate',
    source: { kind: 'external', provider: 'osm', ref: 'way/1' },
    label: { primary: 'Carrer de Sants', kind: 'place' },
    admin: { countryCode: 'ES' },
    precision: 'exact',
    center: CENTRE,
  },
  map_bounds: {
    kind: 'map_bounds',
    bounds: BOUNDS,
    center: CENTRE,
    label: { primary: 'Map area', kind: 'generated' },
    precision: 'area',
  },
  polygon: {
    kind: 'polygon',
    polygon: {
      type: 'Polygon',
      coordinates: [
        [
          [2.05, 41.32],
          [2.23, 41.32],
          [2.23, 41.47],
          [2.05, 41.47],
          [2.05, 41.32],
        ],
      ],
    },
    bounds: BOUNDS,
    label: { primary: 'Drawn area', kind: 'generated' },
    precision: 'area',
  },
  multi_area: {
    kind: 'multi_area',
    areas: [],
    label: { primary: 'Several areas', kind: 'generated' },
  },
};

describe('selectionToBoardScope', () => {
  it('covers every declared selection kind', () => {
    // Vacuity floor. `Object.keys` over an empty or truncated fixture set would
    // make every loop below iterate nothing, which reads exactly like a clean
    // pass — the shape this whole file exists to prevent.
    const kinds = Object.keys(FIXTURES);
    expect(kinds.sort()).toEqual(Object.keys(LOCATION_SELECTION_KINDS).sort());
    expect(kinds.length).toBeGreaterThanOrEqual(6);
  });

  it('resolves a scope, or nothing — never a scope of a different shape', () => {
    for (const [kind, selection] of Object.entries(FIXTURES)) {
      const scope = selectionToBoardScope(selection);
      if (scope === undefined) continue;
      // The board's own contract: one shape per scope, and never a geometric
      // shape AND a named place together.
      expect(['global', 'city', 'bbox', 'radius', 'following', 'attending']).toContain(scope.kind);
      if (scope.kind === 'bbox') {
        expect(scope.swLat).toBeLessThanOrEqual(scope.neLat);
        expect(Object.keys(scope).sort()).toEqual(['kind', 'neLat', 'neLng', 'swLat', 'swLng']);
      }
      if (scope.kind === 'radius') {
        expect(scope.radiusMeters).toBeGreaterThan(0);
        expect(Object.keys(scope).sort()).toEqual(['kind', 'lat', 'lng', 'radiusMeters']);
      }
      if (scope.kind === 'city') {
        expect(Object.keys(scope).sort()).toEqual(['city', 'kind']);
        expect(scope.city).not.toBe('');
      }
      expect(kind).toBeTruthy();
    }
  });

  it('maps the kinds that carry geometry to the shape that matches it', () => {
    expect(selectionToBoardScope(FIXTURES.current_location)).toEqual({
      kind: 'radius',
      lat: CENTRE.latitude,
      lng: CENTRE.longitude,
      radiusMeters: 5_000,
    });
    expect(selectionToBoardScope(FIXTURES.map_bounds)).toEqual({
      kind: 'bbox',
      swLat: BOUNDS.south,
      swLng: BOUNDS.west,
      neLat: BOUNDS.north,
      neLng: BOUNDS.east,
    });
    expect(selectionToBoardScope(FIXTURES.polygon)).toEqual({
      kind: 'bbox',
      swLat: BOUNDS.south,
      swLng: BOUNDS.west,
      neLat: BOUNDS.north,
      neLng: BOUNDS.east,
    });
  });

  it('answers NOTHING rather than a guess for a selection it cannot query', () => {
    // `null` is not "everywhere": a caller with no selection has not asked for
    // the world, it has not asked anything.
    expect(selectionToBoardScope(null)).toBeUndefined();
    // Several areas at once is deliberately unsupported rather than
    // approximated by the first one — showing one of three neighbourhoods
    // somebody picked, silently, is the failure that looks like it worked.
    expect(selectionToBoardScope(FIXTURES.multi_area)).toBeUndefined();
    // A named place with no geometry at all is a legitimate disambiguation
    // candidate (ADR 0002) and still not something this board can query.
    const unframable: LocationSelection = {
      kind: 'place',
      source: { kind: 'homiio', entity: 'region', id: 'region-1' },
      placeType: 'region',
      label: { primary: 'Somewhere', kind: 'place' },
      admin: { countryCode: 'ES' },
      precision: 'area',
    };
    expect(selectionToBoardScope(unframable)).toBeUndefined();
  });

  it('falls back to the CITY scope for a named city with no geometry', () => {
    // The board matches `location_city` by name, so a city Homiio knows but has
    // no coordinates for is still answerable — which is the case ADR 0002 keeps
    // selectable precisely so a homonym stays reachable.
    const cityWithoutGeometry: LocationSelection = {
      kind: 'place',
      source: { kind: 'homiio', entity: 'city', id: 'city-2' },
      placeType: 'city',
      label: { primary: 'Riverside', kind: 'place' },
      admin: { countryCode: 'ES', cityName: 'Riverside' },
      precision: 'area',
    };
    expect(selectionToBoardScope(cityWithoutGeometry)).toEqual({
      kind: 'city',
      city: 'Riverside',
    });
  });
});
