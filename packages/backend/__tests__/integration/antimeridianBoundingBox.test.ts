/**
 * A bounding box that crosses the antimeridian, against a REAL PostGIS.
 *
 * ## Why this file exists, and why it cannot be a unit test
 *
 * `GeoBounds` declares that `west > east` means the box crosses the
 * antimeridian: `west 170 → east -170` is the 20-degree strip over the Pacific,
 * NOT the 340-degree rest of the world. That is not a convention chosen for
 * elegance — it is what the database already does, and only because
 * {@link withinBoundingBox} casts the envelope to `::geography`
 * (`db/properties/propertyGeo.ts`). A plain `geometry` envelope returns the
 * exact COMPLEMENT of the intended strip. Both readings return rows, neither
 * raises, and no mock of drizzle or of postgres.js reproduces the difference,
 * so the semantics are only observable against a real server.
 *
 * ## The reason `parseBoundingBox` validates latitude order and NOT longitude
 *
 * `parseBoundingBox` throws on `swLat > neLat` and says nothing about
 * longitude. That asymmetry looks like an oversight and is load-bearing: adding
 * a `swLng <= neLng` validation turns every antimeridian query into an
 * `INVALID_GEO_PARAMS` 400, and "normalising" it by swapping west and east
 * turns it into its complement — the three far-side listings come back and the
 * two Pacific ones do not. Both regressions are one plausible-looking tidy-up
 * away, which is what this file is here to catch.
 *
 * ## The fixture, and why every probe shares one latitude band
 *
 * Two listings intended INSIDE (Fiji `178.44,-18.14`, Samoa `-172,-18`) and
 * three intended OUTSIDE (`0,-18`, `100,-18`, `-100,-18`). Every one of the
 * five sits at essentially the same latitude, inside the box's `-20 → -16`
 * band, so latitude cannot separate them and the assertions can only be
 * satisfied by the LONGITUDE wrap being read correctly. A probe at a different
 * latitude would be excluded by the latitude bound and would pass under a
 * broken longitude reading too — a mistake made once while measuring this, and
 * the reason it is written down here rather than left to the reader.
 *
 * The three wrong implementations and what each returns are enumerated in
 * ADR 0002 §12.3; the `it` titles below name them.
 *
 * ## `ST_Segmentize` is a fourth wrong implementation, and it looks like a fix
 *
 * A `geography` polygon's edges are GREAT-CIRCLE arcs, not parallels, so a wide
 * envelope bulges poleward and stops being the lat/lng rectangle a map drew.
 * The textbook remedy is to densify the edges — `ST_Segmentize(env, 1.0)` — and
 * it does repair a wide box. It also **inverts the wrap**, measured against this
 * database on 2026-08-10: with segmentize applied, the Pacific box returns
 * Greenwich, the Indian Ocean and the far side, and returns NEITHER Fiji nor
 * Samoa — the exact complement, the same damage as dropping the cast. So the
 * two properties are in tension and segmentize buys one by losing the other.
 * Do not apply it here.
 *
 * ## The measured limits of the current predicate, so they are not a surprise
 *
 * All against `postgis/postgis:17-3.5`, 2026-08-10, probing whether a point
 * plainly inside a box is reported inside:
 *
 *  - Every realistic viewport is CORRECT: a city box, Spain, Europe
 *    (`-25..45`, 70° wide) and the continental US (`-125..-66`, 59° wide) all
 *    contain their own cities under `::geography`.
 *  - A box wider than roughly 50–58° of longitude in a narrow latitude band
 *    stops containing its own centre (measured at latitude −18 with a 4°-tall
 *    box: `t` through a 50° span, `f` from 58°). The geodesic bulge is why.
 *  - A box EXACTLY 180° wide raises `Antipodal (180 degrees long) edge
 *    detected!`, which reaches the endpoint as a 500 rather than a typed 400.
 *
 * Neither of the last two is fixed here: the repair is a different envelope
 * construction, not a tweak, and it must not cost the wrap above. They are
 * recorded because an unmeasured limit gets rediscovered as a mystery.
 */

import express, { type Express } from 'express';
import request from 'supertest';
import { OfferingType, PropertyStatus, PropertyType } from '@homiio/shared-types';

import { searchProperties } from '../../controllers/property/search';
import { parseBoundingBox } from '../../controllers/property/searchQueryBuilder';
import { errorHandler } from '../../middlewares/errorHandler';
import { serializeWireIds } from '../../middlewares/wireIds';
import {
  resetGeoTables,
  seedAddress,
  seedGeoChain,
  seedProperty,
} from '../helpers/postgresGeoFixtures';

/**
 * The box under test: `loc=bbox.170,-20,-170,-16`.
 *
 * `swLng` (170) is GREATER than `neLng` (-170). Read as a wrap it is a
 * 20-degree strip over the Pacific; read as a plain rectangle it is the other
 * 340 degrees.
 */
const PACIFIC_BOX = { swLng: 170, swLat: -20, neLng: -170, neLat: -16 } as const;

/** Points, all in the box's latitude band so only longitude can separate them. */
const INSIDE = {
  fiji: { longitude: 178.44, latitude: -18.14 },
  samoa: { longitude: -172, latitude: -18 },
  nearWestEdge: { longitude: 170.5, latitude: -18 },
} as const;

