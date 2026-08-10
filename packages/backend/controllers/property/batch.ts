/**
 * Batch and owner listing reads.
 *
 * Both endpoints used to filter on `status: 'active'`, which is not a member of
 * `PropertyStatus` — `properties_status_check` would refuse to store it — so
 * both returned an empty page for every request ever made to them. The Postgres
 * port carried the value across verbatim rather than guessing at a replacement,
 * because picking one is a product decision about what each endpoint may reveal
 * and not a detail of a read port (#290).
 *
 * They get DIFFERENT answers, because they answer different questions.
 *
 *  - **`by-ids` hydrates ids the caller already holds** (a saved list, a batch
 *    of chat references), so it is the bulk form of `GET /properties/:id`. A
 *    listing that has since been rented is exactly what such a caller needs to
 *    render — hiding it would blank a row the user saved themselves. It filters
 *    `statusVisibleToNonOwner()`: everything except `draft` and `archived`.
 *  - **`owner/:oxyUserId` is a DISCOVERY feed** — any authenticated caller may
 *    name any owner — so it answers "what is this landlord offering", and
 *    converges on `published`, the same answer `cityController` and
 *    `reviewController.getAgencyProperties` give for the other two "somebody
 *    else's listings" surfaces. An owner's own full view, drafts included, is
 *    `GET /properties/me/list`, which is scoped to the session.
 *
 * `notDeleted()` and `notModerationRestricted()` are new on BOTH, and they are
 * not belt-and-braces. Neither endpoint had them, which cost nothing while the
 * status filter matched nothing; the moment it matches rows, their absence is a
 * live leak of soft-deleted and jury-restricted listings — on `by-ids`, from an
 * unauthenticated route. They are the same pair every other public read applies
 * (`commonFilters.ts`, `searchQueryBuilder.ts`, `reviewController`).
 */

import { PropertyStatus } from '@homiio/shared-types';

import { successResponse, paginationResponse, AppError } from '../../middlewares/errorHandler';
import {
  allOf,
  countProperties,
  findProperties,
  propertyOrderBy,
  NEWEST_FIRST,
} from '../../db/properties/propertyReads';
import {
  idIn,
  idNotIn,
  notDeleted,
  notModerationRestricted,
  ownedBy,
  statusIs,
  statusVisibleToNonOwner,
} from '../../db/properties/propertyFilters';
import { serializeProperty } from '../../db/properties/propertySerializer';
import type { ControllerNext, ControllerRequest, ControllerResponse } from '../controllerTypes';
import { getQueryInteger, getQueryString } from '../queryParams';

/** Split a comma-separated id list into trimmed, non-empty entries. */
function parseIdList(raw: string): string[] {
  return raw.split(',').map((entry) => entry.trim()).filter(Boolean);
}

export async function getPropertiesByIds(req: ControllerRequest, res: ControllerResponse, next: ControllerNext) {
  try {
    const { ids } = req.query;
    if (!ids) return res.status(400).json({ success: false, message: 'ids is required' });
    // No id-SHAPE filter. The old `ObjectId.isValid` pass silently DROPPED every
    // id it did not recognise, which post-cutover is every uuid v7 — see
    // `db/properties/propertyFilters.idIn`. An id that matches no row now simply
    // returns no row.
    const list = parseIdList(String(ids));
    if (!list.length) return res.json(paginationResponse([], 1, 0, 0, 'No valid IDs provided'));

    const hydrated = await findProperties({
      where: allOf([idIn(list), notDeleted(), notModerationRestricted(), statusVisibleToNonOwner()]),
    });
    return res.json(successResponse(hydrated.map(serializeProperty), 'Properties fetched by IDs'));
  } catch (error) { next(error); }
}

export async function getPropertiesByOwner(req: ControllerRequest, res: ControllerResponse, next: ControllerNext) {
  try {
    const { oxyUserId } = req.params;
    const exclude = getQueryString(req.query.exclude);
    const page = getQueryInteger(req.query.page, 1);
    const limit = getQueryInteger(req.query.limit, 10);
    if (!oxyUserId || typeof oxyUserId !== 'string') {
      return next(new AppError('Invalid owner id', 400, 'INVALID_ID'));
    }

    const where = allOf([
      ownedBy(oxyUserId),
      notDeleted(),
      notModerationRestricted(),
      statusIs(PropertyStatus.PUBLISHED),
      exclude ? idNotIn([exclude]) : undefined,
    ]);
    const skip = (page - 1) * limit;
    const [hydrated, total] = await Promise.all([
      // Image-bearing listings first (product rule), then newest.
      findProperties({ where, orderBy: propertyOrderBy(NEWEST_FIRST), limit, offset: skip }),
      countProperties(where),
    ]);
    res.json(paginationResponse(hydrated.map(serializeProperty), page, limit, total, "Owner's properties retrieved successfully"));
  } catch (error) { next(error); }
}
