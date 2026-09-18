/**
 * An address, its geo chain, and the ONE way both reach the wire.
 *
 * Administrative geo is relational: an address holds `country_id` / `region_id`
 * / `city_id` / `neighborhood_id`, and the human-readable names live once on the
 * geo rows. Every read that shows an address therefore needs the same four
 * joins and the same flattening, and there are now two such readers — the
 * address endpoints (`controllers/addressController`) and the property read path
 * (`db/properties/propertyReads`).
 *
 * Two readers is exactly when a shape starts drifting, so the selection, the
 * row mapping and the serialization live here rather than once per caller.
 *
 * ## What this replaced
 *
 * `services/propertyAddressSerializer.ts`, which had to serve TWO input shapes:
 * a joined Postgres row AND a Mongoose document whose `cityId` held either a
 * bare id or a populated `{ _id, name }` sub-document, depending on the query.
 * That file said the ref-reading half would die when the property read became a
 * join. It has, and it did — there is no longer any way to receive an address
 * whose geo reference might or might not be expanded, so there is nothing left
 * to detect.
 *
 * ## Why `leftJoin` on all four, including the three that are NOT NULL
 *
 * `neighborhood_id` is genuinely nullable. The other three are `NOT NULL` with
 * `ON DELETE RESTRICT` foreign keys, so an inner join could not drop a row —
 * but using the same join kind for all four means a reader does not have to work
 * out which is which, and a hypothetical missing parent yields a null NAME
 * rather than silently dropping the address (and, through it, its property) from
 * the result.
 */

import { eq, type InferSelectModel } from 'drizzle-orm';
import { PUBLIC_PRECISION_MAX_DECIMALS, type ListingAddressPrecision } from '@homiio/shared-types';

import { addresses, cities, countries, neighborhoods, regions } from '../schema';

export type AddressRow = InferSelectModel<typeof addresses>;

/** An address plus the display names of its geo chain. */
export interface AddressWithGeoNames extends AddressRow {
  cityName: string | null;
  regionName: string | null;
  countryName: string | null;
  countryCodeName: string | null;
  neighborhoodName: string | null;
}

/**
 * The geo-name half of a selection, to spread beside `address: addresses`.
 *
 * Shared rather than written per caller because these five keys ARE the
 * contract between the query and {@link toAddressWithGeoNames} — a caller that
 * spelled one differently would produce a row the mapper reads as `undefined`,
 * which serializes as an omitted name and looks exactly like an address with no
 * city.
 */
export const ADDRESS_GEO_NAME_COLUMNS = {
  cityName: cities.name,
  regionName: regions.name,
  countryName: countries.name,
  countryCodeName: countries.code,
  neighborhoodName: neighborhoods.name,
} as const;

/** The four joins {@link ADDRESS_GEO_NAME_COLUMNS} requires, as their conditions. */
export const ADDRESS_GEO_JOINS = [
  { table: cities, on: eq(addresses.cityId, cities.id) },
  { table: regions, on: eq(addresses.regionId, regions.id) },
  { table: countries, on: eq(addresses.countryId, countries.id) },
  { table: neighborhoods, on: eq(addresses.neighborhoodId, neighborhoods.id) },
] as const;

/** Row shape a query built from {@link ADDRESS_GEO_NAME_COLUMNS} returns. */
export interface AddressGeoNameRow {
  address: AddressRow;
  cityName: string | null;
  regionName: string | null;
  countryName: string | null;
  countryCodeName: string | null;
  neighborhoodName: string | null;
}

/** Flatten a joined row into {@link AddressWithGeoNames}. */
export function toAddressWithGeoNames(row: AddressGeoNameRow): AddressWithGeoNames {
  return {
    ...row.address,
    cityName: row.cityName,
    regionName: row.regionName,
    countryName: row.countryName,
    countryCodeName: row.countryCodeName,
    neighborhoodName: row.neighborhoodName,
  };
}

/** Drop keys whose value is null/undefined, matching Mongoose's omission of unset paths. */
function withoutAbsent(record: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (value !== null && value !== undefined) out[key] = value;
  }
  return out;
}

