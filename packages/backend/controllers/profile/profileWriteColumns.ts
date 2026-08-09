/**
 * Turning a `PUT /api/profiles/me` body into COLUMNS.
 *
 * The wire shape is the nested `personalProfile` subtree;
 * `db/schema/profiles.ts` stores it flattened with the wrapper dropped
 * (`settings.roommate.preferences.lifestyle.cleanliness` →
 * `settings_roommate_preferences_lifestyle_cleanliness`, because keeping the
 * wrapper would push the identifier past Postgres's 63-byte ceiling and it
 * truncates SILENTLY). This module is the ONE place that mapping lives.
 *
 * ## Why every field is named, and why it may not be a spread
 *
 * Mongoose let the controller assign a nested object onto the document and sort
 * the paths out itself. The equivalent here — spreading a subtree into `.set()`
 * — sends drizzle keys that are not columns, and **drizzle IGNORES an unknown
 * key rather than refusing it**. The write would succeed, report success, and
 * store nothing. So the cost is a long function and the benefit is that a field
 * nobody mapped cannot look like a field that was saved. Same reasoning, same
 * shape, as `controllers/lease/leaseWriteColumns.ts`.
 *
 * ## Block-at-a-time replacement, matching what Mongo did
 *
 * `updateMyProfile` merged at the TOP level only
 * (`{...profile.personalProfile, ...body.personalProfile}`), so sending
 * `personalInfo` replaced the whole `personalInfo` block and left `preferences`
 * alone. That is reproduced exactly: a block absent from the body contributes no
 * columns, and a block PRESENT contributes every one of its columns — including
 * the ones the client omitted, which are written NULL. Anything else would make
 * "clear my bio" impossible to express.
 *
 * The blocks are the seven `personalProfile` keys. `chatHistory` is deliberately
 * NOT one of them: it is the assistant transcript, `/api/ai/history` owns it,
 * and letting a profile save replace it would let a client rewrite its own
 * conversation with Sindi.
 *
 * ## Vocabularies are FILTERED, not rejected
 *
 * A value outside a declared set is dropped to `null` rather than 400ing, which
 * is what mongoose did with `runValidators` off on an update. The alternative is
 * a `23514` from the CHECK, which is a 500 for a field the client can simply not
 * have known about.
 */

import {
  EMPLOYMENT_STATUSES,
  GENDER_PREFERENCES,
  LEASE_DURATIONS,
  PRICE_UNITS,
  PROFILE_PROPERTY_TYPES,
  PROFILE_VISIBILITIES,
  REASONS_FOR_LEAVING,
  REFERENCE_RELATIONSHIPS,
  ROOMMATE_CLEANLINESS_LEVELS,
  ROOMMATE_LIFESTYLE_ANSWERS,
  ROOMMATE_SCHEDULES,
} from '../../db/schema/profiles';
import type {
  ProfilePreferredLocationInput,
  ProfileReferenceInput,
  ProfileRentalHistoryInput,
  ProfileRoommateHistoryInput,
  ProfileUpdate,
  ProfileWriteColumns,
} from '../../db/profiles/profileRepository';

type Loose = Record<string, unknown>;

/** A nested object off the request body, or `undefined` when the block is absent. */
function block(value: unknown): Loose | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Loose) : undefined;
}

/** A nested object, or an empty bag — for a sub-block inside a block that IS present. */
function subtree(value: unknown): Loose {
  return block(value) ?? {};
}

function asString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function asTrimmed(value: unknown): string | null {
  // Mongo's `trim: true` was application behaviour with no Postgres counterpart,
  // so `db/schema/CONVENTIONS.md` says re-apply it at the CALL SITE. This is it.
  const raw = asString(value);
  return raw === null ? null : raw.trim();
}

function asLowercased(value: unknown): string | null {
  const raw = asTrimmed(value);
  return raw === null ? null : raw.toLowerCase();
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function asBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function asDate(value: unknown): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
}

/** A member of a declared vocabulary, or `null`. */
function asMember<T extends string>(value: unknown, vocabulary: readonly T[]): T | null {
  return typeof value === 'string' && (vocabulary as readonly string[]).includes(value)
    ? (value as T)
    : null;
}

/** A string array filtered to a declared vocabulary. `null` when the key is absent. */
function asMemberArray<T extends string>(value: unknown, vocabulary: readonly T[]): T[] | null {
  if (!Array.isArray(value)) return null;
  return value.filter((entry): entry is T =>
    typeof entry === 'string' && (vocabulary as readonly string[]).includes(entry),
  );
}

/** A free-text array, trimmed and lowercased (Mongo's `preferredAmenities`). */
function asLowercasedArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  return value
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry !== '');
}

