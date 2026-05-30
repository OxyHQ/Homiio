import React from 'react';
import { View, Text, TextInput, TouchableOpacity } from 'react-native';
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

const titleizeUnderscore = (value: string) =>
  value.replace('_', ' ').replace(/\b\w/g, (l) => l.toUpperCase());

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
  switch (activeSection) {
    case 'business':
      return (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Agency Information</Text>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Business Type *</Text>
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
                    {titleizeUnderscore(type)}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Legal Company Name *</Text>
            <TextInput
              style={styles.input}
              value={agencyInfo.legalCompanyName}
              onChangeText={(text) => updateAgencyInfo({ legalCompanyName: text })}
              placeholder="Enter your legal company name"
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Description</Text>
            <TextInput
              style={[styles.input, styles.textArea]}
              value={agencyInfo.description}
              onChangeText={(text) => updateAgencyInfo({ description: text })}
              placeholder="Describe your business..."
              multiline
              numberOfLines={4}
            />
          </View>

          <View style={styles.row}>
            <View style={[styles.inputGroup, styles.halfWidth]}>
              <Text style={styles.label}>License Number</Text>
              <TextInput
                style={styles.input}
                value={agencyInfo.businessDetails.licenseNumber}
                onChangeText={(text) =>
                  updateAgencyInfo({
                    businessDetails: { ...agencyInfo.businessDetails, licenseNumber: text },
                  })
                }
                placeholder="Enter license number"
              />
            </View>
            <View style={[styles.inputGroup, styles.halfWidth]}>
              <Text style={styles.label}>Tax ID</Text>
              <TextInput
                style={styles.input}
                value={agencyInfo.businessDetails.taxId}
                onChangeText={(text) =>
                  updateAgencyInfo({
                    businessDetails: { ...agencyInfo.businessDetails, taxId: text },
                  })
                }
                placeholder="Enter tax ID"
              />
            </View>
          </View>

          <View style={styles.row}>
            <View style={[styles.inputGroup, styles.halfWidth]}>
              <Text style={styles.label}>Year Established</Text>
              <TextInput
                style={styles.input}
                value={agencyInfo.businessDetails.yearEstablished}
                onChangeText={(text) =>
                  updateAgencyInfo({
                    businessDetails: { ...agencyInfo.businessDetails, yearEstablished: text },
                  })
                }
                placeholder="e.g., 2020"
                keyboardType="numeric"
              />
            </View>
            <View style={[styles.inputGroup, styles.halfWidth]}>
              <Text style={styles.label}>Number of Employees</Text>
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
            <Text style={styles.label}>Specialties</Text>
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
                    {titleizeUnderscore(specialty)}
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
          <Text style={styles.sectionTitle}>Agency Verification</Text>
          <Text style={styles.sectionSubtitle}>
            Complete these verifications to build trust with clients
          </Text>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Verification Status</Text>

            <TouchableOpacity
              style={[
                styles.verificationItem,
                agencyInfo.verification.businessLicense && styles.verificationItemCompleted,
              ]}
              onPress={() => toggleVerification('businessLicense')}
            >
              <View style={styles.verificationItemContent}>
                <Text style={styles.verificationItemTitle}>Business License</Text>
                <Text style={styles.verificationItemDescription}>
                  Upload your business license for verification
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
                <Text style={styles.verificationItemTitle}>Insurance</Text>
                <Text style={styles.verificationItemDescription}>
                  Provide proof of business insurance
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
                <Text style={styles.verificationItemTitle}>Bonding</Text>
                <Text style={styles.verificationItemDescription}>
                  Provide surety bond information
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
                <Text style={styles.verificationItemTitle}>Background Check</Text>
                <Text style={styles.verificationItemDescription}>
                  Complete background check for all team members
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
          <Text style={styles.sectionTitle}>Team Management</Text>
          <Text style={styles.sectionSubtitle}>Manage your team members and their roles</Text>

          {members && members.length > 0 ? (
            members.map((member, index) => (
              <View key={index} style={styles.teamMemberItem}>
                <View style={styles.teamMemberInfo}>
                  <Text style={styles.teamMemberName}>Member {index + 1}</Text>
                  <Text style={styles.teamMemberRole}>{member.role}</Text>
                  <Text style={styles.teamMemberDate}>
                    Added: {new Date(member.addedAt).toLocaleDateString()}
                  </Text>
                </View>
              </View>
            ))
          ) : (
            <Text style={styles.emptyStateText}>No team members added yet.</Text>
          )}

          <TouchableOpacity style={styles.addButton}>
            <Text style={styles.addButtonText}>+ Add Team Member</Text>
          </TouchableOpacity>
        </View>
      );

    case 'settings':
      return (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Business Settings</Text>
          <Text style={styles.sectionSubtitle}>Configure your business profile settings</Text>

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
