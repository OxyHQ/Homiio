/**
 * Address Service — the Postgres port of `models/Address.ts`'s statics
 *
 * A BUILDING-level record. Administrative geo is NOT free text: an address
 * references `countries` / `regions` / `cities` / `neighborhoods` by id
 * (`geoResolutionService` resolves the chain) and the only denormalized geo
 * field is `country_code`.
 *
 * ## What did NOT need porting, because the schema absorbed it
 *
 * Three of the Mongoose model's members have no counterpart here, and their
 * absence is the point rather than an omission:
 *
 *  - **`getAddressLevel()`** is now `addresses.address_level`, a
 *    `GENERATED ALWAYS … STORED` column. A method is bypassable — every one of
 *    this package's `.lean()` reads skipped it — and the whole street → building
 *    → unit review hierarchy is built on the answer. As a generated column no
 *    write path can produce a row whose level disagrees with its fields.
 *  - **`setLocation()` / `getCoordinates()`** existed to hide Mongo's positional
 *    `coordinates: [lng, lat]` array behind named arguments. The table has NAMED
 *    `longitude` / `latitude` columns and generates the PostGIS point from them,
 *    so reading or writing a coordinate is now an ordinary column read or
 *    `update`, and an accessor pair would be Mongo baggage wearing a helper's
 *    clothes.
 *
 * `createStreetLevel()` / `createBuildingLevel()` / `createUnitLevel()` have a
 * single consumer — `reviewController`, which builds the street/building/unit
 * hierarchy — and `reviews` does not exist in Postgres yet. They land with that
 * table (batch 6) rather than as an unused API here.
 *
 * ## `models/Address.ts` and `geoResolutionService.ts` are deliberately still alive
 *
 * Six call sites still write addresses through the Mongoose model
 * (`property/create`, `property/updateDelete`, `roomController`,
 * `reviewController`, `scraperService`, `IngestionService`). Every one of them
 * writes a Mongo `Property`, `Room` or `Review` in the same breath, and those
 * tables do not exist yet.
 *
 * The blocker is not style, it is one column: `resolveGeoChain` returns a
 * `cities.id` minted by Postgres, which is a **uuid v7**, and
 * `AddressSchema.cityId` is a Mongoose `ObjectId` path. Pointing the Mongo model
 * at this module does not degrade the ingest, it stops it dead with
 * `Cast to ObjectId failed for value "019fd591-…"` — measured while writing this
 * batch, not predicted. So the Mongo chain stays where it is and both halves
 * move together with `properties` in batch 3; `models/Address.ts` and
 * `services/geoResolutionService.ts` are deleted there.
 *
 * `POST /api/addresses` is the one write path that goes through THIS module
 * today, which is what keeps it exercised rather than speculative.
 */

import * as crypto from 'crypto';
import { and, eq, sql, type SQL } from 'drizzle-orm';

import { getDb } from '../db/postgres';
import { addresses, cities, countries, neighborhoods, regions } from '../db/schema';
import {
  ADDRESS_GEO_NAME_COLUMNS,
  toAddressWithGeoNames,
  type AddressRow,
  type AddressWithGeoNames,
} from '../db/addresses/addressSerializer';
import { countryCodeToName, countryNameToCode, defaultCurrencyForCountry } from '../utils/countryData';
import { sanitizeGeoJsonCoordinates } from '../utils/geoCoordinates';
import { forwardGeocode, reverseGeocode, type AddressData } from './geocodingService';
import { GeoResolutionError, type GeoNames } from './geoResolutionService';

/** Resolved geo id chain — the ids an `addresses` row stores. */
export interface ResolvedGeo {
  countryId: string;
  regionId: string;
  cityId: string;
  neighborhoodId?: string;
  /** ISO-2 country code, denormalized onto the address for fast filtering. */
  countryCode: string;
}

/** Placeholder name for a missing administrative level, kept stable so the
 *  fallback row is reused rather than duplicated. */
const UNKNOWN_REGION = 'Unknown';

