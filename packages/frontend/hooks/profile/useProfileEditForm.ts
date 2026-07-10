import { useCallback, useMemo, useState } from 'react';
import { Alert } from 'react-native';
import i18next from 'i18next';
import type { Profile, UpdateProfileData } from '@/services/profileService';
import { usePrimaryProfileQuery, useUpdateProfileMutation } from '@/hooks/query/useProfiles';
import { logger } from '@/utils/logger';
import type { z } from 'zod';
import {
  agencyInfoSchema,
  buildAgencyUpdateData,
  buildBusinessUpdateData,
  buildCooperativeUpdateData,
  buildPersonalUpdateData,
  businessInfoSchema,
  cooperativeInfoSchema,
  personalProfileFormSchema,
  toAgencyBusinessType,
  toAgencyEmployeeCount,
  toBusinessBusinessType,
  toBusinessEmployeeCount,
  toEmploymentStatus,
  toLeaseDuration,
  toReasonForLeaving,
} from '@/components/profile/edit/profileEditSchema';
import type {
  AgencyInfoForm,
  AgencyVerificationField,
  BusinessInfoForm,
  CooperativeInfoForm,
  PersonalInfoForm,
  PreferencesForm,
  ReferenceForm,
  RentalHistoryForm,
  SettingsForm,
} from '@/components/profile/edit/types';

const DEFAULT_PERSONAL_INFO: PersonalInfoForm = {
  bio: '',
  occupation: '',
  employer: '',
  annualIncome: '',
  employmentStatus: 'employed',
  moveInDate: '',
  leaseDuration: 'yearly',
};

const DEFAULT_AGENCY_INFO: AgencyInfoForm = {
  businessType: 'real_estate_agency',
  legalCompanyName: '',
  description: '',
  businessDetails: {
    licenseNumber: '',
    taxId: '',
    yearEstablished: '',
    employeeCount: '1-10',
    specialties: [],
  },
  verification: {
    businessLicense: false,
    insurance: false,
    bonding: false,
    backgroundCheck: false,
  },
};

const DEFAULT_BUSINESS_INFO: BusinessInfoForm = {
  businessType: 'startup',
  legalCompanyName: '',
  description: '',
  businessDetails: {
    licenseNumber: '',
    taxId: '',
    yearEstablished: '',
    employeeCount: '1-5',
    industry: '',
    specialties: [],
  },
  verification: {
    businessLicense: false,
    insurance: false,
    backgroundCheck: false,
  },
};

const DEFAULT_COOPERATIVE_INFO: CooperativeInfoForm = {
  legalName: '',
  description: '',
};

const DEFAULT_PREFERENCES: PreferencesForm = {
  propertyTypes: [],
  maxRent: '',
  priceUnit: 'month',
  minBedrooms: '',
  minBathrooms: '',
  preferredAmenities: [],
  petFriendly: false,
  smokingAllowed: false,
  furnished: false,
  parkingRequired: false,
  accessibility: false,
};

const DEFAULT_SETTINGS: SettingsForm = {
  notifications: {
    email: true,
    push: true,
    sms: false,
    propertyAlerts: true,
    viewingReminders: true,
    leaseUpdates: true,
  },
  privacy: {
    profileVisibility: 'public',
    showContactInfo: true,
    showIncome: false,
    showRentalHistory: false,
    showReferences: false,
  },
  language: 'en',
  timezone: 'UTC',
  currency: 'USD',
};

const toDateInput = (value?: string): string =>
  value ? new Date(value).toISOString().split('T')[0] : '';

/**
 * Sentinel for "no profile has been applied to the form yet". Distinct from
 * `null` (which is a legitimate "no active profile" state) so the very first
 * render always runs the hydration branch once.
 */
const UNINITIALIZED = '__uninitialized__';
type AppliedProfileId = string | null | typeof UNINITIALIZED;

/* -------------------------------------------------------------------------- */
/*  Pure builders that derive a form slice from the loaded profile. They are  */
/*  the seeding counterpart of the serialization builders in the schema file. */
/* -------------------------------------------------------------------------- */

