/**
 * Roommate matching — discovery, preferences, the request handshake and the
 * relationships it produces — as use cases.
 *
 * The caller is the `oxyUserId` given (the session on `/api/roommates/*`, the
 * effective account on the capability lane), never a body or query field. A
 * request is answered only by its RECIPIENT and a relationship ended only by a
 * participant, both enforced in the repository's `UPDATE` predicate, so anybody
 * else gets the same not-found as a missing row. Participant profiles are
 * serialized at PUBLIC visibility (`controllers/roommate/serialize.ts`), and
 * every notification goes through `notificationDispatchService`.
 *
 * Refusals are `AppError`s carrying the exact message the route has always
 * answered with; `controllers/roommateController.ts` renders them in its
 * historical `{ error }` body.
 */

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
import { AppError } from '../middlewares/errorHandler';
import { notificationDispatchService } from '../services/notificationDispatchService';
import { pickFields } from '../utils/pickFields';
import { roommatePreferenceColumns } from '../controllers/profile/profileWriteColumns';
import {
  EDITABLE_ROOMMATE_PREFERENCE_FIELDS,
  type EditableRoommatePreferenceField,
} from '../controllers/roommate/editableFields';
import { calculateMatchPercentage, toMatchInputs } from '../controllers/roommate/matching';
import { hydrateDisplayNames, serializeRoommateProfile } from '../controllers/roommate/serialize';

/** The discovery query, in the string shape the route's query string carries. */
export type RoommateQuery = Readonly<Record<string, unknown>>;

function profileNotFound(): AppError {
  return new AppError('Profile not found', 404, 'PROFILE_NOT_FOUND');
}

/** The caller's own profile row, or the route's 404. */
async function requireOwnProfile(oxyUserId: string) {
  const profile = await findProfileByOxyUserId(getDb(), oxyUserId);
  if (!profile) throw profileNotFound();
  return profile;
}

/**
 * A page of candidates is hydrated (five child reads per page), so an uncapped
 * `?limit=` is a request a client can make arbitrarily expensive, and a negative
 * number would make the Postgres `OFFSET` invalid.
 */
const MAX_DISCOVER_PAGE_SIZE = 100;
const DEFAULT_DISCOVER_PAGE_SIZE = 20;

/** A rejected filter value: the route's 400, carrying the message the client is answered with. */
function invalidFilter(message: string): AppError {
  return new AppError(message, 400, 'INVALID_FILTER');
}

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
 * @throws {AppError} 400 With a message naming the offending parameter.
 */
function parseCandidateFilters(
  query: RoommateQuery,
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
      throw invalidFilter(`gender must be one of ${GENDER_PREFERENCES.join(', ')}`);
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
      throw invalidFilter('maxBudget must be a number');
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
    throw invalidFilter('ageRange must be JSON of the form {"min":25,"max":30}');
  }
  const range = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  const min = Number(range.min);
  const max = Number(range.max);
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    throw invalidFilter('ageRange must carry numeric min and max');
  }
  return { min, max };
}

/**
 * Candidate profiles with roommate matching enabled, scored against the
 * caller's own stated preferences.
 *
 * `minMatchPercentage` is the one filter that cannot be a `WHERE` clause: the
 * score is computed from the caller's preferences against each candidate's, so
 * it is applied to the page after it comes back. The consequence is stated
 * rather than hidden: a page can come back shorter than `total` implies when
 * that parameter is used.
 */
export async function listRoommateProfiles(oxyUserId: string, query: RoommateQuery = {}) {
  const db = getDb();
  const currentProfile = await requireOwnProfile(oxyUserId);

  const page = positiveInteger(query.page, 1);
  const limit = positiveInteger(query.limit, DEFAULT_DISCOVER_PAGE_SIZE, MAX_DISCOVER_PAGE_SIZE);
  const filters = parseCandidateFilters(query, oxyUserId, limit, (page - 1) * limit);

  const { candidates, total } = await searchRoommateCandidates(db, filters);

  const mine = toMatchInputs(currentProfile);
  let scored = candidates.map((candidate) => ({
    ...toProfileDTO(candidate, 'public'),
    matchPercentage: calculateMatchPercentage(mine, toMatchInputs(candidate.profile)),
  }));

  const minMatchPercentage = query.minMatchPercentage;
  if (minMatchPercentage !== undefined && minMatchPercentage !== '') {
    const threshold = Number(minMatchPercentage);
    if (!Number.isFinite(threshold)) throw invalidFilter('minMatchPercentage must be a number');
    scored = scored.filter((candidate) => candidate.matchPercentage >= threshold);
  }

  // A stable sort, so candidates who score the same keep the `updated_at`
  // order the query returned them in.
  scored.sort((first, second) => second.matchPercentage - first.matchPercentage);

  return { profiles: scored, total, page, totalPages: Math.ceil(total / limit) };
}

