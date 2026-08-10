/**
 * Spatial predicates for the property read path — where the two-phase geo query
 * collapses into one join.
 *
 * ## What this replaces, and why it was a live landmine
 *
 * A property has no coordinates of its own; it reaches its place through
 * `address_id`. Mongo could not join, so every geo-scoped property read ran in
 * TWO phases:
 *
 * ```
 * const ids = await Address.find({ coordinates: { $near: … } }).select('_id');   // no .limit()
 * return Property.find({ addressId: { $in: ids } });
 * ```
 *
 * — `services/geoQueryService.resolveGeoFilterAddressIds`, `Property.findNearby`
 * and `Property.findWithinRadius` all had that shape. The first phase is
 * **uncapped**: it materializes every address id in the radius (or in the city)
 * into a JavaScript array and then ships them back as an `$in`. Barcelona alone
 * is tens of thousands of ids, and the cost is paid twice — once building the
 * array, once as a query document large enough to matter on the wire — on a
 * request path behind no feature flag.
 *
 * Here it is ONE statement. `properties` inner-joins `addresses` (the reference
 * is `NOT NULL` with an `ON DELETE RESTRICT` foreign key, so the join can drop
 * no row and multiply none), and the spatial predicate applies to
 * `addresses.geo` directly. Nothing is materialized in the application, and the
 * `LIMIT` reaches the planner.
 *
 * ## Every predicate here is answered by PostGIS, never by arithmetic
 *
 * `addresses.geo` is the `GENERATED ALWAYS AS (ST_MakePoint(longitude,
 * latitude)::geography) STORED` column with the GiST index, so `ST_DWithin` and
 * `ST_Intersects` are index-backed and measure on the spheroid. The obvious
 * alternatives are both wrong and both look right:
 *
 *  - **`ST_Distance(geo, p) < r` in a WHERE clause cannot use the index** and
 *    degrades to a sequential scan over every address on the planet. It is only
 *    correct in a SELECT list or an ORDER BY, which is where {@link distanceTo}
 *    puts it.
 *  - **A lat/lon bounding box computed in TypeScript** (± radius/111_320
 *    degrees) is a square pretending to be a circle, and its longitude term is
 *    wrong everywhere except the equator. A wrong "nearby" is worse than an
 *    absent one.
 *
 * ## The envelope's edges are GREAT CIRCLES, and two things follow
 *
 * This paragraph used to claim the opposite — that `ST_MakeEnvelope` gives
 * edges "straight in lat/lon space", disagreeing with Mongo's geodesic
 * `$geoWithin` polygon only inside a very large box. That is wrong, and wrong
 * in the direction that reassures: {@link withinBoundingBox} casts the envelope
 * to `::geography`, and a `geography` polygon's edges are great-circle arcs.
 * Measured against `postgis/postgis:17-3.5` on 2026-08-10 (fixtures and full
 * numbers in `__tests__/integration/antimeridianBoundingBox.test.ts`):
 *
 *  - **The cast is what makes an antimeridian box work at all.** `west > east`
 *    means the box crosses ±180 — `170 → -170` is the 20° Pacific strip, not
 *    the 340° remainder — and `::geography` already reads it that way. Drop the
 *    cast and every such query returns its exact COMPLEMENT, silently. That is
 *    also why `parseBoundingBox` validates latitude order and NOT longitude
 *    order: the asymmetry is deliberate, and "tidying" it into `swLng <= neLng`
 *    turns every antimeridian search into a 400.
 *  - **A very wide box is therefore NOT the rectangle the map drew.** The
 *    geodesic edges bulge poleward, so a box past roughly 50–58° of longitude
 *    in a narrow latitude band can exclude its own centre, and one exactly 180°
 *    wide raises `Antipodal (180 degrees long) edge detected!`. Every realistic
 *    viewport is unaffected — a city, Spain, Europe and the continental US all
 *    contain their own cities — so this is a known edge, not a live defect, and
 *    it is recorded rather than fixed because the obvious repair costs the wrap:
 *    `ST_Segmentize` on the envelope straightens the edges AND inverts the
 *    antimeridian case into its complement.
 */

import { sql, type SQL } from 'drizzle-orm';

import { addresses } from '../schema';

/** A center + radius constraint, in metres. */
export interface GeoCircle {
  longitude: number;
  latitude: number;
  radiusMeters: number;
}

/** A map-viewport rectangle, in degrees. */
export interface GeoBoundingBox {
  swLat: number;
  swLng: number;
  neLat: number;
  neLng: number;
}

/**
 * A `geography` point at `(longitude, latitude)`.
 *
 * Named arguments rather than a positional pair, because the ONE mistake this
 * whole column design exists to prevent is a transposition — and a transposed
 * pair does not look wrong, it yields a perfectly valid point in the wrong
 * hemisphere. `ST_MakePoint` itself is `(x, y)` i.e. `(lng, lat)`, which is the
 * opposite order from every `lat, lng` the HTTP layer receives.
 */
export function geoPoint(longitude: number, latitude: number): SQL {
  return sql`ST_MakePoint(${longitude}, ${latitude})::geography`;
}

/**
 * Addresses within `radiusMeters` of the circle's centre.
 *
 * The port of Mongo's `$near`/`$maxDistance` and `$centerSphere`. `ST_DWithin`
 * on `geography` measures true spheroid distance in METRES, so the radius needs
 * none of the radians conversion `$centerSphere` demanded (`EARTH_RADIUS_METERS`
 * exists for that conversion and has no counterpart here).
 */
export function withinCircle(circle: GeoCircle): SQL {
  return sql`ST_DWithin(${addresses.geo}, ${geoPoint(circle.longitude, circle.latitude)}, ${circle.radiusMeters})`;
}

/**
 * Addresses inside the rectangle.
 *
 * `ST_MakeEnvelope(xmin, ymin, xmax, ymax, 4326)` takes LONGITUDE first —
 * hence the argument order below, which is deliberately not the field order of
 * {@link GeoBoundingBox}. `ST_Intersects` on `geography` is index-accelerated
 * (it applies the GiST bounding-box operator before the exact test).
 */
export function withinBoundingBox(box: GeoBoundingBox): SQL {
  return sql`ST_Intersects(${addresses.geo}, ST_MakeEnvelope(${box.swLng}, ${box.swLat}, ${box.neLng}, ${box.neLat}, 4326)::geography)`;
}

/**
 * Distance in metres from a listing's address to a point, for a SELECT list or
 * an ORDER BY.
 *
 * Never a WHERE predicate — see the module doc. Pair it with
 * {@link withinCircle} when both a bound and an ordering are wanted: the
 * predicate uses the index to choose the rows, this orders the few that
 * survived.
 */
export function distanceTo(longitude: number, latitude: number): SQL<number> {
  return sql<number>`ST_Distance(${addresses.geo}, ${geoPoint(longitude, latitude)})`;
}
