/**
 * Divergence invariants — the seven checks the issue names.
 *
 * Each answers a question no unit test of a component can answer, because the
 * failure is an AGREEMENT failure between two things that are individually
 * correct: a map that frames Barcelona and a list that queries Madrid are both
 * doing exactly what they were told.
 *
 * WHAT IS REAL HERE AND WHAT IS A CONTRACT
 * ----------------------------------------
 * Four of these run against shapes that exist today and are exercised by the
 * suite. Three — the visible label, the public-precision policy and the housing
 * identity link — describe features that land in #352, #347 and #360/#361. For
 * those the function takes a MINIMAL STRUCTURAL CONTRACT declared right here
 * rather than importing a type that does not exist, so the assertion is real
 * code with real tests today and the later issue satisfies a written interface
 * instead of inventing one. None of it is dead code pretending to run: every
 * function below is called by the suite with the fixtures in
 * `packages/backend/__tests__/helpers/locationIdentityFixtures.ts`.
 *
 * EVERY RESULT IS SAFE TO LOG.
 * `safe` carries classifications, booleans and small integers only — never a
 * coordinate, a label string, a place name or a query. That is asserted by the
 * suite, which runs every invariant's `safe` map through the same sensitive
 * value sweep the redaction layer uses. The issue is explicit that production
 * divergence checks may record ids and classifications and nothing else, and a
 * result object shaped so that the unsafe thing is simply absent is the only
 * version of that which survives a careless caller.
 */

import { deriveQueryId, type GeoBounds, type GeoPoint, type QueryDescriptor } from './queryIdentity';
import type { AddressPrecisionLevel, GeocoderOutcome, LocationKind, SearchFallback } from './schema';

export type InvariantCode =
  | 'query_identity_divergent'
  | 'visible_area_divergent'
  | 'visible_label_divergent'
  | 'stale_result_rendered'
  | 'unscoped_fallback_after_geocoder_error'
  | 'public_precision_exceeded'
  | 'listing_missing_housing_identity';

/** Values an invariant may report. No shape here can hold a coordinate or a name. */
export type SafeDetailValue = string | number | boolean;

export interface InvariantResult {
  /** `true` when the invariant HOLDS. */
  readonly ok: boolean;
  readonly code: InvariantCode;
  readonly safe: Readonly<Record<string, SafeDetailValue>>;
}

/* ── 1. The list and the map must be showing the same query ───────────────── */

/**
 * Both surfaces derive an id from their own effective query; equal ids mean
 * they agree. A test can print `canonicalQueryDescriptor` for each side when
 * this fails — two hex digests say only that they differ.
 */
export function checkQueryIdentityMatch(
  listQuery: QueryDescriptor,
  mapQuery: QueryDescriptor,
): InvariantResult {
  const listId = deriveQueryId(listQuery);
  const mapId = deriveQueryId(mapQuery);
  return {
    ok: listId === mapId,
    code: 'query_identity_divergent',
    safe: {
      listKind: listQuery.locationKind,
      mapKind: mapQuery.locationKind,
      sameScopeKind: listQuery.locationKind === mapQuery.locationKind,
      match: listId === mapId,
    },
  };
}

/* ── 2. The area on screen must be the area that was queried ──────────────── */

/** How much of the two areas coincide, as a label rather than a number. */
export type AreaOverlapClass = 'none' | 'partial' | 'most' | 'match';

/**
 * Default floor for {@link checkVisibleAreaMatchesQueriedArea}. Half the union
 * is generous on purpose: a map that has been nudged, or a list whose radius
 * was rounded, must not fire. The failures this exists to catch — a different
 * city, a different country, a global fallback — score zero.
 */
export const DEFAULT_MIN_AREA_OVERLAP = 0.5;

function crossesAntimeridian(bounds: GeoBounds): boolean {
  return bounds.east < bounds.west;
}

/** A wrapping box becomes two non-wrapping longitude intervals. */
function longitudeIntervals(bounds: GeoBounds): [number, number][] {
  if (!crossesAntimeridian(bounds)) return [[bounds.west, bounds.east]];
  return [
    [bounds.west, 180],
    [-180, bounds.east],
  ];
}

function longitudeSpan(bounds: GeoBounds): number {
  return crossesAntimeridian(bounds)
    ? 360 - bounds.west + bounds.east
    : bounds.east - bounds.west;
}

