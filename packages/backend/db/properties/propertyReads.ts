/**
 * The property read repository — every catalogue read goes through here.
 *
 * One place issues the property SELECT, so the address join, the protected-column
 * exclusion, the child hydration and the wire shape cannot be spelled five
 * different ways by five controllers. That is not tidiness: `list`, `search`,
 * `geospatial`, `batch`, the city feed and the agency feed each assembled their
 * own Mongo filter, and three of them had independently copy-pasted the same
 * `excludeIds` bug.
 *
 * ## The shape of a read
 *
 * `properties INNER JOIN addresses`, plus four `LEFT JOIN`s for the geo display
 * names. The inner join is safe and deliberate: `address_id` is `NOT NULL` with
 * an `ON DELETE RESTRICT` foreign key, so it can neither drop a row nor multiply
 * one, and it is what puts `addresses.geo` in scope for the spatial predicates
 * (see `propertyGeo.ts` for what that collapse replaces).
 *
 * Children — photos, documents and calendar windows — are loaded in ONE batched
 * query each, keyed by the page's property ids. Joining them into the main
 * statement would multiply the property row by its photo count and break both
 * `LIMIT` and the count; three small indexed `IN` queries against a page of at
 * most 100 ids is the honest shape.
 *
 * ## Ordering: two deliberate differences from Mongo, both stated
 *
 *  - **NULLs sort LAST in a price sort, in both directions.** Mongo sorted a
 *    MISSING price first ascending, so "cheapest first" led with listings that
 *    have no price at all. Postgres would put them last ascending and first
 *    descending; neither default is the product's intent, so both directions say
 *    `NULLS LAST` explicitly and priced listings always rank above unpriced ones.
 *  - **`has_images DESC` leads every sort**, unchanged — the product rule, and
 *    the leading column of `properties_has_images_created_at_idx`.
 *
 * ## What this module does NOT do
 *
 * It does not write. Property, address and image WRITES are still Mongoose, and
 * during the dual-run the worker keeps ingesting into Mongo — so nothing here
 * may become the only writer of a Postgres row.
 */

import { and, asc, count, desc, eq, inArray, sql, type SQL, type SQLWrapper } from 'drizzle-orm';

import { getDb } from '../postgres';
import {
  addresses,
  cities,
  countries,
  neighborhoods,
  properties,
  propertyAvailabilityWindows,
  propertyDocuments,
  propertyImages,
  regions,
} from '../schema';
import { ADDRESS_GEO_NAME_COLUMNS, toAddressWithGeoNames } from '../addresses/addressSerializer';
import { distanceTo } from './propertyGeo';
import {
  propertySelection,
  type HydratedProperty,
  type PropertyAvailabilityWindowRow,
  type PropertyDocumentRow,
  type PropertyImageRow,
} from './propertySerializer';

/** A point to measure each result's distance from, for the geo-ranked feed. */
export interface DistanceOrigin {
  longitude: number;
  latitude: number;
}

export interface PropertyReadOptions {
  where?: SQL;
  /** Applied in order. Callers build these with {@link propertyOrderBy}. */
  orderBy?: SQL[];
  limit?: number;
  offset?: number;
  /** When set, each result carries `distance` in metres from this point. */
  distanceFrom?: DistanceOrigin;
}

/**
 * Group child rows by their property id, preserving the query's own ordering
 * within each group.
 */
function groupByProperty<T extends { propertyId: string }>(rows: readonly T[]): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const row of rows) {
    const existing = grouped.get(row.propertyId);
    if (existing) existing.push(row);
    else grouped.set(row.propertyId, [row]);
  }
  return grouped;
}

/** A page's photos, ordered as the listing lists them. */
async function loadImages(propertyIds: string[]): Promise<Map<string, PropertyImageRow[]>> {
  if (propertyIds.length === 0) return new Map();
  const rows = await getDb()
    .select()
    .from(propertyImages)
    .where(inArray(propertyImages.propertyId, propertyIds))
    // `(property_id, order)` is the index, so this ordering is free.
    .orderBy(asc(propertyImages.propertyId), asc(propertyImages.order));
  return groupByProperty(rows);
}

async function loadDocuments(propertyIds: string[]): Promise<Map<string, PropertyDocumentRow[]>> {
  if (propertyIds.length === 0) return new Map();
  const rows = await getDb()
    .select()
    .from(propertyDocuments)
    .where(inArray(propertyDocuments.propertyId, propertyIds));
  return groupByProperty(rows);
}

/**
 * A page's calendar windows, BOTH scopes.
 *
 * The listing calendar and the exchange calendar share this table under a
 * `scope` discriminator, which is what lets one GiST index serve both; the
 * serializer splits them back apart.
 */
