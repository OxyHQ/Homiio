/**
 * Geo Query Service
 *
 * Read-time translation of a human location query (city / region name or id)
 * into canonical geo ids, and from there into the set of address ids in that
 * place. Every consumer that used to regex free-text `address.city` /
 * `address.state` resolves through here, so location filtering is fully
 * relational and index-backed (cities/regions → `addresses.city_id`/`region_id`).
 *
 * `null` is returned when a filter value is present but matches no city/region
 * (the caller should treat that as "no results"), distinct from an empty filter
 * (no geo constraint at all), which the callers detect before calling.
 *
 * ## "Is this an id or a name?" is asked of the DATABASE, never of the shape
 *
 * Deciding by the string's SHAPE is not a validity guard, it is a branch — and
 * it branches WRONG: a uuid v7 city id fails a 24-hex test, falls through to the
 * name lookup, matches no city, and the caller reads "unknown city → no
 * results". No error, no log, an empty result page
 * (`db/MIGRATION-CONTRACT.md` §"Never branch on an id's FORMAT"). The ambiguity
 * is REAL — every
 * caller's parameter is documented as "city (id or name)" and the frontend sends
 * both — so the question "is this an id?" is answered by ASKING THE DATABASE,
 * with `id = $1 or lower(name) = lower($1)` in a single statement. Both sides are
 * index-backed (the primary key, and the `lower(name)` functional btree), the id
 * still WINS when a value somehow matches both, and the answer stays correct for
 * every id shape that will ever exist — 24-char hex, uuid v7, or whatever
 * follows — because nothing here knows or cares what an id looks like.
 *
 * Where two rows share a name (case-insensitively), the `order by … , id`
 * tiebreak makes the answer stable rather than arbitrary between two identical
 * requests.
 */

import { and, eq, sql, type SQL } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';

import { getDb } from '../db/postgres';
import { addresses, cities, neighborhoods, regions } from '../db/schema';

export interface GeoFilterInput {
  /** City name or city id. */
  city?: string;
  /** Region (province/state) name or region id. */
  state?: string;
  /** Neighborhood name or neighborhood id (scoped within the resolved city). */
  neighborhood?: string;
  /** ISO-2 country code. */
  countryCode?: string;
}

function asTrimmed(value: string | undefined): string | undefined {
  const t = value?.trim();
  return t && t.length > 0 ? t : undefined;
}

/**
 * `id = $1 OR lower(name) = lower($1)`, with the id match ordered first.
 *
 * Shared by the city and region resolvers rather than written twice: the two
 * differ only in the table, and a second copy is a second place for the
 * precedence (id beats name) to drift.
 */
function idOrNameMatch(idColumn: AnyPgColumn, nameColumn: AnyPgColumn, value: string): SQL {
  return sql`(${idColumn} = ${value} or lower(${nameColumn}) = lower(${value}))`;
}

/** Resolve a city query (id or name) to a single city id, or null if unknown. */
export async function resolveCityId(city: string): Promise<string | null> {
  const value = asTrimmed(city);
  if (!value) return null;
  const rows = await getDb()
    .select({ id: cities.id })
    .from(cities)
    .where(idOrNameMatch(cities.id, cities.name, value))
    // An exact id match outranks a name match; `id` breaks a tie between two
    // same-named rows deterministically.
    .orderBy(sql`(${cities.id} = ${value}) desc`, cities.id)
    .limit(1);
  return rows[0]?.id ?? null;
}

/** Resolve a region query (id or name) to a single region id, or null if unknown. */
export async function resolveRegionId(state: string): Promise<string | null> {
  const value = asTrimmed(state);
  if (!value) return null;
  const rows = await getDb()
    .select({ id: regions.id })
    .from(regions)
    .where(idOrNameMatch(regions.id, regions.name, value))
    .orderBy(sql`(${regions.id} = ${value}) desc`, regions.id)
    .limit(1);
  return rows[0]?.id ?? null;
}

/**
 * Resolve a neighborhood query (id or name) to a single neighborhood id, or null
 * if unknown.
 *
 * `cityId` scopes the NAME side only, never the id side — an explicitly
 * supplied neighborhood id is looked up unscoped. That asymmetry is deliberate: an id already names exactly one
 * row, so scoping it could only ever turn a correct answer into no answer.
 */
export async function resolveNeighborhoodId(
  neighborhood: string,
  options: { cityId?: string | null } = {},
): Promise<string | null> {
  const value = asTrimmed(neighborhood);
  if (!value) return null;
  const cityId = options.cityId ?? null;
  const rows = await getDb()
    .select({ id: neighborhoods.id })
    .from(neighborhoods)
    .where(sql`(
      ${neighborhoods.id} = ${value}
      or (
        lower(${neighborhoods.name}) = lower(${value})
        ${cityId ? sql`and ${neighborhoods.cityId} = ${cityId}` : sql``}
      )
    )`)
    .orderBy(sql`(${neighborhoods.id} = ${value}) desc`, neighborhoods.id)
    .limit(1);
  return rows[0]?.id ?? null;
}

/**
 * Resolve a city/state/neighborhood/countryCode filter to the set of address
 * ids that satisfy ALL provided constraints.
 *
 * Returns:
 *  - `null` when at least one constraint was provided but resolved to nothing
 *    (unknown city/region → no addresses can match), and
 *  - an array of address ids otherwise (possibly empty if the place exists but
 *    has no addresses yet).
 *
 * Callers that pass no constraint at all should not call this (they have no
 * narrowing to do); when every provided field is blank this returns `null`.
 *
 * **No production read calls this.** The property list, search, geo, city,
 * room and Telegram feeds compare `addresses.city_id` on the row the property
 * read already joins (`db/properties/propertyGeo.ts`) rather than loading an
 * entire city's addresses into one uncapped id list. Do not add a caller: for
 * anything reading properties, the predicates in `db/properties/propertyFilters`
 * are the replacement. `git grep -n resolveGeoFilterAddressIds` is the check.
 */
export async function resolveGeoFilterAddressIds(input: GeoFilterInput): Promise<string[] | null> {
  const conditions: SQL[] = [];

  const cityValue = asTrimmed(input.city);
  let resolvedCityId: string | null = null;
  if (cityValue) {
    resolvedCityId = await resolveCityId(cityValue);
    if (!resolvedCityId) return null;
    conditions.push(eq(addresses.cityId, resolvedCityId));
  }

  const stateValue = asTrimmed(input.state);
  if (stateValue) {
    const regionId = await resolveRegionId(stateValue);
    if (!regionId) return null;
    conditions.push(eq(addresses.regionId, regionId));
  }

  const countryCode = asTrimmed(input.countryCode);
  if (countryCode) {
    conditions.push(eq(addresses.countryCode, countryCode.toUpperCase()));
  }

  const neighborhoodValue = asTrimmed(input.neighborhood);
  if (neighborhoodValue) {
    // Scoped to the resolved city when one was given.
    const neighborhoodId = await resolveNeighborhoodId(neighborhoodValue, {
      cityId: resolvedCityId,
    });
    if (!neighborhoodId) return null;
    conditions.push(eq(addresses.neighborhoodId, neighborhoodId));
  }

  if (conditions.length === 0) return null;

  const rows = await getDb()
    .select({ id: addresses.id })
    .from(addresses)
    .where(and(...conditions));
  return rows.map((row) => row.id);
}

export default {
  resolveCityId,
  resolveRegionId,
  resolveGeoFilterAddressIds,
};
