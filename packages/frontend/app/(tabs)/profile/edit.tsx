import React from 'react';
import { View, Text, ScrollView, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Header } from '@/components/Header';
import { ProfileSkeleton } from '@/components/ui/skeletons/ProfileSkeleton';
import { ProfileEditTabBar } from '@/components/profile/edit/ProfileEditTabBar';
import { PersonalProfileSections } from '@/components/profile/edit/PersonalProfileSections';
import { profileEditStyles as styles } from '@/components/profile/edit/styles';
import { useProfileEditForm } from '@/hooks/profile/useProfileEditForm';
import { useProfileEditTabs } from '@/hooks/profile/useProfileEditTabs';

export default function ProfileEditScreen() {
  const form = useProfileEditForm();
  const { activeProfile, profileLoading, isFormInitialized } = form;
  const { activeSection, setActiveSection, tabs } = useProfileEditTabs(isFormInitialized);

  const shouldShowLoading = profileLoading || (!isFormInitialized && Boolean(activeProfile));

  if (shouldShowLoading) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <ProfileSkeleton />
      </SafeAreaView>
    );
  }

  const title = `Edit profile${form.hasUnsavedChanges ? ' *' : ''}`;

  return (
    <SafeAreaView
      style={styles.safeArea}
      edges={['bottom']}
      key={`edit-${activeProfile?.id}`}
    >
      <Header
        options={{
          title,
          rightComponents: [
            <TouchableOpacity key="save" onPress={form.handleSave} disabled={form.isSaving}>
              <Text style={styles.saveButtonText}>
                {form.isSaving ? 'Saving…' : 'Save'}
              </Text>
            </TouchableOpacity>,
          ],
        }}
      />
      <ProfileEditTabBar tabs={tabs} activeSection={activeSection} onSelect={setActiveSection} />
      <ScrollView style={styles.container}>
        <PersonalProfileSections
          activeSection={activeSection}
          personalInfo={form.personalInfo}
          preferences={form.preferences}
          settings={form.settings}
          references={form.references}
          rentalHistory={form.rentalHistory}
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
      </ScrollView>
    </SafeAreaView>
  );
}
