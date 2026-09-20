/**
 * Turning "the network says Barcelona, ES-CT, ES" into a place Homiio OWNS.
 *
 * ## Why a match and not a candidate
 *
 * A GeoIP record names a city in the provider's vocabulary. Homiio's geo tables
 * name cities in Homiio's. The gap between them is the whole of this file, and
 * there are two wrong ways to close it that both look reasonable:
 *
 *  - **Emit the provider's own identity.** `ext:mmdb:<geonameId>` serialises
 *    into a perfectly well-formed `loc` token that `services/geocoding/registry`
 *    cannot resolve, because there is no GeoIP adapter in the geocoding
 *    registry and never will be. Home would show a city name and query nothing.
 *  - **Geocode the name.** That is the homonym bug ADR 0002 §12.2 exists for —
 *    "Barcelona" picks Catalonia or Anzoátegui by whichever row sorts first —
 *    and it also puts a user's inferred city into the geocoder as free text,
 *    which §4.1 forbids for a different reason entirely.
 *
 * So the match is made against Homiio's own tables, ALWAYS constrained to the
 * country the provider reported, and it never creates a row. A country
 * constraint makes homonyms across borders unreachable rather than unlikely.
 *
 * ## Why the ladder descends, and why it is allowed to
 *
 * City → region → country. Each rung is a HONEST WIDENING, not a fallback to
 * something else: failing to find Homiio's row for Sabadell and answering
 * "Catalonia" states a true, coarser fact, which is exactly what both epics ask
 * for ("Si solo se conoce la región o el país, utilizar ese alcance y nombrarlo
 * correctamente"). What it may never do is widen SIDEWAYS — to a neighbouring
 * city, a popular city, or the whole world.
 *
 * The rung that was reached is returned, so the caller can label the area at
 * the precision it actually has and never say "Barcelona" when it resolved
 * Spain.
 */

import { and, eq, isNotNull, sql } from 'drizzle-orm';

import { getDb } from '../../db/postgres';
import { cities, countries, regions } from '../../db/schema';
import type { ApproximateLocationGranularity } from '@homiio/shared-types';
import type { GeoIpRecord } from './types';

/**
 * How far a Homiio city may be from the provider's point and still be the same
 * city, in metres.
 *
 * Fifty kilometres. A GeoIP city record's coordinate is the city's own centre
 * and Homiio's is too, so a correct match is usually within a few kilometres;
 * the slack absorbs the two databases disagreeing about where a sprawling
 * metropolitan centre is. It is NOT slack for "the nearest city we happen to
 * have": the provider must have named a city for this rung to be tried at all,
 * so a coordinate with no city name descends to the region rather than
 * snapping to whatever is closest.
 */
export const CITY_MATCH_MAX_METERS = 50_000;

export interface PlaceMatch {
  readonly granularity: ApproximateLocationGranularity;
  /** The Homiio row id. Resolved into a full place by the geo gateway. */
  readonly id: string;
}

/**
 * The country row for an ISO-3166-1 alpha-2 code, or null.
 *
 * Every other lookup in this file is scoped by this id, so a country Homiio
 * does not have ends the ladder immediately — there is no rung below it.
 */
async function findCountryId(countryCode: string): Promise<string | null> {
  const [row] = await getDb()
    .select({ id: countries.id })
    .from(countries)
    .where(and(eq(countries.code, countryCode.toUpperCase()), eq(countries.isActive, true)))
    .limit(1);
  return row?.id ?? null;
}

/**
 * The region, by code first and name second.
 *
 * TWO code spellings are tried because the two databases disagree about the
 * form: ISO-3166-2 codes are written `ES-CT` in full, MaxMind's `iso_code` is
 * the bare subdivision part `CT`, and Homiio's `regions.code` column holds
 * whichever the importer supplied. Trying both is not defensive clutter — it is
 * the difference between matching Catalonia and silently descending to Spain
 * for every Spanish visitor.
 *
 * The name is a LAST resort and is matched case-insensitively within the
 * country, which is the index `regions_country_name_lower_idx` exists for.
 */
async function findRegionId(
  countryId: string,
  countryCode: string,
  record: GeoIpRecord,
): Promise<string | null> {
  const db = getDb();

  if (record.regionCode) {
    const bare = record.regionCode.toUpperCase();
    const qualified = `${countryCode.toUpperCase()}-${bare}`;
    const [row] = await db
      .select({ id: regions.id })
      .from(regions)
      .where(
        and(
          eq(regions.countryId, countryId),
          eq(regions.isActive, true),
          sql`upper(${regions.code}) in (${bare}, ${qualified})`,
        ),
      )
      .limit(1);
    if (row) return row.id;
  }

  if (record.regionName) {
    const [row] = await db
      .select({ id: regions.id })
      .from(regions)
      .where(
        and(
          eq(regions.countryId, countryId),
          eq(regions.isActive, true),
          sql`lower(${regions.name}) = lower(${record.regionName})`,
        ),
      )
      .limit(1);
    if (row) return row.id;
  }

  return null;
}

