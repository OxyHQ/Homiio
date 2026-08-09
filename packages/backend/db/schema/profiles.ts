/**
 * `profiles` and its five child tables — the tenant profile Oxy does not own.
 *
 * Ported from `models/schemas/ProfileSchema.ts`. Oxy owns identity; this table
 * owns everything Homiio knows about a person that Oxy has no opinion about —
 * income, search preferences, references, rental history, roommate settings.
 * The join to Oxy is `oxy_user_id`, which carries no foreign key for the reason
 * `CONVENTIONS.md` states once and this file does not repeat.
 *
 * **Five rows in production.** That is the whole collection, measured on
 * 2026-08-06, and it is worth stating because it changes which decisions are
 * risky: nothing here can break a backfill by rejecting rows that already
 * exist, so the constraints are written from the schema rather than deferred to
 * a census the way `properties`' range validators were.
 *
 * ## The `personalProfile` wrapper is DROPPED from the column names
 *
 * `properties` keeps the Mongo path in the column name
 * (`longTermRent.monthlyAmount` → `long_term_rent_monthly_amount`) so the
 * backfill's column-coverage check can map source to target mechanically. This
 * table cannot follow that rule, and the reason is a hard limit rather than
 * taste: `personalProfile.settings.roommate.preferences.lifestyle.cleanliness`
 * spells out to `personal_profile_settings_roommate_preferences_lifestyle_cleanliness`,
 * which is **68 bytes**. Postgres truncates an identifier at 63 and does it
 * SILENTLY — no error, no warning, and two paths that differ only past byte 63
 * would collide into one column.
 *
 * So the wrapper goes: `settings_roommate_preferences_lifestyle_cleanliness`
 * (51 bytes) is the longest column here. Dropping it costs nothing in meaning —
 * `personalProfile` is 1:1 with the profile row and exists in Mongo only
 * because a sub-schema was the way to group the fields — and the backfill's
 * mapping gains exactly one rule ("strip the leading `personalProfile.`")
 * rather than a table of exceptions.
 *
 * ## Every column is NULLABLE, including the ones with a Mongoose default
 *
 * `personalProfile` is declared `{ type: personalProfileSchema }` with no
 * `default`, so mongoose never materializes it and none of its defaults are
 * ever written. Column nullness is the only representation of the block being
 * ABSENT once the block is flattened away — the same rule, and the same
 * measurement, that made `properties.long_term_rent_currency` nullable.
 *
 * ## Arrays
 *
 * Three scalar arrays stay native `text[]` (`preferences.propertyTypes`,
 * `preferences.preferredAmenities` and the roommate `interests` this migration
 * ADDS) — each is read whole and none is ever queried by element. The five
 * arrays that carry STRUCTURE become child tables, because a native array of a
 * composite type is not queryable, not constrainable and not indexable in any
 * useful way.
 *
 * ## Two columns here have NO Mongo source, deliberately
 *
 * `settings_roommate_preferences_location` and
 * `settings_roommate_preferences_interests` are not ports of stored fields —
 * they are the fix for a field that was accepted, sent, and silently discarded.
 * Each carries its own reason where it is declared. They are the profile
 * counterpart of `schema/unmappedColumns.ts`'s `properties.views` /
 * `properties.title`: a column starting to hold data after the cutover is the
 * EXPECTED condition, not a copy failure.
 */

