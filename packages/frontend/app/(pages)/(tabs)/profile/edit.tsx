import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { AppShellMenuButton } from '@oxy.so/bloom/app-shell';
import { Button } from '@oxy.so/bloom/button';
import { PageHeader } from '@oxy.so/bloom/page-header';
import { Screen, ScreenScrollView } from '@oxy.so/bloom/screen';
import { Tabs, TabsTrigger } from '@oxy.so/bloom/tabs';
import { ProfileSkeleton } from '@/components/ui/skeletons/ProfileSkeleton';
import { PersonalProfileSections } from '@/components/profile/edit/PersonalProfileSections';
import { useProfileEditForm } from '@/hooks/profile/useProfileEditForm';
import { useProfileEditTabs } from '@/hooks/profile/useProfileEditTabs';
import { accountOwnerKey, type AccountOwner, useAccountOwnerGuard } from '@/hooks/useAccountOwner';
import { useOxy } from '@oxy.so/services/ui/client';
import { ErrorState } from '@/components/ui/ErrorState';
import { contentClamp, spacing } from '@/constants/styles';

export default function ProfileEditScreen() {
  const { owner, isCurrent } = useAccountOwnerGuard();
  const { openAccountDialog } = useOxy();
  const { t } = useTranslation();
  if (!owner) {
    return (
      <Screen documentScroll>
        <ErrorState
          title={t('contracts.detail.signAccountUnavailable')}
          onRetry={() => openAccountDialog()}
          retryLabel={t('settings.sections.account')}
        />
      </Screen>
    );
  }
  const [userId, , epoch, instance, generation] = accountOwnerKey(owner);
  const formKey = JSON.stringify([userId, epoch, instance, generation]);
  return <OwnedProfileEdit key={formKey} owner={owner} isCurrent={isCurrent} />;
}

function OwnedProfileEdit({
  owner,
  isCurrent,
}: {
  owner: AccountOwner;
  isCurrent: (owner: AccountOwner | null) => boolean;
}) {
  const { t } = useTranslation();
  const form = useProfileEditForm(owner, isCurrent);
  const {
    activeProfile,
    profileLoading,
    profilePaused,
    profileError,
    retryProfile,
    isFormInitialized,
  } = form;
  const { activeSection, setActiveSection, tabs } = useProfileEditTabs(isFormInitialized);

  const shouldShowLoading = profileLoading || (!isFormInitialized && Boolean(activeProfile));

  if (profilePaused || profileError) {
    return (
      <Screen documentScroll>
        <ErrorState
          title={t('profile.loadFailed')}
          description={t('profile.loadFailedHint')}
          onRetry={retryProfile}
          retryLabel={t('common.retry')}
        />
      </Screen>
    );
  }

  if (shouldShowLoading) {
    return (
      <Screen
        documentScroll
        header={
          <PageHeader
            title="Edit profile"
            titleAlign="center"
            leading={<AppShellMenuButton accessibilityLabel={t('sidebar.open')} />}
          />
        }
      >
        <ScreenScrollView>
          <ProfileSkeleton />
        </ScreenScrollView>
      </Screen>
    );
  }

  const title = `Edit profile${form.hasUnsavedChanges ? ' *' : ''}`;

  return (
    <Screen
      key={`edit-${activeProfile?.id}`}
      documentScroll
      header={
        <PageHeader
          title={title}
          titleAlign="center"
          leading={<AppShellMenuButton accessibilityLabel={t('sidebar.open')} />}
          actions={
            <Button
              size="sm"
              onPress={form.handleSave}
              disabled={form.isSaving}
              loading={form.isSaving}
              tone="accent"
              appearance="solid"
            >
              {form.isSaving ? 'Saving…' : 'Save'}
            </Button>
          }
        />
      }
    >
      <ScreenScrollView keyboardShouldPersistTaps="handled">
        <View style={styles.tabs}>
          <Tabs value={activeSection} onValueChange={setActiveSection} variant="underline">
            {tabs.map((tab) => (
              <TabsTrigger key={tab.key} value={tab.key} label={tab.label} />
            ))}
          </Tabs>
        </View>
        <View style={styles.content}>
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
        </View>
      </ScreenScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  tabs: {
    paddingHorizontal: spacing.lg,
  },
  content: {
    width: '100%',
    maxWidth: contentClamp.copy,
    alignSelf: 'center',
    paddingBottom: spacing['4xl'],
  },
});
