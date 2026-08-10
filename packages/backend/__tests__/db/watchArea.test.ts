/**
 * The watch AREA, against a real PostGIS server.
 *
 * Two questions, and only the second needs a database:
 *
 *  1. what polygon does a `LocationSelection` become — pure, asserted directly;
 *  2. does PostGIS agree that the polygon covers what it is supposed to —
 *     asserted by generating the column exactly as the schema does and asking
 *     `ST_Intersects`, because a GeoJSON ring that LOOKS right and a geography
 *     that CONTAINS the right points are different claims.
 *
 * ## The antimeridian case is the whole reason this file exists
 *
 * `GeoBounds` permits `west > east`, meaning the box crosses ±180 — `west 170,
 * east -170` is the 20° Pacific strip. `watchArea` cuts such a box into two
 * rings (RFC 7946 §3.1.9), and the interesting question is what that BUYS.
 *
 * It was written believing the uncut ring would make PostGIS return the 340°
 * complement. Measured against `postgis/postgis:17-3.5`, that is FALSE for
 * `::geography`: the two forms agree to within 0.55%, and the numbers are in the
 * cases below so the next reader does not have to re-derive them. It is TRUE and
 * total for the planar `geometry` reading, which is what a map client rendering
 * the stored GeoJSON performs.
 *
 * So the negative control is the UNCUT ring measured BOTH ways: agreeing as
 * geography, opposite as geometry. A geography-only fixture set cannot tell this
 * implementation from one that never cut at all, and a fixture set with no
 * wrapping box cannot tell either of them from a broken one.
 */

import { sql } from 'drizzle-orm';
import { closePostgres, connectPostgres, type Database } from '../../db/postgres';
import { boundsToArea, watchAreaFromSelection } from '../../db/watches/watchArea';
import type { LocationSelection } from '@homiio/shared-types';

let db: Database;

beforeAll(async () => {
  db = await connectPostgres();
});

afterAll(async () => {
  await closePostgres();
});

/**
 * Ask the SERVER whether an area covers a point, through the same expression the
 * generated column uses.
 *
 * Not `ST_Contains` on a plain geometry: the schema's column is
 * `ST_GeomFromGeoJSON(area)::geography`, and a geography polygon's edges are
 * great-circle arcs. Asserting against anything else would be testing a
 * different object from the one the matcher queries.
 */
async function covers(area: unknown, longitude: number, latitude: number): Promise<boolean> {
  const rows = await db.execute<{ hit: boolean }>(sql`
    select ST_Intersects(
      ST_GeomFromGeoJSON(${JSON.stringify(area)})::geography,
      ST_MakePoint(${longitude}, ${latitude})::geography
    ) as hit
  `);
  return rows[0].hit;
}

describe('a plain bounding box', () => {
  const eixample = { west: 2.15, south: 41.38, east: 2.19, north: 41.4 };

  it('becomes a closed Polygon ring', () => {
    const area = boundsToArea(eixample);
    expect(area?.type).toBe('Polygon');
    const ring = (area as { coordinates: number[][][] }).coordinates[0];
    expect(ring).toHaveLength(5);
    // Closed: GeoJSON requires the first position repeated last, and PostGIS
    // rejects a ring that is not.
    expect(ring[0]).toEqual(ring[4]);
  });

  it('covers a point inside and not one outside, ON THE SERVER', async () => {
    const area = boundsToArea(eixample);
    expect(await covers(area, 2.17, 41.39)).toBe(true);
    expect(await covers(area, -3.7038, 40.4168)).toBe(false);
  });

  it('refuses a box whose south is north of its north', () => {
    // `south > north` is an ERROR, unlike `west > east`. A silently-accepted
    // inverted box is an empty area that reads as a watch matching nothing.
    expect(boundsToArea({ west: 2.15, south: 41.4, east: 2.19, north: 41.38 })).toBeNull();
  });
});

