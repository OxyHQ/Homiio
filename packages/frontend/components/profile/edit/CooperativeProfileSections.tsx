import React from 'react';
import { View, Text, TextInput, TouchableOpacity } from 'react-native';
import { useTranslation } from 'react-i18next';
import { profileEditStyles as styles } from './styles';
import type { CooperativeInfoForm, ProfileVisibilityValue, SettingsForm } from './types';

const PROFILE_VISIBILITIES = ['public', 'private', 'contacts_only'] as const;

interface CooperativeProfileSectionsProps {
  activeSection: string;
  cooperativeInfo: CooperativeInfoForm;
  settings: SettingsForm;
  updateCooperativeInfo: (updates: Partial<CooperativeInfoForm>) => void;
  updateSettings: (updates: Partial<SettingsForm>) => void;
}

export function CooperativeProfileSections({
  activeSection,
  cooperativeInfo,
  settings,
  updateCooperativeInfo,
  updateSettings,
}: CooperativeProfileSectionsProps) {
  const { t } = useTranslation();

  switch (activeSection) {
    case 'cooperative':
      return (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('profile.edit.sections.cooperativeInformation')}</Text>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>{t('profile.edit.labels.legalName')}</Text>
            <TextInput
              style={styles.input}
              value={cooperativeInfo.legalName}
              onChangeText={(text) => updateCooperativeInfo({ legalName: text })}
              placeholder={t('profile.edit.placeholders.cooperativeLegalName')}
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>{t('profile.edit.labels.description')}</Text>
            <TextInput
              style={[styles.input, styles.textArea]}
              value={cooperativeInfo.description}
              onChangeText={(text) => updateCooperativeInfo({ description: text })}
              placeholder={t('profile.edit.placeholders.cooperativeDescription')}
              multiline
              numberOfLines={4}
            />
          </View>
        </View>
      );

    case 'settings':
      return (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('profile.edit.sections.cooperativeSettings')}</Text>
          <Text style={styles.sectionSubtitle}>{t('profile.edit.subtitles.cooperativeSettings')}</Text>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>{t('profile.edit.labels.profileVisibility')}</Text>
            <View style={styles.pickerContainer}>
              {PROFILE_VISIBILITIES.map((visibility) => (
                <TouchableOpacity
                  key={visibility}
                  style={[
                    styles.pickerOption,
                    settings.privacy.profileVisibility === visibility &&
                      styles.pickerOptionSelected,
                  ]}
                  onPress={() =>
                    updateSettings({
                      privacy: {
                        ...settings.privacy,
                        profileVisibility: visibility as ProfileVisibilityValue,
                      },
                    })
                  }
                >
                  <Text
                    style={[
                      styles.pickerOptionText,
                      settings.privacy.profileVisibility === visibility &&
                        styles.pickerOptionTextSelected,
                    ]}
                  >
                    {t(`profile.edit.options.profileVisibility.${visibility}`)}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>{t('profile.edit.labels.notifications')}</Text>
            <View style={styles.checkboxGroup}>
              <TouchableOpacity
                style={[styles.checkbox, settings.notifications.email && styles.checkboxSelected]}
                onPress={() =>
                  updateSettings({
                    notifications: {
                      ...settings.notifications,
                      email: !settings.notifications.email,
                    },
                  })
                }
              >
                <Text
                  style={[
                    styles.checkboxText,
                    settings.notifications.email && styles.checkboxTextSelected,
                  ]}
                >
                  {t('profile.edit.toggles.emailNotifications')}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.checkbox, settings.notifications.push && styles.checkboxSelected]}
                onPress={() =>
                  updateSettings({
                    notifications: {
                      ...settings.notifications,
                      push: !settings.notifications.push,
                    },
                  })
                }
              >
                <Text
                  style={[
                    styles.checkboxText,
                    settings.notifications.push && styles.checkboxTextSelected,
                  ]}
                >
                  {t('profile.edit.toggles.pushNotifications')}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      );

    default:
      return null;
  }
}
