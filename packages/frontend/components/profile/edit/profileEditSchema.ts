import { z } from 'zod';
import {
  EmploymentStatus,
  LeaseDuration,
  PriceUnit,
  BusinessType,
  ReferenceRelationship,
  ReasonForLeaving,
  ProfileVisibility,
} from '@/services/profileService';
import type { UpdateProfileData } from '@/services/profileService';
import type {
  AgencyBusinessTypeValue,
  AgencyEmployeeCountValue,
  AgencyInfoForm,
  BusinessBusinessTypeValue,
  BusinessEmployeeCountValue,
  BusinessInfoForm,
  CooperativeInfoForm,
  EmploymentStatusValue,
  LeaseDurationValue,
  PersonalInfoForm,
  PreferencesForm,
  ReasonForLeavingValue,
  ReferenceForm,
  ReferenceRelationshipValue,
  RentalHistoryForm,
  SettingsForm,
} from './types';

/* -------------------------------------------------------------------------- */
/*  String-literal-union schemas (mirror the form value types)                */
/* -------------------------------------------------------------------------- */

const employmentStatusSchema = z.enum([
  'employed',
  'self_employed',
  'student',
  'retired',
  'unemployed',
  'other',
]);

const leaseDurationSchema = z.enum(['monthly', '3_months', '6_months', 'yearly', 'flexible']);

const agencyBusinessTypeSchema = z.enum([
  'real_estate_agency',
  'property_management',
  'brokerage',
  'developer',
  'other',
]);

const businessBusinessTypeSchema = z.enum([
  'small_business',
  'startup',
  'freelancer',
  'consultant',
  'other',
]);

const agencyEmployeeCountSchema = z.enum(['1-10', '11-50', '51-200', '200+']);

const businessEmployeeCountSchema = z.enum(['1-5', '6-10', '11-25', '26+']);

const priceUnitSchema = z.enum(['day', 'night', 'week', 'month', 'year']);

const profileVisibilitySchema = z.enum(['public', 'private', 'contacts_only']);

const referenceRelationshipSchema = z.enum(['landlord', 'employer', 'personal', 'other']);

const reasonForLeavingSchema = z.enum([
  'lease_ended',
  'bought_home',
  'job_relocation',
  'family_reasons',
  'upgrade',
  'other',
]);

/* -------------------------------------------------------------------------- */
/*  Form schemas — validated on submit. They describe the *shape* of the      */
/*  local form state and guard against corrupted values (e.g. an out-of-range */
/*  enum). They intentionally do NOT add field requiredness the original      */
/*  screen never enforced: empty legal names / bios still save, and           */
/*  references / rental-history rows are pruned by their key field at         */
/*  serialization time (see the builders below), matching prior behaviour.    */
/* -------------------------------------------------------------------------- */

export const personalInfoSchema = z.object({
  bio: z.string(),
  occupation: z.string(),
  employer: z.string(),
  annualIncome: z.string(),
  employmentStatus: employmentStatusSchema,
  moveInDate: z.string(),
  leaseDuration: leaseDurationSchema,
});

export const preferencesSchema = z.object({
  propertyTypes: z.array(z.string()),
  maxRent: z.string(),
  priceUnit: priceUnitSchema,
  minBedrooms: z.string(),
  minBathrooms: z.string(),
  preferredAmenities: z.array(z.string()),
  petFriendly: z.boolean(),
  smokingAllowed: z.boolean(),
  furnished: z.boolean(),
  parkingRequired: z.boolean(),
  accessibility: z.boolean(),
});

export const referenceSchema = z.object({
  name: z.string(),
  relationship: referenceRelationshipSchema,
  phone: z.string().optional(),
  email: z.string().optional(),
});

export const rentalHistorySchema = z.object({
  address: z.string(),
  startDate: z.string(),
  endDate: z.string().optional(),
  monthlyRent: z.string().optional(),
  reasonForLeaving: reasonForLeavingSchema,
  landlordContact: z.object({
    name: z.string(),
    phone: z.string(),
    email: z.string(),
  }),
});

