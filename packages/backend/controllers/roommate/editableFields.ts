/**
 * Mass-assignment protection for the roommate preferences write endpoint.
 *
 * `updateRoommatePreferences` must NEVER spread `req.body` into the update: the
 * profile row also holds owner/system fields (`oxyUserId`, verification, the
 * privacy flags, the protected annual income) that a client must not be able to
 * reach through the roommate settings endpoint. The controller picks ONLY the
 * fields listed here and maps each one to a column through
 * `controllers/profile/profileWriteColumns.ts`.
 *
 * ## This tuple is now the ONE list, and that closes a real hole
 *
 * It used to be a `readonly string[]` read only by `pickFields`, with a comment
 * asking the reader to keep it in sync with two other places by hand. It did
 * not stay in sync: `interests` and `location` were on it, were sent by the
 * client, and were written to `personalProfile.settings.roommate.preferences.*`
 * — paths `personalProfileSchema` never declared, so mongoose strict mode
 * discarded both on every save, silently, for as long as the endpoint has
 * existed.
 *
 * As a `const` tuple it is also the domain of
 * `roommatePreferenceColumns`, whose `switch` is exhaustive over
 * {@link EditableRoommatePreferenceField}. A field added here with no column
 * mapping is now a COMPILE error rather than a write that reports success and
 * stores nothing — which is exactly the failure this file spent its life
 * demonstrating.
 */
export const EDITABLE_ROOMMATE_PREFERENCE_FIELDS = [
  'ageRange',
  'gender',
  'lifestyle',
  'budget',
  'moveInDate',
  'leaseDuration',
  'interests',
  'location',
] as const;

export type EditableRoommatePreferenceField =
  (typeof EDITABLE_ROOMMATE_PREFERENCE_FIELDS)[number];