const OUTSIDE = {
  greenwich: { longitude: 0, latitude: -18 },
  indianOcean: { longitude: 100, latitude: -18 },
  pacificFarSide: { longitude: -100, latitude: -18 },
} as const;

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use(serializeWireIds);
  app.get('/properties/search', searchProperties);
  app.use(errorHandler);
  return app;
}

/** A published long-term listing at a point, in its own geo chain. */
async function seedListingAt(name: string, point: { longitude: number; latitude: number }): Promise<string> {
  // `countries_code_key` is UNIQUE, so each chain needs its own code.
  const chain = await seedGeoChain({
    cityName: name,
    regionName: `${name} region`,
    countryCode: `AM-${name}`,
  });
  const addressId = await seedAddress({
    chain,
    street: `${name} Road`,
    longitude: point.longitude,
    latitude: point.latitude,
  });
  return seedProperty({
    addressId,
    overrides: {
      status: PropertyStatus.PUBLISHED,
      type: PropertyType.APARTMENT,
      availabilityIsAvailable: true,
      offerings: [OfferingType.LONG_TERM_RENT],
      longTermRentMonthlyAmount: 1000,
      longTermRentCurrency: 'EUR',
    },
  });
}

function boxQuery(box: { swLng: number; swLat: number; neLng: number; neLat: number }): string {
  return `swLng=${box.swLng}&swLat=${box.swLat}&neLng=${box.neLng}&neLat=${box.neLat}`;
}

describe('a bounding box crossing the antimeridian (real PostGIS)', () => {
  beforeEach(async () => {
    await resetGeoTables();
  });

  it('accepts west > east rather than rejecting it — a swLng <= neLng validation would 400 here', () => {
    // The loud wrong answer. This is the assertion that fails first if somebody
    // "tidies up" the asymmetry in parseBoundingBox.
    expect(parseBoundingBox({ ...Object.fromEntries(Object.entries(PACIFIC_BOX).map(([k, v]) => [k, String(v)])) })).toEqual({
      swLng: 170,
      swLat: -20,
      neLng: -170,
      neLat: -16,
    });
  });

  it('still rejects an inverted LATITUDE, so the asymmetry is deliberate and not an absent check', () => {
    expect(() =>
      parseBoundingBox({ swLng: '170', swLat: '-16', neLng: '-170', neLat: '-20' }),
    ).toThrow(/swLat must be less than or equal to neLat/);
  });

  it('returns the two Pacific listings and NOT the three far-side ones', async () => {
    // Seeded far-side first, so an implementation that ignores the box entirely
    // (or falls back to insertion order) cannot accidentally produce the right
    // answer at the head of the list.
    const greenwich = await seedListingAt('Greenwich', OUTSIDE.greenwich);
    const indian = await seedListingAt('IndianOcean', OUTSIDE.indianOcean);
    const farSide = await seedListingAt('PacificFarSide', OUTSIDE.pacificFarSide);
    const fiji = await seedListingAt('Fiji', INSIDE.fiji);
    const samoa = await seedListingAt('Samoa', INSIDE.samoa);
    const nearEdge = await seedListingAt('NearWestEdge', INSIDE.nearWestEdge);

    const res = await request(buildApp()).get(
      `/properties/search?${boxQuery(PACIFIC_BOX)}&limit=50`,
    );

    expect(res.status).toBe(200);
    const ids = new Set<string>((res.body.data as { id: string }[]).map((p) => p.id));

    // Vacuity floor: the six listings really are in the database, so an empty
    // result cannot read as a pass. A dropped `::geography` cast returns the
    // exact COMPLEMENT — three rows — which this pair of assertions separates.
    expect(ids.size).toBe(3);
    expect([...ids].sort()).toEqual([fiji, samoa, nearEdge].sort());

    expect(ids.has(greenwich)).toBe(false);
    expect(ids.has(indian)).toBe(false);
    expect(ids.has(farSide)).toBe(false);
  });

  it('reads a NON-wrapping box the ordinary way, so the wrap is not applied to every query', async () => {
    // The control. If `west > east` were being handled by unconditionally
    // swapping, or if every box were treated as a wrap, this block would
    // disagree with the one above — one fixture cannot distinguish "the wrap is
    // read correctly" from "every box is read as a wrap".
    //
    // 50° wide on purpose. A first draft used `-10 → 110` (120°) and failed
    // with zero rows, which read as a wrap bug and is not one: that box is past
    // the geodesic-bulge threshold in the header note, so it excludes its own
    // centre. The control has to sit inside the regime it is controlling for.
    const greenwich = await seedListingAt('Greenwich', OUTSIDE.greenwich);
    const madagascar = await seedListingAt('Madagascar', { longitude: 30, latitude: -18 });
    const indian = await seedListingAt('IndianOcean', OUTSIDE.indianOcean);
    const fiji = await seedListingAt('Fiji', INSIDE.fiji);

    const res = await request(buildApp()).get(
      `/properties/search?${boxQuery({ swLng: -10, swLat: -20, neLng: 40, neLat: -16 })}&limit=50`,
    );

    expect(res.status).toBe(200);
    const ids = new Set<string>((res.body.data as { id: string }[]).map((p) => p.id));

    // Fiji is the discriminator: a predicate that treated EVERY box as a wrap
    // would return it here and drop the two points between −10 and 40.
    expect(ids.size).toBe(2);
    expect([...ids].sort()).toEqual([greenwich, madagascar].sort());
    expect(ids.has(indian)).toBe(false);
    expect(ids.has(fiji)).toBe(false);
  });
});