/** The caller's roommate preferences; `data: null` means "never answered". */
export async function getMyRoommatePreferences(oxyUserId: string) {
  const profile = await requireOwnProfile(oxyUserId);
  return { data: hasStatedRoommatePreferences(profile) ? toRoommatePreferencesDTO(profile) : null };
}

/**
 * Update the caller's roommate preferences, PARTIAL at the field level (a body
 * naming `budget` alone must not blank `lifestyle`), through
 * `EDITABLE_ROOMMATE_PREFERENCE_FIELDS`. A boolean `enabled` also sets matching.
 */
export async function updateMyRoommatePreferences(oxyUserId: string, body: unknown) {
  const db = getDb();
  await requireOwnProfile(oxyUserId);

  const picked = pickFields<Record<string, unknown>>(body, EDITABLE_ROOMMATE_PREFERENCE_FIELDS);
  const present: EditableRoommatePreferenceField[] = EDITABLE_ROOMMATE_PREFERENCE_FIELDS.filter(
    (field) => field in picked,
  );
  const columns = roommatePreferenceColumns(picked, present);
  const enabled = (body as { enabled?: unknown } | null | undefined)?.enabled;
  if (typeof enabled === 'boolean') columns.settingsRoommateEnabled = enabled;

  // ONE transaction: `updateProfile` issues several statements.
  const updated = await db.transaction((tx) => updateProfile(tx, oxyUserId, { columns }));
  return {
    data: hasStatedRoommatePreferences(updated.profile)
      ? toRoommatePreferencesDTO(updated.profile)
      : null,
    enabled: updated.profile.settingsRoommateEnabled ?? false,
  };
}

/** Turn roommate matching on or off. A non-boolean `enabled` is the route's 400. */
export async function setRoommateMatching(oxyUserId: string, enabled: unknown) {
  if (typeof enabled !== 'boolean') {
    throw new AppError('enabled must be a boolean', 400, 'VALIDATION_ERROR');
  }
  const db = getDb();
  await requireOwnProfile(oxyUserId);
  const updated = await db.transaction((tx) =>
    updateProfile(tx, oxyUserId, { columns: { settingsRoommateEnabled: enabled } }),
  );
  const updatedEnabled = updated.profile.settingsRoommateEnabled ?? false;
  return {
    message: `Roommate matching ${updatedEnabled ? 'enabled' : 'disabled'} successfully`,
    enabled: updatedEnabled,
  };
}

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

/** The roommate requests the caller sent and received. */
export async function listMyRoommateRequests(oxyUserId: string) {
  await requireOwnProfile(oxyUserId);
  const { sent, received } = await listRoommateRequests(getDb(), oxyUserId);
  const participantOxyUserIds = Array.from(
    new Set(
      [...sent, ...received].flatMap((request) => [request.fromOxyUserId, request.toOxyUserId]),
    ),
  );
  const { profiles, displayNames } = await loadParticipants(participantOxyUserIds);
  return {
    data: {
      sent: sent.map((request) => serializeRequest(request, profiles, displayNames)),
      received: received.map((request) => serializeRequest(request, profiles, displayNames)),
    },
  };
}

