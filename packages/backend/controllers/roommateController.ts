/**
 * Roommate matching — discovery, preferences, the request handshake and the
 * relationships it produces.
 *
 * `roommate_requests` and `roommate_relationships` moved to Postgres with the
 * roommate batch; this file finishes the job by moving the PROFILE reads that
 * sat beside them. Until now they read Mongo `profiles` while every profile
 * WRITE already went to Postgres, so the two stores had begun to diverge: a
 * preference saved through `PUT /api/profiles/me` was invisible to every
 * roommate endpoint, and a preference saved through this controller was
 * invisible to the profile screen.
 *
 * ## Three filters here matched NOTHING, and are repaired rather than ported
 *
 * `getRoommateProfiles` filtered on `personalProfile.gender`,
 * `personalProfile.location` and `personalProfile.dateOfBirth`.
 * `personalProfileSchema` declares none of them, and `database/connection.ts`
 * sets `strictQuery: false`, so mongoose passed all three through to MongoDB
 * rather than stripping them — where they matched no document, because strict
 * mode (which is ON for writes) meant nothing had ever been stored at those
 * paths. `?gender=`, `?location=` and `?ageRange=` have therefore returned an
 * empty page for the whole life of the feature.
 *
 * `db/profiles/profileRepository.ts`'s `roommateCandidateFilter` carries what
 * each one means now. The short version: gender and ageRange are re-pointed at
 * the roommate PREFERENCE the product really stores, and `location` gets a
 * column, because the write allow-list had been accepting a field mongoose was
 * discarding.
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

import { getDb } from '../db/postgres';
import {
  findHydratedProfilesByOxyUserIds,
  findProfileByOxyUserId,
  searchRoommateCandidates,
  updateProfile,
  type RoommateCandidateQuery,
} from '../db/profiles/profileRepository';
import {
  hasStatedRoommatePreferences,
  toProfileDTO,
  toRoommatePreferencesDTO,
  type HydratedProfile,
} from '../db/profiles/profileSerializer';
import { GENDER_PREFERENCES } from '../db/schema/profiles';
import {
  createRoommateRequest,
  endRoommateRelationship as endRelationshipRow,
  ensureActiveRelationship,
  clampMatchScore,
  listRoommateRelationships,
  listRoommateRequests,
  PendingRoommateRequestExistsError,
  respondToRoommateRequest as respondToRequestRow,
  toRoommateRequestDTO,
  type RoommateRelationshipRow,
  type RoommateRequestRow,
} from '../db/roommates/roommateRepository';
import { logger } from '../middlewares/logging';
import { notificationDispatchService } from '../services/notificationDispatchService';
import { pickFields } from '../utils/pickFields';
import { roommatePreferenceColumns } from './profile/profileWriteColumns';
import {
  EDITABLE_ROOMMATE_PREFERENCE_FIELDS,
  type EditableRoommatePreferenceField,
} from './roommate/editableFields';
import { calculateMatchPercentage, toMatchInputs } from './roommate/matching';
import { hydrateDisplayNames, serializeRoommateProfile } from './roommate/serialize';

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return 'Unknown error';
}

/** Resolve the Oxy user id from the request in the shape the auth layer sets. */
function resolveOxyUserId(req: Request): string | undefined {
  const authed = req as unknown as { user?: { id?: string; _id?: string }; userId?: string };
  return authed.user?.id || authed.user?._id || authed.userId;
}

/**
 * A page of candidates is hydrated (five child reads per page), so an uncapped
 * `?limit=` is a request a client can make arbitrarily expensive. Mongo's
 * `.limit()` took whatever arrived, including a negative number that would make
 * the Postgres `OFFSET` invalid.
 */
const MAX_DISCOVER_PAGE_SIZE = 100;
const DEFAULT_DISCOVER_PAGE_SIZE = 20;

/** A rejected filter value, carrying the message the client is answered with. */
class InvalidFilterError extends Error {}

function positiveInteger(value: unknown, fallback: number, cap?: number): number {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return cap === undefined ? parsed : Math.min(parsed, cap);
}

/**
 * The candidate filters, off the query string.
 *
 * Every malformed value is refused rather than ignored: a filter the API cannot
 * mean is a client mistake, and answering it with an unfiltered page (or, as
 * `maxBudget` did, with an empty one) hides the mistake behind a plausible
 * result. `gender=any` is not a filter — it is the absence of one, which is
 * what the value means in `RoommateFilters` and in the stored vocabulary.
 *
 * @throws {InvalidFilterError} With a message naming the offending parameter.
 */
