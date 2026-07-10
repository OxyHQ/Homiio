import React from 'react';
import { View, Text, TextInput, TouchableOpacity } from 'react-native';
import { useTranslation } from 'react-i18next';
import { profileEditStyles as styles } from './styles';
import type {
  BusinessBusinessTypeValue,
  BusinessEmployeeCountValue,
  BusinessInfoForm,
  ProfileVisibilityValue,
  SettingsForm,
} from './types';

// The business `business` section intentionally has no specialty selector
// (matching the original screen, which only exposed specialties for agencies).

const BUSINESS_TYPES = [
  'small_business',
  'startup',
  'freelancer',
  'consultant',
  'other',
] as const;

const BUSINESS_EMPLOYEE_COUNTS = ['1-5', '6-10', '11-25', '26+'] as const;

const PROFILE_VISIBILITIES = ['public', 'private', 'contacts_only'] as const;

interface BusinessProfileSectionsProps {
  activeSection: string;
  businessInfo: BusinessInfoForm;
  settings: SettingsForm;
  updateBusinessInfo: (updates: Partial<BusinessInfoForm>) => void;
  updateSettings: (updates: Partial<SettingsForm>) => void;
}

export function BusinessProfileSections({
  activeSection,
  businessInfo,
  settings,
  updateBusinessInfo,
  updateSettings,
}: BusinessProfileSectionsProps) {
  const { t } = useTranslation();

  switch (activeSection) {
    case 'business':
      return (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('profile.edit.sections.businessInformation')}</Text>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>{t('profile.edit.labels.businessType')}</Text>
            <View style={styles.checkboxGroup}>
              {BUSINESS_TYPES.map((type) => (
                <TouchableOpacity
                  key={type}
                  style={[
                    styles.checkbox,
                    businessInfo.businessType === type && styles.checkboxSelected,
                  ]}
                  onPress={() =>
                    updateBusinessInfo({ businessType: type as BusinessBusinessTypeValue })
                  }
                >
                  <Text
                    style={[
                      styles.checkboxText,
                      businessInfo.businessType === type && styles.checkboxTextSelected,
                    ]}
                  >
                    {t(`profile.edit.options.businessType.${type}`)}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>{t('profile.edit.labels.legalCompanyName')}</Text>
            <TextInput
              style={styles.input}
              value={businessInfo.legalCompanyName}
              onChangeText={(text) => updateBusinessInfo({ legalCompanyName: text })}
              placeholder={t('profile.edit.placeholders.legalCompanyName')}
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>{t('profile.edit.labels.description')}</Text>
            <TextInput
              style={[styles.input, styles.textArea]}
              value={businessInfo.description}
              onChangeText={(text) => updateBusinessInfo({ description: text })}
              placeholder={t('profile.edit.placeholders.description')}
              multiline
              numberOfLines={4}
            />
          </View>

          <View style={styles.row}>
            <View style={[styles.inputGroup, styles.halfWidth]}>
              <Text style={styles.label}>{t('profile.edit.labels.licenseNumber')}</Text>
              <TextInput
                style={styles.input}
                value={businessInfo.businessDetails.licenseNumber}
                onChangeText={(text) =>
                  updateBusinessInfo({
                    businessDetails: { ...businessInfo.businessDetails, licenseNumber: text },
                  })
                }
                placeholder={t('profile.edit.placeholders.licenseNumber')}
              />
            </View>
            <View style={[styles.inputGroup, styles.halfWidth]}>
              <Text style={styles.label}>{t('profile.edit.labels.taxId')}</Text>
              <TextInput
                style={styles.input}
                value={businessInfo.businessDetails.taxId}
                onChangeText={(text) =>
                  updateBusinessInfo({
                    businessDetails: { ...businessInfo.businessDetails, taxId: text },
                  })
                }
                placeholder={t('profile.edit.placeholders.taxId')}
              />
            </View>
          </View>

          <View style={styles.row}>
            <View style={[styles.inputGroup, styles.halfWidth]}>
              <Text style={styles.label}>{t('profile.edit.labels.yearEstablished')}</Text>
              <TextInput
                style={styles.input}
                value={businessInfo.businessDetails.yearEstablished}
                onChangeText={(text) =>
                  updateBusinessInfo({
                    businessDetails: { ...businessInfo.businessDetails, yearEstablished: text },
                  })
                }
                placeholder={t('profile.edit.placeholders.yearEstablished')}
                keyboardType="numeric"
              />
            </View>
            <View style={[styles.inputGroup, styles.halfWidth]}>
              <Text style={styles.label}>{t('profile.edit.labels.employeeCount')}</Text>
              <View style={styles.pickerContainer}>
                {BUSINESS_EMPLOYEE_COUNTS.map((count) => (
                  <TouchableOpacity
                    key={count}
                    style={[
                      styles.pickerOption,
                      businessInfo.businessDetails.employeeCount === count &&
                        styles.pickerOptionSelected,
                    ]}
                    onPress={() =>
                      updateBusinessInfo({
                        businessDetails: {
                          ...businessInfo.businessDetails,
                          employeeCount: count as BusinessEmployeeCountValue,
                        },
                      })
                    }
                  >
                    <Text
                      style={[
                        styles.pickerOptionText,
                        businessInfo.businessDetails.employeeCount === count &&
                          styles.pickerOptionTextSelected,
                      ]}
                    >
                      {count}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>{t('profile.edit.labels.industry')}</Text>
            <TextInput
              style={styles.input}
              value={businessInfo.businessDetails.industry}
              onChangeText={(text) =>
                updateBusinessInfo({
                  businessDetails: { ...businessInfo.businessDetails, industry: text },
                })
              }
              placeholder={t('profile.edit.placeholders.industry')}
            />
          </View>
        </View>
      );

    case 'verification':
      return (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('profile.edit.sections.businessVerification')}</Text>
          <Text style={styles.sectionSubtitle}>{t('profile.edit.subtitles.businessVerification')}</Text>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>{t('profile.edit.labels.verificationStatus')}</Text>

            <TouchableOpacity
              style={[
                styles.verificationItem,
                businessInfo.verification.businessLicense && styles.verificationItemCompleted,
              ]}
              onPress={() =>
                updateBusinessInfo({
                  verification: {
                    ...businessInfo.verification,
                    businessLicense: !businessInfo.verification.businessLicense,
                  },
                })
              }
            >
              <View style={styles.verificationItemContent}>
                <Text style={styles.verificationItemTitle}>
                  {t('profile.edit.verification.businessLicenseTitle')}
                </Text>
                <Text style={styles.verificationItemDescription}>
                  {t('profile.edit.verification.businessLicenseDescription')}
                </Text>
              </View>
              <View
                style={[
                  styles.verificationStatus,
                  businessInfo.verification.businessLicense && styles.verificationStatusCompleted,
                ]}
              >
                <Text style={styles.verificationStatusText}>
                  {businessInfo.verification.businessLicense ? '✓' : '○'}
                </Text>
              </View>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.verificationItem,
                businessInfo.verification.insurance && styles.verificationItemCompleted,
              ]}
              onPress={() =>
                updateBusinessInfo({
                  verification: {
                    ...businessInfo.verification,
                    insurance: !businessInfo.verification.insurance,
                  },
                })
              }
            >
              <View style={styles.verificationItemContent}>
                <Text style={styles.verificationItemTitle}>
                  {t('profile.edit.verification.insuranceTitle')}
                </Text>
                <Text style={styles.verificationItemDescription}>
                  {t('profile.edit.verification.insuranceDescription')}
                </Text>
              </View>
              <View
                style={[
                  styles.verificationStatus,
                  businessInfo.verification.insurance && styles.verificationStatusCompleted,
                ]}
              >
                <Text style={styles.verificationStatusText}>
                  {businessInfo.verification.insurance ? '✓' : '○'}
                </Text>
              </View>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.verificationItem,
                businessInfo.verification.backgroundCheck && styles.verificationItemCompleted,
              ]}
              onPress={() =>
                updateBusinessInfo({
                  verification: {
                    ...businessInfo.verification,
                    backgroundCheck: !businessInfo.verification.backgroundCheck,
                  },
                })
              }
            >
              <View style={styles.verificationItemContent}>
                <Text style={styles.verificationItemTitle}>
                  {t('profile.edit.verification.backgroundCheckTitle')}
                </Text>
                <Text style={styles.verificationItemDescription}>
                  {t('profile.edit.verification.backgroundCheckDescription')}
                </Text>
              </View>
              <View
                style={[
                  styles.verificationStatus,
                  businessInfo.verification.backgroundCheck && styles.verificationStatusCompleted,
                ]}
              >
                <Text style={styles.verificationStatusText}>
                  {businessInfo.verification.backgroundCheck ? '✓' : '○'}
                </Text>
              </View>
            </TouchableOpacity>
          </View>
        </View>
      );

    case 'settings':
      return (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('profile.edit.sections.businessSettings')}</Text>
          <Text style={styles.sectionSubtitle}>{t('profile.edit.subtitles.businessSettings')}</Text>

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
