/**
 * Address Controller
 *
 * CRUD over `addresses`. Administrative geo is relational — an address
 * references country / region / city / neighborhood by id — so every read joins
 * the geo chain to resolve the display names in the SAME statement rather than
 * populating four refs.
 *
 * The wire format is unchanged (batch 10 owns the `_id` → `id` cut): each
 * address still serializes with BOTH ids, its `coordinates` still leave as a
 * GeoJSON `{ type: 'Point', coordinates: [lng, lat] }` pair even though the table
 * stores named `longitude` / `latitude` columns, and the Mongo field spellings
 * (`postal_code`, `building_name`, `address_lines`, `po_box`, `land_plot`) are
 * preserved because those are the names the frontend reads.
 */

import { Request, Response } from 'express';
import { count, desc, eq, ilike, or, type SQL } from 'drizzle-orm';

import { getDb } from '../db/postgres';
import { escapeLikePattern } from '../db/likePattern';
import { addresses } from '../db/schema';
import {
  findOrCreateCanonicalAddress,
  nearestAddressesQuery,
  selectAddressWithGeoNames,
  type AddressCanonicalInput,
  type AddressRow,
  type AddressWithGeoNames,
} from '../services/addressService';
import { getErrorName, getValidationMessages } from '../utils/errors';
import { logger as appLogger } from '../middlewares/logging';
import { attachAddressGeoNames, type SerializableAddress } from '../services/propertyAddressSerializer';
import { resolveCityId, resolveNeighborhoodId, resolveRegionId } from '../services/geoQueryService';

/**
 * Response helpers
 */
const ok = (res: Response, data: Record<string, unknown>) => res.status(200).json({ success: true, ...data });
const created = (res: Response, data: Record<string, unknown>) => res.status(201).json({ success: true, ...data });
const badRequest = (res: Response, data: Record<string, unknown>) => res.status(400).json({ success: false, ...data });
const notFound = (res: Response, data: Record<string, unknown>) => res.status(404).json({ success: false, ...data });
const serverError = (res: Response, data: Record<string, unknown>) => res.status(500).json({ success: false, ...data });

// Thin adapter onto the shared application logger so this controller logs
// through the same structured pipeline (stdout + file) as the rest of the
// backend, instead of writing to the console directly. An optional second
// argument (typically the caught error) is folded into the structured `meta`.
const logger = {
  info: (message: string, detail?: unknown): void =>
    appLogger.info(message, detail === undefined ? {} : { detail }),
  warn: (message: string, detail?: unknown): void =>
    appLogger.warn(message, detail === undefined ? {} : { detail }),
  error: (message: string, detail?: unknown): void =>
    appLogger.error(message, detail === undefined ? {} : { detail }),
};

/** Drop keys whose value is null/undefined, matching Mongoose's omission of unset paths. */
function withoutAbsent(record: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (value !== null && value !== undefined) out[key] = value;
  }
  return out;
}

/**
 * Serialize one address row onto the wire.
 *
 * The Mongo FIELD SPELLINGS are preserved deliberately: the schema declares them
 * camelCase in TypeScript and drizzle derives the identical snake_case SQL name
 * (`postalCode` → `postal_code`), so the column and the wire agree and nothing
 * in the frontend has to change with this batch. `land_plot` is re-nested from
 * its three flattened columns for the same reason, and is omitted entirely when
 * all three are absent — as Mongoose omitted an empty subdocument.
 */
function serializeAddress(row: AddressRow | AddressWithGeoNames): Record<string, unknown> {
  const geo = row as Partial<AddressWithGeoNames>;
  const landPlot = withoutAbsent({
    block: row.landPlotBlock,
    lot: row.landPlotLot,
    parcel: row.landPlotParcel,
  });

  const serialized = withoutAbsent({
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
    cityName: geo.cityName,
    regionName: geo.regionName,
    countryName: geo.countryName,
    neighborhoodName: geo.neighborhoodName,
  }) as SerializableAddress & Record<string, unknown>;

  // `attachAddressGeoNames` derives the `location` label from the names above;
  // it is the one place that rule lives, shared with the property read path.
  attachAddressGeoNames(serialized);
  return { _id: row.id, id: row.id, ...serialized };
}

/**
 * Get address by ID
 * GET /api/addresses/:id
 */
