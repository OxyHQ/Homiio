/**
 * Roommate request / relationship DTO serialization.
 */

import { type HydratedProfile, toProfileDTO } from '../../db/profiles/profileSerializer';
import { AppError } from '../../middlewares/errorHandler';
import { logger } from '../../middlewares/logging';
import { oxyService } from '../../services/oxy';

/**
 * The Oxy display name of each participant, read with `users.lookupMany` on
 * Homiio's service identity.
 *
 * An id Oxy ANSWERED without (deleted, hidden) simply has no name. An id whose
 * lookup FAILED (timeout, 5xx, 429) is unknown, not nameless: the list answers
 * 503 rather than show those people as strangers with no name, so a retry gets
 * the real answer.
 */
export async function hydrateDisplayNames(
  oxyUserIds: ReadonlyArray<string | undefined | null>,
): Promise<Map<string, string>> {
  const ids = oxyUserIds.filter((id): id is string => Boolean(id));
  const result = new Map<string, string>();
  if (ids.length === 0) return result;

  const lookup = await oxyService.users.lookupMany(ids);
  if (lookup.failed.length > 0) {
    logger.warn('Roommate display names unavailable from Oxy', {
      failed: lookup.failed.length,
      requested: ids.length,
    });
    throw new AppError(
      'Participant names are temporarily unavailable. Try again shortly.',
      503,
      'OXY_UNAVAILABLE',
    );
  }
  for (const user of lookup.found) {
    const displayName = user.name?.displayName || user.username;
    if (user.id && displayName) result.set(user.id, displayName);
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
 *  - **`id` is the profile row id and there is no `_id`.**
 *  - **A stranger never receives the whole profile.** Attaching
 *    `personalProfile` verbatim would hand annual income, references, landlord
 *    phone numbers and the Sindi transcript to everybody who had ever sent or
 *    received a request. `toProfileDTO(…, 'public')`
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
