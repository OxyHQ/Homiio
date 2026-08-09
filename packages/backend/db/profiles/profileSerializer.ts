/**
 * `profiles` row + its five child tables → the wire shape the profile screens
 * read.
 *
 * `db/schema/profiles.ts` drops the `personalProfile.` wrapper from every column
 * name, because keeping it would push
 * `personal_profile_settings_roommate_preferences_lifestyle_cleanliness` to 68
 * bytes and Postgres truncates an identifier at 63 SILENTLY. The WIRE shape is
 * not changed by that decision: sixteen frontend modules read
 * `profile.personalProfile.settings.roommate.…`, so the wrapper is rebuilt here
 * rather than pushed onto every consumer.
 *
 * ## The nesting is rebuilt EXACTLY, including the blocks nothing reads
 *
 * `useProfileEditForm` and `profileEditSchema` round-trip the whole
 * `personalProfile` subtree — the edit form reads a block, the user changes one
 * field in it, and the client sends the block back. A key this module drops
 * because no screen renders it would come back ABSENT on the next save and
 * `updatePersonalProfile` would then write NULL over it. So "nothing reads it"
 * is not a reason to omit a key; the round trip is what decides.
 *
 * ## Income is excluded at the TYPE level, not by omission here
 *
 * `profiles.personal_info_annual_income` is in
 * `db/schema/protectedColumns.ts` — `settings.privacy.showIncome` defaults to
 * FALSE, so the product's own default is that nobody sees it. Reads go through
 * {@link profileSelection}, so the column is not in {@link ProfileRow} at all
 * and this module could not emit it if it tried. A viewer who may see it is a
 * decision the application still has to make; this only makes forgetting to ask
 * a compile error.
 *
 * The same reasoning is why {@link toProfileDTO} takes a `visibility` argument
 * rather than deciding for itself: whether a caller is the owner is a fact about
 * the REQUEST, and a serializer that guessed it would be guessing on every call
 * site at once.
 */

import type { InferSelectModel } from 'drizzle-orm';
import { publicColumns } from '../schema/protectedColumns';
import type {
  profileChatMessages,
  profilePreferredLocations,
  profileReferences,
  profileRentalHistory,
  profileRoommateHistory,
  profiles,
} from '../schema';
import { profiles as profilesTable } from '../schema';

/** The sanctioned selection — every column except the annual income. */
export function profileSelection() {
  return publicColumns(profilesTable);
}

/** A profile row as this module receives it — no annual income. */
export type ProfileRow = Omit<InferSelectModel<typeof profiles>, 'personalInfoAnnualIncome'>;

export type ProfileReferenceRow = InferSelectModel<typeof profileReferences>;
export type ProfileRentalHistoryRow = InferSelectModel<typeof profileRentalHistory>;
export type ProfilePreferredLocationRow = InferSelectModel<typeof profilePreferredLocations>;
export type ProfileRoommateHistoryRow = InferSelectModel<typeof profileRoommateHistory>;
export type ProfileChatMessageRow = InferSelectModel<typeof profileChatMessages>;

/** One profile plus every child row a response carries with it. */
export interface HydratedProfile {
  readonly profile: ProfileRow;
  readonly references: readonly ProfileReferenceRow[];
  readonly rentalHistory: readonly ProfileRentalHistoryRow[];
  readonly preferredLocations: readonly ProfilePreferredLocationRow[];
  readonly roommateHistory: readonly ProfileRoommateHistoryRow[];
  readonly chatHistory: readonly ProfileChatMessageRow[];
}

/**
 * Who is looking.
 *
 * `owner` is the authenticated person's own profile (`GET /api/profiles/me`);
 * `public` is anybody else (`GET /api/profiles/oxy/:oxyUserId`, and the
 * unauthenticated `/api/public/profiles/*` pair).
 */
export type ProfileVisibilityScope = 'owner' | 'public';

function toReferenceDTO(row: ProfileReferenceRow): Record<string, unknown> {
  return {
    id: row.id,
    name: row.name,
    relationship: row.relationship,
    phone: row.phone,
    email: row.email,
    verified: row.verified,
  };
}