describe('a box that crosses the antimeridian', () => {
  /** The 20° Pacific strip: `west 170` running EAST to `east -170`. */
  const pacific = { west: 170, south: -20, east: -170, north: -16 };

  /** The naive single ring, built here purely as a negative control. */
  const naive = {
    type: 'Polygon',
    coordinates: [
      [
        [pacific.west, pacific.south],
        [pacific.east, pacific.south],
        [pacific.east, pacific.north],
        [pacific.west, pacific.north],
        [pacific.west, pacific.south],
      ],
    ],
  };

  it('splits into TWO rings rather than one', () => {
    const area = boundsToArea(pacific);
    expect(area?.type).toBe('MultiPolygon');
    expect((area as { coordinates: unknown[] }).coordinates).toHaveLength(2);
  });

  it('covers Fiji', async () => {
    // 178.44 E, 18.14 S — inside the strip, and on the far side of 180 from the
    // box's western edge.
    expect(await covers(boundsToArea(pacific), 178.4419, -18.1416)).toBe(true);
  });

  it('covers the eastern half too, past ±180', async () => {
    expect(await covers(boundsToArea(pacific), -175, -18)).toBe(true);
  });

  it('excludes the Gulf of Guinea — and so, measurably, does the UNCUT ring', async () => {
    // The correction that matters, and the reason it is asserted rather than
    // assumed: `::geography` reads `west > east` the short way on its own, so
    // the uncut ring is NOT the 340° complement here. Both forms exclude the
    // point 13,000 km away, and both cover Fiji.
    //
    // Asserting the AGREEMENT is what keeps the module comment honest. Without
    // it, somebody would eventually restore the "PostGIS returns the complement"
    // story that the first draft of this file carried and that measurement
    // disproved.
    expect(await covers(boundsToArea(pacific), 0, -18)).toBe(false);
    expect(await covers(naive, 0, -18)).toBe(false);
    expect(await covers(naive, 178.4419, -18.1416)).toBe(true);
  });

  it('agrees with the uncut ring as GEOGRAPHY, to within the edge bowing', async () => {
    // 944,420 km² uncut against 939,253 km² cut, measured on
    // `postgis/postgis:17-3.5`. The whole difference is one 20° great-circle
    // edge bowing against two 10° ones, which is why the tolerance is 1% and not
    // a rounding epsilon — a real disagreement would be a factor of seventeen.
    const rows = await db.execute<{ uncut: number; cut: number }>(sql`
      select
        ST_Area(ST_GeomFromGeoJSON(${JSON.stringify(naive)})::geography) as uncut,
        ST_Area(ST_GeomFromGeoJSON(${JSON.stringify(boundsToArea(pacific))})::geography) as cut
    `);
    expect(Math.abs(rows[0].uncut - rows[0].cut) / rows[0].cut).toBeLessThan(0.01);
  });

  it('DISAGREES with it as GEOMETRY — the exact complement, in both directions', async () => {
    // The reading that actually breaks, and the reason the cut is worth having:
    // the stored value is GeoJSON, and anything reading it without the
    // `::geography` cast — a map client, an export, a future query — gets 1,360
    // deg² covering the Gulf of Guinea and MISSING Fiji, against 80 deg² that is
    // right about both.
    const rows = await db.execute<{
      uncutarea: number;
      cutarea: number;
      uncutguinea: boolean;
      cutguinea: boolean;
      uncutfiji: boolean;
      cutfiji: boolean;
    }>(sql`
      select
        ST_Area(ST_GeomFromGeoJSON(${JSON.stringify(naive)})) as uncutArea,
        ST_Area(ST_GeomFromGeoJSON(${JSON.stringify(boundsToArea(pacific))})) as cutArea,
        ST_Intersects(ST_GeomFromGeoJSON(${JSON.stringify(naive)}),
          ST_SetSRID(ST_MakePoint(0, -18), 4326)) as uncutGuinea,
        ST_Intersects(ST_GeomFromGeoJSON(${JSON.stringify(boundsToArea(pacific))}),
          ST_SetSRID(ST_MakePoint(0, -18), 4326)) as cutGuinea,
        ST_Intersects(ST_GeomFromGeoJSON(${JSON.stringify(naive)}),
          ST_SetSRID(ST_MakePoint(178.4419, -18.1416), 4326)) as uncutFiji,
        ST_Intersects(ST_GeomFromGeoJSON(${JSON.stringify(boundsToArea(pacific))}),
          ST_SetSRID(ST_MakePoint(178.4419, -18.1416), 4326)) as cutFiji
    `);
    expect(rows[0].uncutarea).toBeCloseTo(1360, 0);
    expect(rows[0].cutarea).toBeCloseTo(80, 0);
    expect(rows[0].uncutguinea).toBe(true);
    expect(rows[0].cutguinea).toBe(false);
    expect(rows[0].uncutfiji).toBe(false);
    expect(rows[0].cutfiji).toBe(true);
  });
});

