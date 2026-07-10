/**
 * Mass-assignment protection for the roommate preferences write endpoint.
 *
 * `updateRoommatePreferences` must NEVER spread `req.body` into the Mongoose
 * update: the profile document also holds owner/system fields (`oxyUserId`,
 * `profileType`, verification, trust score, agency membership, …) that a client
 * must not be able to reach through the roommate settings endpoint. The
 * controller instead picks ONLY the roommate-matching preference fields listed
 * here and writes them under `personalProfile.settings.roommate.preferences`.
 *
 * Keep this in sync with `RoommatePreferences.preferences` in
 * `packages/shared-types/src/profile.ts` (plus the `interests`/`location`
 * matching inputs the controller's compatibility score reads).
 */
export const EDITABLE_ROOMMATE_PREFERENCE_FIELDS: readonly string[] = [
  'ageRange',
  'gender',
  'lifestyle',
  'budget',
  'moveInDate',
  'leaseDuration',
  'interests',
  'location',
];
