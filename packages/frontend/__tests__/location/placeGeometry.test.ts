/**
 * `PlaceGeometry` — a place either has a representative point or says it has
 * none, and the two contradictions in between do not compile.
 *
 * WHAT THIS EXISTS FOR. `center` used to be REQUIRED beside a `precision` that
 * could say `area`, so a country — which has no centroid in Homiio's schema —
 * had nowhere honest to go. The geocoding gateway emitted
 * `{ longitude: 0, latitude: 0 }` for every country and region, the search
 * screen drew its ±0.05° fallback box around that, and picking "Spain" returned
 * zero listings over a map of the Gulf of Guinea. Nothing threw. Zero results is
 * the plausible-looking failure, which is why it reached review unnoticed.
 *
 * TWO KINDS OF ASSERTION LIVE HERE, AND ONLY ONE OF THEM IS JEST'S.
 *
 * The `Assert<…>` aliases below are checked by `tsc`, not by this runner —
 * babel strips types, so jest never sees them. They fail the frontend's
 * `tsc --noEmit` (and `shared-types`' build) if the constraint breaks, which is
 * the point: the guarantee is that the bad state cannot be WRITTEN, and a
 * runtime test cannot observe a value that does not exist. Mutating
 * `center?: never` back to `center?: GeoPoint` turns them red under `tsc`;
 * that was measured, not assumed.
 *
 * The `it(…)` blocks below cover what remains observable at runtime: that
 * absence survives a round trip, that it is distinguishable from a real
 * coordinate, and that the key and the token are indifferent to it.
 */

import {
  geoPlaceToSelection,
  locationKey,
  serializeLocationToken,
  type AdminHierarchy,
  type GeoPlace,
  type GeoPoint,
  type LocationSelection,
  type PlaceLabel,
  type PlaceSource,
} from '@homiio/shared-types';

// ---------------------------------------------------------------------------
// Compile-time assertions (checked by tsc, not by jest — see the header)
// ---------------------------------------------------------------------------

/** Fails to compile unless `T` is exactly `true`. */
type Assert<T extends true> = T;
/** `[A] extends [B]` rather than `A extends B`, so a union is not distributed. */
type IsAssignable<A, B> = [A] extends [B] ? true : false;
type NotAssignable<A, B> = IsAssignable<A, B> extends true ? false : true;

type PlaceIdentity = {
  readonly source: PlaceSource;
  readonly placeType: 'city';
  readonly label: PlaceLabel;
  readonly admin: AdminHierarchy;
};

/**
 * The bug itself: `area` may not carry a centre.
 *
 * A plain `center?: GeoPoint` beside an open `precision` would ACCEPT this —
 * verified against the compiler before choosing the shape — leaving the
 * contradiction discouraged rather than unrepresentable. `center?: never`
 * refuses it, and refuses it through a variable too, not only as an object
 * literal, which is the form the gateway actually writes.
 */
export type _AreaMayNotCarryACentre = Assert<
  NotAssignable<PlaceIdentity & { precision: 'area'; center: GeoPoint }, GeoPlace>
>;

/**
 * The mirror, which a one-directional guard would miss: a `centroid` with no
 * centre is equally incoherent, and claiming a representative point while
 * having none is how a consumer ends up reading `undefined.longitude`.
 */
export type _CentroidMustCarryACentre = Assert<
  NotAssignable<PlaceIdentity & { precision: 'centroid' }, GeoPlace>
>;

/** Both legal shapes still are legal — or the two above pass vacuously. */
export type _CentroidWithACentreIsFine = Assert<
  IsAssignable<PlaceIdentity & { precision: 'centroid'; center: GeoPoint }, GeoPlace>
>;
export type _AreaWithoutACentreIsFine = Assert<
  IsAssignable<PlaceIdentity & { precision: 'area' }, GeoPlace>
>;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const LABEL: PlaceLabel = { primary: 'Spain', kind: 'place' };
const ADMIN: AdminHierarchy = { countryCode: 'ES' };

/** A country: real, named, resolvable by id, and with no centroid in this schema. */
const SPAIN: GeoPlace = {
  source: { kind: 'homiio', entity: 'country', id: '01H8XQ7C2R9V6WQ2N4M0KJ3ZTA' },
  placeType: 'country',
  label: LABEL,
  admin: ADMIN,
  precision: 'area',
};

/**
 * A GENUINE place whose centre is exactly `(0, 0)`.
 *
 * The fixture exists so that nothing can later "simplify" absence into a
 * sentinel — an `isNullIsland()` check, or `center.longitude === 0 &&
 * center.latitude === 0` treated as "no centre". `(0, 0)` is a real point in
 * the Atlantic, and longitude zero runs through Greenwich, Accra and Tema, so a
 * sentinel would silently delete the centre of every place on the prime
 * meridian. This is the fixture that makes that regression fail.
 */
