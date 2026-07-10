/**
 * Roommate request / relationship DTO serialization.
 */

import config from '../../config';
import { logger } from '../../middlewares/logging';

interface OxyPublicUser {
  id?: string;
  _id?: string;
  username?: string;
  name?: { displayName?: string };
}

export interface SerializedRoommateProfile {
  id: string;
  oxyUserId?: string;
  displayName?: string;
  personalProfile?: unknown;
}

export interface PopulatedProfileLike {
  _id: unknown;
  oxyUserId?: string;
  personalProfile?: unknown;
}

export const ROOMMATE_PROFILE_FIELDS = 'oxyUserId personalProfile';

const USERS_BY_IDS_CAP = 100;

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
    personalProfile: profile.personalProfile,
  };
}
