/**
 * Discriminating fixtures for the location and housing-identity suite (#350).
 *
 * THE RULE THAT SHAPED EVERY ONE OF THESE: a fixture on which a correct and an
 * incorrect implementation agree proves nothing, however elaborate it looks.
 * Each block below therefore records, in its own comment, what a WRONG
 * implementation produces from it — and `docs/qa/location-and-housing-identity-
 * e2e-matrix.md` repeats that list so the reasoning survives outside the code.
 *
 * Coordinates are real. Barcelona in Anzoátegui, Venezuela is a real city of
 * that name in another country, which is what makes the homonym case a
 * measurement rather than a mock.
 */

import type { PricedListing } from '@homiio/shared-types';
// `GeoPoint`, `GeoBounds` and `QueryDescriptor` come from the observability
// module BY PATH, not from the package barrel.
//
// The barrel's `GeoPoint` is now the canonical location contract's
// (`{ longitude, latitude }`, ADR 0002 §3), while the query-identity digest
// these fixtures feed takes its own `{ lat, lng }`. The two are different types
// with one name, so this file has to say which it means — and it means the one
// its consumer, `checkQueryIdentityMatch`, actually accepts. Do not "tidy" this
// back to the barrel: it compiled before only because the canonical contract
// did not exist yet, and folding the two encodings into one is the location
// migration's job (#352), not a change to make silently from here.
import type { GeoBounds, GeoPoint, QueryDescriptor } from '@homiio/shared-types/observability/queryIdentity';

export interface PlaceFixture {
  /** A stable key, never a display string — see `LocationScopeContract`. */
  readonly placeKey: string;
  readonly countryCode: string;
  readonly center: GeoPoint;
  readonly bounds: GeoBounds;
}

/**
 * Barcelona, Catalonia, Spain.
 *
 * WRONG IMPLEMENTATION: one that scopes by NAME rather than by place key
 * cannot tell this apart from {@link BARCELONA_VE} below, and will answer a
 * search for either with listings from both.
 */
export const BARCELONA_ES: PlaceFixture = {
  placeKey: 'es-cat-barcelona',
  countryCode: 'ES',
  center: { lat: 41.3874, lng: 2.1686 },
  bounds: { west: 2.052, south: 41.317, east: 2.228, north: 41.468 },
};

/**
 * Barcelona, Anzoátegui, Venezuela — 7 200 km away and in the other hemisphere.
 *
 * WRONG IMPLEMENTATION: a name-keyed scope produces the SAME query id as
 * {@link BARCELONA_ES}; the area check reports full overlap because it never
 * compares geometry at all.
 */
export const BARCELONA_VE: PlaceFixture = {
  placeKey: 've-anz-barcelona',
  countryCode: 'VE',
  center: { lat: 10.1333, lng: -64.6833 },
  bounds: { west: -64.76, south: 10.06, east: -64.6, north: 10.21 },
};

/**
 * Madrid — 505 km from Barcelona, far enough that no rounding, tolerance or
 * viewport slop can make the two boxes overlap.
 *
 * WRONG IMPLEMENTATION: "search this area" that moves the map without clearing
 * the previous city filter answers a Madrid viewport with Barcelona listings.
 * The two descriptors differ only in `filters.cityKey`, so a check that
 * compares BOUNDS alone passes it and only the query id catches it.
 */
export const MADRID_ES: PlaceFixture = {
  placeKey: 'es-mad-madrid',
  countryCode: 'ES',
  center: { lat: 40.4168, lng: -3.7038 },
  bounds: { west: -3.889, south: 40.312, east: -3.518, north: 40.564 },
};

/**
 * A viewport across the antimeridian: Fiji, 179°E to −179°W. Two degrees wide.
 *
 * WRONG IMPLEMENTATION: `east - west` gives −358, so the viewport reads as
 * either empty or as the whole planet. Both readings are silent — the first
 * makes an identical pair look divergent, the second makes every comparison
 * pass, which is the dangerous direction.
 */
export const ANTIMERIDIAN_VIEWPORT: GeoBounds = {
  west: 179,
  south: -18,
  east: -179,
  north: -16,
};

/** Its complement: everything BUT the box above. Shares not one square degree. */
export const ANTIMERIDIAN_COMPLEMENT: GeoBounds = {
  west: -179,
  south: -18,
  east: 179,
  north: -16,
};

/** A city-scoped query for a place fixture, as both a list and a map would build it. */
export function cityQuery(
  place: PlaceFixture,
  filters: Readonly<Record<string, string | number | boolean>> = {},
): QueryDescriptor {
  return {
    locationKind: 'city',
    countryCode: place.countryCode,
    placeKey: place.placeKey,
    center: place.center,
    bounds: place.bounds,
    filters: { cityKey: place.placeKey, ...filters },
    sort: 'relevance',
  };
}

/** A viewport-scoped query, as "search this area" would build it. */
export function viewportQuery(
  bounds: GeoBounds,
  filters: Readonly<Record<string, string | number | boolean>> = {},
): QueryDescriptor {
  return {
    locationKind: 'bbox',
    bounds,
    filters,
    sort: 'relevance',
  };
}

/* ── Two dwellings in one building ────────────────────────────────────────── */

export interface DwellingFixture {
  readonly buildingKey: string;
  readonly unitKey: string;
  readonly reviewScore: number;
}

/**
 * Two units at the same street address with genuinely different experiences —
 * the ground-floor flat above a bar and the quiet fourth floor.
 *
 * WRONG IMPLEMENTATION: keying housing identity on the ADDRESS (or on the
 * building) collapses them into one profile, so both units show the average of
 * 2 and 5 and neither resident's review describes the home somebody is about to
 * rent. The fixture discriminates because the two scores are far apart: had
 * both been 4, a building-keyed and a unit-keyed implementation would print the
 * same number and the test would pass either way.
 */
