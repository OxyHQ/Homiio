/**
 * Legal and housing resources for a jurisdiction — PUBLIC, read-only curated
 * reference data (`scripts/seedJurisdictionResources.ts`): Homiio must not
 * invent legal advice, so a row exists only when a person checked a named
 * public source and recorded the date.
 *
 * The answer carries `verifiedAt` on every entry and the `disclaimer` beside
 * them, because #358 requires the disclaimer to be shown and a client that has
 * to remember to add it is a client that will forget on one screen. An EMPTY
 * list is an honest answer: nobody has verified anything there yet.
 */

import { listJurisdictionResources } from '../../db/evictions/jurisdictionResourceRepository';
import { AppError } from '../../middlewares/errorHandler';

/** The disclaimer every consumer must render, served WITH the data. */
const DISCLAIMER =
  'These are links to organisations and public authorities, collected and checked on the ' +
  'date shown. Homiio does not provide legal advice and does not represent these ' +
  'organisations. Check the date and contact them directly.';

export async function listEvictionResources(input: {
  readonly countryCode?: unknown;
  readonly regionId?: unknown;
}) {
  const countryCode = typeof input.countryCode === 'string' ? input.countryCode.trim() : '';
  if (!/^[A-Za-z]{2}$/.test(countryCode)) {
    throw new AppError(
      'A two-letter ISO-3166-1 country code is required.',
      400,
      'INVALID_COUNTRY_CODE',
    );
  }
  const regionId =
    typeof input.regionId === 'string' && input.regionId.trim() ? input.regionId.trim() : undefined;

  const rows = await listJurisdictionResources({ countryCode, regionId });

  return {
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
  };
}
