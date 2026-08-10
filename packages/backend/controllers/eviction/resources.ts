/**
 * Legal and housing resources for a jurisdiction.
 *
 * PUBLIC and read-only. There is no write endpoint anywhere in this package —
 * the table is curated reference data seeded by
 * `scripts/seedJurisdictionResources.ts`, for the reason its repository's header
 * gives: Homiio must not invent legal advice, so a row exists only when a person
 * checked a named public source and recorded the date.
 *
 * The response carries `verifiedAt` on every entry and a `disclaimer` key on the
 * envelope, because #358 requires the disclaimer to be shown and a client that
 * has to remember to add it is a client that will forget on one screen.
 *
 * An EMPTY list is a legitimate and honest answer: it means nobody has verified
 * anything for that jurisdiction yet. It is not an error, and the UI says so
 * rather than showing a spinner or an approximation from a neighbouring country.
 */

import { listJurisdictionResources } from '../../db/evictions/jurisdictionResourceRepository';
import { AppError, successResponse } from '../../middlewares/errorHandler';
import type { ControllerNext, ControllerRequest, ControllerResponse } from '../controllerTypes';

/**
 * The disclaimer every consumer must render, served WITH the data.
 *
 * Server-side so it cannot drift between the web and native clients, and so a
 * new consumer gets it without knowing it exists.
 */
const DISCLAIMER =
  'These are links to organisations and public authorities, collected and checked on the ' +
  'date shown. Homiio does not provide legal advice and does not represent these ' +
  'organisations. Check the date and contact them directly.';

export async function listResources(
  req: ControllerRequest,
  res: ControllerResponse,
  next: ControllerNext,
) {
  try {
    const query = (req.query ?? {}) as Record<string, unknown>;
    const countryCode = typeof query.countryCode === 'string' ? query.countryCode.trim() : '';
    if (!/^[A-Za-z]{2}$/.test(countryCode)) {
      return next(
        new AppError(
          'A two-letter ISO-3166-1 country code is required.',
          400,
          'INVALID_COUNTRY_CODE',
        ),
      );
    }
    const regionId =
      typeof query.regionId === 'string' && query.regionId.trim()
        ? query.regionId.trim()
        : undefined;

    const rows = await listJurisdictionResources({ countryCode, regionId });

    res.json(
      successResponse(
        {
          countryCode: countryCode.toUpperCase(),
          regionId,
          disclaimer: DISCLAIMER,
          resources: rows.map((row) => ({
            id: row.id,
            countryCode: row.countryCode,
            regionId: row.regionId ?? undefined,
            resourceType: row.resourceType,
            title: row.title,
            url: row.url,
            source: row.source,
            verifiedAt: row.verifiedAt.toISOString(),
            validUntil: row.validUntil === null ? undefined : row.validUntil.toISOString(),
            languages: row.languages,
          })),
        },
        'Jurisdiction resources',
      ),
    );
  } catch (error) {
    next(error);
  }
}