function seedPersonalInfo(profile: Profile['personalProfile']): PersonalInfoForm {
  return {
    bio: profile?.personalInfo?.bio || '',
    occupation: profile?.personalInfo?.occupation || '',
    employer: profile?.personalInfo?.employer || '',
    annualIncome: profile?.personalInfo?.annualIncome?.toString() || '',
    employmentStatus: toEmploymentStatus(profile?.personalInfo?.employmentStatus),
    moveInDate: toDateInput(profile?.personalInfo?.moveInDate),
    leaseDuration: toLeaseDuration(profile?.personalInfo?.leaseDuration),
  };
}

function seedPreferences(profile: Profile['personalProfile']): PreferencesForm {
  return {
    propertyTypes: profile?.preferences?.propertyTypes || [],
    maxRent: profile?.preferences?.maxRent?.toString() || '',
    priceUnit: profile?.preferences?.priceUnit || 'month',
    minBedrooms: profile?.preferences?.minBedrooms?.toString() || '',
    minBathrooms: profile?.preferences?.minBathrooms?.toString() || '',
    preferredAmenities: profile?.preferences?.preferredAmenities || [],
    petFriendly: profile?.preferences?.petFriendly || false,
    smokingAllowed: profile?.preferences?.smokingAllowed || false,
    furnished: profile?.preferences?.furnished || false,
    parkingRequired: profile?.preferences?.parkingRequired || false,
    accessibility: profile?.preferences?.accessibility || false,
  };
}

function seedSettings(profile: Profile['personalProfile']): SettingsForm {
  return {
    notifications: {
      email: profile?.settings?.notifications?.email ?? true,
      push: profile?.settings?.notifications?.push ?? true,
      sms: profile?.settings?.notifications?.sms ?? false,
      propertyAlerts: profile?.settings?.notifications?.propertyAlerts ?? true,
      viewingReminders: profile?.settings?.notifications?.viewingReminders ?? true,
      leaseUpdates: profile?.settings?.notifications?.leaseUpdates ?? true,
    },
    privacy: {
      profileVisibility: profile?.settings?.privacy?.profileVisibility || 'public',
      showContactInfo: profile?.settings?.privacy?.showContactInfo ?? true,
      showIncome: profile?.settings?.privacy?.showIncome ?? false,
      showRentalHistory: profile?.settings?.privacy?.showRentalHistory ?? false,
      showReferences: profile?.settings?.privacy?.showReferences ?? false,
    },
    language: profile?.settings?.language || 'en',
    timezone: profile?.settings?.timezone || 'UTC',
    currency: profile?.settings?.currency || 'USD',
  };
}

function seedReferences(profile: Profile['personalProfile']): ReferenceForm[] {
  return (
    profile?.references?.map((ref) => ({
      name: ref.name,
      relationship: ref.relationship,
      phone: ref.phone || '',
      email: ref.email || '',
    })) || []
  );
}

function seedRentalHistory(profile: Profile['personalProfile']): RentalHistoryForm[] {
  return (
    profile?.rentalHistory?.map((history) => ({
      address: history.address,
      startDate: toDateInput(history.startDate),
      endDate: history.endDate ? toDateInput(history.endDate) : undefined,
      monthlyRent: history.monthlyRent?.toString() || undefined,
      reasonForLeaving: toReasonForLeaving(history.reasonForLeaving),
      landlordContact: {
        name: history.landlordContact?.name || '',
        phone: history.landlordContact?.phone || '',
        email: history.landlordContact?.email || '',
      },
    })) || []
  );
}

