/**
 * "Search this area" — when the button is armed, and by whom.
 *
 * ## Why this is a pure reducer and not four lines inside the results view
 *
 * The rule has to hold on two map adapters (a MapLibre instance on web, a
 * WebView document on native) and it is decided from data neither of them can
 * be asked about afterwards: a viewport that arrived because the app framed a
 * city and one the user dragged there are the same four numbers. The decision
 * is therefore taken once, here, from the movement's own {@link MapMoveSource},
 * and both adapters feed it the same event shape.
 *
 * It is also the only place the three failure modes below are prevented, and
 * none of them announces itself:
 *
 *  - **Opening a search arms the button.** The map frames the committed
 *    selection on mount, that framing emits a region change, and a naive
 *    handler records it as pending — so "Search this area" appears, unprompted,
 *    over results that already answer it. Pressing it re-searches the same
 *    place under a GENERATED label, silently replacing "Barcelona" with "Map
 *    area" and losing the city id.
 *  - **Panning back does not disarm it.** The user explores, returns to where
 *    they started, and is still offered a button that would do nothing except
 *    swap the place for a rectangle.
 *  - **Sub-pixel jitter arms it.** An inertial pan settles a few metres off and
 *    the button flickers into existence.
 *
 * ## The anchor is a MEASUREMENT, not the committed bounds
 *
 * The obvious comparison — "is the viewport the committed selection's box?" —
 * does not work, and the reason is worth writing down because it looks like it
 * should. `fitBounds` applies padding and snaps to a continuous zoom, so the
 * viewport it produces is reliably LARGER than the box it was given and has the
 * map's aspect ratio rather than the box's. Comparing against the request would
 * therefore be false immediately after a successful frame.
 *
 * So the anchor is whatever viewport the app's OWN camera command actually
 * produced, recorded from the programmatic event that reports it. "Back at the
 * searched area" then means "back where the app put us", which is exact.
 */

import {
  boundsSpanDegrees,
  normalizeLongitude,
  type GeoBounds,
  type LocationSelection,
} from '@homiio/shared-types';

import type { MapMoveSource } from '@/components/mapTypes';

/**
 * How far a viewport may drift from the anchor and still count as the same
 * area, as a fraction of the anchor's own span.
 *
 * Relative rather than absolute because a degree means something different at
 * every zoom: 0.01° is a third of a city viewport and nothing at all on a map
 * of Europe. Two per cent is below what a person can see and comfortably above
 * the settle of an inertial pan.
 */
export const VIEWPORT_MATCH_TOLERANCE_RATIO = 0.02;

/** A finalised map movement, as both adapters report it. */
export interface MapMovement {
  readonly bounds: GeoBounds;
  /** Only a FINISHED gesture is a statement of intent; a stream of frames is not. */
  readonly isFinal?: boolean;
  readonly source: MapMoveSource;
}

/**
 * What the results surface remembers about the camera.
 *
 * `anchor` is the viewport the app last framed on purpose. `pending` is a
 * viewport the user has moved to and not confirmed — NOT part of the query, and
 * never sent anywhere.
 */
export interface SearchAreaState {
  readonly anchor: GeoBounds | null;
  readonly pending: GeoBounds | null;
}

export const INITIAL_SEARCH_AREA_STATE: SearchAreaState = { anchor: null, pending: null };

/**
 * The shortest angular distance between two longitudes, in degrees.
 *
 * `Math.abs(a - b)` is wrong across the antimeridian: 179.99 and -179.99 are
 * 0.02° apart and subtract to 359.98, so a viewport that drifted by metres
 * would read as having moved most of the way round the planet — and the button
 * would arm on a map nobody touched. {@link normalizeLongitude} wraps the
 * difference into [-180, 180), which is exactly this quantity.
 */
function longitudeDistance(a: number, b: number): number {
  return Math.abs(normalizeLongitude(a - b));
}

