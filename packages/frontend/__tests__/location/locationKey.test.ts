/**
 * `locationKey` — the stable identifier (ADR 0002 §3.1), and the single point
 * that makes the privacy rule of §8.2 enforceable.
 *
 * These live in the FRONTEND suite for the same reason the `format/` tests do:
 * that is the CI job needing no database, and `shared-types` has no runner of
 * its own. Jest loads the package's SOURCE, not its `dist/` — re-verified for
 * this module by mutating `src/location.ts` without rebuilding and watching
 * this file go red, which is what makes mutation testing here meaningful.
 *
 * EVERY FIXTURE BELOW IS CHOSEN SO A CORRECT AND AN INCORRECT IMPLEMENTATION
 * DISAGREE. A key is a string, and almost any implementation produces one, so a
 * test that merely asserts "a string came back" — or that pins one expected
 * value computed from the implementation itself — cannot see any of the five
 * failures ADR §12 enumerates. Each block records what a wrong implementation
 * produces from its fixture.
 */

import {
  KEY_BOUNDS_DECIMALS,
  locationKey,
  type AdminHierarchy,
  type GeoBounds,
  type LocationSelection,
  type PlaceLabel,
} from '@homiio/shared-types';

/**
 * Fixtures are typed to their exact variant rather than to the whole union, so
 * that a `multi_area`'s `areas` accepts them and the reads below narrow, with
 * no cast anywhere in this file. A cast in a test is a place the compiler stops
 * checking the very shape under test.
 */
type PlaceSelection = Extract<LocationSelection, { kind: 'place' }>;
type DeviceSelection = Extract<LocationSelection, { kind: 'current_location' }>;
type MapBoundsSelection = Extract<LocationSelection, { kind: 'map_bounds' }>;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const PLACE_LABEL: PlaceLabel = { primary: 'Barcelona', secondary: 'Catalonia, Spain', kind: 'place' };

/**
 * Barcelona, Catalonia, Spain — the one a wrong implementation picks, because
 * it is first, because it has more listings, and because it is the popular
 * answer. It is deliberately NOT the expected answer anywhere below.
 */
const BARCELONA_ES: PlaceSelection = {
  kind: 'place',
  source: { kind: 'homiio', entity: 'city', id: '01H8XQ7C2R9V6WQ2N4M0KJ3ZTA' },
  placeType: 'city',
  label: PLACE_LABEL,
  admin: { countryCode: 'ES', regionCode: 'ES-CT', regionName: 'Catalonia', cityName: 'Barcelona' },
  center: { longitude: 2.1686, latitude: 41.3874 },
  precision: 'centroid',
};

/**
 * Barcelona, Anzoátegui, Venezuela — a real city of that name in another
 * country. Different id, different `countryCode`, different `regionName`, and
 * the SAME label, which is the whole point: a key built from the label cannot
 * tell these two apart, and neither can one built from popularity.
 */
const BARCELONA_VE: PlaceSelection = {
  kind: 'place',
  source: { kind: 'homiio', entity: 'city', id: '01J2K4M6P8R0T2V4X6Z8A0C2E4' },
  placeType: 'city',
  label: { primary: 'Barcelona', secondary: 'Anzoátegui, Venezuela', kind: 'place' },
  admin: { countryCode: 'VE', regionCode: 'VE-B', regionName: 'Anzoátegui', cityName: 'Barcelona' },
  center: { longitude: -64.6844, latitude: 10.1333 },
  precision: 'centroid',
};

const GENERATED_LABEL: PlaceLabel & { readonly kind: 'generated' } = {
  primary: 'Map area',
  kind: 'generated',
};

function mapBounds(bounds: GeoBounds): MapBoundsSelection {
  return {
    kind: 'map_bounds',
    bounds,
    center: {
      longitude: (bounds.west + bounds.east) / 2,
      latitude: (bounds.south + bounds.north) / 2,
    },
    label: GENERATED_LABEL,
    precision: 'area',
  };
}

const ADMIN_ES: AdminHierarchy = { countryCode: 'ES' };

// ---------------------------------------------------------------------------
// §8.2 — a device fix never reaches a key
// ---------------------------------------------------------------------------

