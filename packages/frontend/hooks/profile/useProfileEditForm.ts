import { useCallback, useMemo, useState } from 'react';
import { Alert } from 'react-native';
import i18next from 'i18next';
import type { Profile, UpdateProfileData } from '@/services/profileService';
import { useProfileQuery, useUpdateProfileMutation } from '@/hooks/query/useProfiles';
import { logger } from '@/utils/logger';
import {
  buildPersonalUpdateData,
  personalProfileFormSchema,
  toEmploymentStatus,
  toLeaseDuration,
  toReasonForLeaving,
} from '@/components/profile/edit/profileEditSchema';
import type {
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

const UNINITIALIZED = '__uninitialized__';
type AppliedProfileId = string | null | typeof UNINITIALIZED;

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
  const prefs = profile?.preferences;
  return {
    propertyTypes: prefs?.propertyTypes || [],
    maxRent: prefs?.maxRent?.toString() || '',
    priceUnit: prefs?.priceUnit || 'month',
    minBedrooms: prefs?.minBedrooms?.toString() || '',
    minBathrooms: prefs?.minBathrooms?.toString() || '',
    preferredAmenities: prefs?.preferredAmenities || [],
    petFriendly: prefs?.petFriendly || false,
    smokingAllowed: prefs?.smokingAllowed || false,
    furnished: prefs?.furnished || false,
    parkingRequired: prefs?.parkingRequired || false,
    accessibility: prefs?.accessibility || false,
  };
}

function seedSettings(profile: Profile['personalProfile']): SettingsForm {
  const settings = profile?.settings;
  return {
    notifications: {
      email: settings?.notifications?.email ?? true,
      push: settings?.notifications?.push ?? true,
      sms: settings?.notifications?.sms ?? false,
      propertyAlerts: settings?.notifications?.propertyAlerts ?? true,
      viewingReminders: settings?.notifications?.viewingReminders ?? true,
      leaseUpdates: settings?.notifications?.leaseUpdates ?? true,
    },
    privacy: {
      profileVisibility: settings?.privacy?.profileVisibility || 'public',
      showContactInfo: settings?.privacy?.showContactInfo ?? true,
      showIncome: settings?.privacy?.showIncome ?? false,
      showRentalHistory: settings?.privacy?.showRentalHistory ?? false,
      showReferences: settings?.privacy?.showReferences ?? false,
    },
    language: settings?.language || 'en',
    timezone: settings?.timezone || 'UTC',
    currency: settings?.currency || 'USD',
  };
}

function seedReferences(profile: Profile['personalProfile']): ReferenceForm[] {
  return (profile?.references || []).map((ref) => ({
    name: ref.name,
    relationship: ref.relationship,
    phone: ref.phone || '',
    email: ref.email || '',
    verified: ref.verified || false,
  }));
}

function seedRentalHistory(profile: Profile['personalProfile']): RentalHistoryForm[] {
  return (profile?.rentalHistory || []).map((rental) => ({
    address: rental.address,
    startDate: toDateInput(rental.startDate),
    endDate: toDateInput(rental.endDate),
    monthlyRent: rental.monthlyRent?.toString() || '',
    reasonForLeaving: toReasonForLeaving(rental.reasonForLeaving),
    landlordContact: {
      name: rental.landlordContact?.name || '',
      phone: rental.landlordContact?.phone || '',
      email: rental.landlordContact?.email || '',
    },
    verified: rental.verified || false,
  }));
}

export function useProfileEditForm() {
  const { data: activeProfile, isLoading: profileLoading } = useProfileQuery();
  const { mutateAsync: updateProfile } = useUpdateProfileMutation();

  const [isSaving, setIsSaving] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [isFormInitialized, setIsFormInitialized] = useState(false);

  const [personalInfo, setPersonalInfo] = useState<PersonalInfoForm>(DEFAULT_PERSONAL_INFO);
  const [preferences, setPreferences] = useState<PreferencesForm>(DEFAULT_PREFERENCES);
  const [settings, setSettings] = useState<SettingsForm>(DEFAULT_SETTINGS);
  const [references, setReferences] = useState<ReferenceForm[]>([]);
  const [rentalHistory, setRentalHistory] = useState<RentalHistoryForm[]>([]);

  const currentProfileId = activeProfile?.id ?? null;
  const [appliedProfileId, setAppliedProfileId] = useState<AppliedProfileId>(UNINITIALIZED);

  if (appliedProfileId !== currentProfileId) {
    setAppliedProfileId(currentProfileId);

    if (activeProfile?.personalProfile) {
      const profile = activeProfile.personalProfile;
      setPersonalInfo(seedPersonalInfo(profile));
      setPreferences(seedPreferences(profile));
      setSettings(seedSettings(profile));
      setReferences(seedReferences(profile));
      setRentalHistory(seedRentalHistory(profile));
      setHasUnsavedChanges(false);
    }
    if (!isFormInitialized) {
      setIsFormInitialized(true);
    }
  }

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

  const togglePropertyType = useCallback((propertyType: string) => {
    setPreferences((prev) => ({
      ...prev,
      propertyTypes: prev.propertyTypes.includes(propertyType)
        ? prev.propertyTypes.filter((t) => t !== propertyType)
        : [...prev.propertyTypes, propertyType],
    }));
    setHasUnsavedChanges(true);
  }, []);

  const addReference = useCallback(() => {
    setReferences((prev) => [
      ...prev,
      { name: '', relationship: 'personal', phone: '', email: '', verified: false },
    ]);
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
        verified: false,
      },
    ]);
    setHasUnsavedChanges(true);
  }, []);

  const updateRentalHistory = useCallback((index: number, updates: Partial<RentalHistoryForm>) => {
    setRentalHistory((prev) => prev.map((entry, i) => (i === index ? { ...entry, ...updates } : entry)));
    setHasUnsavedChanges(true);
  }, []);

  const removeRentalHistory = useCallback((index: number) => {
    setRentalHistory((prev) => prev.filter((_, i) => i !== index));
    setHasUnsavedChanges(true);
  }, []);

  const handleSave = useCallback(async () => {
    if (!activeProfile) {
      Alert.alert(i18next.t('common.error'), i18next.t('profile.edit.noProfile'));
      return;
    }

    const validation = personalProfileFormSchema.safeParse({
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
      const updateData: UpdateProfileData = buildPersonalUpdateData({
        personalInfo,
        preferences,
        references,
        rentalHistory,
        settings,
      });

      await updateProfile(updateData);
      setHasUnsavedChanges(false);
      Alert.alert(i18next.t('common.success'), i18next.t('profile.edit.updateSuccess'));
    } catch (error) {
      logger.error('Error saving profile', error);
      const message = error instanceof Error ? error.message : 'Failed to update profile.';
      Alert.alert(i18next.t('common.error'), message);
    } finally {
      setIsSaving(false);
    }
  }, [activeProfile, personalInfo, preferences, references, rentalHistory, settings, updateProfile]);

  return {
    activeProfile,
    profileLoading,
    isFormInitialized,
    isSaving,
    hasUnsavedChanges,
    personalInfo,
    preferences,
    settings,
    references,
    rentalHistory,
    updatePersonalInfo,
    updatePreferences,
    updateSettings,
    toggleAmenity,
    togglePropertyType,
    addReference,
    updateReference,
    removeReference,
    addRentalHistory,
    updateRentalHistory,
    removeRentalHistory,
    handleSave,
  };
}