/**
 * One rental-history entry, with the two halves disclosed independently.
 *
 * The halves are gated by DIFFERENT flags because the product reads them for
 * different things, and collapsing them into one gate breaks a live feature
 * either way round:
 *
 *  - **`landlordContact` ⇢ `settings.privacy.showContactInfo` (default TRUE).**
 *    `app/properties/[id]` fetches an owner's PUBLIC profile and dials
 *    `personalProfile.rentalHistory[0].landlordContact.phone`, gating on exactly
 *    this flag. So gating the contact on `showRentalHistory` would silently kill
 *    "call the owner" for every user, since that flag defaults to FALSE.
 *  - **The tenancy itself ⇢ `settings.privacy.showRentalHistory` (default
 *    FALSE).** Where a person lived, for how much, and why they left is the
 *    block the schema's own default says nobody sees.
 *
 * A key that is not disclosed is ABSENT rather than `null`. The distinction is
 * load-bearing on this table: `null` means the person never recorded the value,
 * and `updatePersonalProfile` round-trips what the edit form sends back — so a
 * `null` returned to a viewer who may not see it would read as "there is nothing
 * here" to anybody reasoning about the response.
 */
function toRentalHistoryDTO(
  row: ProfileRentalHistoryRow,
  disclose: { readonly tenancy: boolean; readonly contact: boolean },
): Record<string, unknown> {
  return {
    id: row.id,
    ...(disclose.tenancy
      ? {
          address: row.address,
          startDate: row.startDate,
          endDate: row.endDate,
          monthlyRent: row.monthlyRent,
          reasonForLeaving: row.reasonForLeaving,
          verified: row.verified,
        }
      : {}),
    // `landlordContact` was a closed three-field subdocument in Mongo and is
    // three columns here; the wire keeps the object, for the same reason the
    // `personalProfile` wrapper is rebuilt.
    ...(disclose.contact
      ? {
          landlordContact: {
            name: row.landlordContactName,
            phone: row.landlordContactPhone,
            email: row.landlordContactEmail,
          },
        }
      : {}),
  };
}

function toPreferredLocationDTO(row: ProfilePreferredLocationRow): Record<string, unknown> {
  return { id: row.id, city: row.city, state: row.state, radius: row.radius };
}

function toRoommateHistoryDTO(row: ProfileRoommateHistoryRow): Record<string, unknown> {
  return {
    id: row.id,
    startDate: row.startDate,
    endDate: row.endDate,
    location: row.location,
    roommateCount: row.roommateCount,
    reason: row.reason,
  };
}

function toChatMessageDTO(row: ProfileChatMessageRow): Record<string, unknown> {
  return { id: row.id, role: row.role, content: row.content, timestamp: row.timestamp };
}

/**
 * The `personalProfile` subtree, rebuilt from the flattened columns and the
 * child rows.
 *
 * Every value is emitted as stored, NULL included. Mongoose never materialized
 * `personalProfile` (it is declared with no `default`), so a column being NULL
 * means the person never answered — which is a different fact from the schema's
 * default, and the edit form renders the two differently.
 */