/**
 * Two coordinates are "the same building" below this many degrees of drift.
 *
 * Carried over verbatim from the Mongoose static: re-resolving the same
 * building from a slightly different geocode must not rewrite its point on every
 * ingest, but a genuine correction must land. ~0.0005° is ~55 m of latitude.
 */
const COORDINATE_DRIFT_EPSILON = 0.0005;

/**
 * Input accepted by {@link findOrCreateCanonicalAddress}: building fields,
 * coordinates and place NAMES (resolved to ids — never persisted as text) plus
 * the legacy aliases portals send.
 */
export interface AddressCanonicalInput extends GeoNames {
  street: string;
  postal_code?: string;
  number?: string;
  building_name?: string;
  block?: string;
  entrance?: string;
  floor?: string;
  unit?: string;
  subunit?: string;
  district?: string;
  address_lines?: string[];
  po_box?: string;
  reference?: string;
  land_plot?: { block?: string; lot?: string; parcel?: string };
  extras?: Record<string, unknown>;
  coordinates?: { type?: string; coordinates: [number, number] };
  // Building-level aliases
  zipCode?: string;
  zip?: string;
  postcode?: string;
  codigo_postal?: string;
  puerta?: string;
  apartment?: string;
  suite?: string;
  apt?: string;
  piso?: string;
  bloque?: string;
  torre?: string;
  tower?: string;
  building?: string;
  planta?: string;
  nivel?: string;
  level?: string;
  line1?: string;
  line2?: string;
}

/**
 * Normalize building-level field aliases. Geo NAMES (city/state/country/
 * neighborhood) are left untouched here — they are consumed by `resolveGeo` to
 * derive ids and are never written to the row.
 */
export function normalizeAddressAliases(input: AddressCanonicalInput): AddressCanonicalInput {
  const normalized: AddressCanonicalInput = { ...input };

  if (input.puerta) normalized.unit = input.puerta;
  if (input.apartment) normalized.unit = input.apartment;
  if (input.suite) normalized.unit = input.suite;
  if (input.apt) normalized.unit = input.apt;
  if (input.piso) normalized.unit = input.piso;

  if (input.bloque) normalized.block = input.bloque;
  if (input.torre) normalized.block = input.torre;
  if (input.tower) normalized.block = input.tower;
  if (input.building) normalized.block = input.building;

  if (input.planta) normalized.floor = input.planta;
  if (input.nivel) normalized.floor = input.nivel;
  if (input.level) normalized.floor = input.level;

  if (input.line1) {
    normalized.address_lines = normalized.address_lines || [];
    normalized.address_lines[0] = input.line1;
  }
  if (input.line2) {
    normalized.address_lines = normalized.address_lines || [];
    normalized.address_lines[1] = input.line2;
  }

  if (input.zipCode) normalized.postal_code = input.zipCode;
  if (input.zip) normalized.postal_code = input.zip;
  if (input.postcode) normalized.postal_code = input.postcode;
  if (input.codigo_postal) normalized.postal_code = input.codigo_postal;

  return normalized;
}

// ── The geo upsert chain ──
//
// Country → Region → City → (Neighborhood), keyed on exactly the columns the
// unique indexes enforce, so re-resolving a place returns the SAME ids and
// creates no duplicate row.
//
// Each upsert is SELECT → INSERT … ON CONFLICT DO NOTHING → SELECT, and the
// order is deliberate. Mongo's `findOneAndUpdate({ $setOnInsert }, { upsert })`
// is insert-only-if-absent — it NEVER overwrites — and `on conflict do nothing`
// is its faithful form, but that returns no row when it conflicts, so the id has
// to be read separately. Leading with the SELECT makes the common case (the
// place already exists) one indexed lookup and no write at all; the trailing
// SELECT is the branch a concurrent inserter takes.

async function upsertCountry(code: string, name: string): Promise<string> {
  const db = getDb();
  const existing = await db.select({ id: countries.id }).from(countries).where(eq(countries.code, code)).limit(1);
  if (existing[0]) return existing[0].id;

  const inserted = await db
    .insert(countries)
    .values({ code, name, currency: defaultCurrencyForCountry(code), isActive: true })
    .onConflictDoNothing({ target: countries.code })
    .returning({ id: countries.id });
  if (inserted[0]) return inserted[0].id;

  const raced = await db.select({ id: countries.id }).from(countries).where(eq(countries.code, code)).limit(1);
  if (!raced[0]) throw new GeoResolutionError(`Country ${code} could not be resolved after an insert conflict`);
  return raced[0].id;
}

