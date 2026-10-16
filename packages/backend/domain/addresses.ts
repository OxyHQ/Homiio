/**
 * Canonical addresses (ADR 0001) as use cases: read, search, resolve, correct
 * the non-identity attributes, and propose or withdraw an identity correction.
 *
 * ## What each caller is served (ADR 0003 §3, F1)
 *
 * Reads publish `building` precision — street, number, the geo chain, a
 * rounded coordinate — and withhold the dwelling inside it. The single-address
 * read escalates to `exact` only for a viewer with a RECORDED relation to the
 * place (`db/addresses/addressAudience.ts`); list and radius reads never
 * escalate. The viewer is the `viewerOxyUserId` given — the session on the
 * route, the effective account on the capability lane — so a tool is served
 * exactly what the route serves that same person.
 *
 * ## What a caller may CHANGE (ADR 0001 §8.1)
 *
 *  - `updateAddress` corrects only `district`, `po_box`, `reference`, and only
 *    for a caller with a recorded relation to the place — enforced inside the
 *    UPDATE (`db/addresses/addressWrites.ts`), so anybody else gets 404.
 *  - The eight identity fields go through `proposeAddressCorrection`, open to
 *    any signed-in caller because it changes nothing and the community resolves
 *    it — never an admin queue (AGENTS.md veto).
 *  - There is no delete (see below).
 *
 * Refusals are {@link AddressRequestError}s carrying the route's message and,
 * where the route lists them, its `errors[]`.
 */

import { count, desc, eq, ilike, or, type SQL } from 'drizzle-orm';
import type { ListingAddressPrecision } from '@homiio/shared-types';
import { escapeLikePattern } from '@oxy.so/utils/sql';

import { addressAudienceFor, addressPrecisionFor } from '../db/addresses/addressAudience';
import {
  findOpenCorrectionProposals,
  proposeAddressCorrection as proposeCorrectionRow,
  PROPOSABLE_IDENTITY_FIELDS,
  serializeAddressCorrectionProposal,
  withdrawCorrectionProposal,
  type IdentityPatch,
} from '../db/addresses/addressCorrections';
import {
  serializeAddressRow,
  type AddressRow,
  type AddressWithGeoNames,
} from '../db/addresses/addressSerializer';
import { updateAddressAttributes } from '../db/addresses/addressWrites';
import { getDb } from '../db/postgres';
import { addresses } from '../db/schema';
import { AppError } from '../middlewares/errorHandler';
import { logger } from '../middlewares/logging';
import {
  findOrCreateCanonicalAddress,
  nearestAddressesQuery,
  selectAddressWithGeoNames,
  type AddressCanonicalInput,
} from '../services/addressService';
import { resolveCityId, resolveNeighborhoodId, resolveRegionId } from '../services/geoQueryService';

/** A refusal with the route's status, message and (optionally) its `errors[]`. */
export class AddressRequestError extends AppError {
  readonly errors?: string[];

  constructor(message: string, statusCode: number, code: string, errors?: string[]) {
    super(message, statusCode, code);
    this.errors = errors;
  }
}

function addressNotFound(): AddressRequestError {
  return new AddressRequestError('Address not found', 404, 'NOT_FOUND');
}

function validationRefusal(errors: string[]): AddressRequestError {
  return new AddressRequestError('Validation error', 400, 'VALIDATION_ERROR', errors);
}

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

/** The precision ONE viewer is served for ONE address. */
async function precisionForViewer(
  viewerOxyUserId: string | undefined,
  addressId: string,
): Promise<ListingAddressPrecision> {
  return addressPrecisionFor(await addressAudienceFor(addressId, viewerOxyUserId));
}

/** One address at the viewer's precision. */
export async function getAddress(viewerOxyUserId: string | undefined, addressId: string) {
  // No id-SHAPE guard: a nonsense id matches no row and 404s (`db/ids.ts`).
  const rows = await selectAddressWithGeoNames({ where: eq(addresses.id, addressId), limit: 1 });
  if (!rows[0]) throw addressNotFound();
  return {
    address: serializeAddress(rows[0], await precisionForViewer(viewerOxyUserId, rows[0].id)),
  };
}

/**
 * Addresses whose street matches the term or whose city / region /
 * neighbourhood the term names, newest first, at `building` precision for
 * everybody.
 */
