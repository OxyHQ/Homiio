/**
 * The RE sidecar profile — one per Oxy account — as use cases.
 *
 * The owner is the `oxyUserId` given (the session on `/api/profiles/me`, the
 * effective account on the capability lane), never a body field, and every
 * write goes through `controllers/profile/profileWriteColumns.ts`'s allow-list
 * before it reaches a column. Somebody else's profile is only ever read in the
 * `public` scope, which withholds the private blocks
 * (`db/profiles/profileSerializer.ts`).
 */

import { getDb } from '../db/postgres';
import {
  ensureProfile,
  findHydratedProfile,
  updateProfile,
} from '../db/profiles/profileRepository';
import { toProfileDTO } from '../db/profiles/profileSerializer';
import { toProfileUpdate } from '../controllers/profile/profileWriteColumns';

/** The person's own profile, created empty if this is their first read. */
export async function getMyProfile(oxyUserId: string) {
  const hydrated = await ensureProfile(getDb(), oxyUserId, 'owner');
  return toProfileDTO(hydrated, 'owner');
}

/**
 * Update the person's own profile through the write allow-list, in ONE
 * transaction (`updateProfile` may create the row and replace child
 * collections, and a partial application would leave a state never saved).
 */
export async function updateMyProfile(oxyUserId: string, body: unknown) {
  const update = toProfileUpdate(body);
  const hydrated = await getDb().transaction((tx) => updateProfile(tx, oxyUserId, update, 'owner'));
  return toProfileDTO(hydrated, 'owner');
}

/** Somebody's profile in the PUBLIC scope, or null when they have none. */
export async function getPublicProfile(targetOxyUserId: string) {
  const hydrated = await findHydratedProfile(getDb(), targetOxyUserId);
  return hydrated ? toProfileDTO(hydrated, 'public') : null;
}
