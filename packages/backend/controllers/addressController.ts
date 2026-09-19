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
 *
 * ## What a caller may CHANGE, and what they may only propose (ADR 0001 §8.1)
 *
 * An address is not the caller's content: it is the permanent identity of a
 * dwelling that listings, leases, reviews and eviction cases all point at. So
 * the write surface is split three ways and none of the three is "any signed-in
 * caller may edit this row", which is what it used to be.
 *
 *  - **`PUT`** corrects the non-identity attributes (`district`, `po_box`,
 *    `reference`) and needs a RECORDED relation to the place — the same two
 *    `addressAudience` recognises for reading it. Enforced inside the UPDATE
 *    (`db/addresses/addressWrites.ts`); a non-owner gets 404.
 *  - **`POST /:id/corrections`** is where the eight identity fields go. A
 *    correction that re-keys a place is a MERGE PROPOSAL, open to any signed-in
 *    caller because it changes nothing, and resolved by the community — never by
 *    an admin queue, which `AGENTS.md` vetoes outright.
 *  - **There is no `DELETE`.** See the note where the handler used to be.
 */

import { Request, Response } from 'express';
import { count, desc, eq, ilike, or, type SQL } from 'drizzle-orm';
import { getOxyUserId } from '@oxy.so/core/server';
import type { ListingAddressPrecision } from '@homiio/shared-types';

import { getDb } from '../db/postgres';
import { escapeLikePattern } from '@oxy.so/utils/sql';
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
import { updateAddressAttributes } from '../db/addresses/addressWrites';
import {
  findOpenCorrectionProposals,
  proposeAddressCorrection,
  PROPOSABLE_IDENTITY_FIELDS,
  serializeAddressCorrectionProposal,
  withdrawCorrectionProposal,
  type IdentityPatch,
} from '../db/addresses/addressCorrections';
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
const unauthorized = (res: Response) =>
  res.status(401).json({ success: false, message: 'Authentication required' });

/**
 * The session id a write needs, or `null`.
 *
 * `getOxyUserId` plus an explicit 401 rather than `requireSessionOxyUserId`,
 * which throws: these handlers are mounted WITHOUT `asyncHandler`, so a throw
 * from an async handler never reaches `errorHandler` on Express 4 — it becomes
 * an unhandled rejection and the caller sees a 500. Returning the id keeps the
 * refusal a status code the router cannot lose.
 */
function sessionWriterOf(req: Request): string | null {
  const oxyUserId = getOxyUserId(req);
  return typeof oxyUserId === 'string' && oxyUserId.length > 0 ? oxyUserId : null;
}

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
 * The columns this endpoint may write DIRECTLY — ADR 0001 §3.1's "correctable
 * attributes", and not one field the identity key hashes.
 *
 * The eight key fields (`street`, `number`, `building_name`, `block`,
 * `entrance`, `floor`, `unit`, `subunit`) used to be here, and writing one of
 * them re-keyed a canonical place: §8.1 says a correction that changes a key
 * field is a MERGE PROPOSAL, not an edit, because the corrected key may already
 * belong to another row and because the place a listing, a lease, a review and
 * an eviction all point at would silently become a different dwelling. They are
 * served by {@link proposeCorrection} now, and a body naming one is refused
 * rather than ignored — see {@link updateAddress}.
 *
 * An explicit allowlist rather than a delete-list, and `req.body` is never
 * spread into an update (`AGENTS.md` §Ownership).
 */
const EDITABLE_ADDRESS_FIELDS = ['district', 'po_box', 'reference'] as const;

/** Wire field name → the drizzle column it writes. */
const EDITABLE_ADDRESS_COLUMNS = {
  district: 'district',
  po_box: 'poBox',
  reference: 'reference',
} as const satisfies Record<(typeof EDITABLE_ADDRESS_FIELDS)[number], keyof AddressRow>;