function parseCandidateFilters(
  query: Request['query'],
  excludeOxyUserId: string,
  limit: number,
  offset: number,
): RoommateCandidateQuery {
  const filters: {
    -readonly [K in keyof RoommateCandidateQuery]: RoommateCandidateQuery[K];
  } = { excludeOxyUserId, limit, offset };

  const gender = query.gender;
  if (typeof gender === 'string' && gender !== '' && gender !== 'any') {
    const member = GENDER_PREFERENCES.find((value) => value === gender);
    if (!member) {
      throw new InvalidFilterError(`gender must be one of ${GENDER_PREFERENCES.join(', ')}`);
    }
    filters.gender = member;
  }

  const location = query.location;
  if (typeof location === 'string' && location.trim() !== '') {
    filters.location = location.trim();
  }

  if (query.ageRange !== undefined && query.ageRange !== '') {
    filters.ageRange = parseAgeRange(query.ageRange);
  }

  if (query.maxBudget !== undefined && query.maxBudget !== '') {
    const maxBudget = Number(query.maxBudget);
    if (!Number.isFinite(maxBudget)) {
      throw new InvalidFilterError('maxBudget must be a number');
    }
    filters.maxBudget = maxBudget;
  }

  // Both arrive as the strings the client's query serializer produced.
  filters.withPets = query.withPets === 'true';
  filters.nonSmoking = query.nonSmoking === 'true';

  return filters;
}

/** `?ageRange={"min":25,"max":30}`, the shape the client's serializer sends. */
function parseAgeRange(raw: unknown): { min: number; max: number } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(String(raw));
  } catch {
    throw new InvalidFilterError('ageRange must be JSON of the form {"min":25,"max":30}');
  }
  const range = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  const min = Number(range.min);
  const max = Number(range.max);
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    throw new InvalidFilterError('ageRange must carry numeric min and max');
  }
  return { min, max };
}

/**
 * Candidate profiles with roommate matching enabled, scored against the
 * caller's own stated preferences.
 *
 * `minMatchPercentage` is the one filter that cannot be a `WHERE` clause: the
 * score is computed from the caller's preferences against each candidate's, so
 * it is applied to the page after it comes back — which is where every one of
 * these filters used to run. The consequence is stated rather than hidden: a
 * page can come back shorter than `total` implies when that parameter is used.
 */
