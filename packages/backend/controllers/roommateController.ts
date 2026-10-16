/**
 * Roommate matching — discovery, preferences, the request handshake and the
 * relationships it produces.
 *
 * Requests, relationships AND the profile reads beside them all use the same
 * `profiles` table the profile screen writes, so a preference saved through
 * `PUT /api/profiles/me` and one saved through this controller are the same
 * fact.
 *
 * ## Three filters once matched NOTHING, and are repaired
 *
 * `?gender=`, `?location=` and `?ageRange=` once filtered on fields no row
 * stored and returned an empty page for the whole life of the feature.
 * `db/profiles/profileRepository.ts`'s `roommateCandidateFilter` carries what
 * each one means now. The short version: gender and ageRange are re-pointed at
 * the roommate PREFERENCE the product really stores, and `location` gets a
 * column, because the write allow-list had been accepting a field nothing
 * stored.
 *
 * ## Two behaviour changes worth stating out loud
 *
 *  - **A malformed filter is a 400 rather than a 500 or an empty page.**
 *    `JSON.parse(String(ageRange))` threw into the catch-all and answered 500;
 *    `parseInt('abc')` for `maxBudget` produced `NaN`, and `x >= NaN` is false,
 *    so a typo silently emptied the feed.
 *  - **A participant profile is serialized at PUBLIC visibility.** The request
 *    and relationship lists used to attach `personalProfile` verbatim — annual
 *    income, references, landlord phone numbers, the Sindi transcript — to
 *    anybody who had exchanged a request. See `roommate/serialize.ts`.
 */

import type { Request, Response } from 'express';

import {
  endRoommateRelationship as endRelationship,
  getMyRoommatePreferences as readMyPreferences,
  getMyRoommateStatus,
  listMyRoommateRelationships,
  listMyRoommateRequests,
  listRoommateProfiles,
  respondToRoommateRequest as respondToRequest,
  sendRoommateRequest as sendRequest,
  setRoommateMatching,
  updateMyRoommatePreferences,
} from '../domain/roommates';
import { AppError, describeErrorForLog } from '../middlewares/errorHandler';
import { logger } from '../middlewares/logging';

/**
 * The HTTP edge of roommate matching. Every use case lives in
 * `domain/roommates.ts`, which the capability catalogue calls too; this file
 * resolves the session and keeps the route's historical bodies: `{ error }` on
 * a refusal, and a generic 500 that names the action for anything unexpected.
 */

/** Resolve the Oxy user id from the request in the shape the auth layer sets. */
function resolveOxyUserId(req: Request): string | undefined {
  const authed = req as unknown as { user?: { id?: string; _id?: string }; userId?: string };
  return authed.user?.id || authed.user?._id || authed.userId;
}

/**
 * Run one use case for the session's account and answer it the way this
 * router always has.
 */
async function answer(
  req: Request,
  res: Response,
  failure: string,
  run: (oxyUserId: string) => Promise<Record<string, unknown>>,
  status = 200,
): Promise<Response> {
  try {
    const oxyUserId = resolveOxyUserId(req);
    if (!oxyUserId) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    const body = await run(oxyUserId);
    return res.status(status).json(body);
  } catch (error) {
    if (error instanceof AppError) {
      return res.status(error.statusCode).json({ error: error.message });
    }
    logger.error(failure, { error: describeErrorForLog(error) });
    return res.status(500).json({ error: failure });
  }
}

const getRoommateProfiles = (req: Request, res: Response) =>
  answer(req, res, 'Failed to fetch roommate profiles', (oxyUserId) =>
    listRoommateProfiles(oxyUserId, req.query),
  );

const getMyRoommatePreferences = (req: Request, res: Response) =>
  answer(req, res, 'Failed to fetch roommate preferences', (oxyUserId) =>
    readMyPreferences(oxyUserId),
  );

const updateRoommatePreferences = (req: Request, res: Response) =>
  answer(req, res, 'Failed to update roommate preferences', (oxyUserId) =>
    updateMyRoommatePreferences(oxyUserId, req.body),
  );

const toggleRoommateMatching = (req: Request, res: Response) =>
  answer(req, res, 'Failed to toggle roommate matching', (oxyUserId) =>
    setRoommateMatching(oxyUserId, req.body?.enabled),
  );

const getRoommateRequests = (req: Request, res: Response) =>
  answer(req, res, 'Failed to fetch roommate requests', (oxyUserId) =>
    listMyRoommateRequests(oxyUserId),
  );

const sendRoommateRequest = (req: Request, res: Response) =>
  answer(
    req,
    res,
    'Failed to send roommate request',
    (oxyUserId) =>
      sendRequest(oxyUserId, {
        targetOxyUserId: req.params.oxyUserId,
        message: req.body?.message,
      }),
    201,
  );

const acceptRoommateRequest = (req: Request, res: Response) =>
  answer(req, res, 'Failed to accept roommate request', (oxyUserId) =>
    respondToRequest(oxyUserId, req.params.requestId, 'accepted'),
  );

const declineRoommateRequest = (req: Request, res: Response) =>
  answer(req, res, 'Failed to decline roommate request', (oxyUserId) =>
    respondToRequest(oxyUserId, req.params.requestId, 'declined'),
  );

const getRoommateRelationships = (req: Request, res: Response) =>
  answer(req, res, 'Failed to fetch roommate relationships', (oxyUserId) =>
    listMyRoommateRelationships(oxyUserId),
  );

const endRoommateRelationship = (req: Request, res: Response) =>
  answer(req, res, 'Failed to end roommate relationship', (oxyUserId) =>
    endRelationship(oxyUserId, req.params.relationshipId),
  );

const getCurrentUserRoommateStatus = (req: Request, res: Response) =>
  answer(req, res, 'Failed to fetch roommate status', (oxyUserId) =>
    getMyRoommateStatus(oxyUserId),
  );

export default {
  getRoommateProfiles,
  getMyRoommatePreferences,
  updateRoommatePreferences,
  toggleRoommateMatching,
  getRoommateRequests,
  sendRoommateRequest,
  acceptRoommateRequest,
  declineRoommateRequest,
  getRoommateRelationships,
  endRoommateRelationship,
  getCurrentUserRoommateStatus,
};