/**
 * Correct the non-identity attributes of an address
 * PUT /api/addresses/:id
 *
 * Authorised in `db/addresses/addressWrites.ts` — inside the UPDATE's own
 * `where`, against the session id, so a caller with no recorded relation to the
 * place updates zero rows and is answered 404 rather than 403.
 */
export const updateAddress = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const body = req.body as Record<string, unknown>;

    // A key field in the body is REFUSED, not dropped. Silently ignoring it
    // would answer 200 with the address unchanged, and a client that believed
    // the 200 would show a correction that never happened.
    const identityFields = PROPOSABLE_IDENTITY_FIELDS.filter((field) => field in body);
    if (identityFields.length > 0) {
      return badRequest(res, {
        message:
          'These fields are the identity of a place, not attributes of it. ' +
          'Propose a correction at POST /api/addresses/:id/corrections.',
        errors: identityFields.map((field) => `${field} is an identity field`),
      });
    }

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
      // An empty patch is a READ wearing a PUT's clothes, and is served as one —
      // including for a caller with no relation to the place, because it writes
      // nothing and a GET of the same row answers the same body.
      return ok(res, {
        address: serializeAddress(unchanged[0], await precisionForViewer(req, unchanged[0].id)),
      });
    }

    const sessionOxyUserId = sessionWriterOf(req);
    if (sessionOxyUserId === null) return unauthorized(res);

    const updatedId = await updateAddressAttributes({ addressId: id, sessionOxyUserId, patch });
    if (updatedId === undefined) {
      // Two cases, deliberately indistinguishable: no such address, and no
      // relation to it. A 403 here would confirm to an enumerator that the id
      // they guessed names a real dwelling (`AGENTS.md` §Ownership).
      return notFound(res, { message: 'Address not found' });
    }

    const rows = await selectAddressWithGeoNames({ where: eq(addresses.id, id), limit: 1 });
    logger.info(`Address ${id} updated`);
    // The answer is built for the audience a GET would be built for. Writing a
    // field is not a relationship to the dwelling — the relation that authorised
    // the write is, and `precisionForViewer` reads the same one.
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
 * There is no `DELETE /api/addresses/:id`, and its absence is a decision.
 *
 * ADR 0001 §2.1.7: *a duplicate is recorded, never discarded. Merging is
 * reversible; deleting is not.* An `addresses` row is the permanent identity of
 * a dwelling rather than a user's own content — eleven of the twelve columns
 * that can reference one REFUSE a delete — so the endpoint could only ever
 * either raise on a place with history or destroy the one row that lets the next
 * ingest recognise a place without. Withdrawing a place is a merge
 * (`services/addressMerge.ts`), which is reversible and is an operational act.
 *
 * Stated here rather than only by the route's absence, because "somebody removed
 * the handler" and "nobody may delete a place" look identical in a diff.
 */

// ---------------------------------------------------------------------------
// Correction proposals — ADR 0001 §8.1.
// ---------------------------------------------------------------------------

/** Cap on the free-text sentence a proposal must carry. */
const MAX_PROPOSAL_REASON_LENGTH = 500;

/**
 * Propose a correction to a place's identity
 * POST /api/addresses/:id/corrections
 *
 * Open to any signed-in caller, and that is the point: a proposal changes
 * nothing, it is visible and appealable, and the community resolves it (ADR 0001
 * §8.1, and the standing no-admin-queue veto in `AGENTS.md`). Gating it on a
 * recorded relation to the place would mean only the landlord advertising a flat
 * could report that its number is wrong.
 */