function latitudeSpan(bounds: GeoBounds): number {
  return Math.max(0, bounds.north - bounds.south);
}

function longitudeOverlap(a: GeoBounds, b: GeoBounds): number {
  let total = 0;
  for (const [aWest, aEast] of longitudeIntervals(a)) {
    for (const [bWest, bEast] of longitudeIntervals(b)) {
      const low = Math.max(aWest, bWest);
      const high = Math.min(aEast, bEast);
      if (high > low) total += high - low;
    }
  }
  return total;
}

function latitudeOverlap(a: GeoBounds, b: GeoBounds): number {
  const low = Math.max(a.south, b.south);
  const high = Math.min(a.north, b.north);
  return high > low ? high - low : 0;
}

function overlapClass(ratio: number): AreaOverlapClass {
  if (ratio <= 0) return 'none';
  if (ratio < 0.5) return 'partial';
  if (ratio < 0.9) return 'most';
  return 'match';
}

/**
 * Compare what is on screen with what was asked for.
 *
 * The ratio is intersection over union in DEGREES², not square kilometres: a
 * ratio between two boxes at similar latitude is unaffected by the cosine
 * distortion, and introducing a projection here would add a failure mode for no
 * gain. Antimeridian-crossing boxes are handled by splitting them, which is the
 * whole reason the issue lists that case: a naive `east - west` on a box
 * spanning 179°E → -179°W reports a 358°-wide viewport and every comparison
 * against it succeeds.
 */
export function checkVisibleAreaMatchesQueriedArea(
  visible: GeoBounds,
  queried: GeoBounds,
  minOverlapRatio: number = DEFAULT_MIN_AREA_OVERLAP,
): InvariantResult {
  const visibleArea = longitudeSpan(visible) * latitudeSpan(visible);
  const queriedArea = longitudeSpan(queried) * latitudeSpan(queried);
  const intersection = longitudeOverlap(visible, queried) * latitudeOverlap(visible, queried);
  const union = visibleArea + queriedArea - intersection;
  const ratio = union > 0 ? intersection / union : 0;

  return {
    ok: ratio >= minOverlapRatio,
    code: 'visible_area_divergent',
    safe: {
      overlapClass: overlapClass(ratio),
      visibleCrossesAntimeridian: crossesAntimeridian(visible),
      queriedCrossesAntimeridian: crossesAntimeridian(queried),
    },
  };
}

/* ── 3. The label on screen must describe the current selection ───────────── */

/**
 * The minimal shape #352's `LocationSelection` must expose for this check.
 *
 * `placeKey` is a STABLE KEY (a canonical place id), never the display string:
 * comparing rendered text would make the check locale-dependent and would put a
 * place name into a result that is meant to be loggable.
 */
export interface LocationScopeContract {
  readonly kind: LocationKind;
  readonly countryCode?: string;
  readonly placeKey?: string;
}

/**
 * The contract a rendered location label owes: it must carry the scope it was
 * rendered FROM, so "the header still says Barcelona" is answerable without
 * reading the header.
 */
export interface RenderedLocationLabelContract {
  readonly renderedFrom: LocationScopeContract;
}

export function checkVisibleLabelMatchesSelection(
  label: RenderedLocationLabelContract,
  current: LocationScopeContract,
): InvariantResult {
  const kindMatch = label.renderedFrom.kind === current.kind;
  const countryMatch = label.renderedFrom.countryCode === current.countryCode;
  const placeMatch = label.renderedFrom.placeKey === current.placeKey;
  return {
    ok: kindMatch && countryMatch && placeMatch,
    code: 'visible_label_divergent',
    safe: { kindMatch, countryMatch, placeMatch, currentKind: current.kind },
  };
}

/* ── 4. A result must answer the query that is current ────────────────────── */

export function checkResultIsForCurrentQuery(
  resultQueryId: string,
  currentQueryId: string,
): InvariantResult {
  const stale = resultQueryId !== currentQueryId;
  return {
    ok: !stale,
    code: 'stale_result_rendered',
    safe: { stale },
  };
}

/* ── 5. A geocoder failure must never widen the scope to the world ────────── */

/**
 * Principle 4 of the epic, made checkable.
 *
 * Two conditions, and the second is the stricter one:
 *
 *   - a `global` fallback is a violation ALWAYS, geocoder outcome or not. There
 *     is no correct reason to answer a located search with a worldwide feed;
 *   - after a non-`ok` geocoder outcome, the applied scope may not be `none`.
 *     That is the silent version: no fallback was "applied", the scope simply
 *     never existed, and the feed looks like a normal unfiltered browse.
 */