async function upsertRegion(countryId: string, name: string): Promise<string> {
  const db = getDb();
  const match = and(eq(regions.countryId, countryId), eq(regions.name, name));

  const existing = await db.select({ id: regions.id }).from(regions).where(match).limit(1);
  if (existing[0]) return existing[0].id;

  const inserted = await db
    .insert(regions)
    .values({ countryId, name, isActive: true })
    .onConflictDoNothing({ target: [regions.countryId, regions.name] })
    .returning({ id: regions.id });
  if (inserted[0]) return inserted[0].id;

  const raced = await db.select({ id: regions.id }).from(regions).where(match).limit(1);
  if (!raced[0]) throw new GeoResolutionError(`Region ${name} could not be resolved after an insert conflict`);
  return raced[0].id;
}

async function upsertCity(
  regionId: string,
  countryId: string,
  name: string,
  countryCode: string,
  coordinates?: [number, number],
): Promise<string> {
  const db = getDb();
  const match = and(eq(cities.regionId, regionId), eq(cities.name, name));

  const existing = await db.select({ id: cities.id }).from(cities).where(match).limit(1);
  if (existing[0]) return existing[0].id;

  // Mongo stored the centre point as `{ lat, lng }`; the table has NAMED
  // columns, so the pair cannot be transposed by position on the way in.
  const sanitized = coordinates ? sanitizeGeoJsonCoordinates(coordinates) : null;
  const inserted = await db
    .insert(cities)
    .values({
      regionId,
      countryId,
      name,
      currency: defaultCurrencyForCountry(countryCode),
      isActive: true,
      longitude: sanitized ? sanitized[0] : null,
      latitude: sanitized ? sanitized[1] : null,
    })
    .onConflictDoNothing({ target: [cities.regionId, cities.name] })
    .returning({ id: cities.id });
  if (inserted[0]) return inserted[0].id;

  const raced = await db.select({ id: cities.id }).from(cities).where(match).limit(1);
  if (!raced[0]) throw new GeoResolutionError(`City ${name} could not be resolved after an insert conflict`);
  return raced[0].id;
}

async function upsertNeighborhood(cityId: string, name: string, centroid?: [number, number]): Promise<string> {
  const db = getDb();
  const match = and(eq(neighborhoods.cityId, cityId), eq(neighborhoods.name, name));

  const existing = await db.select({ id: neighborhoods.id }).from(neighborhoods).where(match).limit(1);
  if (existing[0]) return existing[0].id;

  const sanitized = centroid ? sanitizeGeoJsonCoordinates(centroid) : null;
  const inserted = await db
    .insert(neighborhoods)
    .values({
      cityId,
      name,
      isActive: true,
      longitude: sanitized ? sanitized[0] : null,
      latitude: sanitized ? sanitized[1] : null,
    })
    .onConflictDoNothing({ target: [neighborhoods.cityId, neighborhoods.name] })
    .returning({ id: neighborhoods.id });
  if (inserted[0]) return inserted[0].id;

  const raced = await db.select({ id: neighborhoods.id }).from(neighborhoods).where(match).limit(1);
  if (!raced[0]) throw new GeoResolutionError(`Neighborhood ${name} could not be resolved after an insert conflict`);
  return raced[0].id;
}

/** True once a name set has every field needed to skip the geocoder. */
function namesAreComplete(names: GeoNames | undefined): boolean {
  if (!names) return false;
  return Boolean(names.city && names.state && (names.countryCode || names.country));
}

/** Merge geocoder output into caller-supplied names (caller wins). */
function mergeNames(provided: GeoNames | undefined, geocoded: AddressData | undefined): GeoNames {
  return {
    city: provided?.city || geocoded?.city || undefined,
    state: provided?.state || geocoded?.state || undefined,
    country: provided?.country || geocoded?.country || undefined,
    countryCode: provided?.countryCode || undefined,
    neighborhood: provided?.neighborhood || geocoded?.neighborhood || undefined,
  };
}

