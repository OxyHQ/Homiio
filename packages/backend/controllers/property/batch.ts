/**
 * Batch and owner listing reads.
 *
 * Both endpoints filtered on `status: 'active'`, which is NOT a member of
 * `PropertyStatus` and therefore matches nothing — the value has been
 * `published` since the status vocabulary was settled, and `properties_status_check`
 * would now refuse to store `active` at all. The filter is carried across
 * VERBATIM rather than corrected: these two endpoints have been returning empty
 * pages for as long as the vocabulary has been wrong, and fixing that here would
 * turn a read port into an unreviewed change of what two endpoints return. It is
 * recorded in the PR body so it is fixed deliberately, with the count in front of
 * whoever fixes it.
 */

import { successResponse, paginationResponse, AppError } from '../../middlewares/errorHandler';
import {
  allOf,
  countProperties,
  findProperties,
  propertyOrderBy,
  NEWEST_FIRST,
} from '../../db/properties/propertyReads';
import { idIn, idNotIn, ownedBy, statusIs } from '../../db/properties/propertyFilters';
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

    const hydrated = await findProperties({ where: allOf([idIn(list), statusIs('active')]) });
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
      statusIs('active'),
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