export function checkGeocoderFallbackScope(
  outcome: GeocoderOutcome,
  appliedScopeKind: LocationKind,
  fallbackApplied: SearchFallback,
): InvariantResult {
  const worldwideFallback = fallbackApplied === 'global';
  const unscopedAfterFailure = outcome !== 'ok' && appliedScopeKind === 'none';
  return {
    ok: !worldwideFallback && !unscopedAfterFailure,
    code: 'unscoped_fallback_after_geocoder_error',
    safe: { outcome, appliedScopeKind, fallbackApplied, worldwideFallback, unscopedAfterFailure },
  };
}

/* ── 6. Published precision must not exceed the policy ────────────────────── */

/**
 * Decimal places permitted in a PUBLISHED coordinate, per precision level.
 *
 * Degrees of latitude: 1 dp ≈ 11 km, 2 ≈ 1.1 km, 3 ≈ 110 m, 4 ≈ 11 m, 5 ≈ 1 m.
 * These are the mechanism's defaults; #347 owns the policy itself and may pass
 * its own map. What must not happen is a surface picking its own number.
 */
export const PUBLIC_PRECISION_MAX_DECIMALS: Readonly<Record<AddressPrecisionLevel, number>> = {
  area: 1,
  locality: 2,
  street: 3,
  building: 4,
  unit: 5,
};

/**
 * How many decimal places a number carries.
 *
 * Exponent notation is handled explicitly: `String(1e-7)` is `"1e-7"`, and a
 * naive scan for `.` reports zero decimals for the most precise value in the
 * set — the failure direction that admits an exact coordinate.
 */
export function decimalPlaces(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const text = String(value);
  const exponentAt = text.indexOf('e');
  if (exponentAt !== -1) {
    const mantissa = text.slice(0, exponentAt);
    const exponent = Number(text.slice(exponentAt + 1));
    const dot = mantissa.indexOf('.');
    const mantissaDecimals = dot === -1 ? 0 : mantissa.length - dot - 1;
    return Math.max(0, mantissaDecimals - exponent);
  }
  const dot = text.indexOf('.');
  return dot === -1 ? 0 : text.length - dot - 1;
}

export function checkPublicPrecisionWithinPolicy(
  published: GeoPoint,
  level: AddressPrecisionLevel,
  maxDecimalsByLevel: Readonly<
    Record<AddressPrecisionLevel, number>
  > = PUBLIC_PRECISION_MAX_DECIMALS,
): InvariantResult {
  const allowed = maxDecimalsByLevel[level];
  const observed = Math.max(decimalPlaces(published.lat), decimalPlaces(published.lng));
  return {
    ok: observed <= allowed,
    code: 'public_precision_exceeded',
    safe: { level, allowedDecimals: allowed, observedDecimals: observed },
  };
}

/* ── 7. A listing on a canonical address must carry its housing identity ──── */

/**
 * The minimal shape #360/#361 must expose. `hasHousingIdentity` is whether the
 * listing resolves to a canonical unit or building; `addressIsCanonical` is
 * whether its address has been materialised out of candidate state. A listing
 * on a materialised address with no identity is the case that makes three
 * external listings of one flat read as three separate homes — and it inflates
 * a price sample by counting the same rent three times.
 */
export interface ListingIdentityContract {
  readonly addressIsCanonical: boolean;
  readonly hasHousingIdentity: boolean;
}

export function checkListingHasHousingIdentity(listing: ListingIdentityContract): InvariantResult {
  const ok = !listing.addressIsCanonical || listing.hasHousingIdentity;
  return {
    ok,
    code: 'listing_missing_housing_identity',
    safe: {
      addressIsCanonical: listing.addressIsCanonical,
      hasHousingIdentity: listing.hasHousingIdentity,
    },
  };
}

/** Every invariant this module declares, for a completeness assertion in tests. */
export const INVARIANT_CODES: readonly InvariantCode[] = [
  'query_identity_divergent',
  'visible_area_divergent',
  'visible_label_divergent',
  'stale_result_rendered',
  'unscoped_fallback_after_geocoder_error',
  'public_precision_exceeded',
  'listing_missing_housing_identity',
];
