/**
 * `boundsCenter` — the representative point of a box, across the antimeridian.
 *
 * Tested at the HELPER rather than at each caller, because the helper is what
 * makes the four sites that need a midpoint agree: `resolveLocationRef` (which
 * writes the result into the committed selection), `mapBoundsSelection` (every
 * "Search this area"), `SearchResultsView` (the map camera) and the geo
 * gateway. Two corrected copies of a ±180 wrap is exactly the thing that
 * diverges later, so there is one copy and this is its test.
 *
 * The Fiji and wraps-by-a-hair cases here are adapted from `geo-351`'s
 * `antimeridianCenter.test.ts` on `handoff/antimeridian-center`, which found
 * the bug. Its two per-file helpers were folded into this single shared one;
 * its test cases were the better half of that patch and are kept.
 */
import { boundsCenter, normalizeLongitude, type GeoBounds } from '@homiio/shared-types';

/** The Pacific strip ADR 0002 §9.3 measured against a real PostGIS. */
const FIJI_STRIP: GeoBounds = { west: 170, south: -20, east: -170, north: -16 };

describe('boundsCenter', () => {
  it('does NOT put a Fiji viewport in the Gulf of Guinea', () => {
    // The bug, stated as an assertion rather than described in prose. Keeping
    // the naive expression here is deliberate: it documents what the old code
    // produced, so nobody "simplifies" the helper back into it without this
    // line turning red first.
    expect((FIJI_STRIP.west + FIJI_STRIP.east) / 2).toBe(0);

    // 0 is a real place — the Atlantic off West Africa, ~13,000 km from the
    // box. That is what made this survive: not a crash, a plausible coordinate.
    expect(boundsCenter(FIJI_STRIP).longitude).not.toBe(0);
    expect(Math.abs(boundsCenter(FIJI_STRIP).longitude)).toBe(180);
  });

  it('spells the antimeridian `-180`, because that is the only spelling', () => {
    // Same meridian either way, and worth pinning rather than leaving to
    // chance: `normalizeLongitude`'s range is half-open on purpose, so one box
    // cannot mint two tokens and two cache keys. A value disagreeing with its
    // own prose is what gets "corrected" later.
    expect(boundsCenter(FIJI_STRIP).longitude).toBe(-180);
    expect(normalizeLongitude(180)).toBe(-180);
  });

  it('leaves an ordinary box exactly where it was', () => {
    // The floor, and the reason this is a repair rather than a behaviour
    // change: every box in production today is non-wrapping, so a fix that
    // moved their centres would be worse than the bug it fixed.
    expect(boundsCenter({ west: -3.75, south: 40.38, east: -3.65, north: 40.45 })).toEqual({
      longitude: -3.7000000000000002,
      latitude: 40.415000000000006,
    });
    expect(
      boundsCenter({ west: 2.05, south: 41.32, east: 2.23, north: 41.47 }).longitude,
    ).toBeCloseTo(2.14, 10);
  });

  it('handles a box that wraps by only a hair', () => {
    // The realistic case: a map panned just across the line, not a
    // deliberately-constructed 20-degree strip. The naive form gives 0 here
    // too, and 0 is further from this box than from the wide one.
    const hair: GeoBounds = { west: 179.98, south: -18, east: -179.98, north: -17 };

    const centre = boundsCenter(hair).longitude;
    expect(centre).not.toBe(0);
    expect(Math.abs(Math.abs(centre) - 180)).toBeLessThan(0.1);
  });

  it('takes the latitude midpoint plainly, because latitude never wraps', () => {
    // `south > north` is an ERROR rather than a convention, so there is no
    // wrap to handle on this axis and the naive midpoint was always right.
    expect(boundsCenter(FIJI_STRIP).latitude).toBe(-18);
  });

  it('is stable for a degenerate point box', () => {
    // `coveringBounds` builds these when folding a centre-only area into a
    // cover, so the helper has to survive one.
    expect(boundsCenter({ west: 2.1, south: 41.3, east: 2.1, north: 41.3 })).toEqual({
      longitude: 2.1,
      latitude: 41.3,
    });
  });
});
