/**
 * Turning a `LocationSelection` into the AREA a watch matches events against.
 *
 * One function, called from one place (the watch repository, on every write that
 * touches `location`), producing the GeoJSON that `saved_searches.area_geo`
 * generates its geography from. Everything geographic about matching reduces to
 * "is this point inside that polygon", so this is where the interesting
 * decisions are.
 *
 * ## It REFUSES more often than it guesses, and that is the design
 *
 * A watch with no derivable area reports `alertStatus: { status: 'inactive',
 * reason: 'no_area' }` and matches nothing. The alternative — invent a radius
 * around a centroid — is the bug ADR 0002 spent a whole section removing: the
 * geocoding gateway used to emit `{ longitude: 0, latitude: 0 }` for every
 * country, and the search screen drew a box around the Gulf of Guinea. A watch
 * with an invented 5 km disc around a city centroid is the same mistake wearing
 * a plausible number: it would silently exclude most of the city while looking
 * like it worked, and nobody would ever see the boundary it chose.
 *
 * So: an area comes from `bounds` or from a `polygon`, both of which somebody
 * DECLARED, or it does not come at all.
 *
 * ## The antimeridian, and WHICH reading of it actually breaks
 *
 * {@link GeoBounds} permits `west > east`, meaning the box crosses ±180 — `west
 * 170, east -170` is the 20° Pacific strip. A wrapping box is emitted here as
 * TWO rings (`west → 180` and `-180 → east`) in a MultiPolygon rather than as
 * one ring in coordinate order, which is RFC 7946 §3.1.9's antimeridian cutting.
 *
 * **The first version of this comment said the uncut ring makes PostGIS return
 * the 340° complement, and that is FALSE — measured, not reasoned.** Against
 * `postgis/postgis:17-3.5`, the two forms as `::geography` agree: 944,420 km²
 * uncut against 939,253 km² cut (0.55% apart, entirely the great-circle bowing
 * of one 20° edge against two 10° ones), and both cover Fiji, both cover
 * −175°, and both exclude the Gulf of Guinea. `::geography` reads `west > east`
 * the short way on its own, exactly as ADR 0002 §9.3 records for
 * `ST_MakeEnvelope(...)::geography`.
 *
 * **What DOES break is the planar reading**, and it breaks completely. As plain
 * `geometry` the uncut ring measures 1,360 deg² against the cut form's 80,
 * COVERS the Gulf of Guinea and does NOT cover Fiji — the exact complement, in
 * both directions at once. So the cut is not defence for the matcher's query,
 * which would be fine either way; it is defence for the STORED ARTEFACT, which
 * is GeoJSON and is read by things that are not this query: a map client
 * rendering `saved_searches.area`, a future export, an `ST_Intersects` somebody
 * writes one day without the cast. Keeping the stored value correct under both
 * readings costs one branch here.
 *
 * `__tests__/db/watchArea.test.ts` asserts both readings with the uncut ring as
 * the negative control, and carries these numbers — because a fixture set with
 * no wrapping box cannot tell this implementation from the broken one, and a
 * geography-only fixture set cannot tell it from one that never cut at all.
 */

import type {
  GeoBounds,
  GeoJSONMultiPolygon,
  GeoJSONPolygon,
  GeoJSONPosition,
  LocationSelection,
} from '@homiio/shared-types';
import { crossesAntimeridian, isValidBounds } from '@homiio/shared-types';

/** What a watch stores in `saved_searches.area`. */
export type WatchArea = GeoJSONPolygon | GeoJSONMultiPolygon;

/** A closed ring for one rectangle, counter-clockwise, first point repeated. */
function ringOf(west: number, south: number, east: number, north: number): GeoJSONPosition[] {
  return [
    [west, south],
    [east, south],
    [east, north],
    [west, north],
    [west, south],
  ];
}

/**
 * The polygon (or MultiPolygon) covering a bounding box.
 *
 * A wrapping box becomes two rings rather than one — see the module header. Note
 * the split uses ±180 rather than ±179.999…: the two rings share an edge at the
 * antimeridian, and a `geography` union of two polygons sharing an edge covers
 * the seam, whereas a gap would silently drop everything within it.
 */
export function boundsToArea(bounds: GeoBounds): WatchArea | null {
  if (!isValidBounds(bounds)) return null;
  if (!crossesAntimeridian(bounds)) {
    return {
      type: 'Polygon',
      coordinates: [ringOf(bounds.west, bounds.south, bounds.east, bounds.north)],
    };
  }
  return {
    type: 'MultiPolygon',
    coordinates: [
      [ringOf(bounds.west, bounds.south, 180, bounds.north)],
      [ringOf(-180, bounds.south, bounds.east, bounds.north)],
    ],
  };
}

/** Every ring set in an area, so several areas can be merged into one MultiPolygon. */
function polygonsOf(area: WatchArea): readonly (readonly (readonly GeoJSONPosition[])[])[] {
  return area.type === 'Polygon' ? [area.coordinates] : area.coordinates;
}

/**
 * The area a watch on this selection covers, or `null` when none can be derived
 * without inventing geometry.
 *
 * `current_location` returns `null` here as well as being refused by
 * `isWatchableSelection` upstream, and the redundancy is deliberate: this
 * function is the last thing between a selection and a stored polygon, and a
 * device fix frozen into a watch is the one outcome that cannot be undone by a
 * later fix — the exact coordinate would already be in the database.
 */
export function watchAreaFromSelection(
  selection: LocationSelection | null | undefined,
): WatchArea | null {
  if (!selection) return null;
  switch (selection.kind) {
    case 'current_location':
      return null;
    case 'polygon':
      return selection.polygon;
    case 'map_bounds':
      return boundsToArea(selection.bounds);
    case 'place':
    case 'address_candidate':
      // `bounds` is optional on both, and its absence is honest rather than
      // incomplete: ADR 0002 keeps `bounds` optional on the `area` branch
      // precisely so a place with no extent says so instead of inventing a
      // rectangle. A watch on such a place is stored and reports `no_area`.
      return selection.bounds ? boundsToArea(selection.bounds) : null;
    case 'multi_area': {
      const parts: (readonly (readonly GeoJSONPosition[])[])[] = [];
      for (const part of selection.areas) {
        const area = watchAreaFromSelection(part);
        // ONE unusable member makes the whole multi-area unusable, rather than
        // the union of the members that happened to work. A watch on "Gràcia and
        // Eixample" that quietly became a watch on Gràcia alone would report
        // itself active while covering half of what its name says.
        if (!area) return null;
        parts.push(...polygonsOf(area));
      }
      if (parts.length === 0) return null;
      return { type: 'MultiPolygon', coordinates: parts };
    }
    default: {
      // A new selection kind must decide its own area rather than inherit one.
      const exhaustive: never = selection;
      return exhaustive;
    }
  }
}