/** Send a roommate request to somebody who has matching enabled; notifies them. */
export async function sendRoommateRequest(
  oxyUserId: string,
  input: { targetOxyUserId: string; message?: unknown },
) {
  const db = getDb();
  await requireOwnProfile(oxyUserId);
  const { targetOxyUserId, message } = input;

  if (!targetOxyUserId) {
    throw new AppError('Target oxy user id is required', 400, 'VALIDATION_ERROR');
  }
  if (oxyUserId === targetOxyUserId) {
    throw new AppError('You cannot send a roommate request to yourself', 400, 'SELF_REQUEST');
  }
  const targetProfile = await findProfileByOxyUserId(db, targetOxyUserId);
  if (!targetProfile) {
    throw new AppError('Target user profile not found', 404, 'TARGET_PROFILE_NOT_FOUND');
  }
  if (targetProfile.settingsRoommateEnabled !== true) {
    throw new AppError(
      'Target user does not have roommate matching enabled',
      400,
      'ROOMMATE_MATCHING_DISABLED',
    );
  }

  // `roommate_requests_pending_pair_key` is a real partial unique index; the
  // repository raises the 409 from the index's own `23505`.
  let request: RoommateRequestRow;
  try {
    request = await createRoommateRequest(db, {
      fromOxyUserId: oxyUserId,
      toOxyUserId: targetOxyUserId,
      message: typeof message === 'string' ? message : undefined,
    });
  } catch (error) {
    if (error instanceof PendingRoommateRequestExistsError) {
      throw new AppError(
        'A pending roommate request already exists between these users',
        409,
        'ROOMMATE_REQUEST_PENDING',
      );
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

  return { message: 'Roommate request sent successfully', data: toRoommateRequestDTO(request) };
}

/**
 * Create (idempotently) the roommate relationship for an accepted request.
 *
 * The pair is sorted by the repository and the sort is enforced by
 * `roommate_relationships_sorted_pair_check`, so a writer that skipped it fails
 * loudly instead of producing a second, invisible row for the same two people.
 */
async function createRelationshipForAcceptedRequest(request: RoommateRequestRow) {
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
}

/**
 * Accept or decline a roommate request. Only the RECIPIENT may answer, in the
 * `UPDATE`'s predicate: anybody else (and a missing or malformed id) is 404.
 * Accepting materializes the relationship idempotently; the sender is notified.
 */
export async function respondToRoommateRequest(
  oxyUserId: string,
  requestId: string,
  status: 'accepted' | 'declined',
) {
  const request = await respondToRequestRow(getDb(), requestId, oxyUserId, status);
  if (!request) throw new AppError('Roommate request not found', 404, 'NOT_FOUND');

  if (status === 'accepted') await createRelationshipForAcceptedRequest(request);

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

  return {
    message: `Roommate request ${status} successfully`,
    data: toRoommateRequestDTO(request),
  };
}

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

/** The caller's roommate relationships. */
export async function listMyRoommateRelationships(oxyUserId: string) {
  await requireOwnProfile(oxyUserId);
  const relationships = await listRoommateRelationships(getDb(), oxyUserId);
  const participantOxyUserIds = Array.from(
    new Set(
      relationships.flatMap((relationship) => [relationship.oxyUser1Id, relationship.oxyUser2Id]),
    ),
  );
  const { profiles, displayNames } = await loadParticipants(participantOxyUserIds);
  return {
    data: relationships.map((relationship) =>
      serializeRelationship(relationship, profiles, displayNames),
    ),
  };
}

/**
 * End a roommate relationship. Only a participant may, in the `UPDATE`'s
 * predicate: a non-participant sees the same 404 as a missing relationship.
 * The other participant is notified.
 */
export async function endRoommateRelationship(oxyUserId: string, relationshipId: string) {
  await requireOwnProfile(oxyUserId);
  const relationship = await endRelationshipRow(getDb(), relationshipId, oxyUserId);
  if (!relationship) throw new AppError('Roommate relationship not found', 404, 'NOT_FOUND');

  const otherOxyUserId =
    relationship.oxyUser1Id === oxyUserId ? relationship.oxyUser2Id : relationship.oxyUser1Id;
  await notificationDispatchService.createForUser(otherOxyUserId, {
    type: 'roommate',
    title: 'Roommate relationship ended',
    message: 'A roommate relationship was ended.',
    priority: 'medium',
    data: { relationshipId: relationship.id, screen: '/roommates' },
  });

  return {
    message: 'Roommate relationship ended successfully',
    data: { id: relationship.id, status: relationship.status },
  };
}

/** The caller's own matching status. */
export async function getMyRoommateStatus(oxyUserId: string) {
  const profile = await requireOwnProfile(oxyUserId);
  return {
    hasRoommateMatching: profile.settingsRoommateEnabled === true,
    profile: {
      id: profile.id,
      oxyUserId: profile.oxyUserId,
      roommatePreferences: hasStatedRoommatePreferences(profile)
        ? toRoommatePreferencesDTO(profile)
        : null,
    },
  };
}