/** Resolve an ISO-2 country code + canonical country name from the merged names. */
function resolveCountryCodeAndName(names: GeoNames): { code: string; name: string } {
  const explicitCode = names.countryCode?.trim().toUpperCase();
  if (explicitCode && /^[A-Z]{2}$/.test(explicitCode)) {
    return { code: explicitCode, name: names.country?.trim() || countryCodeToName(explicitCode) || explicitCode };
  }
  const fromName = names.country ? countryNameToCode(names.country) : undefined;
  if (fromName) {
    return { code: fromName, name: names.country?.trim() || countryCodeToName(fromName) || fromName };
  }
  throw new GeoResolutionError('Unable to resolve a country (no countryCode and unrecognised country name)');
}

/**
 * Resolve the canonical geo id chain for a place, upserting any missing
 * country/region/city/neighborhood row. The geocoder is consulted at most once,
 * and only when the caller's names are incomplete.
 *
 * There is deliberately NO in-memory resolution cache here, unlike the Mongo
 * implementation this ports. That cache exists for the INGEST burst — hundreds
 * of listings in one city — and ingest is still Mongo (batch 3). Carrying an
 * empty cache across would be machinery for a load nothing currently applies,
 * and a cache that can hand back an id for a deleted row is not free.
 *
 * @throws GeoResolutionError when neither names nor coordinates yield a city.
 */
export async function resolveGeoChain(input: {
  coordinates?: [number, number];
  names?: GeoNames;
}): Promise<ResolvedGeo> {
  let names = input.names;
  if (!namesAreComplete(names) && input.coordinates) {
    const [lng, lat] = input.coordinates;
    const geocoded = await reverseGeocode(lng, lat);
    names = mergeNames(names, geocoded.success ? geocoded.data : undefined);
  } else if (!namesAreComplete(names) && names?.city) {
    const query = [names.city, names.state, names.country].filter(Boolean).join(', ');
    const geocoded = await forwardGeocode(query);
    names = mergeNames(names, geocoded.success ? geocoded.data : undefined);
  }

  if (!names?.city) {
    throw new GeoResolutionError('Unable to resolve a city for the provided coordinates/names');
  }

  const { code: countryCode, name: countryName } = resolveCountryCodeAndName(names);
  const countryId = await upsertCountry(countryCode, countryName);
  // Fall back to a stable placeholder so the chain is always whole — the three
  // parent references on `addresses` are NOT NULL.
  const regionId = await upsertRegion(countryId, names.state?.trim() || UNKNOWN_REGION);
  const cityId = await upsertCity(regionId, countryId, names.city.trim(), countryCode, input.coordinates);

  let neighborhoodId: string | undefined;
  if (names.neighborhood?.trim()) {
    neighborhoodId = await upsertNeighborhood(cityId, names.neighborhood.trim(), input.coordinates);
  }

  return { countryId, regionId, cityId, neighborhoodId, countryCode };
}

/** The fields {@link computeAddressNormalizedKey} hashes, in order. */
export interface NormalizedKeyFields {
  street?: string;
  number?: string;
  unit?: string;
  buildingName?: string;
  block?: string;
  postalCode?: string;
  cityId?: string;
  countryCode?: string;
}

/**
 * The deterministic dedup key for a building: sha1 over the normalized building
 * fields plus the resolved `cityId` and `countryCode` (geo is relational, so the
 * city ID — not a free-text city string — anchors the building to its place).
 *
 * **Byte-for-byte identical to the Mongoose method**, field order and all, and
 * it must stay that way: `addresses.normalized_key` is copied VERBATIM by the
 * backfill and never recomputed, so a change here would silently stop matching
 * every key already stored and re-create every building on its next ingest. The
 * hash input has already changed shape once (`cityId` was added).
 */