const getRoommateProfiles = async (req: Request, res: Response): Promise<Response | void> => {
  try {
    const oxyUserId = resolveOxyUserId(req);
    if (!oxyUserId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const db = getDb();
    // The caller's profile is resolved from the SESSION, never from a body or a
    // query parameter — `AGENTS.md`'s rule, and the reason the repository is
    // keyed by `oxyUserId` rather than by a profile id.
    const currentProfile = await findProfileByOxyUserId(db, oxyUserId);
    if (!currentProfile) {
      return res.status(404).json({ error: 'Profile not found' });
    }

    const page = positiveInteger(req.query.page, 1);
    const limit = positiveInteger(
      req.query.limit,
      DEFAULT_DISCOVER_PAGE_SIZE,
      MAX_DISCOVER_PAGE_SIZE,
    );

    let filters: RoommateCandidateQuery;
    try {
      filters = parseCandidateFilters(req.query, oxyUserId, limit, (page - 1) * limit);
    } catch (error) {
      if (error instanceof InvalidFilterError) {
        return res.status(400).json({ error: error.message });
      }
      throw error;
    }

    const { candidates, total } = await searchRoommateCandidates(db, filters);

    const mine = toMatchInputs(currentProfile);
    let scored = candidates.map((candidate) => ({
      ...toProfileDTO(candidate, 'public'),
      matchPercentage: calculateMatchPercentage(mine, toMatchInputs(candidate.profile)),
    }));

    const minMatchPercentage = req.query.minMatchPercentage;
    if (minMatchPercentage !== undefined && minMatchPercentage !== '') {
      const threshold = Number(minMatchPercentage);
      if (!Number.isFinite(threshold)) {
        return res.status(400).json({ error: 'minMatchPercentage must be a number' });
      }
      scored = scored.filter((candidate) => candidate.matchPercentage >= threshold);
    }

    // A stable sort, so candidates who score the same keep the `updated_at`
    // order the query returned them in.
    scored.sort((first, second) => second.matchPercentage - first.matchPercentage);

    res.json({
      profiles: scored,
      total,
      page,
      totalPages: Math.ceil(total / limit),
    });
  } catch (error) {
    logger.error('Failed to fetch roommate profiles', { error: errorMessage(error) });
    res.status(500).json({ error: 'Failed to fetch roommate profiles' });
  }
};

// Get current user's roommate preferences
const getMyRoommatePreferences = async (req: Request, res: Response): Promise<Response | void> => {
  try {
    const oxyUserId = resolveOxyUserId(req);
    if (!oxyUserId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const profile = await findProfileByOxyUserId(getDb(), oxyUserId);
    if (!profile) {
      return res.status(404).json({ error: 'Profile not found' });
    }

    // `null` means "never answered", and it is a different answer from an
    // object full of nulls — see `hasStatedRoommatePreferences`.
    res.json({
      data: hasStatedRoommatePreferences(profile) ? toRoommatePreferencesDTO(profile) : null,
    });
  } catch (error) {
    logger.error('Failed to fetch roommate preferences', { error: errorMessage(error) });
    res.status(500).json({ error: 'Failed to fetch roommate preferences' });
  }
};

/**
 * Update the caller's roommate preferences.
 *
 * PARTIAL at the field level, which is what the Mongo version's per-path `$set`
 * did: a body naming `budget` alone must not blank `lifestyle`. That is the
 * whole difference from `PUT /api/profiles/me`, which sends the block and
 * replaces it — and it is expressed by WHICH fields are passed to
 * `roommatePreferenceColumns`, not by a second mapping.
 */
const updateRoommatePreferences = async (req: Request, res: Response): Promise<Response | void> => {
  try {
    const oxyUserId = resolveOxyUserId(req);
    if (!oxyUserId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const db = getDb();
    const profile = await findProfileByOxyUserId(db, oxyUserId);
    if (!profile) {
      return res.status(404).json({ error: 'Profile not found' });
    }

    const picked = pickFields<Record<string, unknown>>(
      req.body,
      EDITABLE_ROOMMATE_PREFERENCE_FIELDS,
    );
    // Filtered from the tuple rather than read off `Object.keys(picked)`, so the
    // field names stay the literal union the mapper switches over instead of
    // being cast back to it.
    const present: EditableRoommatePreferenceField[] = EDITABLE_ROOMMATE_PREFERENCE_FIELDS.filter(
      (field) => field in picked,
    );
    const columns = roommatePreferenceColumns(picked, present);
    if (typeof req.body?.enabled === 'boolean') {
      columns.settingsRoommateEnabled = req.body.enabled;
    }

    // ONE transaction: `updateProfile` issues several statements, and a partial
    // application would leave the person's preferences in a state that was
    // never saved.
    const updated = await db.transaction((tx) => updateProfile(tx, oxyUserId, { columns }));

    res.json({
      data: hasStatedRoommatePreferences(updated.profile)
        ? toRoommatePreferencesDTO(updated.profile)
        : null,
      enabled: updated.profile.settingsRoommateEnabled ?? false,
    });
  } catch (error) {
    logger.error('Failed to update roommate preferences', { error: errorMessage(error) });
    res.status(500).json({ error: 'Failed to update roommate preferences' });
  }
};

/**
 * Turn roommate matching on or off.
 *
 * A non-boolean `enabled` is a 400. Mongoose CAST whatever arrived to the
 * column's declared Boolean and stored the result, so `'yes'` was an error and
 * `'true'` was silently a `true`; the sibling handler above already treats a
 * non-boolean `enabled` as "not provided". For an endpoint whose entire payload
 * is that one flag, guessing is worse than saying so.
 */
const toggleRoommateMatching = async (req: Request, res: Response): Promise<Response | void> => {
  try {
    const oxyUserId = resolveOxyUserId(req);
    if (!oxyUserId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const { enabled } = req.body ?? {};
    if (typeof enabled !== 'boolean') {
      return res.status(400).json({ error: 'enabled must be a boolean' });
    }

    const db = getDb();
    const profile = await findProfileByOxyUserId(db, oxyUserId);
    if (!profile) {
      return res.status(404).json({ error: 'Profile not found' });
    }

    const updated = await db.transaction((tx) =>
      updateProfile(tx, oxyUserId, { columns: { settingsRoommateEnabled: enabled } }),
    );
    const updatedEnabled = updated.profile.settingsRoommateEnabled ?? false;

    res.json({
      message: `Roommate matching ${updatedEnabled ? 'enabled' : 'disabled'} successfully`,
      enabled: updatedEnabled,
    });
  } catch (error) {
    logger.error('Failed to toggle roommate matching', { error: errorMessage(error) });
    res.status(500).json({ error: 'Failed to toggle roommate matching' });
  }
};

/**
 * The participant profiles and Oxy display names for a set of Oxy account ids.
 *
 * One batched profile read for the whole list rather than one per participant,
 * and one `POST /users/by-ids` beside it — the two lists below are the only
 * callers and both need exactly this pair.
 */
async function loadParticipants(oxyUserIds: readonly string[]): Promise<{
  profiles: Map<string, HydratedProfile>;
  displayNames: Map<string, string>;
}> {
  const [profiles, displayNames] = await Promise.all([
    findHydratedProfilesByOxyUserIds(getDb(), oxyUserIds),
    hydrateDisplayNames(oxyUserIds),
  ]);
  return { profiles, displayNames };
}

/** Serialize a single request row with hydrated display names + score. */
const serializeRequest = (
  request: RoommateRequestRow,
  profileByOxyUserId: Map<string, HydratedProfile>,
  displayNames: Map<string, string>,
) => {
  const senderProfile = profileByOxyUserId.get(request.fromOxyUserId);
  const receiverProfile = profileByOxyUserId.get(request.toOxyUserId);
  return {
    id: request.id,
    senderOxyUserId: request.fromOxyUserId,
    receiverOxyUserId: request.toOxyUserId,
    sender: serializeRoommateProfile(senderProfile, displayNames),
    receiver: serializeRoommateProfile(receiverProfile, displayNames),
    status: request.status,
    message: request.message,
    matchScore: calculateMatchPercentage(
      senderProfile && toMatchInputs(senderProfile.profile),
      receiverProfile && toMatchInputs(receiverProfile.profile),
    ),
    createdAt: request.createdAt,
  };
};

// Get roommate requests
const getRoommateRequests = async (req: Request, res: Response): Promise<Response | void> => {
  try {
    const oxyUserId = resolveOxyUserId(req);
    if (!oxyUserId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const profile = await findProfileByOxyUserId(getDb(), oxyUserId);
    if (!profile) {
      return res.status(404).json({ error: 'Profile not found' });
    }

    const { sent, received } = await listRoommateRequests(getDb(), oxyUserId);

    const participantOxyUserIds = Array.from(
      new Set(
        [...sent, ...received].flatMap((request) => [request.fromOxyUserId, request.toOxyUserId]),
      ),
    );
    const { profiles, displayNames } = await loadParticipants(participantOxyUserIds);

    res.json({
      data: {
        sent: sent.map((request) => serializeRequest(request, profiles, displayNames)),
        received: received.map((request) => serializeRequest(request, profiles, displayNames)),
      },
    });
  } catch (error) {
    logger.error('Failed to fetch roommate requests', { error: errorMessage(error) });
    res.status(500).json({ error: 'Failed to fetch roommate requests' });
  }
};

// Send roommate request
const sendRoommateRequest = async (req: Request, res: Response): Promise<Response | void> => {
  try {
    const { oxyUserId: targetOxyUserId } = req.params;
    const { message } = req.body;
    const oxyUserId = resolveOxyUserId(req);

    if (!oxyUserId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const db = getDb();
    const currentProfile = await findProfileByOxyUserId(db, oxyUserId);
    if (!currentProfile) {
      return res.status(404).json({ error: 'Profile not found' });
    }

    if (!targetOxyUserId) {
      return res.status(400).json({ error: 'Target oxy user id is required' });
    }

    if (oxyUserId === targetOxyUserId) {
      return res.status(400).json({ error: 'You cannot send a roommate request to yourself' });
    }

    const targetProfile = await findProfileByOxyUserId(db, targetOxyUserId);
    if (!targetProfile) {
      return res.status(404).json({ error: 'Target user profile not found' });
    }

    if (targetProfile.settingsRoommateEnabled !== true) {
      return res.status(400).json({ error: 'Target user does not have roommate matching enabled' });
    }

    // The "already pending?" read is GONE in the forward direction: it was a
    // read-then-write with a window, and `roommate_requests_pending_pair_key`
    // is a real partial unique index. The repository raises the same 409 from
    // the index's own `23505`, and still reads for the REVERSE direction, which
    // no single-column index can express.
    let request;
    try {
      request = await createRoommateRequest(db, {
        fromOxyUserId: oxyUserId,
        toOxyUserId: targetOxyUserId,
        message: typeof message === 'string' ? message : undefined,
      });
    } catch (error) {
      if (error instanceof PendingRoommateRequestExistsError) {
        return res.status(409).json({ error: 'A pending roommate request already exists between these users' });
      }
      throw error;
    }

    await notificationDispatchService.createForUser(targetOxyUserId, {
      type: 'roommate',
      title: 'New roommate request',
      message: 'Someone sent you a roommate request.',
      priority: 'high',
      data: { requestId: request.id, screen: '/roommates' },
    });

    res.status(201).json({
      message: 'Roommate request sent successfully',
      data: toRoommateRequestDTO(request),
    });
  } catch (error) {
    logger.error('Failed to send roommate request', { error: errorMessage(error) });
    res.status(500).json({ error: 'Failed to send roommate request' });
  }
};

/**
 * Create (idempotently) the roommate relationship for an accepted request.
 *
 * The pair is sorted by the repository and the sort is enforced by
 * `roommate_relationships_sorted_pair_check`, so a writer that skipped it fails
 * loudly instead of producing a second, invisible row for the same two people.
 */
const createRelationshipForAcceptedRequest = async (request: RoommateRequestRow) => {
  const db = getDb();
  const [fromProfile, toProfile] = await Promise.all([
    findProfileByOxyUserId(db, request.fromOxyUserId),
    findProfileByOxyUserId(db, request.toOxyUserId),
  ]);
  const matchScore = calculateMatchPercentage(
    fromProfile && toMatchInputs(fromProfile),
    toProfile && toMatchInputs(toProfile),
  );

  return ensureActiveRelationship(db, {
    requestId: request.id,
    fromOxyUserId: request.fromOxyUserId,
    toOxyUserId: request.toOxyUserId,
    matchScore: clampMatchScore(matchScore),
  });
};

// Respond to a roommate request (accept/decline) - only the recipient may respond
const respondToRoommateRequest = async (req: Request, res: Response, status: 'accepted' | 'declined'): Promise<Response | void> => {
  const action = status === 'accepted' ? 'accept' : 'decline';
  try {
    const { requestId } = req.params;
    const oxyUserId = resolveOxyUserId(req);

    if (!oxyUserId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    // The `ObjectId.isValid` guard is DELETED rather than widened (`db/ids.ts`):
    // post-cutover every request id is a uuid v7, which that guard rejects. The
    // `UPDATE` below already answers "no such pending request of yours" for a
    // malformed id, an unknown one and somebody else's alike.
    const request = await respondToRequestRow(getDb(), requestId, oxyUserId, status);

    if (!request) {
      return res.status(404).json({ error: 'Roommate request not found' });
    }

    // On accept, materialize the confirmed relationship (idempotent insert).
    if (status === 'accepted') {
      await createRelationshipForAcceptedRequest(request);
    }

    // Notify the original sender of the accept/decline decision.
    await notificationDispatchService.createForUser(request.fromOxyUserId, {
      type: 'roommate',
      title: status === 'accepted' ? 'Roommate request accepted' : 'Roommate request declined',
      message:
        status === 'accepted'
          ? 'Your roommate request was accepted.'
          : 'Your roommate request was declined.',
      priority: 'medium',
      data: { requestId: request.id, screen: '/roommates' },
    });

    res.json({
      message: `Roommate request ${status} successfully`,
      data: toRoommateRequestDTO(request),
    });
  } catch (error) {
    logger.error(`Failed to ${action} roommate request`, { error: errorMessage(error) });
    res.status(500).json({ error: `Failed to ${action} roommate request` });
  }
};

// Accept roommate request
const acceptRoommateRequest = async (req: Request, res: Response): Promise<Response | void> => {
  return respondToRoommateRequest(req, res, 'accepted');
};

// Decline roommate request
const declineRoommateRequest = async (req: Request, res: Response): Promise<Response | void> => {
  return respondToRoommateRequest(req, res, 'declined');
};

/** Serialize a relationship row with hydrated display names. */
const serializeRelationship = (
  relationship: RoommateRelationshipRow,
  profileByOxyUserId: Map<string, HydratedProfile>,
  displayNames: Map<string, string>,
) => ({
  id: relationship.id,
  oxyUser1Id: relationship.oxyUser1Id,
  oxyUser2Id: relationship.oxyUser2Id,
  profile1: serializeRoommateProfile(profileByOxyUserId.get(relationship.oxyUser1Id), displayNames),
  profile2: serializeRoommateProfile(profileByOxyUserId.get(relationship.oxyUser2Id), displayNames),
  status: relationship.status,
  matchScore: relationship.matchScore,
  startDate: relationship.startDate,
  endDate: relationship.endDate,
});

// Get roommate relationships for the current profile
const getRoommateRelationships = async (req: Request, res: Response): Promise<Response | void> => {
  try {
    const oxyUserId = resolveOxyUserId(req);
    if (!oxyUserId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const profile = await findProfileByOxyUserId(getDb(), oxyUserId);
    if (!profile) {
      return res.status(404).json({ error: 'Profile not found' });
    }

    const relationships = await listRoommateRelationships(getDb(), oxyUserId);

    const participantOxyUserIds = Array.from(
      new Set(
        relationships.flatMap((relationship) => [relationship.oxyUser1Id, relationship.oxyUser2Id]),
      ),
    );
    const { profiles, displayNames } = await loadParticipants(participantOxyUserIds);

    res.json({
      data: relationships.map((relationship) =>
        serializeRelationship(relationship, profiles, displayNames),
      ),
    });
  } catch (error) {
    logger.error('Failed to fetch roommate relationships', { error: errorMessage(error) });
    res.status(500).json({ error: 'Failed to fetch roommate relationships' });
  }
};

// End a roommate relationship - only a participant may end it
const endRoommateRelationship = async (req: Request, res: Response): Promise<Response | void> => {
  try {
    const { relationshipId } = req.params;
    const oxyUserId = resolveOxyUserId(req);

    if (!oxyUserId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const profile = await findProfileByOxyUserId(getDb(), oxyUserId);
    if (!profile) {
      return res.status(404).json({ error: 'Profile not found' });
    }

    // The caller must be one of the two participants; a non-participant sees the
    // same 404 as a missing relationship (no existence leak). Both facts are in
    // the `UPDATE`'s predicate, so there is no window between the check and the
    // write — and the `ObjectId.isValid` guard is deleted rather than widened,
    // for the reason `db/ids.ts` gives.
    const relationship = await endRelationshipRow(getDb(), relationshipId, oxyUserId);

    if (!relationship) {
      return res.status(404).json({ error: 'Roommate relationship not found' });
    }

    const otherOxyUserId =
      relationship.oxyUser1Id === oxyUserId ? relationship.oxyUser2Id : relationship.oxyUser1Id;

    await notificationDispatchService.createForUser(otherOxyUserId, {
      type: 'roommate',
      title: 'Roommate relationship ended',
      message: 'A roommate relationship was ended.',
      priority: 'medium',
      data: { relationshipId: relationship.id, screen: '/roommates' },
    });

    res.json({
      message: 'Roommate relationship ended successfully',
      data: { id: relationship.id, status: relationship.status },
    });
  } catch (error) {
    logger.error('Failed to end roommate relationship', { error: errorMessage(error) });
    res.status(500).json({ error: 'Failed to end roommate relationship' });
  }
};

/**
 * The caller's own matching status.
 *
 * `id` and not `_id`: the Mongoose `toJSON` transform renamed it, this handler
 * bypassed the transform by reading `profile._id` directly, and #287 made the
 * rename the wire contract.
 */
const getCurrentUserRoommateStatus = async (req: Request, res: Response): Promise<Response | void> => {
  try {
    const oxyUserId = resolveOxyUserId(req);
    if (!oxyUserId) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const profile = await findProfileByOxyUserId(getDb(), oxyUserId);
    if (!profile) {
      return res.status(404).json({ error: 'Profile not found' });
    }

    res.json({
      hasRoommateMatching: profile.settingsRoommateEnabled === true,
      profile: {
        id: profile.id,
        oxyUserId: profile.oxyUserId,
        roommatePreferences: hasStatedRoommatePreferences(profile)
          ? toRoommatePreferencesDTO(profile)
          : null,
      },
    });
  } catch (error) {
    logger.error('Failed to fetch roommate status', { error: errorMessage(error) });
    res.status(500).json({ error: 'Failed to fetch roommate status' });
  }
};

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
  getCurrentUserRoommateStatus
};