/**
 * The city, by name within the country and then by proximity.
 *
 * ## Name first, coordinate second — and the order matters
 *
 * A name match inside one country is an identity claim: Homiio has exactly one
 * active row called "Sabadell" in Spain (`cities_region_slug_key` makes the
 * name unique per region — a name equality implies a slug equality — so several
 * regions could each hold one, hence the proximity tie-break below rather than
 * a bare `limit 1`).
 *
 * A proximity match is a weaker claim and is only allowed to run when the
 * provider NAMED a city. Without that name, the nearest row within fifty
 * kilometres is "some city near the network's guess", which is precisely the
 * "no seleccionar silenciosamente una ciudad de muestra" both epics forbid.
 *
 * ## Why the distance is computed and not indexed
 *
 * `cities` carries plain `latitude`/`longitude` columns and no GiST index, by a
 * decision recorded at length in `db/schema/geo.ts`: nothing queried cities
 * spatially, so an index would cost every write and serve no read. This query
 * is the first spatial read of that table, and it is still not worth one — the
 * scan is constrained to a single country's rows, which is hundreds at most,
 * and the answer is cached per network for the contract's TTL. If city
 * proximity ever becomes a hot path, the schema note already says the honest
 * trigger is a query like this one becoming frequent, not a resemblance.
 */
async function findCityId(countryId: string, record: GeoIpRecord): Promise<string | null> {
  if (!record.cityName) return null;
  const db = getDb();

  const hasPoint = typeof record.latitude === 'number' && typeof record.longitude === 'number';

  const nameMatch = and(
    eq(cities.countryId, countryId),
    eq(cities.isActive, true),
    sql`lower(${cities.name}) = lower(${record.cityName})`,
  );

  if (!hasPoint) {
    // No point to break a tie with. `cities_region_slug_key` makes the name
    // unique per REGION, so a country can hold several — but the country
    // constraint has already excluded the dangerous homonym (the Barcelona in
    // Venezuela), and choosing between two same-named towns in one country with
    // no further evidence is a coin flip either way.
    const [row] = await db.select({ id: cities.id }).from(cities).where(nameMatch).limit(1);
    return row?.id ?? null;
  }

  // `ST_DistanceSphere` over constructed points: no stored geometry needed, and
  // metres out. Rows with no coordinate sort LAST rather than being excluded,
  // so a named city Homiio holds without coordinates still wins its name match
  // when it is the only one.
  const distance = sql<number>`coalesce(
    st_distancesphere(
      st_makepoint(${cities.longitude}, ${cities.latitude}),
      st_makepoint(${record.longitude}, ${record.latitude})
    ),
    1e12
  )`;

  const [named] = await db
    .select({ id: cities.id, distance })
    .from(cities)
    .where(nameMatch)
    // The provider's point breaks the tie between same-named cities.
    .orderBy(distance)
    .limit(1);
  if (named) return named.id;

  const [nearest] = await db
    .select({ id: cities.id, distance })
    .from(cities)
    .where(
      and(
        eq(cities.countryId, countryId),
        eq(cities.isActive, true),
        isNotNull(cities.latitude),
        isNotNull(cities.longitude),
        sql`st_distancesphere(
          st_makepoint(${cities.longitude}, ${cities.latitude}),
          st_makepoint(${record.longitude}, ${record.latitude})
        ) <= ${CITY_MATCH_MAX_METERS}`,
      ),
    )
    .orderBy(distance)
    .limit(1);

  return nearest?.id ?? null;
}

/**
 * The most precise Homiio place this record can honestly name, or null.
 *
 * Null means Homiio's geo tables do not cover the country at all, which the
 * caller reports as `no_homiio_place` — a COVERAGE gap, distinct from the
 * provider not knowing the address. The two are closed by different work and
 * conflating them hides one behind the other.
 */
export async function matchHomiioPlace(record: GeoIpRecord): Promise<PlaceMatch | null> {
  const countryId = await findCountryId(record.countryCode);
  if (!countryId) return null;

  const cityId = await findCityId(countryId, record);
  if (cityId) return { granularity: 'city', id: cityId };

  const regionId = await findRegionId(countryId, record.countryCode, record);
  if (regionId) return { granularity: 'region', id: regionId };

  return { granularity: 'country', id: countryId };
}
