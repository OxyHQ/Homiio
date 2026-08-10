/**
 * Turning a shared `LocationSelection` into the board's own scope.
 *
 * One function, in one place, because the mapping carries two decisions that a
 * screen would otherwise re-make (differently) each time it needed one.
 *
 * **A selection with no geometry produces NO scope.** A `place` whose
 * `precision` is `area` and which carries no bounds is a real, legitimate
 * selection — ADR 0002 keeps it so a disambiguation candidate with no
 * coordinates can still be chosen — but it is not something this board can
 * query. The honest answer is `undefined`, which the caller renders as "pick a
 * narrower area", rather than a bounding box invented on its behalf.
 *
 * **`null` is not `global`.** A caller with no selection has not asked for the
 * world; it has not asked anything. `global` has its own member and the person
 * has to press a button to get it.
 */

import type { EvictionBoardScope, LocationSelection } from '@homiio/shared-types';

/**
 * Every `LocationSelection` kind, DERIVED from the union rather than listed.
 *
 * `satisfies Record<LocationSelection['kind'], true>` is what makes it derived:
 * adding a kind to the contract fails to compile HERE until somebody decides
 * what the board does with it. A hand-written array would accept the new kind
 * silently and the test below would keep passing over a set that had quietly
 * stopped being complete.
 *
 * Exported for `__tests__/evictionScope.test.ts`, which is the only consumer.
 */
export const LOCATION_SELECTION_KINDS = {
  current_location: true,
  place: true,
  address_candidate: true,
  map_bounds: true,
  polygon: true,
  multi_area: true,
} as const satisfies Record<LocationSelection['kind'], true>;

/**
 * The board scope a selection implies, or `undefined` when it implies none.
 *
 * A `multi_area` selection is deliberately unsupported rather than approximated
 * by its first area: showing one of the three neighbourhoods somebody picked,
 * silently, is the failure that looks like it worked.
 */
export function selectionToBoardScope(
  selection: LocationSelection | null,
): EvictionBoardScope | undefined {
  if (!selection) return undefined;

  switch (selection.kind) {
    case 'current_location':
      return {
        kind: 'radius',
        lat: selection.center.latitude,
        lng: selection.center.longitude,
        radiusMeters: selection.radiusMeters,
      };
    case 'map_bounds':
    case 'polygon':
      return {
        kind: 'bbox',
        swLat: selection.bounds.south,
        swLng: selection.bounds.west,
        neLat: selection.bounds.north,
        neLng: selection.bounds.east,
      };
    case 'place':
    case 'address_candidate': {
      if (selection.bounds) {
        return {
          kind: 'bbox',
          swLat: selection.bounds.south,
          swLng: selection.bounds.west,
          neLat: selection.bounds.north,
          neLng: selection.bounds.east,
        };
      }
      if (selection.precision !== 'area') {
        return {
          kind: 'radius',
          lat: selection.center.latitude,
          lng: selection.center.longitude,
          radiusMeters: DEFAULT_PLACE_RADIUS_METERS,
        };
      }
      // A named city Homiio knows but has no geometry for. The CITY scope still
      // works, because the board matches `location_city` by name.
      if (selection.kind === 'place' && selection.admin.cityName) {
        return { kind: 'city', city: selection.admin.cityName };
      }
      return undefined;
    }
    case 'multi_area':
      return undefined;
    default:
      return unsupportedSelection(selection);
  }
}

/**
 * The exhaustiveness guard.
 *
 * Without it this switch is not checked by the type system at all: the function
 * returns `EvictionBoardScope | undefined`, so a kind with no arm simply falls
 * off the end as `undefined` and `tsc` is satisfied. Verified by MUTATION —
 * deleting the `multi_area` arm produced no error before this existed.
 *
 * The behaviour that fallthrough produced was already the SAFE one: no scope
 * means the board disables its query and shows the picker, so a kind nobody
 * handled could never mis-scope a request, only refuse it. What was missing is
 * that nobody was TOLD. `never` turns a new kind into a compile error at the
 * one place that has to make a decision about it, which is the same defect
 * class as the home-sections controller handling three of six place types
 * (fixed in `a3213af2`) — there it refused places the picker could produce, and
 * the refusal looked like a working feature.
 *
 * Returns `undefined` at runtime rather than throwing: a board that shows the
 * picker is a better answer to an unknown selection than a crash, and this
 * function is on a render path.
 */
function unsupportedSelection(selection: never): undefined {
  void selection;
  return undefined;
}

/** The radius a point-shaped place is queried with, in metres. */
const DEFAULT_PLACE_RADIUS_METERS = 10_000;
