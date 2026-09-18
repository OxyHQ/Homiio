/**
 * Address Controller
 *
 * CRUD over `addresses`. Administrative geo is relational — an address
 * references country / region / city / neighborhood by id — so every read joins
 * the geo chain to resolve the display names in the SAME statement rather than
 * populating four refs.
 *
 * Each address serializes with ONE id, `id` — these responses used to carry
 * `_id` beside it and no longer do. Its `coordinates` still leave as a
 * GeoJSON `{ type: 'Point', coordinates: [lng, lat] }` pair even though the table
 * stores named `longitude` / `latitude` columns, and the Mongo field spellings
 * (`postal_code`, `building_name`, `address_lines`, `po_box`, `land_plot`) are
 * preserved because those are the names the frontend reads.
 *
 * ## What each caller is served (ADR 0003 §3, F1)
 *
 * These endpoints publish `building` — street, number, the geo chain, a
 * coordinate rounded to the ladder's building decimals — and withhold the
 * dwelling inside it: `floor`, `unit`, `subunit`, the free-form
 * `address_lines` / `po_box` / `reference` / `extras`, the unit-keyed
 * `normalizedKey`, and a UNIT row's own id, which is replaced by its building's
 * or absent. The detail read escalates to `exact` for a caller with a RECORDED
 * relation to the place; `db/addresses/addressAudience.ts` decides which
 * relations those are and why the list reads never escalate at all.
 */

import { Request, Response } from 'express';
import { count, desc, eq, ilike, or, type SQL } from 'drizzle-orm';
import { getOxyUserId } from '@oxy.so/core/server';
import type { ListingAddressPrecision } from '@homiio/shared-types';

import { getDb } from '../db/postgres';
import { escapeLikePattern } from '../db/likePattern';
import { addresses } from '../db/schema';
import {
  findOrCreateCanonicalAddress,
  nearestAddressesQuery,
  selectAddressWithGeoNames,
  type AddressCanonicalInput,
} from '../services/addressService';
import {
  serializeAddressRow,
  type AddressRow,
  type AddressWithGeoNames,
} from '../db/addresses/addressSerializer';
import { addressAudienceFor, addressPrecisionFor } from '../db/addresses/addressAudience';
import { getErrorName, getValidationMessages } from '../utils/errors';
import { logger as appLogger } from '../middlewares/logging';
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

/**
 * Serialize one address row onto the wire, at a stated precision.
 *
 * The shape itself lives in `db/addresses/addressSerializer`, shared with the
 * property read path — both endpoints show the same address and there is no
 * second place for that shape to drift. This adapter only supplies the null
 * geo names for the one caller that has an `AddressRow` with no join
 * (`createAddress`, which returns the row it just resolved).
 *
 * Every caller states its precision. There is no default here either: these
 * endpoints are mounted behind the auth middleware, and "behind auth" was
 * exactly the reasoning that let `exact` be published to every signed-in caller
 * in the world (ADR 0003 F1). Who a caller IS decides it —
 * {@link addressAudienceFor}.
 */
function serializeAddress(
  row: AddressRow | AddressWithGeoNames,
  precision: ListingAddressPrecision,
  placeIdOverride?: string,
): Record<string, unknown> {
  const geo = row as Partial<AddressWithGeoNames>;
  return serializeAddressRow(
    {
      ...row,
      cityName: geo.cityName ?? null,
      regionName: geo.regionName ?? null,
      countryName: geo.countryName ?? null,
      countryCodeName: geo.countryCodeName ?? null,
      neighborhoodName: geo.neighborhoodName ?? null,
    },
    precision,
    placeIdOverride,
  );
}

/**
 * The precision ONE caller is served for ONE address.
 *
 * `getOxyUserId` rather than `requireSessionOxyUserId`: the session is an input
 * to the precision, not a requirement of the handler, and these handlers must
 * keep answering when the router they are mounted on changes.
 */
async function precisionForViewer(req: Request, addressId: string): Promise<ListingAddressPrecision> {
  return addressPrecisionFor(await addressAudienceFor(addressId, getOxyUserId(req)));
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

    return ok(res, { address: serializeAddress(rows[0], await precisionForViewer(req, rows[0].id)) });
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
      // `building` for everybody, related or not: a list is the bulk read ADR
      // 0003 §2 forbids tier-C fields from leaving in, and §12's T4 names an
      // enumerable endpoint serving unit precision as the thing to prevent.
      addresses: rows.map((row) => serializeAddress(row, 'building')),
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
    // The submitter's own echo: reduced fields, the row's own id. The resolver
    // DEDUPES, so the row it answers with may be one an ingest wrote and may
    // carry a door label, a po box or a free-form reference this caller never
    // typed — but the id is what they need to attach a listing or a review to
    // the place they just described.
    return created(res, { address: serializeAddress(address, 'building', address.id) });
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
      // An empty patch is a READ wearing a PUT's clothes, and is served as one.
      return ok(res, {
        address: serializeAddress(unchanged[0], await precisionForViewer(req, unchanged[0].id)),
      });
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
    // Writing a field is not a relationship to the dwelling: this endpoint takes
    // no ownership of the row, so the answer is built for the same audience a
    // GET would be. Patching one field must not read back the others.
    return ok(res, { address: serializeAddress(rows[0], await precisionForViewer(req, id)) });
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

    // A radius read is the bulk shape of all — `building` for everybody.
    return ok(res, { addresses: rows.map((row) => serializeAddress(row, 'building')) });
  } catch (error) {
    logger.error('Error finding nearby addresses:', error);
    return serverError(res, { message: 'Failed to find nearby addresses' });
  }
};
