/**
 * Settings → Language. Uses Bloom SettingsList primitives end-to-end so the
 * row layout, divider, and active-state visuals match the rest of the
 * settings stack.
 */
import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import {
  SettingsListGroup,
  SettingsListItem,
} from '@oxyhq/bloom/settings-list';

import { Header } from '@/components/Header';
import { EmptyState } from '@/components/ui/EmptyState';
import {
  SUPPORTED_LANGUAGE_CODES,
  setStoredLanguage,
  type SupportedLanguageCode,
} from '@/utils/languagePreference';
import { colors } from '@/styles/colors';
import { spacing } from '@/constants/styles';

interface LanguageOption {
  code: SupportedLanguageCode;
  label: string;
  description: string;
  flag: string;
}

const LANGUAGES: LanguageOption[] = [
  { code: 'en-US', label: 'English', description: 'English (United States)', flag: '🇺🇸' },
  { code: 'es-ES', label: 'Español', description: 'Español (España)', flag: '🇪🇸' },
  { code: 'ca-ES', label: 'Català', description: 'Català (Espanya)', flag: '🇪🇸' },
  { code: 'it-IT', label: 'Italiano', description: 'Italiano (Italia)', flag: '🇮🇹' },
].filter((lang) => SUPPORTED_LANGUAGE_CODES.includes(lang.code));

export default function LanguageSettingsScreen() {
  const { t, i18n } = useTranslation();
  const router = useRouter();

  return (
    <View style={styles.root}>
      <Header
        options={{
          title: t('settings.language.title'),
          showBackButton: true,
          titlePosition: 'center',
        }}
      />
      <ScrollView contentContainerStyle={styles.scroll}>
        {LANGUAGES.length === 0 ? (
          <EmptyState
            icon="language-outline"
            title={t('settings.language.emptyTitle')}
            description={t('settings.language.emptyDescription')}
          />
        ) : (
          <SettingsListGroup
            title={t('settings.language.choose')}
            footer={t('settings.language.footer')}
          >
            {LANGUAGES.map((lang) => {
              const isActive = i18n.language === lang.code;
              return (
                <SettingsListItem
                  key={lang.code}
                  icon={<Text style={styles.flag}>{lang.flag}</Text>}
                  title={lang.label}
                  description={lang.description}
                  rightElement={
                    isActive ? (
                      <Ionicons
                        name="checkmark"
                        size={20}
                        color={colors.primaryColor}
                      />
                    ) : undefined
                  }
                  showChevron={!isActive}
                  onPress={async () => {
                    await setStoredLanguage(lang.code);
                    router.back();
                  }}
                />
              );
            })}
          </SettingsListGroup>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scroll: {
    paddingTop: spacing.lg,
    paddingBottom: spacing['4xl'],
  },
  flag: {
    fontSize: 18,
    lineHeight: 20,
  },
});
