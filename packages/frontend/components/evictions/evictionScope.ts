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
  }
}

/** The radius a point-shaped place is queried with, in metres. */
const DEFAULT_PLACE_RADIUS_METERS = 10_000;