export function computeAddressNormalizedKey(fields: NormalizedKeyFields): string {
  const keyFields = [
    fields.street?.toLowerCase().trim(),
    fields.number?.toLowerCase().trim(),
    fields.unit?.toLowerCase().trim(),
    fields.buildingName?.toLowerCase().trim(),
    fields.block?.toLowerCase().trim(),
    fields.postalCode?.toLowerCase().trim(),
    fields.cityId ? String(fields.cityId) : undefined,
    fields.countryCode?.toUpperCase(),
  ].filter((field): field is string => Boolean(field && field.length > 0));

  return crypto.createHash('sha1').update(keyFields.join('|')).digest('hex');
}

/** The `addresses` row shape every read in this module returns. */
// `AddressRow` and `AddressWithGeoNames` are defined in
// `db/addresses/addressSerializer` — the module that also owns the geo-name
// join columns and the wire shape — so the query, the row type and the
// serialization cannot drift apart. Imported at the top of this file.

/**
 * Find or create a canonical building-level address. Resolves the geo id chain
 * (country/region/city/neighborhood) from coordinates — falling back to the
 * provided place names — via `resolveGeo`, then dedupes the building by its
 * normalized key.
 *
 * @throws {Error} When no coordinates were supplied. The table's `longitude` /
 *   `latitude` are NOT NULL and its point is generated from them, so an address
 *   without a location is not a degraded address, it is an unrepresentable one.
 */
export async function findOrCreateCanonicalAddress(input: AddressCanonicalInput): Promise<AddressRow> {
  const normalized = normalizeAddressAliases(input);
  const coordinates = normalized.coordinates?.coordinates;
  if (!coordinates) {
    throw new Error('Coordinates are required for address creation');
  }
  const [longitude, latitude] = coordinates;

  const resolved = await resolveGeoChain({
    coordinates,
    names: {
      city: normalized.city,
      state: normalized.state,
      country: normalized.country,
      countryCode: normalized.countryCode,
      neighborhood: normalized.neighborhood,
    },
  });

  const normalizedKey = computeAddressNormalizedKey({
    street: normalized.street,
    number: normalized.number,
    unit: normalized.unit,
    buildingName: normalized.building_name,
    block: normalized.block,
    postalCode: normalized.postal_code,
    cityId: resolved.cityId,
    countryCode: resolved.countryCode,
  });

  const db = getDb();
  const existing = await db
    .select()
    .from(addresses)
    .where(eq(addresses.normalizedKey, normalizedKey))
    .limit(1);

  if (existing[0]) {
    const row = existing[0];
    const drifted =
      Math.abs(row.longitude - longitude) > COORDINATE_DRIFT_EPSILON ||
      Math.abs(row.latitude - latitude) > COORDINATE_DRIFT_EPSILON;
    if (!drifted) return row;
    const [moved] = await db
      .update(addresses)
      .set({ longitude, latitude })
      .where(eq(addresses.id, row.id))
      .returning();
    return moved;
  }

  const inserted = await db
    .insert(addresses)
    .values({
      countryId: resolved.countryId,
      regionId: resolved.regionId,
      cityId: resolved.cityId,
      neighborhoodId: resolved.neighborhoodId ?? null,
      countryCode: resolved.countryCode,
      street: normalized.street,
      // Mongoose declared `postal_code` required and callers rely on that, but
      // the aliases above can leave it unset; `''` would be a VALUE under the
      // NOT NULL column and reads identically to a real empty postcode, which is
      // what the source stored, so it is carried across unchanged.
      postalCode: normalized.postal_code ?? '',
      number: normalized.number ?? null,
      buildingName: normalized.building_name ?? null,
      block: normalized.block ?? null,
      entrance: normalized.entrance ?? null,
      floor: normalized.floor ?? null,
      unit: normalized.unit ?? null,
      subunit: normalized.subunit ?? null,
      district: normalized.district ?? null,
      addressLines: normalized.address_lines ?? [],
      poBox: normalized.po_box ?? null,
      reference: normalized.reference ?? null,
      landPlotBlock: normalized.land_plot?.block ?? null,
      landPlotLot: normalized.land_plot?.lot ?? null,
      landPlotParcel: normalized.land_plot?.parcel ?? null,
      extras: normalized.extras ?? {},
      longitude,
      latitude,
      normalizedKey,
    })
    // A concurrent ingest of the same building loses the race here rather than
    // raising 23505: the winner's row is then read back below, which is the same
    // answer `findOne(normalizedKey)` would have given a moment later.
    //
    // `where` is NOT optional here and it is not a row filter — it is the index
    // PREDICATE. `addresses_normalized_key_key` is a PARTIAL unique index
    // (`where normalized_key is not null`, the port of Mongo's `sparse: true`),
    // and Postgres will not infer a partial index from its columns alone: without
    // the matching predicate the statement fails outright with "there is no
    // unique or exclusion constraint matching the ON CONFLICT specification".
    .onConflictDoNothing({
      target: addresses.normalizedKey,
      where: sql`${addresses.normalizedKey} is not null`,
    })
    .returning();
  if (inserted[0]) return inserted[0];

  const raced = await db
    .select()
    .from(addresses)
    .where(eq(addresses.normalizedKey, normalizedKey))
    .limit(1);
  if (!raced[0]) {
    throw new Error(`Address ${normalizedKey} could not be resolved after an insert conflict`);
  }
  return raced[0];
}