import { boolean, check, doublePrecision, index, pgTable, text, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { createdAt, generatedId, inList, textArrayLiteral, timestamptz, updatedAt } from '@oxyhq/db';
import type {
  EmploymentStatus,
  GenderPreference,
  LeaseDuration,
  PriceUnit,
  ProfileVisibility,
  PropertyType,
  ReasonForLeaving,
  ReferenceRelationship,
} from '@homiio/shared-types';

/**
 * The closed value sets, as `const` tuples.
 *
 * `satisfies readonly \`${Enum}\`[]` on each one keeps every entry a real member
 * of the shared union, so a renamed or deleted member fails to compile here.
 * It does not catch a member ADDED to the union — the same asymmetry
 * `images.ts` documents, and the same answer: the production `distinct()` audit
 * measures the real values before the copy runs.
 */
export const EMPLOYMENT_STATUSES = [
  'employed',
  'self_employed',
  'student',
  'retired',
  'unemployed',
  'other',
] as const satisfies readonly `${EmploymentStatus}`[];

export const LEASE_DURATIONS = [
  'monthly',
  '3_months',
  '6_months',
  'yearly',
  'flexible',
] as const satisfies readonly `${LeaseDuration}`[];

export const PRICE_UNITS = [
  'day',
  'night',
  'week',
  'month',
  'year',
] as const satisfies readonly `${PriceUnit}`[];

export const PROFILE_PROPERTY_TYPES = [
  'apartment',
  'house',
  'room',
  'studio',
  'couchsurfing',
  'roommates',
  'coliving',
  'hostel',
  'guesthouse',
  'campsite',
  'boat',
  'treehouse',
  'yurt',
  'other',
] as const satisfies readonly `${PropertyType}`[];

export const REFERENCE_RELATIONSHIPS = [
  'landlord',
  'employer',
  'personal',
  'other',
] as const satisfies readonly `${ReferenceRelationship}`[];

export const REASONS_FOR_LEAVING = [
  'lease_ended',
  'bought_home',
  'job_relocation',
  'family_reasons',
  'upgrade',
  'other',
] as const satisfies readonly `${ReasonForLeaving}`[];

export const PROFILE_VISIBILITIES = [
  'public',
  'private',
  'contacts_only',
] as const satisfies readonly `${ProfileVisibility}`[];

export const GENDER_PREFERENCES = [
  'male',
  'female',
  'any',
] as const satisfies readonly `${GenderPreference}`[];

/**
 * Three lifestyle preferences share one three-valued vocabulary in Mongo and
 * one tuple here. `prefer_not` is a real answer — "I would rather not say" — and
 * is NOT the same as the column being NULL, which means the person never
 * answered at all.
 */
export const ROOMMATE_LIFESTYLE_ANSWERS = ['yes', 'no', 'prefer_not'] as const;
export const ROOMMATE_CLEANLINESS_LEVELS = ['very_clean', 'clean', 'average', 'relaxed'] as const;
export const ROOMMATE_SCHEDULES = ['early_bird', 'night_owl', 'flexible'] as const;

/** `chatHistory[]` roles — the Sindi assistant transcript kept on the profile. */
export const PROFILE_CHAT_ROLES = ['user', 'assistant', 'system'] as const;

export const profiles = pgTable(
  'profiles',
  {
    id: generatedId(),

    /**
     * The Oxy account this profile belongs to. One profile per account.
     *
     * Mongoose declared `unique: true` AND `index: true`, which creates the same
     * index twice; only the unique one is ported.
     */
    oxyUserId: text().notNull(),

    // ── personalProfile.personalInfo ──
    personalInfoBio: text(),
    personalInfoOccupation: text(),
    personalInfoEmployer: text(),
    /**
     * PROTECTED — see `protectedColumns.ts`. `settings.privacy.showIncome`
     * defaults to `false`, so this has never been part of a public profile, and
     * a bare drizzle `select()` would return it on the first query anyone writes.
     */
    personalInfoAnnualIncome: doublePrecision(),
    personalInfoEmploymentStatus: text({ enum: EMPLOYMENT_STATUSES }),
    personalInfoMoveInDate: timestamptz(),
    personalInfoLeaseDuration: text({ enum: LEASE_DURATIONS }),

    // ── personalProfile.preferences ──
    /**
     * Scalar array, read whole and never queried by element — the "search
     * preferences" blob a client renders as a set of chips. A child table for a
     * set nothing filters on is the over-normalization `CONVENTIONS.md` forbids.
     */
    preferencesPropertyTypes: text().array(),
    preferencesMaxRent: doublePrecision(),
    preferencesPriceUnit: text({ enum: PRICE_UNITS }),
    preferencesMinBedrooms: doublePrecision(),
    preferencesMinBathrooms: doublePrecision(),
    /** Free-text amenity keywords, lowercased at the call site (Mongo `lowercase: true`). */
    preferencesPreferredAmenities: text().array(),
    preferencesPetFriendly: boolean(),
    preferencesSmokingAllowed: boolean(),
    preferencesFurnished: boolean(),
    preferencesParkingRequired: boolean(),
    preferencesAccessibility: boolean(),

    // ── personalProfile.verification ──
    verificationIdentity: boolean(),
    verificationIncome: boolean(),
    verificationBackground: boolean(),
    verificationRentalHistory: boolean(),
    verificationReferences: boolean(),

    // ── personalProfile.settings.notifications ──
    settingsNotificationsEmail: boolean(),
    settingsNotificationsPush: boolean(),
    settingsNotificationsSms: boolean(),
    settingsNotificationsPropertyAlerts: boolean(),
    settingsNotificationsViewingReminders: boolean(),
    settingsNotificationsLeaseUpdates: boolean(),

    // ── personalProfile.settings.privacy ──
    settingsPrivacyProfileVisibility: text({ enum: PROFILE_VISIBILITIES }),
    settingsPrivacyShowContactInfo: boolean(),
    settingsPrivacyShowIncome: boolean(),
    settingsPrivacyShowRentalHistory: boolean(),
    settingsPrivacyShowReferences: boolean(),

    // ── personalProfile.settings.roommate ──
    settingsRoommateEnabled: boolean(),
    settingsRoommatePreferencesAgeRangeMin: doublePrecision(),
    settingsRoommatePreferencesAgeRangeMax: doublePrecision(),
    settingsRoommatePreferencesGender: text({ enum: GENDER_PREFERENCES }),
    settingsRoommatePreferencesLifestyleSmoking: text({ enum: ROOMMATE_LIFESTYLE_ANSWERS }),
    settingsRoommatePreferencesLifestylePets: text({ enum: ROOMMATE_LIFESTYLE_ANSWERS }),
    settingsRoommatePreferencesLifestylePartying: text({ enum: ROOMMATE_LIFESTYLE_ANSWERS }),
    settingsRoommatePreferencesLifestyleCleanliness: text({ enum: ROOMMATE_CLEANLINESS_LEVELS }),
    settingsRoommatePreferencesLifestyleSchedule: text({ enum: ROOMMATE_SCHEDULES }),
    settingsRoommatePreferencesBudgetMin: doublePrecision(),
    settingsRoommatePreferencesBudgetMax: doublePrecision(),
    settingsRoommatePreferencesMoveInDate: timestamptz(),
    settingsRoommatePreferencesLeaseDuration: text({ enum: LEASE_DURATIONS }),
    /**
     * Where the person wants to share a home — free text, the way the roommate
     * filter has always collected it ("Barcelona", "Gràcia").
     *
     * **This column has no Mongo counterpart, and that is the defect it exists
     * to close rather than an omission being carried forward.**
     * `EDITABLE_ROOMMATE_PREFERENCE_FIELDS` accepts `location`,
     * `RoommateFilters` sends it, and `updateRoommatePreferences` wrote it to
     * `personalProfile.settings.roommate.preferences.location` — a path
     * `personalProfileSchema` never declared, so mongoose strict mode (ON for
     * writes, always) dropped it from every update. Nothing errored and nothing
     * was ever stored, which is why the discover filter that reads it has never
     * returned a row.
     *
     * Filtered with `ILIKE` over `escapeLikePattern` (`db/likePattern.ts`) —
     * the port of the `{ $regex, $options: 'i' }` the Mongo filter used. No
     * index: the table holds five rows, and `CONVENTIONS.md` forbids a
     * speculative one.
     */
    settingsRoommatePreferencesLocation: text(),
    /**
     * The person's own interests, as free-text tags.
     *
     * Same defect as {@link settingsRoommatePreferencesLocation} — accepted by
     * the write allow-list, sent by the client, and silently dropped by strict
     * mode — with a second consequence that is invisible from the write side:
     * `calculateMatchPercentage`'s interests branch is worth 20 of the 100
     * compatibility points and is guarded by `prefs1.interests &&
     * prefs2.interests`, so with the field unstorable it could NEVER fire. The
     * scorer has been running on 80 points for its whole life.
     *
     * A native `text[]`, matching `preferences_preferred_amenities`: it is read
     * whole to intersect two people's tags and is never queried by element, so a
     * child table would be the over-normalization `CONVENTIONS.md` forbids.
     */
    settingsRoommatePreferencesInterests: text().array(),

    // ── personalProfile.settings (locale) ──
    settingsLanguage: text(),
    settingsTimezone: text(),
    /**
     * The person's DISPLAY currency preference, and deliberately NOT constrained
     * to `LISTING_CURRENCIES`.
     *
     * Mongoose declared it a bare `String` with `default: 'USD'` and no `enum`,
     * so nothing has ever restricted what lands here. A CHECK derived from a
     * vocabulary the source never enforced is exactly the shape
     * `CONVENTIONS.md` defers until the `distinct()` audit has measured the real
     * values.
     */
    settingsCurrency: text(),

    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex('profiles_oxy_user_id_key').on(table.oxyUserId),
    // Mongo carried `{ createdAt: -1 }` and `{ updatedAt: -1 }` as two
    // single-field indexes on a five-row collection. Neither is ported: a btree
    // on a table this size is never chosen by the planner, and both would be
    // speculative even if it were larger — nothing in this package sorts
    // profiles by either.
    check(
      'profiles_personal_info_employment_status_check',
      sql`${table.personalInfoEmploymentStatus} in (${sql.raw(inList(EMPLOYMENT_STATUSES))})`,
    ),
    check(
      'profiles_personal_info_lease_duration_check',
      sql`${table.personalInfoLeaseDuration} in (${sql.raw(inList(LEASE_DURATIONS))})`,
    ),
    check(
      'profiles_preferences_price_unit_check',
      sql`${table.preferencesPriceUnit} in (${sql.raw(inList(PRICE_UNITS))})`,
    ),
    /**
     * Containment rather than `in`, and trivially satisfied by the empty array —
     * the same spelling and the same reason as `properties_offerings_check`: a
     * CHECK may not contain a subquery, so `not exists (select 1 from unnest(…))`
     * is rejected outright by Postgres.
     */
    check(
      'profiles_preferences_property_types_check',
      sql`${table.preferencesPropertyTypes} <@ ${sql.raw(textArrayLiteral(PROFILE_PROPERTY_TYPES))}`,
    ),
    check(
      'profiles_settings_privacy_profile_visibility_check',
      sql`${table.settingsPrivacyProfileVisibility} in (${sql.raw(inList(PROFILE_VISIBILITIES))})`,
    ),
    check(
      'profiles_settings_roommate_gender_check',
      sql`${table.settingsRoommatePreferencesGender} in (${sql.raw(inList(GENDER_PREFERENCES))})`,
    ),
    check(
      'profiles_settings_roommate_smoking_check',
      sql`${table.settingsRoommatePreferencesLifestyleSmoking} in (${sql.raw(inList(ROOMMATE_LIFESTYLE_ANSWERS))})`,
    ),
    check(
      'profiles_settings_roommate_pets_check',
      sql`${table.settingsRoommatePreferencesLifestylePets} in (${sql.raw(inList(ROOMMATE_LIFESTYLE_ANSWERS))})`,
    ),
    check(
      'profiles_settings_roommate_partying_check',
      sql`${table.settingsRoommatePreferencesLifestylePartying} in (${sql.raw(inList(ROOMMATE_LIFESTYLE_ANSWERS))})`,
    ),
    check(
      'profiles_settings_roommate_cleanliness_check',
      sql`${table.settingsRoommatePreferencesLifestyleCleanliness} in (${sql.raw(inList(ROOMMATE_CLEANLINESS_LEVELS))})`,
    ),
    check(
      'profiles_settings_roommate_schedule_check',
      sql`${table.settingsRoommatePreferencesLifestyleSchedule} in (${sql.raw(inList(ROOMMATE_SCHEDULES))})`,
    ),
    check(
      'profiles_settings_roommate_lease_duration_check',
      sql`${table.settingsRoommatePreferencesLeaseDuration} in (${sql.raw(inList(LEASE_DURATIONS))})`,
    ),
  ],
);

/**
 * `personalProfile.references[]` — a landlord, employer or personal referee.
 *
 * A child table rather than `jsonb` because each entry has a KNOWN shape with a
 * constrained `relationship`, and because `verified` is a per-entry fact a
 * future verification flow has to be able to set on one row without rewriting
 * the whole array.
 *
 * CASCADE from `profiles` everywhere below: a reference, a rental-history entry
 * or a chat message has no meaning without the profile it belongs to, and
 * mongoose deleted them with the parent document by construction.
 */
export const profileReferences = pgTable(
  'profile_references',
  {
    id: generatedId(),
    profileId: text()
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    name: text().notNull(),
    relationship: text({ enum: REFERENCE_RELATIONSHIPS }).notNull(),
    phone: text(),
    email: text(),
    verified: boolean().notNull().default(false),
  },
  (table) => [
    index('profile_references_profile_id_idx').on(table.profileId),
    check(
      'profile_references_relationship_check',
      sql`${table.relationship} in (${sql.raw(inList(REFERENCE_RELATIONSHIPS))})`,
    ),
  ],
);

/** `personalProfile.rentalHistory[]` — where the person lived, and why they left. */
export const profileRentalHistory = pgTable(
  'profile_rental_history',
  {
    id: generatedId(),
    profileId: text()
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    /** Free text, not an `addresses` reference — this is a self-reported past tenancy. */
    address: text().notNull(),
    startDate: timestamptz().notNull(),
    endDate: timestamptz(),
    monthlyRent: doublePrecision(),
    reasonForLeaving: text({ enum: REASONS_FOR_LEAVING }),
    /** `landlordContact`, a closed three-field subdocument, flattened. */
    landlordContactName: text(),
    landlordContactPhone: text(),
    landlordContactEmail: text(),
    verified: boolean().notNull().default(false),
  },
  (table) => [
    index('profile_rental_history_profile_id_idx').on(table.profileId),
    check(
      'profile_rental_history_reason_for_leaving_check',
      sql`${table.reasonForLeaving} in (${sql.raw(inList(REASONS_FOR_LEAVING))})`,
    ),
    /**
     * Mongo declared no ordering rule here at all — unlike `livedTo` on a review
     * or `end` on an availability window, which both carried a validator. It is
     * expressed anyway because an open-ended tenancy is NULL rather than a date
     * before its own start, and because the collection holds five rows: there is
     * nothing for it to reject.
     */
    check(
      'profile_rental_history_order_check',
      sql`${table.endDate} is null or ${table.endDate} >= ${table.startDate}`,
    ),
  ],
);

/**
 * `personalProfile.preferences.preferredLocations[]` — a city/state pair plus a
 * search radius.
 *
 * `radius` keeps Mongo's units, which are MILES (the validator reads "Radius
 * must be at least 1 mile"). Nothing converts it and the column does not claim
 * otherwise; renaming it `radius_miles` would be the honest fix and is a change
 * to the API contract, not to the schema, so it is left for the batch that ports
 * the profile controller.
 */
export const profilePreferredLocations = pgTable(
  'profile_preferred_locations',
  {
    id: generatedId(),
    profileId: text()
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    /**
     * Free text, NOT a `cities.id`. Mongo declared plain strings and the profile
     * UI collects typed text, so a foreign key here would be an invention rather
     * than a link that exists — the prime directive is that no relational link is
     * LOST, not that one is manufactured.
     */
    city: text(),
    state: text(),
    radius: doublePrecision(),
  },
  (table) => [index('profile_preferred_locations_profile_id_idx').on(table.profileId)],
);

/** `personalProfile.settings.roommate.history[]` — past shared-living arrangements. */
export const profileRoommateHistory = pgTable(
  'profile_roommate_history',
  {
    id: generatedId(),
    profileId: text()
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    startDate: timestamptz().notNull(),
    endDate: timestamptz(),
    /** Free text ("Barcelona, Gràcia"), not a geo reference. */
    location: text().notNull(),
    roommateCount: doublePrecision(),
    reason: text(),
  },
  (table) => [
    index('profile_roommate_history_profile_id_idx').on(table.profileId),
    check(
      'profile_roommate_history_order_check',
      sql`${table.endDate} is null or ${table.endDate} >= ${table.startDate}`,
    ),
  ],
);

/**
 * `personalProfile.chatHistory[]` — the Sindi assistant transcript.
 *
 * An UNBOUNDED embedded array, which is the deciding property: it grows with
 * every message and Mongo kept it inside the profile document, where it competes
 * with the 16 MB BSON ceiling and is rewritten in full on every append. A child
 * table makes an append an INSERT.
 *
 * `position` is the array index, preserved because the transcript's ORDER is its
 * meaning and `timestamp` cannot substitute for it: it defaults to `Date.now`
 * at millisecond resolution, so two messages appended in the same tick sort
 * arbitrarily. This is the same reason `property_images.order` is carried.
 */
export const profileChatMessages = pgTable(
  'profile_chat_messages',
  {
    id: generatedId(),
    profileId: text()
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    role: text({ enum: PROFILE_CHAT_ROLES }).notNull(),
    content: text().notNull(),
    timestamp: timestamptz().notNull(),
    position: doublePrecision().notNull(),
  },
  (table) => [
    index('profile_chat_messages_profile_position_idx').on(table.profileId, table.position),
    check(
      'profile_chat_messages_role_check',
      sql`${table.role} in (${sql.raw(inList(PROFILE_CHAT_ROLES))})`,
    ),
  ],
);