function toPersonalProfile(
  hydrated: HydratedProfile,
  visibility: ProfileVisibilityScope,
): Record<string, unknown> {
  const { profile } = hydrated;

  // The owner always sees their whole profile; everything below is what a
  // STRANGER gets. A viewer-specific decision, which is why it is made here from
  // the scope the caller passed rather than inside the repository — the
  // repository cannot know who asked.
  //
  // Mongo returned the entire document on both public routes, income and
  // landlord phone numbers included. That is a deliberate behaviour CHANGE here,
  // not a discovery: `showReferences` and `showRentalHistory` default to FALSE,
  // so the product's own default already says a stranger does not see either
  // block, and `/api/public/profiles/*` needs no authentication at all. It costs
  // nothing today — both child tables hold ZERO rows in production — which is
  // why this is the batch to make it true in.
  const owner = visibility === 'owner';
  const showReferences = owner || profile.settingsPrivacyShowReferences === true;
  const showTenancy = owner || profile.settingsPrivacyShowRentalHistory === true;
  const showContact = owner || profile.settingsPrivacyShowContactInfo === true;

  return {
    personalInfo: {
      bio: profile.personalInfoBio,
      occupation: profile.personalInfoOccupation,
      employer: profile.personalInfoEmployer,
      employmentStatus: profile.personalInfoEmploymentStatus,
      moveInDate: profile.personalInfoMoveInDate,
      leaseDuration: profile.personalInfoLeaseDuration,
    },
    preferences: {
      propertyTypes: profile.preferencesPropertyTypes,
      maxRent: profile.preferencesMaxRent,
      priceUnit: profile.preferencesPriceUnit,
      minBedrooms: profile.preferencesMinBedrooms,
      minBathrooms: profile.preferencesMinBathrooms,
      preferredAmenities: profile.preferencesPreferredAmenities,
      preferredLocations: hydrated.preferredLocations.map(toPreferredLocationDTO),
      petFriendly: profile.preferencesPetFriendly,
      smokingAllowed: profile.preferencesSmokingAllowed,
      furnished: profile.preferencesFurnished,
      parkingRequired: profile.preferencesParkingRequired,
      accessibility: profile.preferencesAccessibility,
    },
    references: showReferences ? hydrated.references.map(toReferenceDTO) : [],
    rentalHistory:
      showTenancy || showContact
        ? hydrated.rentalHistory.map((row) =>
            toRentalHistoryDTO(row, { tenancy: showTenancy, contact: showContact }),
          )
        : [],
    verification: {
      identity: profile.verificationIdentity,
      income: profile.verificationIncome,
      background: profile.verificationBackground,
      rentalHistory: profile.verificationRentalHistory,
      references: profile.verificationReferences,
    },
    settings: {
      notifications: {
        email: profile.settingsNotificationsEmail,
        push: profile.settingsNotificationsPush,
        sms: profile.settingsNotificationsSms,
        propertyAlerts: profile.settingsNotificationsPropertyAlerts,
        viewingReminders: profile.settingsNotificationsViewingReminders,
        leaseUpdates: profile.settingsNotificationsLeaseUpdates,
      },
      privacy: {
        profileVisibility: profile.settingsPrivacyProfileVisibility,
        showContactInfo: profile.settingsPrivacyShowContactInfo,
        showIncome: profile.settingsPrivacyShowIncome,
        showRentalHistory: profile.settingsPrivacyShowRentalHistory,
        showReferences: profile.settingsPrivacyShowReferences,
      },
      roommate: {
        enabled: profile.settingsRoommateEnabled,
        preferences: {
          ageRange: {
            min: profile.settingsRoommatePreferencesAgeRangeMin,
            max: profile.settingsRoommatePreferencesAgeRangeMax,
          },
          gender: profile.settingsRoommatePreferencesGender,
          lifestyle: {
            smoking: profile.settingsRoommatePreferencesLifestyleSmoking,
            pets: profile.settingsRoommatePreferencesLifestylePets,
            partying: profile.settingsRoommatePreferencesLifestylePartying,
            cleanliness: profile.settingsRoommatePreferencesLifestyleCleanliness,
            schedule: profile.settingsRoommatePreferencesLifestyleSchedule,
          },
          budget: {
            min: profile.settingsRoommatePreferencesBudgetMin,
            max: profile.settingsRoommatePreferencesBudgetMax,
          },
          moveInDate: profile.settingsRoommatePreferencesMoveInDate,
          leaseDuration: profile.settingsRoommatePreferencesLeaseDuration,
        },
        history: hydrated.roommateHistory.map(toRoommateHistoryDTO),
      },
      language: profile.settingsLanguage,
      timezone: profile.settingsTimezone,
      currency: profile.settingsCurrency,
    },
    // The Sindi transcript kept on the profile. Owner-only: it is the person's
    // own conversation with the assistant and no privacy flag ever gated it,
    // because in Mongo it was only ever read back by its owner.
    chatHistory: visibility === 'owner' ? hydrated.chatHistory.map(toChatMessageDTO) : [],
  };
}

/**
 * The wire shape `GET /api/profiles/me` and the two public reads return.
 *
 * `id` and not `_id`: Mongoose's `toJSON` transform renamed it and PR #287 made
 * that a clean cut across the wire contract.
 */
export function toProfileDTO(
  hydrated: HydratedProfile,
  visibility: ProfileVisibilityScope,
): Record<string, unknown> {
  return {
    id: hydrated.profile.id,
    oxyUserId: hydrated.profile.oxyUserId,
    personalProfile: toPersonalProfile(hydrated, visibility),
    createdAt: hydrated.profile.createdAt,
    updatedAt: hydrated.profile.updatedAt,
  };
}