/**
 * Read addresses with their geo display names resolved in the SAME statement.
 *
 * This is what replaced the two-level `populate([{ path: 'cityId' }, …])` spec
 * the address reads used: the names live once on the geo rows and a join is how
 * a relational store fetches them, so there is no N+1 to avoid and no
 * "populated or not" state for a serializer to detect.
 *
 * `leftJoin` throughout: `neighborhood_id` is genuinely nullable, and using the
 * same join kind for all four means a hypothetical missing parent yields a null
 * NAME rather than dropping the address from the result entirely.
 */
export async function selectAddressWithGeoNames(options: {
  where: SQL;
  limit?: number;
  offset?: number;
  orderBy?: SQL;
}): Promise<AddressWithGeoNames[]> {
  const base = getDb()
    .select({ address: addresses, ...ADDRESS_GEO_NAME_COLUMNS })
    .from(addresses)
    .leftJoin(cities, eq(addresses.cityId, cities.id))
    .leftJoin(regions, eq(addresses.regionId, regions.id))
    .leftJoin(countries, eq(addresses.countryId, countries.id))
    .leftJoin(neighborhoods, eq(addresses.neighborhoodId, neighborhoods.id))
    .where(options.where)
    .$dynamic();

  if (options.orderBy) base.orderBy(options.orderBy);
  if (options.limit !== undefined) base.limit(options.limit);
  if (options.offset !== undefined) base.offset(options.offset);

  const rows = await base;
  return rows.map(toAddressWithGeoNames);
}

/**
 * Addresses within `radiusMeters` of a point, nearest first.
 *
 * `ST_DWithin` in the predicate + the KNN `<->` operator in the ORDER BY is the
 * port of Mongo's `$near` + `$maxDistance`, and the pairing is not
 * interchangeable with the obvious spelling: `ST_Distance(geo, p) < r` in a
 * WHERE clause cannot use the GiST index and degrades to a sequential scan over
 * every address on the planet. `ST_DWithin` is index-backed, and `<->` on
 * `geography` gives the true spheroid ordering.
 *
 * `withNeighborhood` narrows to addresses that actually resolved a
 * neighborhood — the `{ neighborhoodId: { $ne: null } }` half of the
 * `by-location` lookup.
 */
export function nearestAddressesQuery(options: {
  longitude: number;
  latitude: number;
  radiusMeters: number;
  withNeighborhood?: boolean;
}): { where: SQL; orderBy: SQL } {
  const point = sql`ST_MakePoint(${options.longitude}, ${options.latitude})::geography`;
  const within = sql`ST_DWithin(${addresses.geo}, ${point}, ${options.radiusMeters})`;
  return {
    where: options.withNeighborhood
      ? sql`${within} and ${addresses.neighborhoodId} is not null`
      : within,
    orderBy: sql`${addresses.geo} <-> ${point}`,
  };
}