const AT_NULL_ISLAND: GeoPlace = {
  source: { kind: 'external', provider: 'osm', ref: 'N9999999999' },
  placeType: 'city',
  label: { primary: 'Soul Buoy', secondary: 'Atlantic Ocean', kind: 'place' },
  admin: { countryCode: 'GH' },
  center: { longitude: 0, latitude: 0 },
  precision: 'centroid',
};

/** On the prime meridian, and unambiguously a place people live in. */
const GREENWICH: GeoPlace = {
  source: { kind: 'external', provider: 'osm', ref: 'N1111111111' },
  placeType: 'district',
  label: { primary: 'Greenwich', secondary: 'London, United Kingdom', kind: 'place' },
  admin: { countryCode: 'GB', cityName: 'London' },
  center: { longitude: 0, latitude: 51.4779 },
  precision: 'centroid',
};

// ---------------------------------------------------------------------------
// Runtime behaviour
// ---------------------------------------------------------------------------

describe('a place with no representative point', () => {
  it('converts to a selection that also has none', () => {
    const selection = geoPlaceToSelection(SPAIN);
    expect(selection.kind).toBe('place');
    // Not `toBeUndefined()`: the key property is that the field is ABSENT, so a
    // consumer spreading the selection cannot resurrect a `center` key holding
    // `undefined` and then read `.longitude` off it.
    expect('center' in selection).toBe(false);
    expect(selection).toMatchObject({ precision: 'area' });
  });

  it('is not confused with a place that really is at (0, 0)', () => {
    const absent = geoPlaceToSelection(SPAIN);
    const present = geoPlaceToSelection(AT_NULL_ISLAND);
    expect('center' in absent).toBe(false);
    expect('center' in present).toBe(true);
    expect(present).toMatchObject({ center: { longitude: 0, latitude: 0 } });
  });

  it('keeps the centre of a place on the prime meridian', () => {
    // A `longitude === 0 ? absent : present` shortcut would delete this one.
    expect(geoPlaceToSelection(GREENWICH)).toMatchObject({
      center: { longitude: 0, latitude: 51.4779 },
    });
  });

  it('carries bounds through when it has them, and invents none when it does not', () => {
    const withBounds = geoPlaceToSelection({
      ...SPAIN,
      bounds: { west: -9.3, south: 36, east: 3.3, north: 43.8 },
    });
    expect(withBounds).toMatchObject({
      precision: 'area',
      bounds: { west: -9.3, south: 36, east: 3.3, north: 43.8 },
    });
    // Requiring `bounds` on the `area` branch would only move the fabrication
    // one field across: a country with no bbox would have to invent a rectangle
    // instead of a point.
    expect('bounds' in geoPlaceToSelection(SPAIN)).toBe(false);
  });
});

describe('the key and the token are indifferent to a missing centre', () => {
  /**
   * This is what keeps the blast radius small, so it is pinned rather than
   * asserted in a PR description: `locationKey` keys a place on its `source`
   * and a place token carries no coordinates, so making `center` optional
   * changes neither. Only code that READS `.center` had to move.
   */
  const centreless = geoPlaceToSelection(SPAIN);
  const withCentre: LocationSelection = {
    kind: 'place',
    source: { kind: 'homiio', entity: 'country', id: '01H8XQ7C2R9V6WQ2N4M0KJ3ZTA' },
    placeType: 'country',
    label: LABEL,
    admin: ADMIN,
    center: { longitude: -3.7, latitude: 40.4 },
    precision: 'centroid',
  };

  it('produces the same key either way, because the key is the identity', () => {
    expect(locationKey(centreless)).toBe('homiio:country:01H8XQ7C2R9V6WQ2N4M0KJ3ZTA');
    expect(locationKey(centreless)).toBe(locationKey(withCentre));
  });

  it('produces the same token either way', () => {
    const a = serializeLocationToken(centreless);
    const b = serializeLocationToken(withCentre);
    expect(a).toEqual({ ok: true, value: 'country.homiio.01H8XQ7C2R9V6WQ2N4M0KJ3ZTA' });
    expect(a).toEqual(b);
  });

  /**
   * Negative control for both: the key and the token DO still distinguish two
   * different places. Without this, an implementation returning a constant
   * would satisfy the two assertions above.
   */
  it('still distinguishes a different place', () => {
    const other = geoPlaceToSelection(GREENWICH);
    expect(locationKey(other)).not.toBe(locationKey(centreless));
    expect(serializeLocationToken(other)).not.toEqual(serializeLocationToken(centreless));
  });
});