/**
 * Whether two viewports describe the same area.
 *
 * All four edges must agree, each within the tolerance scaled by the REFERENCE
 * box's span in that axis. Comparing edges rather than centres is deliberate: a
 * pure zoom keeps the centre exactly and changes the area, which is a different
 * question the user is entitled to ask.
 */
export function viewportsMatch(
  reference: GeoBounds,
  candidate: GeoBounds,
  toleranceRatio: number = VIEWPORT_MATCH_TOLERANCE_RATIO,
): boolean {
  const span = boundsSpanDegrees(reference);
  const lngTolerance = Math.abs(span.longitude) * toleranceRatio;
  const latTolerance = Math.abs(span.latitude) * toleranceRatio;

  // The WIDTH is checked as well as the edges, and it is not redundant with
  // them: two boxes can have west and east edges a whisker apart and describe
  // wildly different areas, because `west > east` means the box wraps. `west
  // 170 → east 169.9999` is very nearly the whole planet and `west 170 → east
  // 170.0001` is very nearly nothing. Height needs no such check — latitude
  // does not wrap, so south and north settle it.
  //
  // Comparing the wrap FLAGS instead would be the intuitive guard and is wrong
  // in the other direction: it refuses a box nudged a few metres ACROSS the
  // antimeridian, which is the same area by any honest reading and one a user
  // reaches by dragging.
  if (Math.abs(span.longitude - boundsSpanDegrees(candidate).longitude) > lngTolerance) {
    return false;
  }

  return (
    longitudeDistance(reference.west, candidate.west) <= lngTolerance &&
    longitudeDistance(reference.east, candidate.east) <= lngTolerance &&
    Math.abs(reference.south - candidate.south) <= latTolerance &&
    Math.abs(reference.north - candidate.north) <= latTolerance
  );
}

/**
 * Fold a map movement into the camera state.
 *
 * Four rules, in the order they are decided:
 *
 * 1. **A movement that is not final changes nothing.** Streaming frames while a
 *    finger is down are not a statement about where to search.
 * 2. **A programmatic movement becomes the anchor and clears any pending
 *    viewport.** The app just framed something on purpose — an opening frame, a
 *    "back to the searched area", a camera restored on return from a detail
 *    screen — and whatever the user had wandered to before that is gone.
 * 3. **A user movement that lands back on the anchor clears the pending
 *    viewport.** Returning to where you started is not a new area to search.
 * 4. **Any other user movement becomes the pending viewport.** Which changes no
 *    results, no request and no URL until it is confirmed.
 */
export function reduceMapMovement(
  state: SearchAreaState,
  movement: MapMovement,
): SearchAreaState {
  if (!movement.isFinal) return state;

  if (movement.source === 'programmatic') {
    if (state.anchor && state.pending === null && viewportsMatch(state.anchor, movement.bounds)) {
      // Identical anchor, nothing pending: return the SAME object so a caller
      // writing this into React or Zustand state does not re-render on a resize
      // that moved nothing.
      return state;
    }
    return { anchor: movement.bounds, pending: null };
  }

  // No anchor yet means the app has never framed anything — a map that opened
  // on its own default. A user gesture there is still a real intent to search
  // somewhere else, so it arms.
  if (state.anchor && viewportsMatch(state.anchor, movement.bounds)) {
    return state.pending === null ? state : { ...state, pending: null };
  }
  return { ...state, pending: movement.bounds };
}

/**
 * The box the committed selection frames, or `null` when it declares none.
 *
 * Used for "take me back to the area I searched" when the app has no anchor yet
 * — on a cold load the committed box is the best available answer, and it is
 * the same value the opening frame would have used.
 */
export function committedScopeBounds(selection: LocationSelection | null): GeoBounds | null {
  if (!selection) return null;
  switch (selection.kind) {
    case 'map_bounds':
    case 'polygon':
      return selection.bounds;
    case 'place':
    case 'address_candidate':
      return selection.bounds ?? null;
    case 'current_location':
    case 'multi_area':
      return null;
    default: {
      const exhaustive: never = selection;
      return exhaustive;
    }
  }
}
