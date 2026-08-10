/**
 * The exact-location endpoints: grant, revoke, read, and read the audit.
 *
 * ADR 0003 §10 says access to a tier-R record is *"relationship-derived,
 * purpose-bound, time-bound, revocable and audited, with no standing access"*,
 * and #358 repeats it for this surface: an explicitly authorised actor, a
 * concrete purpose, a limited duration, access auditing, revocation, and never
 * in a push, an email or a URL.
 *
 * ## The exact location is never in a URL, a push or a cached response
 *
 * It is the BODY of one `GET`, on the authenticated router, with
 * `Cache-Control: no-store` set by hand on the response. The case id is what
 * appears in the path; the coordinate does not. No notification payload carries
 * it — `notificationDispatchService` payloads are rendered by whatever shows the
 * push, which ADR 0003 §4.6 counts as a publication.
 *
 * ## Two gates, and both are the organiser's to open
 *
 * The affected household must have authorised exact disclosure at all, and the
 * caller must hold a live grant. `resolveExactLocation` checks both and audits
 * every outcome including the refusals — an audit that records only successes
 * cannot answer "did anybody try".
 *
 * ## Who reads the audit
 *
 * The organiser. §10.6 puts it in the hands of the person with the strongest
 * interest in noticing an improper access, and §7.2 deliberately does not store
 * the affected household as an actor, so there is nobody else it can be handed
 * to. That is a compromise and it is worth naming as one: the subject of the
 * data is not the reader of its audit here, because storing the subject would be
 * the larger harm.
 */

import {
  grantLocationAccess,
  listAccessAudit,
  listLiveGrants,
  resolveExactLocation,
  revokeLocationAccess,
  MAX_GRANT_HOURS,
} from '../../db/evictions/evictionAccessRepository';
import { findEvictionCase } from '../../db/evictions/evictionRepository';
import { parseGrantPurpose } from './shared';
import { AppError, successResponse } from '../../middlewares/errorHandler';
import { requireSessionOxyUserId } from '../../utils/sessionUser';
import type { ControllerNext, ControllerRequest, ControllerResponse } from '../controllerTypes';

const MAX_AUDIT_PAGE = 200;

/** The organiser of `caseId`, or a 404 for everybody else. */
async function requireOwnedCase(caseId: string, oxyUserId: string) {
  const evictionCase = await findEvictionCase(caseId);
  if (!evictionCase || evictionCase.oxyUserId !== oxyUserId) return undefined;
  return evictionCase;
}

export async function createLocationGrant(
  req: ControllerRequest,
  res: ControllerResponse,
  next: ControllerNext,
) {
  try {
    const { id } = req.params;
    const oxyUserId = requireSessionOxyUserId(req);

    const owned = await requireOwnedCase(id, oxyUserId);
    if (!owned) return next(new AppError('Eviction case not found', 404, 'EVICTION_NOT_FOUND'));

    if (owned.locationHouseholdAuthorizedAt === null) {
      return next(
        new AppError(
          'This case has no exact location to share. The affected household has to ask for it.',
          409,
          'HOUSEHOLD_NOT_AUTHORIZED',
        ),
      );
    }

    const granteeOxyUserId =
      typeof req.body?.granteeOxyUserId === 'string' ? req.body.granteeOxyUserId.trim() : '';
    if (!granteeOxyUserId) {
      return next(new AppError('A grantee is required', 400, 'INVALID_GRANTEE'));
    }
    if (granteeOxyUserId === oxyUserId) {
      return next(
        new AppError('You already hold this case; a grant would record nothing.', 400, 'INVALID_GRANTEE'),
      );
    }

    const purpose = parseGrantPurpose(req.body?.purpose);
    if (!purpose) {
      return next(
        new AppError(
          'A concrete purpose is required: legal_representation, accompaniment or emergency_housing.',
          400,
          'INVALID_PURPOSE',
        ),
      );
    }

    const hours = Number(req.body?.hours);
    if (!Number.isFinite(hours) || hours <= 0) {
      return next(new AppError('A positive duration in hours is required', 400, 'INVALID_DURATION'));
    }

    const grant = await grantLocationAccess({
      caseId: id,
      granteeOxyUserId,
      grantedByOxyUserId: oxyUserId,
      purpose,
      hours,
    });

    res.status(201).json(
      successResponse(
        {
          id: grant.id,
          caseId: grant.caseId,
          granteeOxyUserId: grant.granteeOxyUserId,
          purpose: grant.purpose,
          grantedAt: grant.grantedAt.toISOString(),
          expiresAt: grant.expiresAt.toISOString(),
          maxGrantHours: MAX_GRANT_HOURS,
        },
        'Exact location access granted',
      ),
    );
  } catch (error) {
    next(error);
  }
}