function seedAgencyInfo(profile: Profile['agencyProfile']): AgencyInfoForm {
  return {
    businessType: toAgencyBusinessType(profile?.businessType),
    legalCompanyName: profile?.legalCompanyName || '',
    description: profile?.description || '',
    businessDetails: {
      licenseNumber: profile?.businessDetails?.licenseNumber || '',
      taxId: profile?.businessDetails?.taxId || '',
      yearEstablished: profile?.businessDetails?.yearEstablished?.toString() || '',
      employeeCount: toAgencyEmployeeCount(profile?.businessDetails?.employeeCount),
      specialties: profile?.businessDetails?.specialties || [],
    },
    verification: {
      businessLicense: profile?.verification?.businessLicense || false,
      insurance: profile?.verification?.insurance || false,
      bonding: profile?.verification?.bonding || false,
      backgroundCheck: profile?.verification?.backgroundCheck || false,
    },
  };
}

function seedBusinessInfo(profile: Profile['businessProfile']): BusinessInfoForm {
  return {
    businessType: toBusinessBusinessType(profile?.businessType),
    legalCompanyName: profile?.legalCompanyName || '',
    description: profile?.description || '',
    businessDetails: {
      licenseNumber: profile?.businessDetails?.licenseNumber || '',
      taxId: profile?.businessDetails?.taxId || '',
      yearEstablished: profile?.businessDetails?.yearEstablished?.toString() || '',
      employeeCount: toBusinessEmployeeCount(profile?.businessDetails?.employeeCount),
      industry: profile?.businessDetails?.industry || '',
      specialties: profile?.businessDetails?.specialties || [],
    },
    verification: {
      businessLicense: profile?.verification?.businessLicense || false,
      insurance: profile?.verification?.insurance || false,
      backgroundCheck: profile?.verification?.backgroundCheck || false,
    },
  };
}

function seedCooperativeInfo(profile: Profile['cooperativeProfile']): CooperativeInfoForm {
  return {
    legalName: profile?.legalName || '',
    description: profile?.description || '',
  };
}

export interface UseProfileEditFormResult {
  activeProfile: Profile | null | undefined;
  profileType: string;
  profileLoading: boolean;
  isFormInitialized: boolean;
  isSaving: boolean;
  hasUnsavedChanges: boolean;

  personalInfo: PersonalInfoForm;
  agencyInfo: AgencyInfoForm;
  businessInfo: BusinessInfoForm;
  cooperativeInfo: CooperativeInfoForm;
  preferences: PreferencesForm;
  settings: SettingsForm;
  references: ReferenceForm[];
  rentalHistory: RentalHistoryForm[];
  trustScoreData: { score: number; factors: TrustFactorView[] };

  updatePersonalInfo: (updates: Partial<PersonalInfoForm>) => void;
  updatePreferences: (updates: Partial<PreferencesForm>) => void;
  updateSettings: (updates: Partial<SettingsForm>) => void;
  updateAgencyInfo: (updates: Partial<AgencyInfoForm>) => void;
  updateBusinessInfo: (updates: Partial<BusinessInfoForm>) => void;
  updateCooperativeInfo: (updates: Partial<CooperativeInfoForm>) => void;
  toggleAmenity: (amenity: string) => void;
  togglePropertyType: (type: string) => void;
  toggleSpecialty: (specialty: string) => void;
  toggleVerification: (field: AgencyVerificationField) => void;
  addReference: () => void;
  updateReference: (index: number, updates: Partial<ReferenceForm>) => void;
  removeReference: (index: number) => void;
  addRentalHistory: () => void;
  updateRentalHistory: (index: number, updates: Partial<RentalHistoryForm>) => void;
  removeRentalHistory: (index: number) => void;

  handleSave: () => Promise<void>;
}

interface TrustFactorView {
  type: string;
  value: number;
  maxValue: number;
}

/** Max value per trust-score factor (kept from the original screen). */
const TRUST_FACTOR_MAX_VALUE = 20;

/**
 * Owns every piece of profile-edit form state plus the logic to hydrate it from
 * the loaded profile, mutate it, and persist it through React Query.
 *
 * The profile is read via {@link usePrimaryProfileQuery} and saved via
 * {@link useUpdateProfileMutation}. Local editable copies of the server data
 * live in component state; the single remaining effect hydrates those copies
 * once per loaded profile id (a genuine server-state -> form-state sync).
 */
