/**
 * Roommate request / relationship DTO serialization.
 *
 * Roommate rows reference Homiio `Profile` documents, but the human-facing name
 * lives on the Oxy user account (`name.displayName`), not on the Homiio profile.
 * This module resolves those names in ONE round-trip via Oxy's
 * `POST /users/by-ids` endpoint (dual-mode auth, cap 100 ids per call) and maps
 * them back onto the serialized profiles, so the frontend renders real names
 * instead of guessing from a bio.
 *
 * The endpoint is best-effort for display purposes: if it is unreachable we log
 * and fall back to `undefined` display names rather than failing the whole
 * roommate request/relationship read.
 */

import config from '../../config';
import { logger } from '../../middlewares/logging';

/** The subset of Oxy's `PublicUserProfile` payload we consume. */
interface OxyPublicUser {
  id?: string;
  _id?: string;
  username?: string;
  name?: { displayName?: string };
}

/** Public projection of a Homiio profile referenced by a roommate row. */
export interface SerializedRoommateProfile {
  id: string;
  oxyUserId?: string;
  displayName?: string;
  profileType?: string;
  isAnonymous?: boolean;
  personalProfile?: unknown;
}

/**
 * A populated `Profile` document (or lean object) with the fields this
 * serializer reads. The `personalProfile` slice is passed through untouched for
 * the frontend match cards.
 */
export interface PopulatedProfileLike {
  _id: unknown;
  oxyUserId?: string;
  profileType?: string;
  isAnonymous?: boolean;
  personalProfile?: unknown;
}

/** Oxy user fields the roommate serializer needs from a populated profile. */
export const ROOMMATE_PROFILE_FIELDS = 'oxyUserId profileType personalProfile isAnonymous';

const USERS_BY_IDS_CAP = 100;

/**
 * Resolve `oxyUserId → displayName` for the given ids in a single Oxy
 * `POST /users/by-ids` call. Ids are de-duplicated, empties dropped, and the
 * list is capped at 100 (the endpoint's documented limit). Returns an empty map
 * on any transport/parse failure — display names are non-critical.
 */
export async function hydrateDisplayNames(
  oxyUserIds: ReadonlyArray<string | undefined | null>,
): Promise<Map<string, string>> {
  const unique = Array.from(
    new Set(oxyUserIds.filter((id): id is string => Boolean(id))),
  ).slice(0, USERS_BY_IDS_CAP);

  const result = new Map<string, string>();
  if (unique.length === 0) {
    return result;
  }

  try {
    const response = await fetch(`${config.oxy.baseURL}/users/by-ids`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: unique }),
    });

    if (!response.ok) {
      logger.warn('Roommate display-name hydration failed', {
        status: response.status,
        count: unique.length,
      });
      return result;
    }

    const payload = (await response.json()) as { data?: OxyPublicUser[] } | OxyPublicUser[];
    const users = Array.isArray(payload)
      ? payload
      : Array.isArray(payload?.data)
        ? payload.data
        : [];

    for (const user of users) {
      const id = user?.id ?? user?._id;
      const displayName = user?.name?.displayName ?? user?.username;
      if (id && displayName) {
        result.set(String(id), String(displayName));
      }
    }
  } catch (error) {
    logger.warn('Roommate display-name hydration errored', {
      error: error instanceof Error ? error.message : String(error),
      count: unique.length,
    });
  }

  return result;
}

/** Serialize a populated profile into the public roommate DTO shape. */
export function serializeRoommateProfile(
  profile: PopulatedProfileLike | null | undefined,
  displayNames: Map<string, string>,
): SerializedRoommateProfile | null {
  if (!profile) {
    return null;
  }
  const oxyUserId = profile.oxyUserId ? String(profile.oxyUserId) : undefined;
  return {
    id: String(profile._id),
    oxyUserId,
    displayName: oxyUserId ? displayNames.get(oxyUserId) : undefined,
    profileType: profile.profileType,
    isAnonymous: profile.isAnonymous,
    personalProfile: profile.personalProfile,
  };
}
