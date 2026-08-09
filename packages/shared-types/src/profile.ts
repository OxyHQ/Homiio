/**
 * Profile-related types shared across Homiio frontend and backend.
 * Profile is a thin RE sidecar keyed uniquely by oxyUserId.
 */

import {
  EmploymentStatus,
  LeaseDuration,
  PriceUnit,
  ReferenceRelationship,
  ReasonForLeaving,
  ProfileVisibility,
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
  avatar?: string;
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
    ageRange?: {
      min: number;
      max: number;
    };
    gender?: 'male' | 'female' | 'any';
    lifestyle?: {
      smoking: 'yes' | 'no' | 'prefer_not';
      pets: 'yes' | 'no' | 'prefer_not';
      partying: 'yes' | 'no' | 'prefer_not';
      cleanliness: 'very_clean' | 'clean' | 'average' | 'relaxed';
      schedule: 'early_bird' | 'night_owl' | 'flexible';
    };
    budget?: {
      min: number;
      max: number;
    };
    moveInDate?: string;
    leaseDuration?: LeaseDuration;
    /**
     * Free-text tags the compatibility score intersects, worth 20 of its 100
     * points, and free text the discover feed filters on with `ILIKE`.
     *
     * Both were already accepted by the backend's write allow-list
     * (`EDITABLE_ROOMMATE_PREFERENCE_FIELDS`) and already sent by
     * `RoommateFilters`, while being declared NOWHERE — neither here nor in
     * `personalProfileSchema`, which is why mongoose strict mode discarded
     * every write of them. Declaring them is the type catching up with the
     * contract two other places already state.
     */
    interests?: string[];
    location?: string;
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

export interface Profile {
  id: string;
  oxyUserId: string;
  avatar?: string;
  personalProfile?: PersonalProfile;
  createdAt: string;
  updatedAt: string;
}

export interface UpdateProfileData {
  personalProfile?: Partial<PersonalProfile>;
}

export interface RoommateProfile extends Profile {
  matchScore?: number;
}
