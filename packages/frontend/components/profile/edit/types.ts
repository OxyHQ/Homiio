/**
 * Local form-value types for the profile edit screen.
 *
 * The form keeps numeric fields (income, rent, bedrooms, year, …) as strings so
 * they bind directly to `TextInput`, and uses plain string-literal unions for
 * enum-like fields so the picker UI stays simple. These shapes are mapped to the
 * shared `UpdateProfileData` envelope (with the proper enums) only on submit.
 */

export type EmploymentStatusValue =
  | 'employed'
  | 'self_employed'
  | 'student'
  | 'retired'
  | 'unemployed'
  | 'other';

export type LeaseDurationValue = 'monthly' | '3_months' | '6_months' | 'yearly' | 'flexible';

export type AgencyBusinessTypeValue =
  | 'real_estate_agency'
  | 'property_management'
  | 'brokerage'
  | 'developer'
  | 'other';

export type BusinessBusinessTypeValue =
  | 'small_business'
  | 'startup'
  | 'freelancer'
  | 'consultant'
  | 'other';

export type AgencyEmployeeCountValue = '1-10' | '11-50' | '51-200' | '200+';

export type BusinessEmployeeCountValue = '1-5' | '6-10' | '11-25' | '26+';

export type PriceUnitValue = 'day' | 'night' | 'week' | 'month' | 'year';

export type ProfileVisibilityValue = 'public' | 'private' | 'contacts_only';

export type ReferenceRelationshipValue = 'landlord' | 'employer' | 'personal' | 'other';

export type ReasonForLeavingValue =
  | 'lease_ended'
  | 'bought_home'
  | 'job_relocation'
  | 'family_reasons'
  | 'upgrade'
  | 'other';

export interface PersonalInfoForm {
  bio: string;
  occupation: string;
  employer: string;
  annualIncome: string;
  employmentStatus: EmploymentStatusValue;
  moveInDate: string;
  leaseDuration: LeaseDurationValue;
}

export interface AgencyInfoForm {
  businessType: AgencyBusinessTypeValue;
  legalCompanyName: string;
  description: string;
  businessDetails: {
    licenseNumber: string;
    taxId: string;
    yearEstablished: string;
    employeeCount: AgencyEmployeeCountValue;
    specialties: string[];
  };
  verification: {
    businessLicense: boolean;
    insurance: boolean;
    bonding: boolean;
    backgroundCheck: boolean;
  };
}

export interface BusinessInfoForm {
  businessType: BusinessBusinessTypeValue;
  legalCompanyName: string;
  description: string;
  businessDetails: {
    licenseNumber: string;
    taxId: string;
    yearEstablished: string;
    employeeCount: BusinessEmployeeCountValue;
    industry: string;
    specialties: string[];
  };
  verification: {
    businessLicense: boolean;
    insurance: boolean;
    backgroundCheck: boolean;
  };
}

export interface CooperativeInfoForm {
  legalName: string;
  description: string;
}

export interface PreferencesForm {
  propertyTypes: string[];
  maxRent: string;
  priceUnit: PriceUnitValue;
  minBedrooms: string;
  minBathrooms: string;
  preferredAmenities: string[];
  petFriendly: boolean;
  smokingAllowed: boolean;
  furnished: boolean;
  parkingRequired: boolean;
  accessibility: boolean;
}

export interface SettingsForm {
  notifications: {
    email: boolean;
    push: boolean;
    sms: boolean;
    propertyAlerts: boolean;
    viewingReminders: boolean;
    leaseUpdates: boolean;
  };
  privacy: {
    profileVisibility: ProfileVisibilityValue;
    showContactInfo: boolean;
    showIncome: boolean;
    showRentalHistory: boolean;
    showReferences: boolean;
  };
  language: string;
  timezone: string;
  currency: string;
}

export interface ReferenceForm {
  name: string;
  relationship: ReferenceRelationshipValue;
  phone?: string;
  email?: string;
}

export interface RentalHistoryForm {
  address: string;
  startDate: string;
  endDate?: string;
  monthlyRent?: string;
  reasonForLeaving: ReasonForLeavingValue;
  landlordContact: {
    name: string;
    phone: string;
    email: string;
  };
}

/** Verification flags toggled from the agency verification section. */
export type AgencyVerificationField = 'businessLicense' | 'insurance' | 'bonding' | 'backgroundCheck';

export interface ProfileTab {
  key: string;
  label: string;
}

export const PERSONAL_TABS: ProfileTab[] = [
  { key: 'personal', label: 'Personal' },
  { key: 'preferences', label: 'Preferences' },
  { key: 'references', label: 'References' },
  { key: 'rental-history', label: 'History' },
  { key: 'trust-score', label: 'Trust Score' },
  { key: 'settings', label: 'Settings' },
];

export const AGENCY_TABS: ProfileTab[] = [
  { key: 'business', label: 'Agency' },
  { key: 'verification', label: 'Verification' },
  { key: 'team', label: 'Team' },
  { key: 'settings', label: 'Settings' },
];

export const BUSINESS_TABS: ProfileTab[] = [
  { key: 'business', label: 'Business' },
  { key: 'verification', label: 'Verification' },
  { key: 'settings', label: 'Settings' },
];

export const COOPERATIVE_TABS: ProfileTab[] = [
  { key: 'cooperative', label: 'Cooperative' },
  { key: 'settings', label: 'Settings' },
];

/** Persisted-tab storage key (was a string literal in the original screen). */
export const ACTIVE_SECTION_STORAGE_KEY = 'profile-edit-active-section';

/** Tab keys that are valid to restore from storage. */
export const PERSISTABLE_SECTIONS = [
  'personal',
  'preferences',
  'verification',
  'business',
  'cooperative',
  'settings',
] as const;
