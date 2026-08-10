/**
 * "Search this area" — armed by a person, never by the app.
 *
 * These are the rules #354 states as invariants 2 and 3 and as the acceptance
 * criteria "moving the map without confirming changes nothing" and "an initial
 * programmatic movement does not show the button". They are tested here, on the
 * pure reducer, because that is the ONE place both map adapters decide it: the
 * web component drives a MapLibre instance and the native one drives a WebView
 * document, and neither can be asked afterwards who moved the camera.
 *
 * ## Every case below fails SILENTLY in production
 *
 * A button that appears when it should not is not an exception, a type error or
 * a failed request — it is an offer to replace a city with a rectangle, made at
 * a moment nobody asked for it. So each test states what a wrong implementation
 * would show a user, not merely which boolean it would return.
 */
import type { GeoBounds } from '@homiio/shared-types';

import {
  INITIAL_SEARCH_AREA_STATE,
  committedScopeBounds,
  reduceMapMovement,
  viewportsMatch,
  VIEWPORT_MATCH_TOLERANCE_RATIO,
  type SearchAreaState,
} from '@/components/search/searchArea';

/** Barcelona-sized: about 0.18° across. */
const BARCELONA_VIEW: GeoBounds = { west: 2.05, south: 41.32, east: 2.23, north: 41.47 };
const MADRID_VIEW: GeoBounds = { west: -3.75, south: 40.38, east: -3.65, north: 40.45 };

/** Nudge every edge of a box by the same number of degrees. */
function shift(bounds: GeoBounds, degrees: number): GeoBounds {
  return {
    west: bounds.west + degrees,
    east: bounds.east + degrees,
    south: bounds.south + degrees,
    north: bounds.north + degrees,
  };
}

describe('viewportsMatch', () => {
  it('accepts a viewport that settled a few metres off', () => {
    // An inertial pan does not stop on the pixel it started from. Without a
    // tolerance the button flickers into existence after every gesture that
    // was meant to return to where it began.
    expect(viewportsMatch(BARCELONA_VIEW, shift(BARCELONA_VIEW, 0.0005))).toBe(true);
  });

  it('rejects a viewport a person could see had moved', () => {
    // 0.02 degrees against a 0.18-degree span is 11%, five times the tolerance.
    expect(viewportsMatch(BARCELONA_VIEW, shift(BARCELONA_VIEW, 0.02))).toBe(false);
  });

  it('scales the tolerance to the box, so it is not a fixed number of degrees', () => {
    // The same absolute drift: inside tolerance on a continent-sized view, far
    // outside it on a neighbourhood. A fixed threshold has to be wrong for one
    // of the two, and both are ordinary map states.
    const continent: GeoBounds = { west: -10, south: 35, east: 30, north: 60 };
    const block: GeoBounds = { west: 2.17, south: 41.385, east: 2.18, north: 41.39 };
    expect(viewportsMatch(continent, shift(continent, 0.05))).toBe(true);
    expect(viewportsMatch(block, shift(block, 0.05))).toBe(false);
  });

  it('measures a drift ACROSS the antimeridian the short way round', () => {
    // A 0.02-degree strip over the Pacific, dragged 0.0002 degrees east — far
    // enough that it no longer wraps, close enough to be the same view. The
    // west edges are 179.9999 and -179.9999: two ten-thousandths apart, and
    // 359.9998 apart if subtracted. Read naively, a map barely touched has
    // moved most of the way round the planet and the button arms.
    const pacific: GeoBounds = { west: 179.9999, south: -18, east: -179.9801, north: -16 };
    const nudged: GeoBounds = { west: -179.9999, south: -18, east: -179.9799, north: -16 };
    expect(viewportsMatch(pacific, nudged)).toBe(true);
  });

  it('never calls a wrapping box and its complement the same area', () => {
    // The two describe complementary strips of the planet — 20 degrees over
    // the Pacific against the 340 degrees that is everywhere else — out of the
    // same four numbers.
    const wrapping: GeoBounds = { west: 170, south: -20, east: -170, north: -16 };
    const complement: GeoBounds = { west: -170, south: -20, east: 170, north: -16 };
    expect(viewportsMatch(wrapping, complement)).toBe(false);
  });

  it('separates a nearly-global box from a nearly-empty one', () => {
    // The case the edge comparison alone cannot see: every edge is within a
    // ten-thousandth of a degree and one box is the whole planet while the
    // other is a slice of a street. Only the WIDTH tells them apart.
    const nearlyEverything: GeoBounds = { west: 170, south: -20, east: 169.9999, north: -16 };
    const nearlyNothing: GeoBounds = { west: 170, south: -20, east: 170.0001, north: -16 };
    expect(viewportsMatch(nearlyEverything, nearlyNothing)).toBe(false);
  });

  it('is pinned against a deliberately loose tolerance', () => {
    // A negative control for the two cases above: with the tolerance widened
    // the "moved" case matches, so `viewportsMatch` is really reading the
    // distance rather than returning a constant.
    expect(viewportsMatch(BARCELONA_VIEW, shift(BARCELONA_VIEW, 0.02), 0.5)).toBe(true);
    expect(VIEWPORT_MATCH_TOLERANCE_RATIO).toBeLessThan(0.5);
  });
});

