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
import React, { useCallback } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useOxy } from '@oxy.so/services';
import { getNativeLanguageName } from '@oxy.so/core';
import { RiGlobalLine } from '@oxy.so/bloom/icons';
import { useTheme } from '@oxy.so/bloom/theme';
import {
  SettingsListGroup,
  SettingsListItem,
} from '@oxy.so/bloom/settings-list';

import { Header } from '@/components/Header';
import { SettingsRowIcon, settingsScreenStyles } from '@/components/profile/SettingsRowIcon';

export default function LanguageSettingsScreen() {
  const { t } = useTranslation();
  const { showBottomSheet, currentLanguage, currentLanguages } = useOxy();
  const { colors: theme } = useTheme();

  const openLanguageSelector = useCallback(() => {
    showBottomSheet?.('LanguageSelector');
  }, [showBottomSheet]);

  // Account locales when there are any (signed in, or a guest override was
  // set), else the single resolved device/fallback locale — the same
  // fallback `LanguageSelectorScreen` itself uses.
  const selectedLanguages = currentLanguages.length > 0 ? currentLanguages : [currentLanguage];
  const languageDescription = selectedLanguages.map((code) => getNativeLanguageName(code)).join(', ');

  return (
    <View style={[styles.root, { backgroundColor: theme.background }]}>
      <Header
        options={{
          title: t('settings.language.title'),
          showBackButton: true,
        }}
      />
      <View style={settingsScreenStyles.content}>
        <SettingsListGroup title={t('settings.language.choose')}>
          <SettingsListItem
            icon={<SettingsRowIcon icon={RiGlobalLine} />}
            title={t('settings.language.title')}
            description={languageDescription}
            onPress={openLanguageSelector}
          />
        </SettingsListGroup>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
});