export const getAddressById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    // No id-SHAPE guard. A `text` primary key takes any string, so a nonsense id
    // simply matches no row and 404s — which is what the old
    // `Types.ObjectId.isValid` 400 was standing in for, and unlike that guard it
    // stays correct for every id shape (see `db/MIGRATION-CONTRACT.md`).
    const rows = await selectAddressWithGeoNames({ where: eq(addresses.id, id), limit: 1 });
    if (!rows[0]) {
      return notFound(res, { message: 'Address not found' });
    }

    return ok(res, { address: serializeAddress(rows[0]) });
  } catch (error) {
    logger.error('Error fetching address:', error);
    return serverError(res, { message: 'Failed to fetch address' });
  }
};

/**
 * Search addresses
 * GET /api/addresses/search
 */
export const searchAddresses = async (req: Request, res: Response) => {
  try {
    const { query, limit = 10, page = 1 } = req.query;

    if (!query) {
      return badRequest(res, { message: 'Search query is required' });
    }

    const skip = (Number(page) - 1) * Number(limit);
    const term = String(query);

    // Geo is relational, so the term is resolved against the canonical
    // city/region/neighborhood rows — but the SCOPE it produces is three foreign
    // keys ON `addresses`, which is the table being searched. So this resolves
    // three ids and ORs three ordinary predicates; it deliberately does NOT go
    // through `resolveGeoFilterAddressIds`, which exists to hand an address-id
    // list to a Mongo PROPERTY query. Materialising an entire city's addresses
    // only to match them against their own table buys nothing and costs a scan.
    const [cityId, regionId, neighborhoodId] = await Promise.all([
      resolveCityId(term),
      resolveRegionId(term),
      resolveNeighborhoodId(term),
    ]);

    // `{ street: { $regex: query, $options: 'i' } }` is an unanchored substring
    // match; `ILIKE '%…%'` is its port, and the term is escaped because `%` and
    // `_` are LIKE metacharacters. Without the escape a user typing `100%` would
    // silently match every street.
    const streetMatch = ilike(addresses.street, `%${escapeLikePattern(term)}%`);

    // An OR, and that is load-bearing: a row that matched only on `street` must
    // survive. Nothing here may become a join for the same reason — an inner
    // join to `cities` would silently drop every street-only match.
    const geoMatches: SQL[] = [];
    if (cityId) geoMatches.push(eq(addresses.cityId, cityId));
    if (regionId) geoMatches.push(eq(addresses.regionId, regionId));
    if (neighborhoodId) geoMatches.push(eq(addresses.neighborhoodId, neighborhoodId));
    const where: SQL = or(streetMatch, ...geoMatches) ?? streetMatch;

    const [rows, totals] = await Promise.all([
      selectAddressWithGeoNames({
        where,
        limit: Number(limit),
        offset: skip,
        // `created_at` is NOT NULL, so Postgres' NULLS FIRST on a DESC order and
        // Mongo's missing-first cannot disagree here.
        orderBy: desc(addresses.createdAt),
      }),
      getDb().select({ total: count() }).from(addresses).where(where),
    ]);
    const totalCount = totals[0]?.total ?? 0;

    return ok(res, {
      addresses: rows.map(serializeAddress),
      pagination: {
        currentPage: Number(page),
        totalPages: Math.ceil(totalCount / Number(limit)),
        totalItems: totalCount,
        hasNextPage: skip + rows.length < totalCount,
        hasPrevPage: Number(page) > 1
      }
    });
  } catch (error) {
    logger.error('Error searching addresses:', error);
    return serverError(res, { message: 'Failed to search addresses' });
  }
};

/**
 * Create a new address
 * POST /api/addresses
 */
export const createAddress = async (req: Request, res: Response) => {
  try {
    const addressData = req.body as AddressCanonicalInput;

    // Validate required fields
    if (!addressData.street || !addressData.city || !addressData.country) {
      return badRequest(res, {
        message: 'Street, city, and country are required'
      });
    }
    if (!addressData.coordinates?.coordinates) {
      return badRequest(res, { message: 'Coordinates are required to resolve the address location' });
    }

    // Geo is relational: `findOrCreateCanonicalAddress` resolves the country/
    // region/city/neighborhood id chain from the coordinates/place names and
    // dedupes the building. City/state/country NAMES are inputs only — never
    // persisted.
    const address = await findOrCreateCanonicalAddress(addressData);

    logger.info(`Address resolved: ${address.id}`);
    return created(res, { address: serializeAddress(address) });
  } catch (error) {
    logger.error('Error creating address:', error);
    if (getErrorName(error) === 'ValidationError') {
      return badRequest(res, {
        message: 'Validation error',
        errors: getValidationMessages(error)
      });
    }
    return serverError(res, { message: 'Failed to create address' });
  }
};

