import React from 'react';
import { View, Text, TextInput, TouchableOpacity } from 'react-native';
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
  switch (activeSection) {
    case 'cooperative':
      return (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Cooperative Information</Text>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Legal Name *</Text>
            <TextInput
              style={styles.input}
              value={cooperativeInfo.legalName}
              onChangeText={(text) => updateCooperativeInfo({ legalName: text })}
              placeholder="Enter cooperative legal name"
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Description</Text>
            <TextInput
              style={[styles.input, styles.textArea]}
              value={cooperativeInfo.description}
              onChangeText={(text) => updateCooperativeInfo({ description: text })}
              placeholder="Describe your cooperative..."
              multiline
              numberOfLines={4}
            />
          </View>
        </View>
      );

    case 'settings':
      return (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Cooperative Settings</Text>
          <Text style={styles.sectionSubtitle}>Configure your cooperative profile settings</Text>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Profile Visibility</Text>
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
                    {visibility.replace('_', ' ').toUpperCase()}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Notifications</Text>
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
                  Email Notifications
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
                  Push Notifications
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