export const settingsSchema = z.object({
  notifications: z.object({
    email: z.boolean(),
    push: z.boolean(),
    sms: z.boolean(),
    propertyAlerts: z.boolean(),
    viewingReminders: z.boolean(),
    leaseUpdates: z.boolean(),
  }),
  privacy: z.object({
    profileVisibility: profileVisibilitySchema,
    showContactInfo: z.boolean(),
    showIncome: z.boolean(),
    showRentalHistory: z.boolean(),
    showReferences: z.boolean(),
  }),
  language: z.string(),
  timezone: z.string(),
  currency: z.string(),
});

export const personalProfileFormSchema = z.object({
  personalInfo: personalInfoSchema,
  preferences: preferencesSchema,
  references: z.array(referenceSchema),
  rentalHistory: z.array(rentalHistorySchema),
  settings: settingsSchema,
});

export const agencyInfoSchema = z.object({
  businessType: agencyBusinessTypeSchema,
  legalCompanyName: z.string(),
  description: z.string(),
  businessDetails: z.object({
    licenseNumber: z.string(),
    taxId: z.string(),
    yearEstablished: z.string(),
    employeeCount: agencyEmployeeCountSchema,
    specialties: z.array(z.string()),
  }),
  verification: z.object({
    businessLicense: z.boolean(),
    insurance: z.boolean(),
    bonding: z.boolean(),
    backgroundCheck: z.boolean(),
  }),
});

export const businessInfoSchema = z.object({
  businessType: businessBusinessTypeSchema,
  legalCompanyName: z.string(),
  description: z.string(),
  businessDetails: z.object({
    licenseNumber: z.string(),
    taxId: z.string(),
    yearEstablished: z.string(),
    employeeCount: businessEmployeeCountSchema,
    industry: z.string(),
    specialties: z.array(z.string()),
  }),
  verification: z.object({
    businessLicense: z.boolean(),
    insurance: z.boolean(),
    backgroundCheck: z.boolean(),
  }),
});

export const cooperativeInfoSchema = z.object({
  legalName: z.string(),
  description: z.string(),
});

/* -------------------------------------------------------------------------- */
/*  Enum coercion helpers — read a possibly-invalid value from the server     */
/*  profile and narrow it to a valid form value, falling back to a default.   */
/* -------------------------------------------------------------------------- */

export const toEmploymentStatus = (val: unknown): EmploymentStatusValue =>
  employmentStatusSchema.safeParse(val).data ?? 'employed';

export const toLeaseDuration = (val: unknown): LeaseDurationValue =>
  leaseDurationSchema.safeParse(val).data ?? 'yearly';

export const toAgencyBusinessType = (val: unknown): AgencyBusinessTypeValue =>
  agencyBusinessTypeSchema.safeParse(val).data ?? 'real_estate_agency';

export const toBusinessBusinessType = (val: unknown): BusinessBusinessTypeValue =>
  businessBusinessTypeSchema.safeParse(val).data ?? 'startup';

export const toAgencyEmployeeCount = (val: unknown): AgencyEmployeeCountValue =>
  agencyEmployeeCountSchema.safeParse(val).data ?? '1-10';

export const toBusinessEmployeeCount = (val: unknown): BusinessEmployeeCountValue =>
  businessEmployeeCountSchema.safeParse(val).data ?? '1-5';

export const toReasonForLeaving = (val: unknown): ReasonForLeavingValue =>
  reasonForLeavingSchema.safeParse(val).data ?? 'lease_ended';

/* -------------------------------------------------------------------------- */
/*  Form value -> shared enum maps (used when serializing to the API).        */
/* -------------------------------------------------------------------------- */

const EMPLOYMENT_STATUS_MAP: Record<EmploymentStatusValue, EmploymentStatus> = {
  employed: EmploymentStatus.EMPLOYED,
  self_employed: EmploymentStatus.SELF_EMPLOYED,
  student: EmploymentStatus.STUDENT,
  retired: EmploymentStatus.RETIRED,
  unemployed: EmploymentStatus.UNEMPLOYED,
  other: EmploymentStatus.OTHER,
};

const LEASE_DURATION_MAP: Record<LeaseDurationValue, LeaseDuration> = {
  monthly: LeaseDuration.MONTHLY,
  '3_months': LeaseDuration.THREE_MONTHS,
  '6_months': LeaseDuration.SIX_MONTHS,
  yearly: LeaseDuration.YEARLY,
  flexible: LeaseDuration.FLEXIBLE,
};

