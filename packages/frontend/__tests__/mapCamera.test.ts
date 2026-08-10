/**
 * Framing an area, and the antimeridian case that has already cost this epic a
 * bug.
 *
 * The property under test is not "the numbers are right" but **which region a
 * box denotes**. For a box that crosses 180° the naive reading and the correct
 * one are COMPLEMENTS: ADR 0002 §9.3 probed exactly this against PostGIS 3.5
 * rather than reasoning about it, and for `west 170, south -20, east -170,
 * north -16` every point inside the intended Pacific strip is `t` under
 * `::geography` and `f` under plain `geometry`, while every point outside it is
 * the reverse. So a camera that reads such a box naively does not land nearby —
 * it frames the rest of the world.
 *
 * The fixture coordinates below are that probe's, deliberately: they were
 * measured against a real server, so a change here is a change against
 * measurement rather than against my arithmetic.
 */
import { boundsCenter, normalizeLongitude, type GeoBounds } from '@homiio/shared-types';

import { isDegenerateBounds, toCameraBounds } from '@/components/mapCamera';

/** ADR §9.3's probe box: the 20-degree strip over the Pacific. */
const PACIFIC_STRIP: GeoBounds = { west: 170, south: -20, east: -170, north: -16 };

/** Points the ADR measured as INSIDE that strip. */
const INSIDE = [
  { name: 'Fiji', longitude: 178.44, latitude: -18.14 },
  { name: 'Samoa', longitude: -172, latitude: -18 },
  { name: 'near the west edge', longitude: 170.5, latitude: -18 },
];

/** Points the ADR measured as OUTSIDE it — the "long way round". */
const OUTSIDE = [
  { name: 'Gulf of Guinea', longitude: 0, latitude: -18 },
  { name: 'Indian Ocean', longitude: 100, latitude: -18 },
  { name: 'eastern Pacific', longitude: -100, latitude: -18 },
];

/**
 * Is a point inside the camera's span, in the continuous longitude space
 * MapLibre frames in?
 *
 * This is the assertion that makes the test about the REGION rather than about
 * two numbers: a camera is correct exactly when it contains what the database
 * contains and excludes what the database excludes.
 */
function cameraContains(bounds: GeoBounds, point: { longitude: number; latitude: number }): boolean {
  const [[west, south], [east, north]] = toCameraBounds(bounds);
  // Carry the probe point into the same continuous space the camera uses.
  const longitude = point.longitude < west ? point.longitude + 360 : point.longitude;
  return longitude >= west && longitude <= east && point.latitude >= south && point.latitude <= north;
}

describe('a box that crosses the antimeridian frames the strip, not its complement', () => {
  it('contains every point PostGIS measured as inside', () => {
    for (const point of INSIDE) {
      expect({ name: point.name, inside: cameraContains(PACIFIC_STRIP, point) }).toEqual({
        name: point.name,
        inside: true,
      });
    }
  });

  it('excludes every point PostGIS measured as outside', () => {
    // The half that catches the complement. A camera framing the rest of the
    // world would pass the test above and fail only here — and the Gulf of
    // Guinea entry is the exact point the naive midpoint produced.
    for (const point of OUTSIDE) {
      expect({ name: point.name, inside: cameraContains(PACIFIC_STRIP, point) }).toEqual({
        name: point.name,
        inside: false,
      });
    }
  });

  it('carries the east edge past 180 rather than swapping the corners', () => {
    // Swapping would produce a 340-degree box — valid-looking, and the
    // complement of what was asked for.
    expect(toCameraBounds(PACIFIC_STRIP)).toEqual([
      [170, -20],
      [190, -16],
    ]);
  });

  it('agrees with the SHARED centre, which is the one callers use', () => {
    // `boundsCenter` is not this module's — it lives in `@homiio/shared-types`
    // because four production sites each computed it naively. Asserted here to
    // pin that the camera form and the contract's centre describe the SAME
    // place: a camera correct about the corners and wrong about the middle
    // would still frame the ocean.
    const { longitude } = boundsCenter(PACIFIC_STRIP);

    // The bug, stated, so this test explains itself to whoever it fails for.
    expect((PACIFIC_STRIP.west + PACIFIC_STRIP.east) / 2).toBe(0);
    // 180 and -180 are the same meridian; `normalizeLongitude` is half-open on
    // purpose so one box cannot mint two tokens for one place.
    expect(longitude).toBe(-180);
    expect(normalizeLongitude(longitude)).toBe(-180);

    // And the camera's own midpoint lands on that meridian too.
    const [[west], [east]] = toCameraBounds(PACIFIC_STRIP);
    expect(normalizeLongitude((west + east) / 2)).toBe(-180);
  });
});

describe('an ordinary box is left exactly where it is', () => {
  // The other direction, and the one that matters most in practice: every box
  // in the database today is non-wrapping, so a fix that moved them would be
  // far worse than the bug it corrects.
  const MADRID: GeoBounds = { west: -3.75, south: 40.38, east: -3.65, north: 40.45 };
  const BARCELONA: GeoBounds = { west: 2.05, south: 41.31, east: 2.23, north: 41.47 };

  it('does not touch the corners', () => {
    expect(toCameraBounds(MADRID)).toEqual([
      [-3.75, 40.38],
      [-3.65, 40.45],
    ]);
  });

  it('centres it where the arithmetic always did', () => {
    expect(boundsCenter(MADRID).longitude).toBeCloseTo(-3.7, 10);
    expect(boundsCenter(BARCELONA).longitude).toBeCloseTo(2.14, 10);
  });

  it('contains its own city and excludes the other', () => {
    // A control on the control: the containment helper must be able to say NO,
    // or every assertion above is vacuous.
    expect(cameraContains(BARCELONA, { longitude: 2.1734, latitude: 41.3851 })).toBe(true);
    expect(cameraContains(BARCELONA, { longitude: -3.7038, latitude: 40.4168 })).toBe(false);
  });
});

describe('a degenerate box is not framed', () => {
  it('recognises a zero-width and a zero-height box', () => {
    // Fitting one asks MapLibre for an infinitely small region, which pins the
    // zoom to maximum — a city with a point-like extent would open at building
    // level. Callers fall back to a centre at a sane zoom.
    expect(isDegenerateBounds({ west: 2.1, south: 41.3, east: 2.1, north: 41.4 })).toBe(true);
    expect(isDegenerateBounds({ west: 2.1, south: 41.3, east: 2.2, north: 41.3 })).toBe(true);
    expect(isDegenerateBounds({ west: 2.1, south: 41.3, east: 2.1, north: 41.3 })).toBe(true);
  });

  it('does not call an ordinary box degenerate', () => {
    expect(isDegenerateBounds({ west: 2.05, south: 41.31, east: 2.23, north: 41.47 })).toBe(false);
  });

  it('does not call a WRAPPING box degenerate', () => {
    // The trap in the obvious implementation: comparing the raw `west` and
    // `east` of the Pacific strip finds `170 !== -170` and happens to be right,
    // but a box from 170 to 170 the long way round — a full circumnavigation —
    // must not read as a point. Going through `toCameraBounds` first is what
    // makes both answers come from one place.
    expect(isDegenerateBounds(PACIFIC_STRIP)).toBe(false);
  });
});
