import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from '@oxy.so/bloom/button';
import { Tabs, TabsTrigger } from '@oxy.so/bloom/tabs';
import { Header } from '@/components/Header';
import { ProfileSkeleton } from '@/components/ui/skeletons/ProfileSkeleton';
import { PersonalProfileSections } from '@/components/profile/edit/PersonalProfileSections';
import { useProfileEditForm } from '@/hooks/profile/useProfileEditForm';
import { useProfileEditTabs } from '@/hooks/profile/useProfileEditTabs';
import { contentClamp, spacing } from '@/constants/styles';

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
            <Button
              key="save"
              variant="primary"
              size="small"
              onPress={form.handleSave}
              disabled={form.isSaving}
              loading={form.isSaving}
            >
              {form.isSaving ? 'Saving…' : 'Save'}
            </Button>,
          ],
        }}
      />
      <View style={styles.tabs}>
        <Tabs value={activeSection} onValueChange={setActiveSection} variant="underline">
          {tabs.map((tab) => (
            <TabsTrigger key={tab.key} value={tab.key} label={tab.label} />
          ))}
        </Tabs>
      </View>
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
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

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  tabs: {
    paddingHorizontal: spacing.lg,
  },
  container: {
    flex: 1,
  },
  content: {
    width: '100%',
    maxWidth: contentClamp.copy,
    alignSelf: 'center',
    paddingBottom: spacing['4xl'],
  },
});
