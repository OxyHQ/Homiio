/**
 * Profile-related types shared across Homiio frontend and backend.
 *
 * Identity (name, avatar, handle, kind) and follow/trust/teams live in Oxy SDK.
 * Homiio sidecar = one document per oxyUserId with RE-domain fields only.
 */

import {
  EmploymentStatus,
  LeaseDuration,
  BusinessType,
  ReferenceRelationship,
  ReasonForLeaving,
  ProfileVisibility,
  PriceUnit,
  Location,
} from './common';

export interface PersonalInfo {
  bio?: string;
  occupation?: string;
  employer?: string;
  annualIncome?: number;
  employmentStatus?: EmploymentStatus;
  moveInDate?: string;
  leaseDuration?: LeaseDuration;
}

export interface PropertyPreferences {
  propertyTypes?: string[];
  maxRent?: number;
  priceUnit?: PriceUnit;
  minBedrooms?: number;
  minBathrooms?: number;
  preferredAmenities?: string[];
  preferredLocations?: Location[];
  petFriendly?: boolean;
  smokingAllowed?: boolean;
  furnished?: boolean;
  parkingRequired?: boolean;
  accessibility?: boolean;
}

export interface Reference {
  name: string;
  relationship: ReferenceRelationship;
  phone?: string;
  email?: string;
  verified?: boolean;
}

export interface RentalHistory {
  address: string;
  startDate: string;
  endDate?: string;
  monthlyRent?: number;
  reasonForLeaving?: ReasonForLeaving;
  landlordContact?: {
    name?: string;
    phone?: string;
    email?: string;
  };
  verified?: boolean;
}

export interface Verification {
  identity: boolean;
  income: boolean;
  background: boolean;
  rentalHistory: boolean;
  references?: boolean;
}

export interface NotificationSettings {
  email: boolean;
  push: boolean;
  sms: boolean;
  propertyAlerts?: boolean;
  viewingReminders?: boolean;
  leaseUpdates?: boolean;
}

export interface PrivacySettings {
  profileVisibility: ProfileVisibility;
  showContactInfo: boolean;
  showIncome: boolean;
  showRentalHistory?: boolean;
  showReferences?: boolean;
}

export interface RoommatePreferences {
  enabled: boolean;
  preferences?: {
    ageRange?: { min: number; max: number };
    gender?: 'male' | 'female' | 'any';
    lifestyle?: {
      smoking: 'yes' | 'no' | 'prefer_not';
      pets: 'yes' | 'no' | 'prefer_not';
      partying: 'yes' | 'no' | 'prefer_not';
      cleanliness: 'very_clean' | 'clean' | 'average' | 'relaxed';
      schedule: 'early_bird' | 'night_owl' | 'flexible';
    };
    budget?: { min: number; max: number };
    moveInDate?: string;
    leaseDuration?: LeaseDuration;
  };
  history?: Array<{
    startDate: string;
    endDate?: string;
    location: string;
    roommateCount?: number;
    reason?: string;
  }>;
}

export interface ProfileSettings {
  notifications: NotificationSettings;
  privacy: PrivacySettings;
  roommate?: RoommatePreferences;
  language: string;
  timezone: string;
  currency?: string;
}

export interface PersonalProfile {
  personalInfo?: PersonalInfo;
  preferences: PropertyPreferences;
  references?: Reference[];
  rentalHistory?: RentalHistory[];
  verification: Verification;
  settings: ProfileSettings;
}

export interface BusinessDetails {
  licenseNumber?: string;
  taxId?: string;
  yearEstablished?: number;
  employeeCount?: '1-10' | '11-50' | '51-200' | '200+' | '1-5' | '6-10' | '11-25' | '26+';
  specialties?: string[];
  serviceAreas?: Location[];
  industry?: string;
}

export interface BusinessVerification {
  businessLicense: boolean;
  insurance: boolean;
  bonding?: boolean;
  backgroundCheck: boolean;
}

export interface BusinessRatings {
  average: number;
  count: number;
}

export interface AgencyProfile {
  businessType: BusinessType;
  legalCompanyName?: string;
  description?: string;
  businessDetails: BusinessDetails;
  verification: BusinessVerification;
  ratings: BusinessRatings;
}

export interface BusinessProfile {
  businessType: BusinessType;
  legalCompanyName?: string;
  description?: string;
  businessDetails: BusinessDetails;
  verification: BusinessVerification;
  ratings: BusinessRatings;
}

export interface CooperativeProfile {
  legalName: string;
  description?: string;
}

/** Homiio RE sidecar — one per Oxy account id. */
export interface Profile {
  id: string;
  _id?: string;
  oxyUserId: string;
  personalProfile?: PersonalProfile;
  agencyProfile?: AgencyProfile;
  businessProfile?: BusinessProfile;
  cooperativeProfile?: CooperativeProfile;
  createdAt: string;
  updatedAt: string;
}

export interface UpdateProfileData {
  personalProfile?: Partial<PersonalProfile>;
  agencyProfile?: Partial<AgencyProfile>;
  businessProfile?: Partial<BusinessProfile>;
  cooperativeProfile?: Partial<CooperativeProfile>;
}

export interface UserProfile {
  id: string;
  email: string;
  name: string;
  createdAt: string;
}

export interface RoommateProfile extends Profile {
  matchScore?: number;
}