/** A `references[]` entry, or `undefined` when it has no usable name/relationship. */
function toReference(value: unknown): ProfileReferenceInput | undefined {
  const entry = block(value);
  if (!entry) return undefined;
  const name = asTrimmed(entry.name);
  const relationship = asMember(entry.relationship, REFERENCE_RELATIONSHIPS);
  // Both are `NOT NULL` in the schema because both were `required: true` in
  // Mongo. An entry missing either is dropped rather than 500ing on a `23502`.
  if (!name || !relationship) return undefined;
  return {
    name,
    relationship,
    phone: asTrimmed(entry.phone),
    email: asLowercased(entry.email),
    verified: asBoolean(entry.verified) ?? false,
  };
}

/** A `rentalHistory[]` entry, or `undefined` when it has no address or start date. */
function toRentalHistory(value: unknown): ProfileRentalHistoryInput | undefined {
  const entry = block(value);
  if (!entry) return undefined;
  const address = asTrimmed(entry.address);
  const startDate = asDate(entry.startDate);
  if (!address || !startDate) return undefined;
  const endDate = asDate(entry.endDate);
  // `profile_rental_history_order_check` refuses an end before its own start.
  // Dropped rather than sent, for the same reason a bad vocabulary member is:
  // a `23514` here is a 500 on a form the user can see and fix.
  if (endDate && endDate < startDate) return undefined;
  const contact = subtree(entry.landlordContact);
  return {
    address,
    startDate,
    endDate,
    monthlyRent: asNumber(entry.monthlyRent),
    reasonForLeaving: asMember(entry.reasonForLeaving, REASONS_FOR_LEAVING),
    landlordContactName: asTrimmed(contact.name),
    landlordContactPhone: asTrimmed(contact.phone),
    landlordContactEmail: asLowercased(contact.email),
    verified: asBoolean(entry.verified) ?? false,
  };
}

function toPreferredLocation(value: unknown): ProfilePreferredLocationInput | undefined {
  const entry = block(value);
  if (!entry) return undefined;
  return {
    city: asTrimmed(entry.city),
    state: asTrimmed(entry.state),
    // Miles, keeping Mongo's units — `db/schema/profiles.ts` says so and says
    // renaming the column would be an API change rather than a schema one.
    radius: asNumber(entry.radius),
  };
}

function toRoommateHistory(value: unknown): ProfileRoommateHistoryInput | undefined {
  const entry = block(value);
  if (!entry) return undefined;
  const startDate = asDate(entry.startDate);
  const location = asTrimmed(entry.location);
  if (!startDate || !location) return undefined;
  const endDate = asDate(entry.endDate);
  if (endDate && endDate < startDate) return undefined;
  return {
    startDate,
    endDate,
    location,
    roommateCount: asNumber(entry.roommateCount),
    reason: asTrimmed(entry.reason),
  };
}

/** Map an array off the body through a per-entry mapper, dropping what does not map. */
function mapEntries<T>(value: unknown, map: (entry: unknown) => T | undefined): T[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.map(map).filter((entry): entry is T => entry !== undefined);
}

/**
 * Build the write from a request body.
 *
 * Returns only the blocks the body actually carried, so a request naming one
 * block cannot blank the other six.
 */