async function loadAvailabilityWindows(
  propertyIds: string[],
): Promise<Map<string, PropertyAvailabilityWindowRow[]>> {
  if (propertyIds.length === 0) return new Map();
  const rows = await getDb()
    .select()
    .from(propertyAvailabilityWindows)
    .where(inArray(propertyAvailabilityWindows.propertyId, propertyIds))
    .orderBy(asc(propertyAvailabilityWindows.propertyId), asc(propertyAvailabilityWindows.startsAt));
  return groupByProperty(rows);
}

/**
 * Read a page of listings with their address, geo names and children.
 *
 * @returns The listings in the requested order, each hydrated enough for
 *   `serializeProperty` to build a response with no further queries.
 */
export async function findProperties(options: PropertyReadOptions): Promise<HydratedProperty[]> {
  const origin = options.distanceFrom;
  const query = getDb()
    .select({
      property: propertySelection(),
      address: addresses,
      ...ADDRESS_GEO_NAME_COLUMNS,
      // ONE selection shape whether or not a distance was asked for: a
      // conditional selection would make the row type depend on a runtime flag,
      // and every consumer would have to narrow it. The literal costs nothing.
      distance: origin
        ? distanceTo(origin.longitude, origin.latitude)
        : sql<number | null>`null::double precision`,
    })
    .from(properties)
    .innerJoin(addresses, eq(properties.addressId, addresses.id))
    .leftJoin(cities, eq(addresses.cityId, cities.id))
    .leftJoin(regions, eq(addresses.regionId, regions.id))
    .leftJoin(countries, eq(addresses.countryId, countries.id))
    .leftJoin(neighborhoods, eq(addresses.neighborhoodId, neighborhoods.id))
    .where(options.where)
    .$dynamic();

  if (options.orderBy && options.orderBy.length > 0) query.orderBy(...options.orderBy);
  if (options.limit !== undefined) query.limit(options.limit);
  if (options.offset !== undefined) query.offset(options.offset);

  const rows = await query;
  const propertyIds = rows.map((row) => row.property.id);

  const [images, documents, windows] = await Promise.all([
    loadImages(propertyIds),
    loadDocuments(propertyIds),
    loadAvailabilityWindows(propertyIds),
  ]);

  return rows.map((row) => ({
    property: row.property,
    address: toAddressWithGeoNames(row),
    images: images.get(row.property.id) ?? [],
    documents: documents.get(row.property.id) ?? [],
    availabilityWindows: windows.get(row.property.id) ?? [],
    distance: row.distance ?? undefined,
  }));
}

/**
 * How many listings satisfy `where`.
 *
 * Joins `addresses` unconditionally so that a spatial or geo-id predicate is
 * countable by the same clause the page was selected with. The four geo-NAME
 * joins are not needed here — no predicate ever references a city/region name
 * directly, because `services/geoQueryService` resolves a name to an id before
 * the property query is built.
 */
export async function countProperties(where?: SQL): Promise<number> {
  const [row] = await getDb()
    .select({ total: count() })
    .from(properties)
    .innerJoin(addresses, eq(properties.addressId, addresses.id))
    .where(where);
  return row?.total ?? 0;
}

/** One listing by id, or `null`. Applies no visibility filter — the caller decides. */
export async function findPropertyById(id: string): Promise<HydratedProperty | null> {
  const [found] = await findProperties({ where: eq(properties.id, id), limit: 1 });
  return found ?? null;
}

/**
 * Combine predicates, ignoring the absent ones.
 *
 * Returns `undefined` for an empty list rather than an always-true clause, so a
 * caller can pass the result straight to `.where()` and get an unfiltered read.
 */
export function allOf(conditions: readonly (SQL | undefined)[]): SQL | undefined {
  const present = conditions.filter((condition): condition is SQL => condition !== undefined);
  if (present.length === 0) return undefined;
  return present.length === 1 ? present[0] : and(...present);
}

/**
 * The sort a discovery feed uses, with `has_images DESC` always in front.
 *
 * Callers pass the ordering they want WITHIN the image-bearing group; this
 * prepends the product rule so no feed can forget it, which is how the Mongo
 * code was written too — and there the prepending was duplicated in four places.
 */
export function propertyOrderBy(...within: SQL[]): SQL[] {
  return [sql`${properties.hasImages} desc`, ...within];
}

/**
 * `column DESC NULLS LAST` / `column ASC NULLS LAST` — see the module doc for
 * why both directions put NULLs last.
 */
export function nullsLast(column: SQLWrapper, direction: 'asc' | 'desc'): SQL {
  return direction === 'asc' ? sql`${column} asc nulls last` : sql`${column} desc nulls last`;
}

/** Newest first — the default ordering of every feed. */
export const NEWEST_FIRST = desc(properties.createdAt);
