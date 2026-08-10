/**
 * An antimeridian bounding box has its centre ON the antimeridian.
 *
 * Why this had no test and would not have grown one: the bug produced a
 * plausible, successful-looking answer. The bounds stayed correct, so the LIST
 * was right — Fijian listings, a 200, a normal-looking page — and only the
 * derived framing point was wrong, by half a planet. Nothing threw and nothing
 * was empty, so no assertion about a result set could have distinguished it
 * from correct behaviour. The assertion is therefore on the ARITHMETIC.
 */
import { normalizeLongitude, type GeoBounds } from '@homiio/shared-types';

/**
 * The same wrap-aware midpoint the two production call sites use.
 *
 * Reimplemented here on purpose: `boundsCenter` is module-private in both
 * `SearchResultsView` (a component) and `resolveLocationRef`, and exporting a
 * helper solely to test it would be the tail wagging the dog. What is asserted
 * is the ARITHMETIC — the property that a wrapping box's centre is on the
 * antimeridian and not in the Gulf of Guinea — so a call site that stops using
 * it fails the integration, not this file.
 */
function centerLongitude(bounds: GeoBounds): number {
  return bounds.west <= bounds.east
    ? (bounds.west + bounds.east) / 2
    : normalizeLongitude((bounds.west + bounds.east + 360) / 2);
}

describe('an antimeridian box has its centre on the antimeridian', () => {
  it('does NOT put a Fiji viewport in the Gulf of Guinea', () => {
    // `west 170, east -170` is the 20-degree strip over the Pacific and a
    // LEGAL token: `isValidBounds` enforces only `south <= north`, because
    // `west > east` IS the wrap and PostGIS `::geography` reads it that way.
    //
    // The naive midpoint computes 0 — not a nearby approximation but a point
    // ~13,000 km away off West Africa. The bounds stay correct throughout, so
    // the LIST is right and only the map is wrong, which is precisely why it
    // would be reported as "the map is broken" rather than as a location bug.
    const fiji: GeoBounds = { west: 170, south: -20, east: -170, north: -16 };

    expect((fiji.west + fiji.east) / 2).toBe(0); // the bug, stated
    // -180 rather than 180: the same meridian in the one spelling
    // `normalizeLongitude` permits, so one box cannot mint two cache keys.
    expect(centerLongitude(fiji)).toBe(-180);
  });

  it('leaves an ordinary box exactly where it was', () => {
    // The other half: a fix that moved a NON-wrapping centre would be worse
    // than the bug, and every existing box is non-wrapping.
    const madrid: GeoBounds = { west: -3.75, south: 40.38, east: -3.65, north: 40.45 };
    expect(centerLongitude(madrid)).toBeCloseTo(-3.7, 10);

    const barcelona: GeoBounds = { west: 2.05, south: 41.31, east: 2.23, north: 41.47 };
    expect(centerLongitude(barcelona)).toBeCloseTo(2.14, 10);
  });

  it('handles a box that wraps by only a hair', () => {
    // The realistic case: a synthetic ±0.05° box around a point at longitude
    // 179.98, which is what ADR §9.3 measured as unsearchable.
    const hair: GeoBounds = { west: 179.93, south: -1, east: -179.97, north: 1 };
    const centre = centerLongitude(hair);
    // Near the antimeridian, on one side or the other — emphatically not 0.
    expect(Math.abs(Math.abs(centre) - 180)).toBeLessThan(0.1);
    expect(centre).not.toBe(0);
  });
});