/**
 * The BUILDING-level columns this endpoint may write.
 *
 * An explicit allowlist rather than a delete-list: geo is resolved at creation
 * time and must not be mutated here, and `req.body` is never spread into an
 * update (`AGENTS.md` §Ownership). `normalized_key` is deliberately absent —
 * it is derived from these fields and rewritten below.
 */
const EDITABLE_ADDRESS_FIELDS = [
  'street',
  'number',
  'building_name',
  'block',
  'entrance',
  'floor',
  'unit',
  'subunit',
  'district',
  'po_box',
  'reference',
] as const;

/** Wire field name → the drizzle column it writes. */
const EDITABLE_ADDRESS_COLUMNS = {
  street: 'street',
  number: 'number',
  building_name: 'buildingName',
  block: 'block',
  entrance: 'entrance',
  floor: 'floor',
  unit: 'unit',
  subunit: 'subunit',
  district: 'district',
  po_box: 'poBox',
  reference: 'reference',
} as const satisfies Record<(typeof EDITABLE_ADDRESS_FIELDS)[number], keyof AddressRow>;

/**
 * Update an address
 * PUT /api/addresses/:id
 */
export const updateAddress = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const body = req.body as Record<string, unknown>;

    const patch: Record<string, string | null> = {};
    for (const field of EDITABLE_ADDRESS_FIELDS) {
      if (!(field in body)) continue;
      const value = body[field];
      if (value === null || value === undefined) {
        patch[EDITABLE_ADDRESS_COLUMNS[field]] = null;
      } else if (typeof value === 'string') {
        patch[EDITABLE_ADDRESS_COLUMNS[field]] = value;
      }
    }

    if (Object.keys(patch).length === 0) {
      const unchanged = await selectAddressWithGeoNames({ where: eq(addresses.id, id), limit: 1 });
      if (!unchanged[0]) return notFound(res, { message: 'Address not found' });
      return ok(res, { address: serializeAddress(unchanged[0]) });
    }

    // `street` is NOT NULL — clearing it would fail the constraint rather than
    // quietly storing an unusable address, so refuse it up front with the same
    // 400 the Mongoose validator produced.
    if (patch.street === null) {
      return badRequest(res, { message: 'Validation error', errors: ['Street address is required'] });
    }

    const updated = await getDb()
      .update(addresses)
      .set(patch)
      .where(eq(addresses.id, id))
      .returning({ id: addresses.id });
    if (!updated[0]) {
      return notFound(res, { message: 'Address not found' });
    }

    const rows = await selectAddressWithGeoNames({ where: eq(addresses.id, id), limit: 1 });
    logger.info(`Address ${id} updated`);
    return ok(res, { address: serializeAddress(rows[0]) });
  } catch (error) {
    logger.error('Error updating address:', error);
    if (getErrorName(error) === 'ValidationError') {
      return badRequest(res, {
        message: 'Validation error',
        errors: getValidationMessages(error)
      });
    }
    return serverError(res, { message: 'Failed to update address' });
  }
};

/**
 * Delete an address
 * DELETE /api/addresses/:id
 */
export const deleteAddress = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const deleted = await getDb()
      .delete(addresses)
      .where(eq(addresses.id, id))
      .returning({ id: addresses.id });
    if (!deleted[0]) {
      return notFound(res, { message: 'Address not found' });
    }

    logger.info(`Address ${id} deleted`);
    return ok(res, { message: 'Address deleted successfully' });
  } catch (error) {
    logger.error('Error deleting address:', error);
    return serverError(res, { message: 'Failed to delete address' });
  }
};

/**
 * Get addresses near a location
 * GET /api/addresses/nearby
 */
export const getNearbyAddresses = async (req: Request, res: Response) => {
  try {
    const { lat, lng, radius = 1000, limit = 20 } = req.query;

    if (!lat || !lng) {
      return badRequest(res, { message: 'Latitude and longitude are required' });
    }

    const latitude = parseFloat(lat as string);
    const longitude = parseFloat(lng as string);
    const radiusInMeters = parseInt(radius as string);

    if (isNaN(latitude) || isNaN(longitude)) {
      return badRequest(res, { message: 'Invalid coordinates' });
    }

    const nearest = nearestAddressesQuery({ longitude, latitude, radiusMeters: radiusInMeters });
    const rows = await selectAddressWithGeoNames({
      where: nearest.where,
      orderBy: nearest.orderBy,
      limit: Number(limit),
    });

    return ok(res, { addresses: rows.map(serializeAddress) });
  } catch (error) {
    logger.error('Error finding nearby addresses:', error);
    return serverError(res, { message: 'Failed to find nearby addresses' });
  }
};
