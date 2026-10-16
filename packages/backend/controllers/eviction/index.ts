/**
 * Eviction solidarity board controllers — thin HTTP adapters over
 * `domain/evictions/*`, which the catalogue's eviction tools call too.
 *
 * Every rule (whitelists, sanitising, ownership, the precision a viewer is
 * published, notifications) is in the domain. This file reads the session and
 * the request, picks the status code, and shapes the envelope. The PUBLIC reads
 * (`listEvictions`, `getEvictionById`, `listComments`, `listResources`) are
 * mounted on `routes/public.ts` and read an OPTIONAL viewer; everything else is
 * on the authenticated router and requires one.
 *
 * `teamChat.ts` (MLS team chat) and `publicCards.ts` (the anonymous card
 * surface) are separate surfaces and stay in their own files.
 */

import { getOxyUserId } from '@oxy.so/core/server';

import {
  addEvictionCollaborator,
  clearEvictionHold,
  commentOnEvictionCase,
  deleteEvictionCase,
  deleteEvictionCaseComment,
  getEvictionCase,
  getEvictionLocationAudit,
  getEvictionTeam,
  getExactEvictionLocation,
  grantEvictionLocation,
  listAttendingEvictionCases,
  listEvictionBoard,
  listEvictionCaseComments,
  listEvictionLocationGrants,
  listEvictionResources,
  listFollowedEvictionCases,
  listMyEvictionCases,
  postEvictionUpdate,
  removeEvictionCollaborator,
  reportEvictionCase,
  reportEvictionContent,
  revokeEvictionLocationGrant,
  revokeEvictionSupporter,
  toggleEvictionAttendance,
  toggleEvictionFollow,
  updateEvictionCase,
  vouchForEvictionSupporter,
} from '../../domain/evictions';
import { successResponse } from '../../middlewares/errorHandler';
import { requireSessionOxyUserId } from '../../utils/sessionUser';
import type { ControllerNext, ControllerRequest, ControllerResponse } from '../controllerTypes';

type Handler = (
  req: ControllerRequest,
  res: ControllerResponse,
  next: ControllerNext,
) => Promise<void>;

/** One adapter: run the use case, answer `status` with its result, forward any refusal. */
function respond(
  run: (req: ControllerRequest, res: ControllerResponse) => Promise<unknown>,
  message: string | ((data: unknown) => string),
  status = 200,
): Handler {
  return async (req, res, next) => {
    try {
      const data = await run(req, res);
      res
        .status(status)
        .json(successResponse(data, typeof message === 'function' ? message(data) : message));
    } catch (error) {
      next(error);
    }
  };
}

const query = (req: ControllerRequest) => (req.query ?? {}) as Record<string, unknown>;
const noStore = (res: ControllerResponse) => res.setHeader('Cache-Control', 'no-store');

// ── Public reads ────────────────────────────────────────────────────────────

export const listEvictions = respond(
  (req) => listEvictionBoard(getOxyUserId(req), query(req)),
  'Eviction cases',
);

export const getEvictionById = respond(
  (req) => getEvictionCase(getOxyUserId(req), req.params.id),
  'Eviction case',
);

export const listComments = respond(
  (req) => listEvictionCaseComments(req.params.id, query(req)),
  'Comments',
);

export const listResources = respond(
  (req) =>
    listEvictionResources({ countryCode: req.query.countryCode, regionId: req.query.regionId }),
  'Jurisdiction resources',
);

// ── The person's own lists ──────────────────────────────────────────────────

export const listMyEvictions = respond(
  (req) => listMyEvictionCases(requireSessionOxyUserId(req), query(req)),
  'My eviction cases',
);

export const listAttendingEvictions = respond(
  (req) => listAttendingEvictionCases(requireSessionOxyUserId(req), query(req)),
  'Attending eviction cases',
);

export const listFollowedEvictions = respond(
  (req) => listFollowedEvictionCases(requireSessionOxyUserId(req), query(req)),
  'Followed eviction cases',
);

// ── Writes ──────────────────────────────────────────────────────────────────

export const createEviction = respond(
  (req) => reportEvictionCase(requireSessionOxyUserId(req), req.body),
  'Eviction case created',
  201,
);

export const updateEviction = respond(
  (req) => updateEvictionCase(requireSessionOxyUserId(req), req.params.id, req.body),
  'Eviction case updated',
);

export const deleteEviction = respond(async (req) => {
  await deleteEvictionCase(requireSessionOxyUserId(req), req.params.id);
  return null;
}, 'Eviction case deleted');

export const createUpdate = respond(
  (req) => postEvictionUpdate(requireSessionOxyUserId(req), req.params.id, req.body),
  'Update posted',
  201,
);