describe('which selections become an area at all', () => {
  const bounds = { west: 2.15, south: 41.38, east: 2.19, north: 41.4 };

  it('takes the bounds off a `map_bounds` selection', () => {
    const selection: LocationSelection = {
      kind: 'map_bounds',
      bounds,
      center: { longitude: 2.17, latitude: 41.39 },
      label: { primary: 'Map area', kind: 'generated' },
      precision: 'area',
    };
    expect(watchAreaFromSelection(selection)?.type).toBe('Polygon');
  });

  it('takes the polygon off a drawn selection verbatim', () => {
    const polygon = {
      type: 'Polygon' as const,
      coordinates: [
        [
          [2.15, 41.38],
          [2.19, 41.38],
          [2.19, 41.4],
          [2.15, 41.38],
        ] as [number, number][],
      ],
    };
    const selection: LocationSelection = {
      kind: 'polygon',
      polygon,
      bounds,
      label: { primary: 'Drawn', kind: 'generated' },
      precision: 'area',
    };
    expect(watchAreaFromSelection(selection)).toBe(polygon);
  });

  it('REFUSES a place with a centroid and no extent, rather than inventing a radius', () => {
    // The decision this module exists to make. A 5 km disc around a city
    // centroid looks like it works and silently excludes most of the city; a
    // refusal is visible, and the watch reports `no_area`.
    const selection: LocationSelection = {
      kind: 'place',
      source: { kind: 'homiio', entity: 'city', id: 'city-1' },
      placeType: 'city',
      label: { primary: 'Barcelona', kind: 'place' },
      admin: { countryCode: 'ES' },
      center: { longitude: 2.1734, latitude: 41.3851 },
      precision: 'centroid',
    };
    expect(watchAreaFromSelection(selection)).toBeNull();
  });

  it('uses a place\'s bounds when it has them', () => {
    const selection: LocationSelection = {
      kind: 'place',
      source: { kind: 'homiio', entity: 'city', id: 'city-1' },
      placeType: 'city',
      label: { primary: 'Barcelona', kind: 'place' },
      admin: { countryCode: 'ES' },
      center: { longitude: 2.1734, latitude: 41.3851 },
      bounds,
      precision: 'centroid',
    };
    expect(watchAreaFromSelection(selection)?.type).toBe('Polygon');
  });

  it('REFUSES a device position outright', () => {
    // "Near me" means "near wherever I am when I look", and a watch is evaluated
    // by a server job with no device attached. The only way to persist one is to
    // freeze an exact GPS fix into the row.
    const selection: LocationSelection = {
      kind: 'current_location',
      center: { longitude: 2.17, latitude: 41.39 },
      radiusMeters: 2_000,
      precision: 'exact',
    };
    expect(watchAreaFromSelection(selection)).toBeNull();
  });

  it('unions a multi-area, and covers BOTH halves on the server', async () => {
    const madrid = { west: -3.75, south: 40.39, east: -3.65, north: 40.45 };
    const selection: LocationSelection = {
      kind: 'multi_area',
      label: { primary: 'Two cities', kind: 'generated' },
      areas: [
        {
          kind: 'map_bounds',
          bounds,
          center: { longitude: 2.17, latitude: 41.39 },
          label: { primary: 'Eixample', kind: 'generated' },
          precision: 'area',
        },
        {
          kind: 'map_bounds',
          bounds: madrid,
          center: { longitude: -3.7, latitude: 40.42 },
          label: { primary: 'Madrid centro', kind: 'generated' },
          precision: 'area',
        },
      ],
    };
    const area = watchAreaFromSelection(selection);
    expect(area?.type).toBe('MultiPolygon');
    expect(await covers(area, 2.17, 41.39)).toBe(true);
    expect(await covers(area, -3.7, 40.42)).toBe(true);
    expect(await covers(area, 0, 0)).toBe(false);
  });

  it('refuses a multi-area if ANY member has no extent', () => {
    // One unusable member makes the whole thing unusable rather than silently
    // becoming a watch on the members that happened to work — which would report
    // itself active while covering half of what its name says.
    const selection: LocationSelection = {
      kind: 'multi_area',
      label: { primary: 'Mixed', kind: 'generated' },
      areas: [
        {
          kind: 'map_bounds',
          bounds,
          center: { longitude: 2.17, latitude: 41.39 },
          label: { primary: 'Eixample', kind: 'generated' },
          precision: 'area',
        },
        {
          kind: 'place',
          source: { kind: 'homiio', entity: 'city', id: 'city-2' },
          placeType: 'city',
          label: { primary: 'Somewhere', kind: 'place' },
          admin: { countryCode: 'ES' },
          center: { longitude: 1, latitude: 1 },
          precision: 'centroid',
        },
      ],
    };
    expect(watchAreaFromSelection(selection)).toBeNull();
  });
});