describe('locationKey: current_location emits no coordinate', () => {
  /**
   * Digits are chosen so the two sets are DISJOINT: the radius 25000 uses only
   * {2,5,0}, and both coordinates use only {1,3,4,6,7,8}. Without that, "the
   * key contains no digit of the coordinate" is untestable — the `2` of
   * longitude 2.1686 is also the `2` of 25000, so a leak and a clean key look
   * identical.
   */
  const RADIUS_DIGITS = new Set('25000');
  const HERE: DeviceSelection = {
    kind: 'current_location',
    center: { longitude: 13.4678, latitude: 41.3874 },
    radiusMeters: 25000,
    precision: 'exact',
  };

  it('produces exactly the radius form', () => {
    expect(locationKey(HERE)).toBe('here:25000');
  });

  it('contains no digit that is not part of the radius', () => {
    // Sanity: the fixture really does have disjoint digit sets, or this
    // assertion passes for a reason that has nothing to do with the code.
    const coordinateDigits = `${HERE.center.longitude}${HERE.center.latitude}`.replace(/[^0-9]/g, '');
    expect(coordinateDigits.length).toBeGreaterThan(6);
    for (const digit of coordinateDigits) {
      expect(RADIUS_DIGITS.has(digit)).toBe(false);
    }

    const key = locationKey(HERE);
    const leaked = [...key].filter((char) => /[0-9]/.test(char) && !RADIUS_DIGITS.has(char));
    expect(leaked).toEqual([]);
  });

  /**
   * THE STRUCTURAL DISCRIMINATOR, and the one that does not depend on which
   * digits the fixture happens to use: two device fixes on different continents
   * with the same radius are the same key. No implementation that emits any
   * function of the coordinate — full precision, 2 dp, 3 dp, a hash, a geohash
   * — can satisfy this.
   */
  it('is identical for two different positions with the same radius', () => {
    const elsewhere: DeviceSelection = {
      kind: 'current_location',
      center: { longitude: -73.9857, latitude: 40.7484 },
      radiusMeters: 25000,
      precision: 'exact',
    };
    expect(locationKey(elsewhere)).toBe(locationKey(HERE));
  });

  /**
   * Negative control for the test above: the key is not simply constant. A
   * `locationKey` that returned `'here'` for everything would pass the
   * same-key assertion and be useless.
   */
  it('still distinguishes two different radii', () => {
    const wider: DeviceSelection = { ...HERE, radiusMeters: 50000 };
    expect(locationKey(wider)).not.toBe(locationKey(HERE));
  });
});

// ---------------------------------------------------------------------------
// §3.1 — the bbox grid
// ---------------------------------------------------------------------------

describe('locationKey: bbox is on a 3 dp grid', () => {
  const MADRID: GeoBounds = { west: -3.75, south: 40.38, east: -3.65, north: 40.45 };

  it('matches the value ADR §12.1 states', () => {
    expect(locationKey(mapBounds(MADRID))).toBe('bbox:-3.75,40.38,-3.65,40.45');
  });

  /**
   * The bound is the LITERAL 3, not `KEY_BOUNDS_DECIMALS`.
   *
   * Written the obvious way — asserting against the exported constant — this
   * test cannot fail: widening the constant to 6 moves the implementation and
   * the assertion together, so a key emitting six decimals passes. That was
   * found by mutation-testing this very file (the constant was changed to 6 and
   * only two OTHER assertions went red), and it is the plain form of "a check
   * that cannot distinguish success from failure".
   */
  it('never emits more than three decimal places', () => {
    const jittery: GeoBounds = {
      west: 2.0501234567,
      south: 41.3209876543,
      east: 2.2304444444,
      north: 41.4706666666,
    };
    const key = locationKey(mapBounds(jittery));
    const components = key.replace('bbox:', '').split(',');
    expect(components).toHaveLength(4);
    for (const component of components) {
      const decimals = component.split('.')[1] ?? '';
      expect(decimals.length).toBeLessThanOrEqual(3);
    }
    // And the published constant is what the ADR says it is, so a consumer
    // reading it for its own rounding gets the same grid.
    expect(KEY_BOUNDS_DECIMALS).toBe(3);
  });

  /**
   * The reason the grid exists: a map that jitters by less than the grid is one
   * query, not a new one for every frame. The offset here (2e-5 degrees, about
   * 2 m) is far below 3 dp, so a correct implementation collapses the two.
   */
  it('gives two viewports differing below the grid the same key', () => {
    const a: GeoBounds = { west: 2.05, south: 41.32, east: 2.23, north: 41.47 };
    const b: GeoBounds = {
      west: 2.05002,
      south: 41.32002,
      east: 2.23002,
      north: 41.47002,
    };
    expect(locationKey(mapBounds(b))).toBe(locationKey(mapBounds(a)));
  });

  /**
   * Negative control for the collapse above. Without it, an implementation
   * rounding to zero decimals — or returning a constant — passes.
   */
  it('gives two viewports differing above the grid different keys', () => {
    const a: GeoBounds = { west: 2.05, south: 41.32, east: 2.23, north: 41.47 };
    const b: GeoBounds = { west: 2.06, south: 41.32, east: 2.23, north: 41.47 };
    expect(locationKey(mapBounds(b))).not.toBe(locationKey(mapBounds(a)));
  });

  /**
   * A box straddling Greenwich must not key differently depending on which side
   * of zero the float landed on: `-0` and `0` are the same meridian, and
   * `String(-0.0001 rounded)` is `-0` without the normalisation.
   */
  it('normalises negative zero', () => {
    const west: GeoBounds = { west: -0.0001, south: 51.4, east: 0.1, north: 51.6 };
    const east: GeoBounds = { west: 0.0001, south: 51.4, east: 0.1, north: 51.6 };
    expect(locationKey(mapBounds(west))).toBe(locationKey(mapBounds(east)));
    expect(locationKey(mapBounds(west))).not.toContain('-0,');
  });

  it('keys a polygon by its bounds, on the same grid', () => {
    const polygon: Extract<LocationSelection, { kind: 'polygon' }> = {
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
      bounds: { west: 2.05, south: 41.32, east: 2.23, north: 41.47 },
      label: { primary: 'Drawn area', kind: 'generated' },
      precision: 'area',
    };
    expect(locationKey(polygon)).toBe('bbox:2.05,41.32,2.23,41.47');
  });
});