/** Round a coordinate to `decimals` places, as a number rather than a string. */
function roundCoordinate(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/**
 * The place id a reduced address may carry.
 *
 * `id` is not a neutral field: a UNIT row's id is the handle that names one
 * household, so publishing it beside a withheld unit hands the reader a key to
 * everything else filed against that flat. ADR 0001 §6.2 decides the shape — at
 * building precision the place id is the BUILDING's — and where no parent is
 * recorded there is no building id to give, so the key is absent.
 */
function publishedPlaceId(row: AddressWithGeoNames, precision: ListingAddressPrecision): string | undefined {
  if (precision === 'exact') return row.id;
  if (precision === 'building') {
    if (row.addressLevel !== 'UNIT') return row.id;
    return row.parentAddressId ?? undefined;
  }
  return row.addressLevel === 'STREET' ? row.id : undefined;
}

/**
 * A place id the CALLER already holds, published in place of the derived one.
 *
 * Two readers need it, and neither is a widening:
 *
 *  - `POST /api/addresses` answers the person who just submitted the address
 *    with the row it resolved to. The fields are still reduced — the resolver
 *    DEDUPES, so a matching row can carry a door label and a free-form
 *    reference the submitter never typed — but the id has to be the row's own
 *    or the caller cannot attach the listing or review they are in the middle
 *    of writing.
 *  - A review publishes at its own recorded `building_level_id` (ADR 0003
 *    §5.1), which is the authority for where that review is filed and is set
 *    even where `parent_address_id` is not.
 *
 * Anything else passes `undefined` and takes the ladder's answer.
 */
export type PublishedPlaceIdOverride = string | undefined;

/**
 * Serialize one address onto the wire, at a stated precision.
 *
 * `precision` has NO default, on purpose (ADR 0003 §4.1): whether a caller may
 * see a unit is a fact about the request, and a serializer that guessed it would
 * guess for every call site at once.
 *
 *  - `exact` — the whole row, exactly the body this function has always built.
 *  - `building` — street and number. ABSENT: `floor`, `unit`, `subunit`, and the
 *    free-form `address_lines` / `po_box` / `reference` / `extras` (tier R in
 *    ADR 0003 §2.1, because a portal or a person can type "3r 2a" into any of
 *    them), plus `normalizedKey`, a hash over `unit` that a short list of door
 *    labels inverts. Coordinates are rounded to the ladder's building decimals.
 *  - `street` — additionally withholds `number`, `building_name`, `block`,
 *    `entrance` and `land_plot`, and rounds to the street decimals.
 *
 * Withheld keys are ABSENT, never `null`: a `null` reads as "not recorded".
 *
 * The Mongo FIELD SPELLINGS are preserved deliberately: the schema declares them
 * camelCase in TypeScript and drizzle derives the identical snake_case SQL name
 * (`postalCode` → `postal_code`), so the column and the wire agree and nothing
 * in the frontend has to change. `land_plot` is re-nested from its three
 * flattened columns for the same reason, and is omitted entirely when all three
 * are absent — as Mongoose omitted an empty subdocument.
 *
 * `coordinates` is rebuilt as the GeoJSON `{ type: 'Point', coordinates: [lng,
 * lat] }` the wire has always carried, from the NAMED `longitude` / `latitude`
 * columns. That is the only place in the read path where the positional pair is
 * reconstructed, and it is written once, here — which is the point of naming the
 * columns in the first place.
 */
export function serializeAddressRow(
  row: AddressWithGeoNames,
  precision: ListingAddressPrecision,
  placeIdOverride: PublishedPlaceIdOverride = undefined,
): Record<string, unknown> {
  const landPlot = withoutAbsent({
    block: row.landPlotBlock,
    lot: row.landPlotLot,
    parcel: row.landPlotParcel,
  });

  // The display label every property card renders. Built from whichever of the
  // three names resolved, in the order a reader expects to see them.
  const location = [row.cityName, row.regionName, row.countryName]
    .filter((part): part is string => Boolean(part))
    .join(', ');

  const exact = precision === 'exact';
  const withNumber = precision !== 'street';
  const decimals = PUBLIC_PRECISION_MAX_DECIMALS[precision === 'street' ? 'street' : 'building'];
  const longitude = exact ? row.longitude : roundCoordinate(row.longitude, decimals);
  const latitude = exact ? row.latitude : roundCoordinate(row.latitude, decimals);
  // Kept apart: the LADDER's answer is what decides whether the row may
  // announce its own level, and an override says "the caller already holds this
  // id", never "this row is publishable at its own level".
  const derivedPlaceId = publishedPlaceId(row, precision);
  const placeId = placeIdOverride ?? derivedPlaceId;

  return withoutAbsent({
    id: placeId,
    countryId: row.countryId,
    regionId: row.regionId,
    cityId: row.cityId,
    neighborhoodId: row.neighborhoodId,
    countryCode: row.countryCode,
    street: row.street,
    postal_code: row.postalCode,
    number: withNumber ? row.number : undefined,
    building_name: withNumber ? row.buildingName : undefined,
    block: withNumber ? row.block : undefined,
    entrance: withNumber ? row.entrance : undefined,
    floor: exact ? row.floor : undefined,
    unit: exact ? row.unit : undefined,
    subunit: exact ? row.subunit : undefined,
    district: row.district,
    address_lines: exact ? row.addressLines : undefined,
    po_box: exact ? row.poBox : undefined,
    reference: exact ? row.reference : undefined,
    land_plot: withNumber && Object.keys(landPlot).length > 0 ? landPlot : undefined,
    extras: exact ? row.extras : undefined,
    coordinates: { type: 'Point', coordinates: [longitude, latitude] },
    // The level of the place `id` names. When the id was swapped for the
    // building's, or withheld, the row's own level would announce the unit.
    addressLevel: derivedPlaceId === row.id ? row.addressLevel : undefined,
    normalizedKey: exact ? row.normalizedKey : undefined,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    cityName: row.cityName,
    regionName: row.regionName,
    countryName: row.countryName,
    neighborhoodName: row.neighborhoodName,
    location: location.length > 0 ? location : undefined,
  });
}