export async function revokeLocationGrant(
  req: ControllerRequest,
  res: ControllerResponse,
  next: ControllerNext,
) {
  try {
    const { id, oxyUserId: grantee } = req.params;
    const oxyUserId = requireSessionOxyUserId(req);

    const owned = await requireOwnedCase(id, oxyUserId);
    if (!owned) return next(new AppError('Eviction case not found', 404, 'EVICTION_NOT_FOUND'));

    const revoked = await revokeLocationAccess({
      caseId: id,
      granteeOxyUserId: grantee,
      revokedByOxyUserId: oxyUserId,
    });
    res.json(successResponse({ revoked }, revoked ? 'Access revoked' : 'Nothing to revoke'));
  } catch (error) {
    next(error);
  }
}

/** The live grants on a case, for the organiser's own management screen. */
export async function listLocationGrants(
  req: ControllerRequest,
  res: ControllerResponse,
  next: ControllerNext,
) {
  try {
    const { id } = req.params;
    const oxyUserId = requireSessionOxyUserId(req);

    const owned = await requireOwnedCase(id, oxyUserId);
    if (!owned) return next(new AppError('Eviction case not found', 404, 'EVICTION_NOT_FOUND'));

    const grants = await listLiveGrants(id);
    res.json(
      successResponse(
        grants.map((grant) => ({
          id: grant.id,
          caseId: grant.caseId,
          granteeOxyUserId: grant.granteeOxyUserId,
          purpose: grant.purpose,
          grantedAt: grant.grantedAt.toISOString(),
          expiresAt: grant.expiresAt.toISOString(),
        })),
        'Live location grants',
      ),
    );
  } catch (error) {
    next(error);
  }
}

/**
 * Serve the exact location to a grant holder.
 *
 * `Cache-Control: no-store` is set explicitly rather than left to a default:
 * #358 requires that a precise location is *"no cachearla en respuestas
 * públicas"*, and a response body that a proxy or a client keeps is the same
 * disclosure with a delay.
 */
export async function getExactLocation(
  req: ControllerRequest,
  res: ControllerResponse,
  next: ControllerNext,
) {
  try {
    const { id } = req.params;
    const oxyUserId = requireSessionOxyUserId(req);

    const evictionCase = await findEvictionCase(id);
    if (!evictionCase) {
      return next(new AppError('Eviction case not found', 404, 'EVICTION_NOT_FOUND'));
    }

    const outcome = await resolveExactLocation({ caseId: id, requesterOxyUserId: oxyUserId });
    if (outcome.outcome === 'denied') {
      // The reason is told to the CALLER because it changes what they should do
      // next — asking the organiser helps for `no_grant` and `expired`, and does
      // not for `not_authorized_by_household`. It is a fact about their own
      // permission, not about the household.
      return next(
        new AppError(
          'You do not have access to this location.',
          403,
          `LOCATION_ACCESS_${outcome.reason.toUpperCase()}`,
        ),
      );
    }

    res.set('Cache-Control', 'no-store');
    res.json(successResponse(outcome.location, 'Exact location'));
  } catch (error) {
    next(error);
  }
}

/** Every access decision on a case, for the organiser. */
export async function getLocationAccessAudit(
  req: ControllerRequest,
  res: ControllerResponse,
  next: ControllerNext,
) {
  try {
    const { id } = req.params;
    const oxyUserId = requireSessionOxyUserId(req);

    const owned = await requireOwnedCase(id, oxyUserId);
    if (!owned) return next(new AppError('Eviction case not found', 404, 'EVICTION_NOT_FOUND'));

    const entries = await listAccessAudit(id, MAX_AUDIT_PAGE);
    res.set('Cache-Control', 'no-store');
    res.json(
      successResponse(
        entries.map((entry) => ({
          id: entry.id,
          caseId: entry.caseId,
          actorOxyUserId: entry.actorOxyUserId,
          action: entry.action,
          purpose: entry.purpose ?? undefined,
          denialReason: entry.denialReason ?? undefined,
          createdAt: entry.createdAt.toISOString(),
        })),
        'Location access audit',
      ),
    );
  } catch (error) {
    next(error);
  }
}
