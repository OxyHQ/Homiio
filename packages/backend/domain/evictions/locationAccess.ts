/**
 * The exact-location use cases: grant, revoke, read, and read the audit.
 *
 * ADR 0003 §10 says access to a tier-R record is *"relationship-derived,
 * purpose-bound, time-bound, revocable and audited, with no standing access"*.
 *
 * ## Two gates, and both are the organiser's to open
 *
 * The affected household must have authorised exact disclosure at all, and the
 * caller must belong to the case team or hold a live grant.
 * `resolveExactLocation` checks both and audits every outcome including the
 * refusals — an audit that records only successes cannot answer "did anybody
 * try". Everything else here is the organiser's alone; anybody else gets the
 * case's 404.
 *
 * The exact location is never in a URL, a push or a cached response: the HTTP
 * adapter sets `Cache-Control: no-store`, and no notification payload carries it.
 */

import {
  grantLocationAccess,
  listAccessAudit,
  listLiveGrants,
  MAX_GRANT_HOURS,
  resolveExactLocation,
  revokeLocationAccess,
} from '../../db/evictions/evictionAccessRepository';
import { findEvictionCase } from '../../db/evictions/evictionRepository';
import { AppError } from '../../middlewares/errorHandler';
import { parseGrantPurpose } from './shared';

const MAX_AUDIT_PAGE = 200;

const CASE_NOT_FOUND = () => new AppError('Eviction case not found', 404, 'EVICTION_NOT_FOUND');

/** The organiser's own case, or the 404 everybody else gets. */
async function requireOwnedCase(caseId: string, oxyUserId: string) {
  const evictionCase = await findEvictionCase(caseId);
  if (!evictionCase || evictionCase.oxyUserId !== oxyUserId) throw CASE_NOT_FOUND();
  return evictionCase;
}

/** Grant one person time-bound, purpose-bound access to the exact location. */
export async function grantEvictionLocation(
  oxyUserId: string,
  id: string,
  input: { readonly granteeOxyUserId: unknown; readonly purpose: unknown; readonly hours: unknown },
) {
  const owned = await requireOwnedCase(id, oxyUserId);

  if (owned.locationHouseholdAuthorizedAt === null) {
    throw new AppError(
      'This case has no exact location to share. The affected household has to ask for it.',
      409,
      'HOUSEHOLD_NOT_AUTHORIZED',
    );
  }

  const granteeOxyUserId =
    typeof input.granteeOxyUserId === 'string' ? input.granteeOxyUserId.trim() : '';
  if (!granteeOxyUserId) throw new AppError('A grantee is required', 400, 'INVALID_GRANTEE');
  if (granteeOxyUserId === oxyUserId) {
    throw new AppError(
      'You already hold this case; a grant would record nothing.',
      400,
      'INVALID_GRANTEE',
    );
  }

  const purpose = parseGrantPurpose(input.purpose);
  if (!purpose) {
    throw new AppError(
      'A concrete purpose is required: legal_representation, accompaniment or emergency_housing.',
      400,
      'INVALID_PURPOSE',
    );
  }

  const hours = Number(input.hours);
  if (!Number.isFinite(hours) || hours <= 0) {
    throw new AppError('A positive duration in hours is required', 400, 'INVALID_DURATION');
  }

  const grant = await grantLocationAccess({
    caseId: id,
    granteeOxyUserId,
    grantedByOxyUserId: oxyUserId,
    purpose,
    hours,
  });

  return {
    id: grant.id,
    caseId: grant.caseId,
    granteeOxyUserId: grant.granteeOxyUserId,
    purpose: grant.purpose,
    grantedAt: grant.grantedAt.toISOString(),
    expiresAt: grant.expiresAt.toISOString(),
    maxGrantHours: MAX_GRANT_HOURS,
  };
}

/** Revoke one person's grant. */
export async function revokeEvictionLocationGrant(oxyUserId: string, id: string, grantee: string) {
  await requireOwnedCase(id, oxyUserId);
  const revoked = await revokeLocationAccess({
    caseId: id,
    granteeOxyUserId: grantee,
    revokedByOxyUserId: oxyUserId,
  });
  return { revoked };
}

/** The live grants on a case, for the organiser's own management screen. */
export async function listEvictionLocationGrants(oxyUserId: string, id: string) {
  await requireOwnedCase(id, oxyUserId);
  const grants = await listLiveGrants(id);
  return grants.map((grant) => ({
    id: grant.id,
    caseId: grant.caseId,
    granteeOxyUserId: grant.granteeOxyUserId,
    purpose: grant.purpose,
    grantedAt: grant.grantedAt.toISOString(),
    expiresAt: grant.expiresAt.toISOString(),
  }));
}

/**
 * The exact location, to a team member or grant holder — audited either way.
 *
 * A refusal says WHICH gate refused, because it changes what the caller should
 * do next: asking the organiser helps for `no_grant` and `expired`, and does not
 * for `not_authorized_by_household`.
 */
export async function getExactEvictionLocation(oxyUserId: string, id: string) {
  const evictionCase = await findEvictionCase(id);
  if (!evictionCase) throw CASE_NOT_FOUND();

  const outcome = await resolveExactLocation({ caseId: id, requesterOxyUserId: oxyUserId });
  if (outcome.outcome === 'denied') {
    throw new AppError(
      'You do not have access to this location.',
      403,
      `LOCATION_ACCESS_${outcome.reason.toUpperCase()}`,
    );
  }
  return outcome.location;
}

/** Every access decision on a case, for the organiser. */
export async function getEvictionLocationAudit(oxyUserId: string, id: string) {
  await requireOwnedCase(id, oxyUserId);
  const entries = await listAccessAudit(id, MAX_AUDIT_PAGE);
  return entries.map((entry) => ({
    id: entry.id,
    caseId: entry.caseId,
    actorOxyUserId: entry.actorOxyUserId,
    action: entry.action,
    purpose: entry.purpose ?? undefined,
    denialReason: entry.denialReason ?? undefined,
    createdAt: entry.createdAt.toISOString(),
  }));
}