export const proposeCorrection = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const body = req.body as Record<string, unknown>;
    const proposedByOxyUserId = sessionWriterOf(req);
    if (proposedByOxyUserId === null) return unauthorized(res);

    const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
    if (reason === '') {
      return badRequest(res, {
        message: 'Validation error',
        errors: ['A correction must say why'],
      });
    }
    if (reason.length > MAX_PROPOSAL_REASON_LENGTH) {
      return badRequest(res, {
        message: 'Validation error',
        errors: [`reason must be at most ${MAX_PROPOSAL_REASON_LENGTH} characters`],
      });
    }

    const patch: IdentityPatch = {};
    for (const field of PROPOSABLE_IDENTITY_FIELDS) {
      if (!(field in body)) continue;
      const value = body[field];
      if (value === null || value === undefined) patch[field] = null;
      else if (typeof value === 'string') patch[field] = value;
    }
    if (Object.keys(patch).length === 0) {
      return badRequest(res, {
        message: 'Validation error',
        errors: ['A correction must propose at least one identity field'],
      });
    }

    const [address] = await selectAddressWithGeoNames({ where: eq(addresses.id, id), limit: 1 });
    if (!address) return notFound(res, { message: 'Address not found' });

    const result = await proposeAddressCorrection({
      address,
      patch,
      reason,
      evidenceUrl: typeof body.evidenceUrl === 'string' ? body.evidenceUrl : null,
      proposedByOxyUserId,
    });

    if ('kind' in result) {
      return badRequest(res, {
        message: 'Validation error',
        errors: [PROPOSAL_REFUSAL_MESSAGES[result.kind]],
      });
    }

    logger.info(`Address correction proposed for ${id}`);
    return created(res, {
      proposal: serializeAddressCorrectionProposal(
        result,
        await precisionForViewer(req, id),
        proposedByOxyUserId,
      ),
    });
  } catch (error) {
    logger.error('Error proposing address correction:', error);
    return serverError(res, { message: 'Failed to propose a correction' });
  }
};

/** One sentence per refusal, so the caller learns which rule fired (ADR 0003 §5.8). */
const PROPOSAL_REFUSAL_MESSAGES = {
  no_change: 'That is already this place’s identity',
  street_required: 'Street address is required',
  empty_unit: 'A dwelling must carry a floor, unit or subunit',
  duplicate: 'You already have this correction open for this place',
} as const;

/**
 * The open corrections proposed against a place
 * GET /api/addresses/:id/corrections
 *
 * Visible, per ADR 0001 §8.1 — at the viewer's own precision, because a proposal
 * naming a floor or a door is the same disclosure the address serializer
 * withholds.
 */
export const listCorrections = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const [address] = await selectAddressWithGeoNames({ where: eq(addresses.id, id), limit: 1 });
    if (!address) return notFound(res, { message: 'Address not found' });

    const [proposals, precision] = await Promise.all([
      findOpenCorrectionProposals(id),
      precisionForViewer(req, id),
    ]);
    const viewer = getOxyUserId(req);

    return ok(res, {
      proposals: proposals.map((proposal) =>
        serializeAddressCorrectionProposal(proposal, precision, viewer),
      ),
    });
  } catch (error) {
    logger.error('Error listing address corrections:', error);
    return serverError(res, { message: 'Failed to list corrections' });
  }
};

/**
 * Withdraw your own correction
 * DELETE /api/addresses/:id/corrections/:proposalId
 *
 * The proposer id is a conjunct of the UPDATE, so somebody else's proposal is a
 * 404 and never a 403.
 */
export const withdrawCorrection = async (req: Request, res: Response) => {
  try {
    const { id, proposalId } = req.params;
    const proposedByOxyUserId = sessionWriterOf(req);
    if (proposedByOxyUserId === null) return unauthorized(res);

    const withdrawn = await withdrawCorrectionProposal({ proposalId, addressId: id, proposedByOxyUserId });
    if (!withdrawn) return notFound(res, { message: 'Correction not found' });

    return ok(res, {
      proposal: serializeAddressCorrectionProposal(
        withdrawn,
        await precisionForViewer(req, id),
        withdrawn.proposedByOxyUserId,
      ),
    });
  } catch (error) {
    logger.error('Error withdrawing address correction:', error);
    return serverError(res, { message: 'Failed to withdraw the correction' });
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
