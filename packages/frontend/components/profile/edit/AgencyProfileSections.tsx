import React from 'react';
import { View, Text, TextInput, TouchableOpacity } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { AgencyProfile } from '@/services/profileService';
import { profileEditStyles as styles } from './styles';
import type {
  AgencyBusinessTypeValue,
  AgencyEmployeeCountValue,
  AgencyInfoForm,
  AgencyVerificationField,
  ProfileVisibilityValue,
  SettingsForm,
} from './types';

const AGENCY_BUSINESS_TYPES = [
  'real_estate_agency',
  'property_management',
  'brokerage',
  'developer',
  'other',
] as const;

const AGENCY_EMPLOYEE_COUNTS = ['1-10', '11-50', '51-200', '200+'] as const;

const AGENCY_SPECIALTIES = [
  'residential',
  'commercial',
  'luxury',
  'student_housing',
  'senior_housing',
  'vacation_rentals',
] as const;

const PROFILE_VISIBILITIES = ['public', 'private', 'contacts_only'] as const;

interface AgencyProfileSectionsProps {
  activeSection: string;
  agencyInfo: AgencyInfoForm;
  settings: SettingsForm;
  members: AgencyProfile['members'] | undefined;
  updateAgencyInfo: (updates: Partial<AgencyInfoForm>) => void;
  updateSettings: (updates: Partial<SettingsForm>) => void;
  toggleSpecialty: (specialty: string) => void;
  toggleVerification: (field: AgencyVerificationField) => void;
}