export const clearHold = respond(
  (req) => clearEvictionHold(requireSessionOxyUserId(req), req.params.id, req.body?.message),
  'Hold cleared',
);

// ── Supporters and following ────────────────────────────────────────────────

export const toggleAttend = respond(
  (req) => toggleEvictionAttendance(requireSessionOxyUserId(req), req.params.id),
  (data) =>
    (data as { attending: boolean }).attending
      ? 'You are attending this case'
      : 'You are no longer attending this case',
);

export const toggleFollowEviction = respond(
  (req) => toggleEvictionFollow(requireSessionOxyUserId(req), req.params.id),
  (data) =>
    (data as { following: boolean }).following
      ? 'You are following this case'
      : 'You are no longer following this case',
);

export const vouchForSupporter = respond(
  (req) =>
    vouchForEvictionSupporter(requireSessionOxyUserId(req), req.params.id, req.params.oxyUserId),
  'Vouch recorded',
);

export const revokeAttendee = respond(
  (req) =>
    revokeEvictionSupporter(requireSessionOxyUserId(req), req.params.id, req.params.oxyUserId),
  (data) => ((data as { revoked: boolean }).revoked ? 'Access revoked' : 'Nothing to revoke'),
);

// ── Team ────────────────────────────────────────────────────────────────────

export const getTeam: Handler = async (req, res, next) => {
  try {
    const team = await getEvictionTeam(requireSessionOxyUserId(req), req.params.id);
    noStore(res);
    res.json(successResponse(team));
  } catch (error) {
    next(error);
  }
};

export const addCollaborator: Handler = async (req, res, next) => {
  try {
    const result = await addEvictionCollaborator(requireSessionOxyUserId(req), req.params.id, {
      oxyUserId: req.body?.oxyUserId,
      acknowledgeExactLocationAccess: req.body?.acknowledgeExactLocationAccess,
    });
    res.json(successResponse(result));
  } catch (error) {
    next(error);
  }
};

export const removeCollaborator: Handler = async (req, res, next) => {
  try {
    const result = await removeEvictionCollaborator(
      requireSessionOxyUserId(req),
      req.params.id,
      req.params.oxyUserId,
    );
    res.json(successResponse(result));
  } catch (error) {
    next(error);
  }
};

// ── Exact location ──────────────────────────────────────────────────────────

export const createLocationGrant = respond(
  (req) =>
    grantEvictionLocation(requireSessionOxyUserId(req), req.params.id, {
      granteeOxyUserId: req.body?.granteeOxyUserId,
      purpose: req.body?.purpose,
      hours: req.body?.hours,
    }),
  'Exact location access granted',
  201,
);

export const revokeLocationGrant = respond(
  (req) =>
    revokeEvictionLocationGrant(requireSessionOxyUserId(req), req.params.id, req.params.oxyUserId),
  (data) => ((data as { revoked: boolean }).revoked ? 'Access revoked' : 'Nothing to revoke'),
);

export const listLocationGrants = respond(
  (req) => listEvictionLocationGrants(requireSessionOxyUserId(req), req.params.id),
  'Live location grants',
);

/**
 * `Cache-Control: no-store` is set explicitly: #358 requires that a precise
 * location is *"no cachearla en respuestas públicas"*, and a body a proxy keeps
 * is the same disclosure with a delay. Set only once access was granted.
 */
export const getExactLocation = respond(async (req, res) => {
  const location = await getExactEvictionLocation(requireSessionOxyUserId(req), req.params.id);
  res.set('Cache-Control', 'no-store');
  return location;
}, 'Exact location');

export const getLocationAccessAudit = respond(async (req, res) => {
  const audit = await getEvictionLocationAudit(requireSessionOxyUserId(req), req.params.id);
  res.set('Cache-Control', 'no-store');
  return audit;
}, 'Location access audit');

// ── Comments and reports ────────────────────────────────────────────────────

export const createComment = respond(
  (req) => commentOnEvictionCase(requireSessionOxyUserId(req), req.params.id, req.body),
  'Comment posted',
  201,
);

export const deleteComment = respond(async (req) => {
  await deleteEvictionCaseComment(
    requireSessionOxyUserId(req),
    req.params.id,
    req.params.commentId,
  );
  return null;
}, 'Comment deleted');

/** A new report answers 201; the reporter's report already on record answers 200. */
export const createEvictionReport: Handler = async (req, res, next) => {
  try {
    const outcome = await reportEvictionContent(
      requireSessionOxyUserId(req),
      req.params.id,
      req.body,
    );
    res
      .status(outcome.created ? 201 : 200)
      .json(
        successResponse(
          outcome.report,
          outcome.created ? 'Report submitted' : 'Report already submitted',
        ),
      );
  } catch (error) {
    next(error);
  }
};
