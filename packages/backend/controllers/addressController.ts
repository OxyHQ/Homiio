/**
 * Address Controller — the HTTP edge of `domain/addresses.ts`.
 *
 * Every use case lives in the domain module, which the capability catalogue
 * calls too; this file resolves the session and keeps the route's historical
 * bodies (`{ success, ...data }`, `{ success: false, message, errors? }`).
 *
 * CRUD over `addresses`. Administrative geo is relational — an address
 * references country / region / city / neighborhood by id — so every read joins
 * the geo chain to resolve the display names in the SAME statement rather than
 * populating four refs.
 *
 * Each address serializes with ONE id, `id` — these responses used to carry
 * `_id` beside it and no longer do. Its `coordinates` still leave as a
 * GeoJSON `{ type: 'Point', coordinates: [lng, lat] }` pair even though the table
 * stores named `longitude` / `latitude` columns, and the wire field spellings
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

import type { Request, Response } from 'express';
import { getOxyUserId } from '@oxy.so/core/server';

import {
  AddressRequestError,
  createAddress as resolveAddress,
  findNearbyAddresses,
  getAddress,
  listAddressCorrections,
  proposeAddressCorrection,
  searchAddresses as searchAddressRows,
  updateAddress as correctAddress,
  withdrawAddressCorrection,
} from '../domain/addresses';
import { getErrorName, getValidationMessages } from '../utils/errors';
import { logger as appLogger } from '../middlewares/logging';

/**
 * The session id a write needs, or `null`.
 *
 * `getOxyUserId` plus an explicit 401 rather than `requireSessionOxyUserId`,
 * which throws: these handlers are mounted WITHOUT `asyncHandler`, so a throw
 * from an async handler never reaches `errorHandler` on Express 4 — it becomes
 * an unhandled rejection and the caller sees a 500.
 */
function sessionWriterOf(req: Request): string | null {
  const oxyUserId = getOxyUserId(req);
  return typeof oxyUserId === 'string' && oxyUserId.length > 0 ? oxyUserId : null;
}

/** The viewer whose relation to a place decides its precision (ADR 0003). */
function viewerOf(req: Request): string | undefined {
  return sessionWriterOf(req) ?? undefined;
}

const unauthorized = (res: Response) =>
  res.status(401).json({ success: false, message: 'Authentication required' });

/**
 * Answer one use case the way this controller always has. A domain refusal is
 * `{ success: false, message, errors? }` at its status; a thrown
 * `ValidationError` (where `validationAware`) is the historical 400; anything
 * else is logged and answers `failure` as a 500.
 */
async function answer(
  res: Response,
  run: () => Promise<Record<string, unknown>>,
  options: { status?: number; failure: string; log: string; validationAware?: boolean },
) {
  try {
    const data = await run();
    return res.status(options.status ?? 200).json({ success: true, ...data });
  } catch (error) {
    if (error instanceof AddressRequestError) {
      return res.status(error.statusCode).json({
        success: false,
        message: error.message,
        ...(error.errors ? { errors: error.errors } : {}),
      });
    }
    appLogger.error(options.log, { detail: error });
    if (options.validationAware && getErrorName(error) === 'ValidationError') {
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: getValidationMessages(error),
      });
    }
    return res.status(500).json({ success: false, message: options.failure });
  }
}

/** GET /api/addresses/:id */
export const getAddressById = (req: Request, res: Response) =>
  answer(res, () => getAddress(viewerOf(req), req.params.id), {
    failure: 'Failed to fetch address',
    log: 'Error fetching address:',
  });

/** GET /api/addresses/search */
export const searchAddresses = (req: Request, res: Response) =>
  answer(res, () => searchAddressRows(req.query), {
    failure: 'Failed to search addresses',
    log: 'Error searching addresses:',
  });

/** POST /api/addresses */
export const createAddress = (req: Request, res: Response) =>
  answer(res, () => resolveAddress(req.body), {
    status: 201,
    failure: 'Failed to create address',
    log: 'Error creating address:',
    validationAware: true,
  });

/** PUT /api/addresses/:id — non-identity attributes, for a caller related to the place. */
export const updateAddress = (req: Request, res: Response) =>
  answer(res, () => correctAddress(viewerOf(req), req.params.id, req.body), {
    failure: 'Failed to update address',
    log: 'Error updating address:',
    validationAware: true,
  });

/**
 * There is no `DELETE /api/addresses/:id`, and its absence is a decision —
 * see `domain/addresses.ts` (ADR 0001 §2.1.7).
 */

/** POST /api/addresses/:id/corrections — open to any signed-in caller (ADR 0001 §8.1). */
export const proposeCorrection = (req: Request, res: Response) => {
  const proposedByOxyUserId = sessionWriterOf(req);
  if (proposedByOxyUserId === null) return unauthorized(res);
  return answer(res, () => proposeAddressCorrection(proposedByOxyUserId, req.params.id, req.body), {
    status: 201,
    failure: 'Failed to propose a correction',
    log: 'Error proposing address correction:',
  });
};

/** GET /api/addresses/:id/corrections */
export const listCorrections = (req: Request, res: Response) =>
  answer(res, () => listAddressCorrections(viewerOf(req), req.params.id), {
    failure: 'Failed to list corrections',
    log: 'Error listing address corrections:',
  });

/** DELETE /api/addresses/:id/corrections/:proposalId — one's own proposal only. */
export const withdrawCorrection = (req: Request, res: Response) => {
  const proposedByOxyUserId = sessionWriterOf(req);
  if (proposedByOxyUserId === null) return unauthorized(res);
  return answer(
    res,
    () => withdrawAddressCorrection(proposedByOxyUserId, req.params.id, req.params.proposalId),
    { failure: 'Failed to withdraw the correction', log: 'Error withdrawing address correction:' },
  );
};

/** GET /api/addresses/nearby */
export const getNearbyAddresses = (req: Request, res: Response) =>
  answer(res, () => findNearbyAddresses(req.query), {
    failure: 'Failed to find nearby addresses',
    log: 'Error finding nearby addresses:',
  });
