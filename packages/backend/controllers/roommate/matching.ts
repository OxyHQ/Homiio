/**
 * Roommate compatibility scoring, over Postgres profile rows.
 *
 * Pure, and separate from the controller for that reason: the score is
 * arithmetic on two people's stated preferences and needs neither a request nor
 * a database to be exercised.
 *
 * ## "Has this person stated any preference at all?" is a real question here
 *
 * In Mongo it answered itself. `personalProfile` was declared with no `default`,
 * so mongoose never materialised it and `prefsOf(profile)` was `undefined` for
 * anybody who had not filled the form in — which is what
 * `calculateMatchPercentage`'s `if (!prefs1 || !prefs2) return 0` reads. Flatten
 * the block into columns and that distinction has nowhere to live unless it is
 * rebuilt: an all-NULL row would otherwise present as a preferences object whose
 * every field happens to be empty, and two such people would score against each
 * other as though they had answered.
 *
 * So {@link toMatchInputs} returns `undefined` when NO roommate preference
 * column is set, and each sub-block is present only when one of ITS columns is —
 * reproducing exactly which branches of the scorer used to fire.
 *
 * ## The scorer's own quirks are carried VERBATIM, with one exception
 *
 * Two people who both left `smoking` unanswered score 15 points for agreeing,
 * because the comparison is `===` on two absent values — `undefined ===
 * undefined` in Mongo, `null === null` here. That is the same answer the same
 * arithmetic has always given and it is not this port's to change.
 *
 * The exception is forced rather than chosen. `interests` has never been
 * storable (see `db/schema/profiles.ts`), so the branch that divides by
 * `Math.max(len1, len2)` has never run; with the column added it can, and two
 * EMPTY lists would divide by zero and put `NaN` on the wire — `JSON.stringify`
 * renders that as `null`, so a client would read "no score" rather than an
 * error. An empty list is therefore treated as an unstated one.
 */

import {
  hasStatedRoommatePreferences,
  type ProfileRow,
} from '../../db/profiles/profileSerializer';

/**
 * The four facts the score is computed from.
 *
 * Deliberately NOT the whole preferences DTO: this type exists so a reader can
 * see at a glance what can move a score, and so a field added to the wire shape
 * cannot start affecting compatibility without somebody deciding it should.
 */
export interface RoommateMatchInputs {
  readonly budget?: { readonly min: number | null; readonly max: number | null };
  readonly lifestyle?: {
    readonly smoking: string | null;
    readonly pets: string | null;
    readonly cleanliness: string | null;
    readonly schedule: string | null;
  };
  readonly interests?: readonly string[];
}

/**
 * The scoring inputs for a profile row, or `undefined` when the person has
 * stated no roommate preference at all.
 *
 * `enabled` is deliberately not consulted: it says whether they want to appear
 * in the feed, not what they are looking for, and a candidate can be scored
 * without it (the two request lists score people who may since have switched
 * matching off).
 */
export function toMatchInputs(profile: ProfileRow): RoommateMatchInputs | undefined {
  // The same question `GET /api/roommates/preferences` answers `null` to, and
  // deliberately the same function: "this person stated nothing" must not be
  // true for one endpoint and false for the other.
  if (!hasStatedRoommatePreferences(profile)) return undefined;

  const budgetStated =
    profile.settingsRoommatePreferencesBudgetMin !== null ||
    profile.settingsRoommatePreferencesBudgetMax !== null;
  const lifestyleStated =
    profile.settingsRoommatePreferencesLifestyleSmoking !== null ||
    profile.settingsRoommatePreferencesLifestylePets !== null ||
    profile.settingsRoommatePreferencesLifestylePartying !== null ||
    profile.settingsRoommatePreferencesLifestyleCleanliness !== null ||
    profile.settingsRoommatePreferencesLifestyleSchedule !== null;
  const interests = profile.settingsRoommatePreferencesInterests ?? [];

  return {
    ...(budgetStated
      ? {
          budget: {
            min: profile.settingsRoommatePreferencesBudgetMin,
            max: profile.settingsRoommatePreferencesBudgetMax,
          },
        }
      : {}),
    ...(lifestyleStated
      ? {
          lifestyle: {
            smoking: profile.settingsRoommatePreferencesLifestyleSmoking,
            pets: profile.settingsRoommatePreferencesLifestylePets,
            cleanliness: profile.settingsRoommatePreferencesLifestyleCleanliness,
            schedule: profile.settingsRoommatePreferencesLifestyleSchedule,
          },
        }
      : {}),
    ...(interests.length > 0 ? { interests } : {}),
  };
}

/**
 * A 0-100 compatibility percentage between two people's stated preferences.
 *
 * Scored out of the factors BOTH sides stated, so a pair who only ever
 * discussed budget is scored out of 20 rather than penalised for the 80 points
 * neither of them answered.
 */
export function calculateMatchPercentage(
  first: RoommateMatchInputs | undefined,
  second: RoommateMatchInputs | undefined,
): number {
  if (!first || !second) return 0;

  let matchScore = 0;
  let totalFactors = 0;

  if (first.budget && second.budget) {
    const max1 = first.budget.max ?? 0;
    const max2 = second.budget.max ?? 0;
    const min1 = first.budget.min ?? 0;
    const min2 = second.budget.min ?? 0;
    if (Math.min(max1, max2) - Math.max(min1, min2) > 0) {
      matchScore += 20;
    }
    totalFactors += 20;
  }

  if (first.lifestyle && second.lifestyle) {
    if (first.lifestyle.smoking === second.lifestyle.smoking) matchScore += 15;
    if (first.lifestyle.pets === second.lifestyle.pets) matchScore += 15;
    if (first.lifestyle.cleanliness === second.lifestyle.cleanliness) matchScore += 15;
    if (first.lifestyle.schedule === second.lifestyle.schedule) matchScore += 15;
    totalFactors += 60;
  }

  // Reachable for the first time: the column this reads was added by migration
  // 0008, and `toMatchInputs` guarantees both lists are non-empty so the
  // denominator cannot be zero.
  if (first.interests && second.interests) {
    const theirs = new Set(second.interests);
    const common = first.interests.filter((interest) => theirs.has(interest)).length;
    matchScore += (common / Math.max(first.interests.length, second.interests.length)) * 20;
    totalFactors += 20;
  }

  return totalFactors > 0 ? Math.round((matchScore / totalFactors) * 100) : 0;
}