const PRICE_UNIT_MAP: Record<PreferencesForm['priceUnit'], PriceUnit> = {
  day: PriceUnit.DAY,
  night: PriceUnit.NIGHT,
  week: PriceUnit.WEEK,
  month: PriceUnit.MONTH,
  year: PriceUnit.YEAR,
};

const REFERENCE_RELATIONSHIP_MAP: Record<ReferenceRelationshipValue, ReferenceRelationship> = {
  landlord: ReferenceRelationship.LANDLORD,
  employer: ReferenceRelationship.EMPLOYER,
  personal: ReferenceRelationship.PERSONAL,
  other: ReferenceRelationship.OTHER,
};

const REASON_FOR_LEAVING_MAP: Record<ReasonForLeavingValue, ReasonForLeaving> = {
  lease_ended: ReasonForLeaving.LEASE_ENDED,
  bought_home: ReasonForLeaving.BOUGHT_HOME,
  job_relocation: ReasonForLeaving.JOB_RELOCATION,
  family_reasons: ReasonForLeaving.FAMILY_REASONS,
  upgrade: ReasonForLeaving.UPGRADE,
  other: ReasonForLeaving.OTHER,
};

const PROFILE_VISIBILITY_MAP: Record<SettingsForm['privacy']['profileVisibility'], ProfileVisibility> =
  {
    public: ProfileVisibility.PUBLIC,
    private: ProfileVisibility.PRIVATE,
    contacts_only: ProfileVisibility.CONTACTS_ONLY,
  };

const AGENCY_BUSINESS_TYPE_MAP: Record<AgencyBusinessTypeValue, BusinessType> = {
  real_estate_agency: BusinessType.REAL_ESTATE_AGENCY,
  property_management: BusinessType.PROPERTY_MANAGEMENT,
  brokerage: BusinessType.BROKERAGE,
  developer: BusinessType.DEVELOPER,
  other: BusinessType.OTHER,
};

const BUSINESS_BUSINESS_TYPE_MAP: Record<BusinessBusinessTypeValue, BusinessType> = {
  small_business: BusinessType.SMALL_BUSINESS,
  startup: BusinessType.STARTUP,
  freelancer: BusinessType.FREELANCER,
  consultant: BusinessType.CONSULTANT,
  other: BusinessType.OTHER,
};

const toOptionalInt = (val: string): number | undefined => (val ? parseInt(val, 10) : undefined);

const toOptionalString = (val: string): string | undefined => val || undefined;

/* -------------------------------------------------------------------------- */
/*  Form -> UpdateProfileData builders. These reproduce, field for field, the */
/*  payload that the original `handleSave` sent for each profile type.        */
/* -------------------------------------------------------------------------- */

