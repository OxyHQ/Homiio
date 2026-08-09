/**
 * Roommate request / relationship DTO serialization.
 */

import config from '../../config';
import { type HydratedProfile, toProfileDTO } from '../../db/profiles/profileSerializer';
import { logger } from '../../middlewares/logging';

/**
 * A user as the OXY API returns it from `POST /users/by-ids`.
 *
 * The `_id` here is deliberate and must NOT be renamed by a sweep of Homiio's
 * own `_id` → `id` cut. This is a foreign service's response shape, not Homiio's
 * wire: Oxy decides what it sends, and editing this declaration would only make
 * Homiio stop reading a field Oxy still emits. It is also never re-served —
 * {@link hydrateDisplayNames} keeps the display name and nothing else, so the
 * raw object never reaches `res.json`.
 */
interface OxyPublicUser {
  id?: string;
  _id?: string;
  username?: string;
  name?: { displayName?: string };
}

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

/**
 * One participant of a request or a relationship, as the roommate screens read
 * them.
 *
 * ## The whole DTO comes from `toProfileDTO`, at PUBLIC visibility
 *
 * Two things follow from that, and both are changes:
 *
 *  - **`id` is the profile row id and there is no `_id`.** The Mongoose
 *    `toJSON` transform renamed `_id` → `id` and stripped `__v`; these
 *    endpoints bypassed it (they `.lean()`-ed and re-projected by hand), so the
 *    rename is applied here rather than lost with the transform. `__v` has no
 *    Postgres counterpart to leak.
 *  - **A stranger no longer receives the whole profile document.** The Mongo
 *    version attached `personalProfile` verbatim — annual income, references,
 *    landlord phone numbers and the Sindi transcript included — to everybody
 *    who had ever sent or received a request. `toProfileDTO(…, 'public')`
 *    applies the same privacy flags `/api/public/profiles/*` does, and the
 *    income column is unreachable at the TYPE level.
 *
 * `displayName` is hydrated from Oxy and is not part of the stored profile,
 * which is why it is spread on here rather than being a column.
 */
export function serializeRoommateProfile(
  hydrated: HydratedProfile | null | undefined,
  displayNames: Map<string, string>,
): Record<string, unknown> | null {
  if (!hydrated) {
    return null;
  }
  const { oxyUserId } = hydrated.profile;
  return {
    ...toProfileDTO(hydrated, 'public'),
    displayName: displayNames.get(oxyUserId),
  };
}
