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
import { colors } from '@/styles/colors';
import { spacing } from '@/constants/styles';

interface LanguageOption {
  code: string;
  label: string;
  description: string;
  flag: string;
}

const LANGUAGES: LanguageOption[] = [
  { code: 'en-US', label: 'English', description: 'English (United States)', flag: '🇺🇸' },
  { code: 'es-ES', label: 'Español', description: 'Español (España)', flag: '🇪🇸' },
  { code: 'ca-ES', label: 'Català', description: 'Català (Espanya)', flag: '🇪🇸' },
  { code: 'fr-FR', label: 'Français', description: 'Français (France)', flag: '🇫🇷' },
  { code: 'de-DE', label: 'Deutsch', description: 'Deutsch (Deutschland)', flag: '🇩🇪' },
  { code: 'it-IT', label: 'Italiano', description: 'Italiano (Italia)', flag: '🇮🇹' },
  { code: 'pt-PT', label: 'Português', description: 'Português (Portugal)', flag: '🇵🇹' },
  { code: 'zh-CN', label: '中文', description: 'Chinese (Simplified)', flag: '🇨🇳' },
  { code: 'ja-JP', label: '日本語', description: 'Japanese (Japan)', flag: '🇯🇵' },
  { code: 'ru-RU', label: 'Русский', description: 'Russian (Russia)', flag: '🇷🇺' },
  { code: 'ar-AR', label: 'العربية', description: 'Arabic', flag: '🇸🇦' },
];

export default function LanguageSettingsScreen() {
  const { t, i18n } = useTranslation();
  const router = useRouter();

  return (
    <View style={styles.root}>
      <Header
        options={{
          title: t('Language'),
          showBackButton: true,
          titlePosition: 'center',
        }}
      />
      <ScrollView contentContainerStyle={styles.scroll}>
        {LANGUAGES.length === 0 ? (
          <EmptyState
            icon="language-outline"
            title={t('No languages found')}
            description={t('No language options are currently available')}
          />
        ) : (
          <SettingsListGroup
            title={t('settings.language.choose', 'Choose a language')}
            footer={t(
              'settings.language.footer',
              'Changing the language updates labels across the app immediately.',
            )}
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
                  onPress={() => {
                    i18n.changeLanguage(lang.code);
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
    backgroundColor: colors.surface,
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