export function buildPersonalUpdateData(input: {
  personalInfo: PersonalInfoForm;
  preferences: PreferencesForm;
  references: ReferenceForm[];
  rentalHistory: RentalHistoryForm[];
  settings: SettingsForm;
}): UpdateProfileData {
  const { personalInfo, preferences, references, rentalHistory, settings } = input;

  return {
    personalProfile: {
      personalInfo: {
        bio: toOptionalString(personalInfo.bio),
        occupation: toOptionalString(personalInfo.occupation),
        employer: toOptionalString(personalInfo.employer),
        annualIncome: toOptionalInt(personalInfo.annualIncome),
        employmentStatus: EMPLOYMENT_STATUS_MAP[personalInfo.employmentStatus],
        moveInDate: toOptionalString(personalInfo.moveInDate),
        leaseDuration: LEASE_DURATION_MAP[personalInfo.leaseDuration],
      },
      preferences: {
        propertyTypes: preferences.propertyTypes,
        maxRent: toOptionalInt(preferences.maxRent),
        priceUnit: PRICE_UNIT_MAP[preferences.priceUnit],
        minBedrooms: toOptionalInt(preferences.minBedrooms),
        minBathrooms: toOptionalInt(preferences.minBathrooms),
        preferredAmenities: preferences.preferredAmenities,
        petFriendly: preferences.petFriendly,
        smokingAllowed: preferences.smokingAllowed,
        furnished: preferences.furnished,
        parkingRequired: preferences.parkingRequired,
        accessibility: preferences.accessibility,
      },
      references: references
        .filter((ref) => ref.name.trim())
        .map((ref) => ({
          name: ref.name,
          relationship: REFERENCE_RELATIONSHIP_MAP[ref.relationship],
          phone: ref.phone || undefined,
          email: ref.email || undefined,
        })),
      rentalHistory: rentalHistory
        .filter((history) => history.address.trim())
        .map((history) => ({
          address: history.address,
          startDate: history.startDate,
          endDate: history.endDate || undefined,
          monthlyRent: history.monthlyRent ? parseInt(history.monthlyRent, 10) : undefined,
          reasonForLeaving: history.reasonForLeaving
            ? REASON_FOR_LEAVING_MAP[history.reasonForLeaving]
            : undefined,
          landlordContact: {
            name: history.landlordContact.name || undefined,
            phone: history.landlordContact.phone || undefined,
            email: history.landlordContact.email || undefined,
          },
        })),
      settings: {
        notifications: { ...settings.notifications },
        privacy: {
          profileVisibility: PROFILE_VISIBILITY_MAP[settings.privacy.profileVisibility],
          showContactInfo: settings.privacy.showContactInfo,
          showIncome: settings.privacy.showIncome,
          showRentalHistory: settings.privacy.showRentalHistory,
          showReferences: settings.privacy.showReferences,
        },
        language: settings.language,
        timezone: settings.timezone,
        currency: settings.currency,
      },
    },
  };
}

export function buildAgencyUpdateData(agencyInfo: AgencyInfoForm): UpdateProfileData {
  return {
    agencyProfile: {
      businessType: AGENCY_BUSINESS_TYPE_MAP[agencyInfo.businessType],
      description: agencyInfo.description,
      legalCompanyName: agencyInfo.legalCompanyName || undefined,
      businessDetails: {
        licenseNumber: agencyInfo.businessDetails.licenseNumber || undefined,
        taxId: agencyInfo.businessDetails.taxId || undefined,
        yearEstablished: toOptionalInt(agencyInfo.businessDetails.yearEstablished),
        employeeCount: agencyInfo.businessDetails.employeeCount,
        specialties: agencyInfo.businessDetails.specialties,
      },
      verification: agencyInfo.verification,
    },
  };
}

export function buildBusinessUpdateData(businessInfo: BusinessInfoForm): UpdateProfileData {
  return {
    businessProfile: {
      businessType: BUSINESS_BUSINESS_TYPE_MAP[businessInfo.businessType],
      description: businessInfo.description,
      legalCompanyName: businessInfo.legalCompanyName,
      businessDetails: {
        licenseNumber: businessInfo.businessDetails.licenseNumber || undefined,
        taxId: businessInfo.businessDetails.taxId || undefined,
        yearEstablished: toOptionalInt(businessInfo.businessDetails.yearEstablished),
        employeeCount: businessInfo.businessDetails.employeeCount,
        industry: businessInfo.businessDetails.industry,
        specialties: businessInfo.businessDetails.specialties,
        serviceAreas: [],
      },
      verification: businessInfo.verification,
    },
  };
}

/**
 * Cooperative updates are not modelled by the shared {@link UpdateProfileData}
 * envelope (it only covers personal/agency/business), yet the backend's update
 * handler assigns any unknown top-level key straight onto the document, so the
 * original screen sent a `cooperativeProfile` payload directly. We preserve
 * that exact wire shape by extending the shared envelope locally — the result
 * is still assignable to `UpdateProfileData`, so no cast is needed at the call
 * site and the mutation contract is honoured.
 */
export interface CooperativeUpdatePayload extends UpdateProfileData {
  cooperativeProfile: {
    legalName: string;
    description: string;
  };
}

export function buildCooperativeUpdateData(
  cooperativeInfo: CooperativeInfoForm,
): CooperativeUpdatePayload {
  return {
    cooperativeProfile: {
      legalName: cooperativeInfo.legalName,
      description: cooperativeInfo.description,
    },
  };
}
