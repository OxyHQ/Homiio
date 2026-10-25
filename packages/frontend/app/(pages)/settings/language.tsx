/**
 * Settings → Language.
 *
 * The app's UI language is an Oxy-account concern, not Homiio's own: Oxy
 * already resolves it (account locales when signed in, a device/guest locale
 * otherwise — see `OxyProvider`'s `language` config in `app/_layout.tsx`) and
 * ships the picker that reads and writes it (`LanguageSelectorScreen`, opened
 * here the same way every other Oxy-owned surface is —
 * `showBottomSheet('LanguageSelector')`, exactly like `ManageAccount` and
 * `FileManagement` in Settings). This screen no longer hand-rolls a picker.
 */
import { useCallback } from 'react';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useOxy } from '@oxy.so/services/ui/client';
import { getNativeLanguageName } from '@oxy.so/core';
import { AppShellMenuButton } from '@oxy.so/bloom/app-shell';
import { RiGlobalLine } from '@oxy.so/bloom/icons/RiGlobalLine';
import { PageHeader } from '@oxy.so/bloom/page-header';
import { Screen, ScreenScrollView } from '@oxy.so/bloom/screen';
import { SettingsListGroup, SettingsListItem } from '@oxy.so/bloom/settings-list';

import { SettingsRowIcon, settingsScreenStyles } from '@/components/profile/SettingsRowIcon';

export default function LanguageSettingsScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { showBottomSheet, currentLanguage, currentLanguages } = useOxy();

  const openLanguageSelector = useCallback(() => {
    showBottomSheet?.('LanguageSelector');
  }, [showBottomSheet]);

  // Account locales when there are any (signed in, or a guest override was
  // set), else the single resolved device/fallback locale — the same
  // fallback `LanguageSelectorScreen` itself uses.
  const selectedLanguages = currentLanguages.length > 0 ? currentLanguages : [currentLanguage];
  const languageDescription = selectedLanguages
    .map((code) => getNativeLanguageName(code))
    .join(', ');

  return (
    <Screen
      documentScroll
      header={
        <PageHeader
          title={t('settings.language.title')}
          titleAlign="center"
          leading={<AppShellMenuButton accessibilityLabel={t('sidebar.open')} />}
          onBack={router.canGoBack() ? router.back : undefined}
          backLabel={t('goBack')}
        />
      }
    >
      <ScreenScrollView contentContainerStyle={settingsScreenStyles.content}>
        <SettingsListGroup title={t('settings.language.choose')}>
          <SettingsListItem
            icon={<SettingsRowIcon icon={RiGlobalLine} />}
            title={t('settings.language.title')}
            description={languageDescription}
            onPress={openLanguageSelector}
          />
        </SettingsListGroup>
      </ScreenScrollView>
    </Screen>
  );
}
