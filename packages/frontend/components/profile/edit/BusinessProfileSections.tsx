import React from 'react';
import { View, Text, TextInput, TouchableOpacity } from 'react-native';
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

const titleizeUnderscore = (value: string) =>
  value.replace('_', ' ').replace(/\b\w/g, (l) => l.toUpperCase());

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
  switch (activeSection) {
    case 'business':
      return (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Business Information</Text>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Business Type *</Text>
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
              value={businessInfo.legalCompanyName}
              onChangeText={(text) => updateBusinessInfo({ legalCompanyName: text })}
              placeholder="Enter your legal company name"
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Description</Text>
            <TextInput
              style={[styles.input, styles.textArea]}
              value={businessInfo.description}
              onChangeText={(text) => updateBusinessInfo({ description: text })}
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
                value={businessInfo.businessDetails.licenseNumber}
                onChangeText={(text) =>
                  updateBusinessInfo({
                    businessDetails: { ...businessInfo.businessDetails, licenseNumber: text },
                  })
                }
                placeholder="Enter license number"
              />
            </View>
            <View style={[styles.inputGroup, styles.halfWidth]}>
              <Text style={styles.label}>Tax ID</Text>
              <TextInput
                style={styles.input}
                value={businessInfo.businessDetails.taxId}
                onChangeText={(text) =>
                  updateBusinessInfo({
                    businessDetails: { ...businessInfo.businessDetails, taxId: text },
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
                value={businessInfo.businessDetails.yearEstablished}
                onChangeText={(text) =>
                  updateBusinessInfo({
                    businessDetails: { ...businessInfo.businessDetails, yearEstablished: text },
                  })
                }
                placeholder="e.g., 2020"
                keyboardType="numeric"
              />
            </View>
            <View style={[styles.inputGroup, styles.halfWidth]}>
              <Text style={styles.label}>Number of Employees</Text>
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
            <Text style={styles.label}>Industry</Text>
            <TextInput
              style={styles.input}
              value={businessInfo.businessDetails.industry}
              onChangeText={(text) =>
                updateBusinessInfo({
                  businessDetails: { ...businessInfo.businessDetails, industry: text },
                })
              }
              placeholder="Enter industry"
            />
          </View>
        </View>
      );

    case 'verification':
      return (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Business Verification</Text>
          <Text style={styles.sectionSubtitle}>
            Complete these verifications to build trust with clients
          </Text>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Verification Status</Text>

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
                <Text style={styles.verificationItemTitle}>Business License</Text>
                <Text style={styles.verificationItemDescription}>
                  Upload your business license for verification
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
                <Text style={styles.verificationItemTitle}>Insurance</Text>
                <Text style={styles.verificationItemDescription}>
                  Provide proof of business insurance
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
                <Text style={styles.verificationItemTitle}>Background Check</Text>
                <Text style={styles.verificationItemDescription}>
                  Complete background check for all team members
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