export async function searchAddresses(input: { query?: unknown; limit?: unknown; page?: unknown }) {
  const { query, limit = 10, page = 1 } = input;
  if (!query) throw new AddressRequestError('Search query is required', 400, 'VALIDATION_ERROR');

  const skip = (Number(page) - 1) * Number(limit);
  const term = String(query);

  // The term resolves to three geo ids ORed against three foreign keys ON
  // `addresses`; never a join, which would drop every street-only match.
  const [cityId, regionId, neighborhoodId] = await Promise.all([
    resolveCityId(term),
    resolveRegionId(term),
    resolveNeighborhoodId(term),
  ]);
  // Escaped: `%` and `_` are LIKE metacharacters.
  const streetMatch = ilike(addresses.street, `%${escapeLikePattern(term)}%`);
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
      orderBy: desc(addresses.createdAt),
    }),
    getDb().select({ total: count() }).from(addresses).where(where),
  ]);
  const totalCount = totals[0]?.total ?? 0;

  return {
    // `building` for everybody: a list is the bulk read ADR 0003 §2 forbids
    // tier-C fields from leaving in.
    addresses: rows.map((row) => serializeAddress(row, 'building')),
    pagination: {
      currentPage: Number(page),
      totalPages: Math.ceil(totalCount / Number(limit)),
      totalItems: totalCount,
      hasNextPage: skip + rows.length < totalCount,
      hasPrevPage: Number(page) > 1,
    },
  };
}

/** Addresses within `radius` metres of a point, nearest first, at `building` precision. */
export async function findNearbyAddresses(input: {
  lat?: unknown;
  lng?: unknown;
  radius?: unknown;
  limit?: unknown;
}) {
  const { lat, lng, radius = 1000, limit = 20 } = input;
  if (!lat || !lng) {
    throw new AddressRequestError('Latitude and longitude are required', 400, 'VALIDATION_ERROR');
  }
  const latitude = parseFloat(String(lat));
  const longitude = parseFloat(String(lng));
  const radiusInMeters = parseInt(String(radius), 10);
  if (Number.isNaN(latitude) || Number.isNaN(longitude)) {
    throw new AddressRequestError('Invalid coordinates', 400, 'VALIDATION_ERROR');
  }

  const nearest = nearestAddressesQuery({ longitude, latitude, radiusMeters: radiusInMeters });
  const rows = await selectAddressWithGeoNames({
    where: nearest.where,
    orderBy: nearest.orderBy,
    limit: Number(limit),
  });
  return { addresses: rows.map((row) => serializeAddress(row, 'building')) };
}

/**
 * Resolve (or create) the canonical address for a described place. The
 * resolver DEDUPES, so the row answered may already exist; the caller gets its
 * id at `building` precision, which is what they need to attach a listing or a
 * review to it.
 */
export async function createAddress(body: unknown) {
  const addressData = (body ?? {}) as AddressCanonicalInput;
  if (!addressData.street || !addressData.city || !addressData.country) {
    throw new AddressRequestError(
      'Street, city, and country are required',
      400,
      'VALIDATION_ERROR',
    );
  }
  if (!addressData.coordinates?.coordinates) {
    throw new AddressRequestError(
      'Coordinates are required to resolve the address location',
      400,
      'VALIDATION_ERROR',
    );
  }
  // City/state/country NAMES are inputs only — never persisted; the id chain is
  // resolved from coordinates and names.
  const address = await findOrCreateCanonicalAddress(addressData);
  logger.info(`Address resolved: ${address.id}`);
  return { address: serializeAddress(address, 'building', address.id) };
}

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
 * Correct the non-identity attributes of an address. A key field in the body
 * is REFUSED, not dropped; a caller with no recorded relation to the place
 * updates zero rows and is answered 404 (indistinguishable from a missing row).
 * An empty patch is a read and is served as one.
 */
export async function updateAddress(
  viewerOxyUserId: string | undefined,
  addressId: string,
  body: unknown,
) {
  const fields = (body ?? {}) as Record<string, unknown>;

  const identityFields = PROPOSABLE_IDENTITY_FIELDS.filter((field) => field in fields);
  if (identityFields.length > 0) {
    throw new AddressRequestError(
      'These fields are the identity of a place, not attributes of it. ' +
        'Propose a correction at POST /api/addresses/:id/corrections.',
      400,
      'IDENTITY_FIELDS',
      identityFields.map((field) => `${field} is an identity field`),
    );
  }

  const patch: Record<string, string | null> = {};
  for (const field of EDITABLE_ADDRESS_FIELDS) {
    if (!(field in fields)) continue;
    const value = fields[field];
    if (value === null || value === undefined) {
      patch[EDITABLE_ADDRESS_COLUMNS[field]] = null;
    } else if (typeof value === 'string') {
      patch[EDITABLE_ADDRESS_COLUMNS[field]] = value;
    }
  }

  if (Object.keys(patch).length === 0) {
    const unchanged = await selectAddressWithGeoNames({
      where: eq(addresses.id, addressId),
      limit: 1,
    });
    if (!unchanged[0]) throw addressNotFound();
    return {
      address: serializeAddress(
        unchanged[0],
        await precisionForViewer(viewerOxyUserId, unchanged[0].id),
      ),
    };
  }

  if (!viewerOxyUserId) {
    throw new AddressRequestError('Authentication required', 401, 'AUTHENTICATION_REQUIRED');
  }
  const updatedId = await updateAddressAttributes({
    addressId,
    sessionOxyUserId: viewerOxyUserId,
    patch,
  });
  if (updatedId === undefined) throw addressNotFound();

  const rows = await selectAddressWithGeoNames({ where: eq(addresses.id, addressId), limit: 1 });
  logger.info(`Address ${addressId} updated`);
  return {
    address: serializeAddress(rows[0], await precisionForViewer(viewerOxyUserId, addressId)),
  };
}

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