export function toProfileUpdate(body: unknown): ProfileUpdate {
  const personalProfile = block(block(body)?.personalProfile);
  const columns: ProfileWriteColumns = {};
  const update: {
    -readonly [K in keyof ProfileUpdate]: ProfileUpdate[K];
  } = { columns };
  if (!personalProfile) return update;

  const personalInfo = block(personalProfile.personalInfo);
  if (personalInfo) {
    columns.personalInfoBio = asTrimmed(personalInfo.bio);
    columns.personalInfoOccupation = asTrimmed(personalInfo.occupation);
    columns.personalInfoEmployer = asTrimmed(personalInfo.employer);
    columns.personalInfoAnnualIncome = asNumber(personalInfo.annualIncome);
    columns.personalInfoEmploymentStatus = asMember(
      personalInfo.employmentStatus,
      EMPLOYMENT_STATUSES,
    );
    columns.personalInfoMoveInDate = asDate(personalInfo.moveInDate);
    columns.personalInfoLeaseDuration = asMember(personalInfo.leaseDuration, LEASE_DURATIONS);
  }

  const preferences = block(personalProfile.preferences);
  if (preferences) {
    columns.preferencesPropertyTypes = asMemberArray(
      preferences.propertyTypes,
      PROFILE_PROPERTY_TYPES,
    );
    columns.preferencesMaxRent = asNumber(preferences.maxRent);
    columns.preferencesPriceUnit = asMember(preferences.priceUnit, PRICE_UNITS);
    columns.preferencesMinBedrooms = asNumber(preferences.minBedrooms);
    columns.preferencesMinBathrooms = asNumber(preferences.minBathrooms);
    columns.preferencesPreferredAmenities = asLowercasedArray(preferences.preferredAmenities);
    columns.preferencesPetFriendly = asBoolean(preferences.petFriendly);
    columns.preferencesSmokingAllowed = asBoolean(preferences.smokingAllowed);
    columns.preferencesFurnished = asBoolean(preferences.furnished);
    columns.preferencesParkingRequired = asBoolean(preferences.parkingRequired);
    columns.preferencesAccessibility = asBoolean(preferences.accessibility);
    // `preferredLocations` lives INSIDE the preferences block in the wire shape
    // and in its own table here, so it is replaced exactly when that block is
    // present — which is what assigning the block did in Mongo.
    update.preferredLocations = mapEntries(preferences.preferredLocations, toPreferredLocation) ?? [];
  }

  const verification = block(personalProfile.verification);
  if (verification) {
    columns.verificationIdentity = asBoolean(verification.identity);
    columns.verificationIncome = asBoolean(verification.income);
    columns.verificationBackground = asBoolean(verification.background);
    columns.verificationRentalHistory = asBoolean(verification.rentalHistory);
    columns.verificationReferences = asBoolean(verification.references);
  }

  const settings = block(personalProfile.settings);
  if (settings) {
    const notifications = block(settings.notifications);
    if (notifications) {
      columns.settingsNotificationsEmail = asBoolean(notifications.email);
      columns.settingsNotificationsPush = asBoolean(notifications.push);
      columns.settingsNotificationsSms = asBoolean(notifications.sms);
      columns.settingsNotificationsPropertyAlerts = asBoolean(notifications.propertyAlerts);
      columns.settingsNotificationsViewingReminders = asBoolean(notifications.viewingReminders);
      columns.settingsNotificationsLeaseUpdates = asBoolean(notifications.leaseUpdates);
    }

    const privacy = block(settings.privacy);
    if (privacy) {
      columns.settingsPrivacyProfileVisibility = asMember(
        privacy.profileVisibility,
        PROFILE_VISIBILITIES,
      );
      columns.settingsPrivacyShowContactInfo = asBoolean(privacy.showContactInfo);
      columns.settingsPrivacyShowIncome = asBoolean(privacy.showIncome);
      columns.settingsPrivacyShowRentalHistory = asBoolean(privacy.showRentalHistory);
      columns.settingsPrivacyShowReferences = asBoolean(privacy.showReferences);
    }

    const roommate = block(settings.roommate);
    if (roommate) {
      columns.settingsRoommateEnabled = asBoolean(roommate.enabled);
      const roommatePreferences = subtree(roommate.preferences);
      const ageRange = subtree(roommatePreferences.ageRange);
      const lifestyle = subtree(roommatePreferences.lifestyle);
      const budget = subtree(roommatePreferences.budget);
      columns.settingsRoommatePreferencesAgeRangeMin = asNumber(ageRange.min);
      columns.settingsRoommatePreferencesAgeRangeMax = asNumber(ageRange.max);
      columns.settingsRoommatePreferencesGender = asMember(
        roommatePreferences.gender,
        GENDER_PREFERENCES,
      );
      columns.settingsRoommatePreferencesLifestyleSmoking = asMember(
        lifestyle.smoking,
        ROOMMATE_LIFESTYLE_ANSWERS,
      );
      columns.settingsRoommatePreferencesLifestylePets = asMember(
        lifestyle.pets,
        ROOMMATE_LIFESTYLE_ANSWERS,
      );
      columns.settingsRoommatePreferencesLifestylePartying = asMember(
        lifestyle.partying,
        ROOMMATE_LIFESTYLE_ANSWERS,
      );
      columns.settingsRoommatePreferencesLifestyleCleanliness = asMember(
        lifestyle.cleanliness,
        ROOMMATE_CLEANLINESS_LEVELS,
      );
      columns.settingsRoommatePreferencesLifestyleSchedule = asMember(
        lifestyle.schedule,
        ROOMMATE_SCHEDULES,
      );
      columns.settingsRoommatePreferencesBudgetMin = asNumber(budget.min);
      columns.settingsRoommatePreferencesBudgetMax = asNumber(budget.max);
      columns.settingsRoommatePreferencesMoveInDate = asDate(roommatePreferences.moveInDate);
      columns.settingsRoommatePreferencesLeaseDuration = asMember(
        roommatePreferences.leaseDuration,
        LEASE_DURATIONS,
      );
      update.roommateHistory = mapEntries(roommate.history, toRoommateHistory) ?? [];
    }

    columns.settingsLanguage = asTrimmed(settings.language);
    columns.settingsTimezone = asTrimmed(settings.timezone);
    columns.settingsCurrency = asTrimmed(settings.currency);
  }

  if (Array.isArray(personalProfile.references)) {
    update.references = mapEntries(personalProfile.references, toReference) ?? [];
  }
  if (Array.isArray(personalProfile.rentalHistory)) {
    update.rentalHistory = mapEntries(personalProfile.rentalHistory, toRentalHistory) ?? [];
  }

  return update;
}
