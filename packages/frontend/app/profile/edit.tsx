import React from 'react';
import { View, Text, ScrollView, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Header } from '@/components/Header';
import { ProfileSkeleton } from '@/components/ui/skeletons/ProfileSkeleton';
import { ProfileEditTabBar } from '@/components/profile/edit/ProfileEditTabBar';
import { PersonalProfileSections } from '@/components/profile/edit/PersonalProfileSections';
import { AgencyProfileSections } from '@/components/profile/edit/AgencyProfileSections';
import { BusinessProfileSections } from '@/components/profile/edit/BusinessProfileSections';
import { CooperativeProfileSections } from '@/components/profile/edit/CooperativeProfileSections';
import { profileEditStyles as styles } from '@/components/profile/edit/styles';
import { useProfileEditForm } from '@/hooks/profile/useProfileEditForm';
import { useProfileEditTabs } from '@/hooks/profile/useProfileEditTabs';

const PROFILE_TYPE_LABELS: Record<string, string> = {
  agency: 'Agency',
  business: 'Business',
  cooperative: 'Cooperative',
  personal: 'Personal',
};

/**
 * Thin route orchestrator for the profile edit screen. All form state and
 * persistence live in `useProfileEditForm`; tab state lives in
 * `useProfileEditTabs`; each profile type renders its own co-located section
 * component. This file only wires those pieces together.
 */
export default function ProfileEditScreen() {
  const form = useProfileEditForm();
  const { activeProfile, profileType, profileLoading, isFormInitialized } = form;
  const { activeSection, setActiveSection, tabs } = useProfileEditTabs(
    profileType,
    isFormInitialized,
  );

  // Show loading while profile is loading or the form has not yet hydrated.
  const shouldShowLoading = profileLoading || (!isFormInitialized && Boolean(activeProfile));

  if (shouldShowLoading) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <ProfileSkeleton />
      </SafeAreaView>
    );
  }

  const renderSection = () => {
    if (profileType === 'agency') {
      return (
        <AgencyProfileSections
          activeSection={activeSection}
          agencyInfo={form.agencyInfo}
          settings={form.settings}
          members={activeProfile?.agencyProfile?.members}
          updateAgencyInfo={form.updateAgencyInfo}
          updateSettings={form.updateSettings}
          toggleSpecialty={form.toggleSpecialty}
          toggleVerification={form.toggleVerification}
        />
      );
    }
    if (profileType === 'business') {
      return (
        <BusinessProfileSections
          activeSection={activeSection}
          businessInfo={form.businessInfo}
          settings={form.settings}
          updateBusinessInfo={form.updateBusinessInfo}
          updateSettings={form.updateSettings}
        />
      );
    }
    if (profileType === 'cooperative') {
      return (
        <CooperativeProfileSections
          activeSection={activeSection}
          cooperativeInfo={form.cooperativeInfo}
          settings={form.settings}
          updateCooperativeInfo={form.updateCooperativeInfo}
          updateSettings={form.updateSettings}
        />
      );
    }
    return (
      <PersonalProfileSections
        activeSection={activeSection}
        personalInfo={form.personalInfo}
        preferences={form.preferences}
        settings={form.settings}
        references={form.references}
        rentalHistory={form.rentalHistory}
        trustScoreData={form.trustScoreData}
        updatePersonalInfo={form.updatePersonalInfo}
        updatePreferences={form.updatePreferences}
        updateSettings={form.updateSettings}
        toggleAmenity={form.toggleAmenity}
        togglePropertyType={form.togglePropertyType}
        addReference={form.addReference}
        updateReference={form.updateReference}
        removeReference={form.removeReference}
        addRentalHistory={form.addRentalHistory}
        updateRentalHistory={form.updateRentalHistory}
        removeRentalHistory={form.removeRentalHistory}
      />
    );
  };

  const title = `Edit ${PROFILE_TYPE_LABELS[profileType] ?? 'Personal'} Profile${
    form.hasUnsavedChanges ? ' *' : ''
  }`;

  return (
    <SafeAreaView
      style={styles.safeArea}
      edges={['top']}
      key={`edit-${activeProfile?.id}-${profileType}`}
    >
      <Header
        options={{
          title,
          showBackButton: true,
          rightComponents: [
            <TouchableOpacity
              key="save"
              onPress={form.handleSave}
              style={[styles.saveButton, form.hasUnsavedChanges && styles.saveButtonActive]}
              disabled={form.isSaving || !form.hasUnsavedChanges}
            >
              {form.isSaving ? (
                <View style={styles.saveSpinnerContainer}>
                  <View style={styles.saveSpinner} />
                </View>
              ) : (
                <Text style={styles.saveButtonText}>Save</Text>
              )}
            </TouchableOpacity>,
          ],
        }}
      />

      <ProfileEditTabBar tabs={tabs} activeSection={activeSection} onSelect={setActiveSection} />

      <ScrollView style={styles.container} key={activeProfile ? 'profile-loaded' : 'profile-loading'}>
        {renderSection()}
      </ScrollView>
    </SafeAreaView>
  );
}