describe('reduceMapMovement', () => {
  it('ignores a movement that is still in progress', () => {
    // Streaming frames while a finger is down are not a statement about where
    // to search; acting on them makes the button strobe through a pan.
    const next = reduceMapMovement(INITIAL_SEARCH_AREA_STATE, {
      bounds: MADRID_VIEW,
      isFinal: false,
      source: 'user',
    });
    expect(next).toBe(INITIAL_SEARCH_AREA_STATE);
  });

  it('does NOT arm on the app framing the committed selection', () => {
    // The acceptance criterion, and the failure it prevents is worse than a
    // stray button: pressing it re-searches the same place under a GENERATED
    // label, so "Barcelona" silently becomes "Map area" and the city id is
    // gone.
    const next = reduceMapMovement(INITIAL_SEARCH_AREA_STATE, {
      bounds: BARCELONA_VIEW,
      isFinal: true,
      source: 'programmatic',
    });
    expect(next.pending).toBeNull();
    expect(next.anchor).toEqual(BARCELONA_VIEW);
  });

  it('arms when a person pans somewhere else', () => {
    const framed = reduceMapMovement(INITIAL_SEARCH_AREA_STATE, {
      bounds: BARCELONA_VIEW,
      isFinal: true,
      source: 'programmatic',
    });
    const panned = reduceMapMovement(framed, {
      bounds: MADRID_VIEW,
      isFinal: true,
      source: 'user',
    });

    expect(panned.pending).toEqual(MADRID_VIEW);
    // The anchor does NOT move: it is where the results are, and it is what
    // "back to the searched area" has to return to.
    expect(panned.anchor).toEqual(BARCELONA_VIEW);
  });

  it('disarms when the person pans back to where the search opened', () => {
    const framed = reduceMapMovement(INITIAL_SEARCH_AREA_STATE, {
      bounds: BARCELONA_VIEW,
      isFinal: true,
      source: 'programmatic',
    });
    const away = reduceMapMovement(framed, {
      bounds: MADRID_VIEW,
      isFinal: true,
      source: 'user',
    });
    const back = reduceMapMovement(away, {
      bounds: shift(BARCELONA_VIEW, 0.0004),
      isFinal: true,
      source: 'user',
    });

    expect(back.pending).toBeNull();
  });

  it('discards a pending viewport when the app frames something new', () => {
    // Picking a city, applying a saved search or arriving on a new URL all
    // frame the map. A pending box left over from the previous search would
    // then be confirmable against results it has nothing to do with.
    const away: SearchAreaState = { anchor: BARCELONA_VIEW, pending: MADRID_VIEW };
    const reframed = reduceMapMovement(away, {
      bounds: MADRID_VIEW,
      isFinal: true,
      source: 'programmatic',
    });

    expect(reframed.pending).toBeNull();
    expect(reframed.anchor).toEqual(MADRID_VIEW);
  });

  it('arms on a user gesture even before anything has been framed', () => {
    // A map that opened on its own default has no anchor. Moving it is still a
    // real intent to search elsewhere, and refusing to arm there would make
    // the button unreachable on an unscoped search.
    const next = reduceMapMovement(INITIAL_SEARCH_AREA_STATE, {
      bounds: MADRID_VIEW,
      isFinal: true,
      source: 'user',
    });
    expect(next.pending).toEqual(MADRID_VIEW);
  });

  it('returns the SAME state object when a resize reports the anchor again', () => {
    // A container resize fires a camera event carrying an unchanged viewport.
    // A new object there would write the store on every layout pass, and the
    // map re-renders on each write.
    const framed: SearchAreaState = { anchor: BARCELONA_VIEW, pending: null };
    expect(
      reduceMapMovement(framed, {
        bounds: shift(BARCELONA_VIEW, 0.0002),
        isFinal: true,
        source: 'programmatic',
      }),
    ).toBe(framed);
  });

  it('the SOURCE is what decides it, not the geometry', () => {
    // The sharpest statement of the rule: identical bounds, opposite answers.
    // Anything that infers the source from the numbers gets one of these wrong.
    const state: SearchAreaState = { anchor: BARCELONA_VIEW, pending: null };
    const byApp = reduceMapMovement(state, {
      bounds: MADRID_VIEW,
      isFinal: true,
      source: 'programmatic',
    });
    const byPerson = reduceMapMovement(state, {
      bounds: MADRID_VIEW,
      isFinal: true,
      source: 'user',
    });

    expect(byApp.pending).toBeNull();
    expect(byPerson.pending).toEqual(MADRID_VIEW);
  });
});

describe('committedScopeBounds', () => {
  it('reads a confirmed viewport back out', () => {
    expect(
      committedScopeBounds({
        kind: 'map_bounds',
        bounds: MADRID_VIEW,
        center: { longitude: -3.7, latitude: 40.415 },
        label: { primary: 'search.summary.mapArea', kind: 'generated' },
        precision: 'area',
      }),
    ).toEqual(MADRID_VIEW);
  });

  it('gives a place its declared extent, and null when it declares none', () => {
    const withBounds = committedScopeBounds({
      kind: 'place',
      source: { kind: 'homiio', entity: 'city', id: 'city-1' },
      placeType: 'city',
      label: { primary: 'Barcelona', kind: 'place' },
      admin: { countryCode: 'ES' },
      center: { longitude: 2.17, latitude: 41.38 },
      bounds: BARCELONA_VIEW,
      precision: 'centroid',
    });
    const withoutBounds = committedScopeBounds({
      kind: 'place',
      source: { kind: 'homiio', entity: 'city', id: 'city-1' },
      placeType: 'city',
      label: { primary: 'Barcelona', kind: 'place' },
      admin: { countryCode: 'ES' },
      center: { longitude: 2.17, latitude: 41.38 },
      precision: 'centroid',
    });

    expect(withBounds).toEqual(BARCELONA_VIEW);
    // A place with no extent has no area to return to — the caller renders no
    // action rather than framing an invented rectangle.
    expect(withoutBounds).toBeNull();
  });

  it('has no answer for "everywhere"', () => {
    expect(committedScopeBounds(null)).toBeNull();
  });
});