export const SAME_BUILDING_UNITS: readonly [DwellingFixture, DwellingFixture] = [
  { buildingKey: 'es-cat-barcelona-mallorca-401', unitKey: 'unit-1-1', reviewScore: 2 },
  { buildingKey: 'es-cat-barcelona-mallorca-401', unitKey: 'unit-4-2', reviewScore: 5 },
];

/* ── One dwelling, three portal listings ──────────────────────────────────── */

export interface ListingFixture {
  readonly listingKey: string;
  readonly provider: string;
  readonly unitKey: string;
  readonly price: PricedListing;
  readonly photoCount: number;
}

/**
 * One flat, listed by three portals with different ids, different photo counts
 * and prices that differ by agency fees.
 *
 * WRONG IMPLEMENTATION: grouping on the LISTING id yields three groups of one
 * rather than one group of three, so `listing_duplicate_group_opened` never
 * fires and the price sample below counts the same flat three times. The prices
 * are deliberately close (1 200 / 1 250 / 1 290) so that a merge is invisible in
 * any single figure and only shows in the median.
 */
export const DUPLICATE_LISTING_GROUP: readonly ListingFixture[] = [
  {
    listingKey: 'idealista-98217361',
    provider: 'idealista',
    unitKey: 'unit-4-2',
    price: { amount: 1200, currency: 'EUR' },
    photoCount: 18,
  },
  {
    listingKey: 'fotocasa-171-3390022',
    provider: 'fotocasa',
    unitKey: 'unit-4-2',
    price: { amount: 1250, currency: 'EUR' },
    photoCount: 21,
  },
  {
    listingKey: 'habitaclia-i9927744',
    provider: 'habitaclia',
    unitKey: 'unit-4-2',
    price: { amount: 1290, currency: 'EUR' },
    photoCount: 17,
  },
];

/**
 * A group whose members are quoted in different currencies.
 *
 * WRONG IMPLEMENTATION: `(max - min) / min` over these reports a spread of
 * 0% — every amount is 1 200 — while the real gap between 1 200 PLN and
 * 1 200 USD is roughly fourfold. The correct answer is not a converted number,
 * it is the absence of one.
 */
export const MIXED_CURRENCY_GROUP: readonly PricedListing[] = [
  { amount: 1200, currency: 'EUR' },
  { amount: 1200, currency: 'USD' },
  { amount: 1200, currency: 'PLN' },
  { amount: 1200, currency: 'RON' },
];

/**
 * A neighbourhood price sample in which the duplicate above appears three times.
 *
 * WRONG IMPLEMENTATION: counting every listing gives an eight-value sample
 * (900, 980, 1050, 1200, 1250, 1290, 1600, 1800) with a median of 1 225;
 * deduplicating to one row per dwelling — the lowest asking price for the flat
 * — gives six values (900, 980, 1050, 1200, 1600, 1800) and a median of 1 125.
 * A hundred euros of difference in the number a person is told is fair, and it
 * exists only because the duplicate sits in the MIDDLE of the distribution: a
 * duplicate at either extreme moves the median the same way under both
 * readings and would prove nothing.
 */
export const PRICE_SAMPLE_WITH_DUPLICATE: readonly ListingFixture[] = [
  {
    listingKey: 'local-a',
    provider: 'homiio',
    unitKey: 'unit-1-1',
    price: { amount: 900, currency: 'EUR' },
    photoCount: 8,
  },
  {
    listingKey: 'local-b',
    provider: 'homiio',
    unitKey: 'unit-2-1',
    price: { amount: 980, currency: 'EUR' },
    photoCount: 6,
  },
  {
    listingKey: 'local-c',
    provider: 'homiio',
    unitKey: 'unit-3-1',
    price: { amount: 1050, currency: 'EUR' },
    photoCount: 9,
  },
  ...DUPLICATE_LISTING_GROUP,
  {
    listingKey: 'local-d',
    provider: 'homiio',
    unitKey: 'unit-5-1',
    price: { amount: 1600, currency: 'EUR' },
    photoCount: 12,
  },
  {
    listingKey: 'local-e',
    provider: 'homiio',
    unitKey: 'unit-6-1',
    price: { amount: 1800, currency: 'EUR' },
    photoCount: 14,
  },
];

/* ── An exact location and its public approximation ───────────────────────── */

/**
 * Where the dwelling actually is: five decimal places, roughly one metre.
 *
 * WRONG IMPLEMENTATION: publishing this verbatim on an eviction board or a
 * review puts a household's door on a public map. It renders identically to the
 * approximation at any zoom a person is likely to look at, which is exactly why
 * nothing but a decimal-place check catches it.
 */
export const EXACT_LOCATION: GeoPoint = { lat: 41.38743, lng: 2.1686 };

/** The same place at locality precision: two decimals, roughly a kilometre. */
export const PUBLIC_APPROXIMATION: GeoPoint = { lat: 41.39, lng: 2.17 };

/**
 * A rounding that produced float noise. `41.39000000000001` is what
 * `Math.round(41.38743 * 100) / 100` can yield on some inputs, and it carries
 * fourteen decimal places.
 *
 * WRONG IMPLEMENTATION: one that trusts "we rounded it" instead of measuring
 * the stored value publishes full precision while believing it did not.
 */
export const FLOAT_NOISE_APPROXIMATION: GeoPoint = { lat: 41.39000000000001, lng: 2.17 };
