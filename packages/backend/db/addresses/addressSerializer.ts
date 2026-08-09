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

/**
 * Serialize one address onto the wire.
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
export function serializeAddressRow(row: AddressWithGeoNames): Record<string, unknown> {
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

  return withoutAbsent({
    id: row.id,
    countryId: row.countryId,
    regionId: row.regionId,
    cityId: row.cityId,
    neighborhoodId: row.neighborhoodId,
    countryCode: row.countryCode,
    street: row.street,
    postal_code: row.postalCode,
    number: row.number,
    building_name: row.buildingName,
    block: row.block,
    entrance: row.entrance,
    floor: row.floor,
    unit: row.unit,
    subunit: row.subunit,
    district: row.district,
    address_lines: row.addressLines,
    po_box: row.poBox,
    reference: row.reference,
    land_plot: Object.keys(landPlot).length > 0 ? landPlot : undefined,
    extras: row.extras,
    coordinates: { type: 'Point', coordinates: [row.longitude, row.latitude] },
    addressLevel: row.addressLevel,
    normalizedKey: row.normalizedKey,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    cityName: row.cityName,
    regionName: row.regionName,
    countryName: row.countryName,
    neighborhoodName: row.neighborhoodName,
    location: location.length > 0 ? location : undefined,
  });
}