// ---------------------------------------------------------------------------
// §12.2 — two cities called Barcelona
// ---------------------------------------------------------------------------

describe('locationKey: homonyms are two different things', () => {
  /**
   * The expected answer is the SECOND fixture, per §12.2's fixture-shape
   * warning: a test whose right answer is also the first candidate, the most
   * popular one, or the default-country match cannot distinguish a correct
   * implementation from any of the four wrong ones the ADR lists.
   */
  it('keys the Venezuelan Barcelona by its own id', () => {
    expect(locationKey(BARCELONA_VE)).toBe('homiio:city:01J2K4M6P8R0T2V4X6Z8A0C2E4');
  });

  it('gives the two Barcelonas different keys', () => {
    expect(locationKey(BARCELONA_VE)).not.toBe(locationKey(BARCELONA_ES));
  });

  /**
   * A key built from the label is the failure that produces both of today's
   * homonym bugs at once — `results[0]` and de-duping recents by label. The two
   * fixtures share a label exactly so this assertion can see it.
   */
  it('does not contain the label the two share', () => {
    expect(locationKey(BARCELONA_VE)).not.toContain('Barcelona');
    expect(locationKey(BARCELONA_ES)).not.toContain('Barcelona');
  });

  it('keys an external candidate by provider and ref, marked as external', () => {
    const external: PlaceSelection = {
      kind: 'place',
      source: { kind: 'external', provider: 'osm', ref: 'R349036' },
      placeType: 'city',
      label: PLACE_LABEL,
      admin: ADMIN_ES,
      center: { longitude: 2.1686, latitude: 41.3874 },
      precision: 'centroid',
    };
    expect(locationKey(external)).toBe('ext:osm:R349036');
  });

  /**
   * A Homiio city and an external candidate that happen to share an id string
   * are different places, and the source prefix is what says so. Without it a
   * provider ref could collide with a canonical id and silently share a cache
   * entry.
   */
  it('separates a homiio entity from an external ref with the same id', () => {
    const external: Extract<LocationSelection, { kind: 'address_candidate' }> = {
      kind: 'address_candidate',
      source: { kind: 'external', provider: 'osm', ref: '01H8XQ7C2R9V6WQ2N4M0KJ3ZTA' },
      label: PLACE_LABEL,
      admin: ADMIN_ES,
      center: { longitude: 2.1686, latitude: 41.3874 },
      precision: 'exact',
    };
    expect(locationKey(external)).not.toBe(locationKey(BARCELONA_ES));
  });
});

// ---------------------------------------------------------------------------
// The remaining branches
// ---------------------------------------------------------------------------

describe('locationKey: absence and composition', () => {
  it('has a key for no location at all', () => {
    expect(locationKey(null)).toBe('none');
  });

  /**
   * "No location" is a legitimate query (§4.3) and must not collide with any
   * real one — otherwise a global feed and a real search share a cache entry.
   */
  it('does not collide with any selection key', () => {
    for (const selection of [BARCELONA_ES, BARCELONA_VE, mapBounds({ west: 0, south: 0, east: 1, north: 1 })]) {
      expect(locationKey(selection)).not.toBe('none');
    }
  });

  it('sorts multi_area so the key does not depend on pick order', () => {
    const forward: LocationSelection = {
      kind: 'multi_area',
      areas: [BARCELONA_ES, BARCELONA_VE],
      label: { primary: '2 areas', kind: 'generated' },
    };
    const reversed: LocationSelection = {
      kind: 'multi_area',
      areas: [BARCELONA_VE, BARCELONA_ES],
      label: { primary: '2 areas', kind: 'generated' },
    };
    expect(locationKey(reversed)).toBe(locationKey(forward));
  });

  /**
   * Negative control for the sort: a `multi_area` of two different sets must
   * not collapse. An implementation returning `multi:` regardless would pass
   * the order-independence assertion above on its own.
   */
  it('still distinguishes two different multi_area sets', () => {
    const pair: LocationSelection = {
      kind: 'multi_area',
      areas: [BARCELONA_ES, BARCELONA_VE],
      label: { primary: '2 areas', kind: 'generated' },
    };
    const single: LocationSelection = {
      kind: 'multi_area',
      areas: [BARCELONA_ES],
      label: { primary: '1 area', kind: 'generated' },
    };
    expect(locationKey(single)).not.toBe(locationKey(pair));
  });
});