/** Cap on the free-text sentence a proposal must carry. */
const MAX_PROPOSAL_REASON_LENGTH = 500;

/** One sentence per refusal, so the caller learns which rule fired (ADR 0003 §5.8). */
const PROPOSAL_REFUSAL_MESSAGES = {
  no_change: 'That is already this place’s identity',
  street_required: 'Street address is required',
  empty_unit: 'A dwelling must carry a floor, unit or subunit',
  duplicate: 'You already have this correction open for this place',
} as const;

/**
 * Propose a correction to a place's identity. Open to any signed-in caller: a
 * proposal changes nothing, it is visible and appealable, and the community
 * resolves it.
 */
export async function proposeAddressCorrection(
  proposedByOxyUserId: string,
  addressId: string,
  body: unknown,
) {
  const fields = (body ?? {}) as Record<string, unknown>;
  const reason = typeof fields.reason === 'string' ? fields.reason.trim() : '';
  if (reason === '') throw validationRefusal(['A correction must say why']);
  if (reason.length > MAX_PROPOSAL_REASON_LENGTH) {
    throw validationRefusal([`reason must be at most ${MAX_PROPOSAL_REASON_LENGTH} characters`]);
  }

  const patch: IdentityPatch = {};
  for (const field of PROPOSABLE_IDENTITY_FIELDS) {
    if (!(field in fields)) continue;
    const value = fields[field];
    if (value === null || value === undefined) patch[field] = null;
    else if (typeof value === 'string') patch[field] = value;
  }
  if (Object.keys(patch).length === 0) {
    throw validationRefusal(['A correction must propose at least one identity field']);
  }

  const [address] = await selectAddressWithGeoNames({
    where: eq(addresses.id, addressId),
    limit: 1,
  });
  if (!address) throw addressNotFound();

  const result = await proposeCorrectionRow({
    address,
    patch,
    reason,
    evidenceUrl: typeof fields.evidenceUrl === 'string' ? fields.evidenceUrl : null,
    proposedByOxyUserId,
  });
  if ('kind' in result) throw validationRefusal([PROPOSAL_REFUSAL_MESSAGES[result.kind]]);

  logger.info(`Address correction proposed for ${addressId}`);
  return {
    proposal: serializeAddressCorrectionProposal(
      result,
      await precisionForViewer(proposedByOxyUserId, addressId),
      proposedByOxyUserId,
    ),
  };
}

/** The open corrections proposed against a place, at the viewer's precision. */
export async function listAddressCorrections(
  viewerOxyUserId: string | undefined,
  addressId: string,
) {
  const [address] = await selectAddressWithGeoNames({
    where: eq(addresses.id, addressId),
    limit: 1,
  });
  if (!address) throw addressNotFound();
  const [proposals, precision] = await Promise.all([
    findOpenCorrectionProposals(addressId),
    precisionForViewer(viewerOxyUserId, addressId),
  ]);
  return {
    proposals: proposals.map((proposal) =>
      serializeAddressCorrectionProposal(proposal, precision, viewerOxyUserId),
    ),
  };
}

/**
 * Withdraw one's own correction. The proposer id is a conjunct of the UPDATE,
 * so somebody else's proposal is a 404, never a 403.
 */
export async function withdrawAddressCorrection(
  proposedByOxyUserId: string,
  addressId: string,
  proposalId: string,
) {
  const withdrawn = await withdrawCorrectionProposal({
    proposalId,
    addressId,
    proposedByOxyUserId,
  });
  if (!withdrawn) throw new AddressRequestError('Correction not found', 404, 'NOT_FOUND');
  return {
    proposal: serializeAddressCorrectionProposal(
      withdrawn,
      await precisionForViewer(proposedByOxyUserId, addressId),
      withdrawn.proposedByOxyUserId,
    ),
  };
}