export function useProfileEditForm(): UseProfileEditFormResult {
  const { data: activeProfile, isLoading: profileLoading } = usePrimaryProfileQuery();
  const { mutateAsync: updateProfile } = useUpdateProfileMutation();

  const [isSaving, setIsSaving] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [isFormInitialized, setIsFormInitialized] = useState(false);

  const profileType = activeProfile?.profileType || 'personal';

  const [personalInfo, setPersonalInfo] = useState<PersonalInfoForm>(DEFAULT_PERSONAL_INFO);
  const [agencyInfo, setAgencyInfo] = useState<AgencyInfoForm>(DEFAULT_AGENCY_INFO);
  const [businessInfo, setBusinessInfo] = useState<BusinessInfoForm>(DEFAULT_BUSINESS_INFO);
  const [cooperativeInfo, setCooperativeInfo] =
    useState<CooperativeInfoForm>(DEFAULT_COOPERATIVE_INFO);
  const [preferences, setPreferences] = useState<PreferencesForm>(DEFAULT_PREFERENCES);
  const [settings, setSettings] = useState<SettingsForm>(DEFAULT_SETTINGS);
  const [references, setReferences] = useState<ReferenceForm[]>([]);
  const [rentalHistory, setRentalHistory] = useState<RentalHistoryForm[]>([]);

  // Hydrate the form from the loaded profile, once per distinct profile id.
  //
  // This uses React's "adjust state while rendering" pattern instead of an
  // effect: the last-applied profile id is tracked in state, and when the
  // loaded profile id differs we seed every relevant slice synchronously during
  // render. React restarts the render with the new state before painting, so
  // there is no extra commit or flash — and behaviour matches the original
  // screen (which seeded the same values right after the profile resolved)
  // without a setState-in-effect. The sentinel `'__uninitialized__'` lets the
  // very first render (even with no profile yet) flip the initialized flag.
  // See https://react.dev/learn/you-might-not-need-an-effect
  const currentProfileId = activeProfile?.id ?? null;
  const [appliedProfileId, setAppliedProfileId] = useState<AppliedProfileId>(UNINITIALIZED);

  if (appliedProfileId !== currentProfileId) {
    setAppliedProfileId(currentProfileId);

    if (activeProfile) {
      if (profileType === 'personal') {
        const profile = activeProfile.personalProfile;
        setPersonalInfo(seedPersonalInfo(profile));
        setPreferences(seedPreferences(profile));
        setSettings(seedSettings(profile));
        setReferences(seedReferences(profile));
        setRentalHistory(seedRentalHistory(profile));
      } else if (profileType === 'agency') {
        setAgencyInfo(seedAgencyInfo(activeProfile.agencyProfile));
      } else if (profileType === 'business') {
        setBusinessInfo(seedBusinessInfo(activeProfile.businessProfile));
      } else if (profileType === 'cooperative') {
        setCooperativeInfo(seedCooperativeInfo(activeProfile.cooperativeProfile));
      }
      setHasUnsavedChanges(false);
    }
    if (!isFormInitialized) {
      setIsFormInitialized(true);
    }
  }

  const trustScoreData = useMemo(() => {
    const trustScore = activeProfile?.personalProfile?.trustScore;
    if (!trustScore) {
      return { score: 0, factors: [] as TrustFactorView[] };
    }
    return {
      score: trustScore.score || 0,
      factors:
        trustScore.factors?.map((factor) => ({
          type: factor.type,
          value: factor.value,
          maxValue: TRUST_FACTOR_MAX_VALUE,
        })) || [],
    };
  }, [activeProfile?.personalProfile?.trustScore]);

  const updatePersonalInfo = useCallback((updates: Partial<PersonalInfoForm>) => {
    setPersonalInfo((prev) => ({ ...prev, ...updates }));
    setHasUnsavedChanges(true);
  }, []);

  const updatePreferences = useCallback((updates: Partial<PreferencesForm>) => {
    setPreferences((prev) => ({ ...prev, ...updates }));
    setHasUnsavedChanges(true);
  }, []);

  const updateSettings = useCallback((updates: Partial<SettingsForm>) => {
    setSettings((prev) => ({ ...prev, ...updates }));
    setHasUnsavedChanges(true);
  }, []);

  const toggleAmenity = useCallback((amenity: string) => {
    setPreferences((prev) => ({
      ...prev,
      preferredAmenities: prev.preferredAmenities.includes(amenity)
        ? prev.preferredAmenities.filter((a) => a !== amenity)
        : [...prev.preferredAmenities, amenity],
    }));
    setHasUnsavedChanges(true);
  }, []);

  const togglePropertyType = useCallback((type: string) => {
    setPreferences((prev) => ({
      ...prev,
      propertyTypes: prev.propertyTypes.includes(type)
        ? prev.propertyTypes.filter((t) => t !== type)
        : [...prev.propertyTypes, type],
    }));
    setHasUnsavedChanges(true);
  }, []);

  const addReference = useCallback(() => {
    setReferences((prev) => [...prev, { name: '', relationship: 'personal', phone: '', email: '' }]);
    setHasUnsavedChanges(true);
  }, []);

  const updateReference = useCallback((index: number, updates: Partial<ReferenceForm>) => {
    setReferences((prev) => prev.map((ref, i) => (i === index ? { ...ref, ...updates } : ref)));
    setHasUnsavedChanges(true);
  }, []);

  const removeReference = useCallback((index: number) => {
    setReferences((prev) => prev.filter((_, i) => i !== index));
    setHasUnsavedChanges(true);
  }, []);

  const addRentalHistory = useCallback(() => {
    setRentalHistory((prev) => [
      ...prev,
      {
        address: '',
        startDate: '',
        endDate: '',
        monthlyRent: '',
        reasonForLeaving: 'lease_ended',
        landlordContact: { name: '', phone: '', email: '' },
      },
    ]);
    setHasUnsavedChanges(true);
  }, []);

  const updateRentalHistory = useCallback(
    (index: number, updates: Partial<RentalHistoryForm>) => {
      setRentalHistory((prev) =>
        prev.map((history, i) => (i === index ? { ...history, ...updates } : history)),
      );
      setHasUnsavedChanges(true);
    },
    [],
  );

  const removeRentalHistory = useCallback((index: number) => {
    setRentalHistory((prev) => prev.filter((_, i) => i !== index));
    setHasUnsavedChanges(true);
  }, []);

  const updateAgencyInfo = useCallback((updates: Partial<AgencyInfoForm>) => {
    setAgencyInfo((prev) => ({ ...prev, ...updates }));
    setHasUnsavedChanges(true);
  }, []);

  const updateBusinessInfo = useCallback((updates: Partial<BusinessInfoForm>) => {
    setBusinessInfo((prev) => ({ ...prev, ...updates }));
    setHasUnsavedChanges(true);
  }, []);

  const updateCooperativeInfo = useCallback((updates: Partial<CooperativeInfoForm>) => {
    setCooperativeInfo((prev) => ({ ...prev, ...updates }));
    setHasUnsavedChanges(true);
  }, []);

  const toggleSpecialty = useCallback(
    (specialty: string) => {
      if (profileType === 'agency') {
        setAgencyInfo((prev) => ({
          ...prev,
          businessDetails: {
            ...prev.businessDetails,
            specialties: prev.businessDetails.specialties.includes(specialty)
              ? prev.businessDetails.specialties.filter((s) => s !== specialty)
              : [...prev.businessDetails.specialties, specialty],
          },
        }));
      } else if (profileType === 'business') {
        setBusinessInfo((prev) => ({
          ...prev,
          businessDetails: {
            ...prev.businessDetails,
            specialties: prev.businessDetails.specialties.includes(specialty)
              ? prev.businessDetails.specialties.filter((s) => s !== specialty)
              : [...prev.businessDetails.specialties, specialty],
          },
        }));
      }
      setHasUnsavedChanges(true);
    },
    [profileType],
  );

  const toggleVerification = useCallback(
    (field: AgencyVerificationField) => {
      if (profileType === 'agency') {
        setAgencyInfo((prev) => ({
          ...prev,
          verification: { ...prev.verification, [field]: !prev.verification[field] },
        }));
      } else if (profileType === 'business') {
        // Business profiles don't have bonding, so it is skipped here.
        if (field === 'bonding') return;
        setBusinessInfo((prev) => ({
          ...prev,
          verification: { ...prev.verification, [field]: !prev.verification[field] },
        }));
      }
      setHasUnsavedChanges(true);
    },
    [profileType],
  );

  const handleSave = useCallback(async () => {
    if (!activeProfile) {
      Alert.alert(i18next.t('common.error'), i18next.t('profile.edit.noProfile'));
      return;
    }

    // Validate the active form snapshot on submit. The schemas are structural
    // (they never add requiredness the UI didn't already enforce), so this is a
    // no-op for any input reachable through the form and only acts as a guard
    // against corrupted state, surfacing through the same Alert error channel.
    const validation: z.SafeParseReturnType<unknown, unknown> =
      profileType === 'agency'
        ? agencyInfoSchema.safeParse(agencyInfo)
        : profileType === 'business'
          ? businessInfoSchema.safeParse(businessInfo)
          : profileType === 'cooperative'
            ? cooperativeInfoSchema.safeParse(cooperativeInfo)
            : personalProfileFormSchema.safeParse({
                personalInfo,
                preferences,
                references,
                rentalHistory,
                settings,
              });

    if (!validation.success) {
      const message = validation.error.issues[0]?.message || 'Please review the form and try again.';
      Alert.alert(i18next.t('common.error'), message);
      return;
    }

    setIsSaving(true);

    try {
      const profileId = activeProfile.id || activeProfile._id;
      if (!profileId) {
        throw new Error('Profile ID not found');
      }

      let updateData: UpdateProfileData;

      if (profileType === 'agency') {
        updateData = buildAgencyUpdateData(agencyInfo);
      } else if (profileType === 'business') {
        updateData = buildBusinessUpdateData(businessInfo);
      } else if (profileType === 'cooperative') {
        // Cooperative updates carry an extra `cooperativeProfile` key that is
        // outside the shared UpdateProfileData envelope; preserve the exact
        // original wire payload by widening through the mutation contract.
        updateData = buildCooperativeUpdateData(cooperativeInfo);
      } else {
        updateData = buildPersonalUpdateData({
          personalInfo,
          preferences,
          references,
          rentalHistory,
          settings,
        });
      }

      await updateProfile({ profileId, data: updateData });

      setHasUnsavedChanges(false);
      Alert.alert(i18next.t('common.success'), i18next.t('profile.edit.updateSuccess'));
    } catch (error) {
      logger.error('Error saving profile', error);
      const message = error instanceof Error ? error.message : 'Failed to update profile.';
      Alert.alert(i18next.t('common.error'), message);
    } finally {
      setIsSaving(false);
    }
  }, [
    activeProfile,
    profileType,
    personalInfo,
    preferences,
    references,
    rentalHistory,
    settings,
    agencyInfo,
    businessInfo,
    cooperativeInfo,
    updateProfile,
  ]);

  return {
    activeProfile,
    profileType,
    profileLoading,
    isFormInitialized,
    isSaving,
    hasUnsavedChanges,
    personalInfo,
    agencyInfo,
    businessInfo,
    cooperativeInfo,
    preferences,
    settings,
    references,
    rentalHistory,
    trustScoreData,
    updatePersonalInfo,
    updatePreferences,
    updateSettings,
    updateAgencyInfo,
    updateBusinessInfo,
    updateCooperativeInfo,
    toggleAmenity,
    togglePropertyType,
    toggleSpecialty,
    toggleVerification,
    addReference,
    updateReference,
    removeReference,
    addRentalHistory,
    updateRentalHistory,
    removeRentalHistory,
    handleSave,
  };
}