export function AgencyProfileSections({
  activeSection,
  agencyInfo,
  settings,
  members,
  updateAgencyInfo,
  updateSettings,
  toggleSpecialty,
  toggleVerification,
}: AgencyProfileSectionsProps) {
  const { t } = useTranslation();

  switch (activeSection) {
    case 'business':
      return (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('profile.edit.sections.agencyInformation')}</Text>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>{t('profile.edit.labels.businessType')}</Text>
            <View style={styles.checkboxGroup}>
              {AGENCY_BUSINESS_TYPES.map((type) => (
                <TouchableOpacity
                  key={type}
                  style={[
                    styles.checkbox,
                    agencyInfo.businessType === type && styles.checkboxSelected,
                  ]}
                  onPress={() =>
                    updateAgencyInfo({ businessType: type as AgencyBusinessTypeValue })
                  }
                >
                  <Text
                    style={[
                      styles.checkboxText,
                      agencyInfo.businessType === type && styles.checkboxTextSelected,
                    ]}
                  >
                    {t(`profile.edit.options.agencyBusinessType.${type}`)}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>{t('profile.edit.labels.legalCompanyName')}</Text>
            <TextInput
              style={styles.input}
              value={agencyInfo.legalCompanyName}
              onChangeText={(text) => updateAgencyInfo({ legalCompanyName: text })}
              placeholder={t('profile.edit.placeholders.legalCompanyName')}
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>{t('profile.edit.labels.description')}</Text>
            <TextInput
              style={[styles.input, styles.textArea]}
              value={agencyInfo.description}
              onChangeText={(text) => updateAgencyInfo({ description: text })}
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
                value={agencyInfo.businessDetails.licenseNumber}
                onChangeText={(text) =>
                  updateAgencyInfo({
                    businessDetails: { ...agencyInfo.businessDetails, licenseNumber: text },
                  })
                }
                placeholder={t('profile.edit.placeholders.licenseNumber')}
              />
            </View>
            <View style={[styles.inputGroup, styles.halfWidth]}>
              <Text style={styles.label}>{t('profile.edit.labels.taxId')}</Text>
              <TextInput
                style={styles.input}
                value={agencyInfo.businessDetails.taxId}
                onChangeText={(text) =>
                  updateAgencyInfo({
                    businessDetails: { ...agencyInfo.businessDetails, taxId: text },
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
                value={agencyInfo.businessDetails.yearEstablished}
                onChangeText={(text) =>
                  updateAgencyInfo({
                    businessDetails: { ...agencyInfo.businessDetails, yearEstablished: text },
                  })
                }
                placeholder={t('profile.edit.placeholders.yearEstablished')}
                keyboardType="numeric"
              />
            </View>
            <View style={[styles.inputGroup, styles.halfWidth]}>
              <Text style={styles.label}>{t('profile.edit.labels.employeeCount')}</Text>
              <View style={styles.pickerContainer}>
                {AGENCY_EMPLOYEE_COUNTS.map((count) => (
                  <TouchableOpacity
                    key={count}
                    style={[
                      styles.pickerOption,
                      agencyInfo.businessDetails.employeeCount === count &&
                        styles.pickerOptionSelected,
                    ]}
                    onPress={() =>
                      updateAgencyInfo({
                        businessDetails: {
                          ...agencyInfo.businessDetails,
                          employeeCount: count as AgencyEmployeeCountValue,
                        },
                      })
                    }
                  >
                    <Text
                      style={[
                        styles.pickerOptionText,
                        agencyInfo.businessDetails.employeeCount === count &&
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
            <Text style={styles.label}>{t('profile.edit.labels.specialties')}</Text>
            <View style={styles.checkboxGroup}>
              {AGENCY_SPECIALTIES.map((specialty) => (
                <TouchableOpacity
                  key={specialty}
                  style={[
                    styles.checkbox,
                    agencyInfo.businessDetails.specialties.includes(specialty) &&
                      styles.checkboxSelected,
                  ]}
                  onPress={() => toggleSpecialty(specialty)}
                >
                  <Text
                    style={[
                      styles.checkboxText,
                      agencyInfo.businessDetails.specialties.includes(specialty) &&
                        styles.checkboxTextSelected,
                    ]}
                  >
                    {t(`profile.edit.options.agencySpecialty.${specialty}`)}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </View>
      );

    case 'verification':
      return (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('profile.edit.sections.agencyVerification')}</Text>
          <Text style={styles.sectionSubtitle}>
            {t('profile.edit.subtitles.agencyVerification')}
          </Text>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>{t('profile.edit.labels.verificationStatus')}</Text>

            <TouchableOpacity
              style={[
                styles.verificationItem,
                agencyInfo.verification.businessLicense && styles.verificationItemCompleted,
              ]}
              onPress={() => toggleVerification('businessLicense')}
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
                  agencyInfo.verification.businessLicense && styles.verificationStatusCompleted,
                ]}
              >
                <Text style={styles.verificationStatusText}>
                  {agencyInfo.verification.businessLicense ? '✓' : '○'}
                </Text>
              </View>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.verificationItem,
                agencyInfo.verification.insurance && styles.verificationItemCompleted,
              ]}
              onPress={() => toggleVerification('insurance')}
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
                  agencyInfo.verification.insurance && styles.verificationStatusCompleted,
                ]}
              >
                <Text style={styles.verificationStatusText}>
                  {agencyInfo.verification.insurance ? '✓' : '○'}
                </Text>
              </View>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.verificationItem,
                agencyInfo.verification.bonding && styles.verificationItemCompleted,
              ]}
              onPress={() => toggleVerification('bonding')}
            >
              <View style={styles.verificationItemContent}>
                <Text style={styles.verificationItemTitle}>
                  {t('profile.edit.verification.bondingTitle')}
                </Text>
                <Text style={styles.verificationItemDescription}>
                  {t('profile.edit.verification.bondingDescription')}
                </Text>
              </View>
              <View
                style={[
                  styles.verificationStatus,
                  agencyInfo.verification.bonding && styles.verificationStatusCompleted,
                ]}
              >
                <Text style={styles.verificationStatusText}>
                  {agencyInfo.verification.bonding ? '✓' : '○'}
                </Text>
              </View>
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.verificationItem,
                agencyInfo.verification.backgroundCheck && styles.verificationItemCompleted,
              ]}
              onPress={() => toggleVerification('backgroundCheck')}
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
                  agencyInfo.verification.backgroundCheck && styles.verificationStatusCompleted,
                ]}
              >
                <Text style={styles.verificationStatusText}>
                  {agencyInfo.verification.backgroundCheck ? '✓' : '○'}
                </Text>
              </View>
            </TouchableOpacity>
          </View>
        </View>
      );

    case 'team':
      return (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('profile.edit.sections.teamManagement')}</Text>
          <Text style={styles.sectionSubtitle}>{t('profile.edit.team.subtitle')}</Text>

          {members && members.length > 0 ? (
            members.map((member, index) => (
              <View key={index} style={styles.teamMemberItem}>
                <View style={styles.teamMemberInfo}>
                  <Text style={styles.teamMemberName}>
                    {t('profile.edit.team.memberLabel', { index: index + 1 })}
                  </Text>
                  <Text style={styles.teamMemberRole}>{member.role}</Text>
                  <Text style={styles.teamMemberDate}>
                    {t('profile.edit.team.addedLabel', {
                      date: new Date(member.addedAt).toLocaleDateString(),
                    })}
                  </Text>
                </View>
              </View>
            ))
          ) : (
            <Text style={styles.emptyStateText}>{t('profile.edit.team.emptyText')}</Text>
          )}

          <TouchableOpacity style={styles.addButton}>
            <Text style={styles.addButtonText}>{t('profile.edit.team.addMember')}</Text>
          </TouchableOpacity>
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
