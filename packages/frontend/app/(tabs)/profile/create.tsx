import React, { useState } from 'react';
import { View, StyleSheet, TouchableOpacity, TextInput, ScrollView } from 'react-native';
import { ThemedText } from '@/components/ThemedText';
import { useTranslation } from 'react-i18next';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors } from '@/styles/colors';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useCreateProfileMutation } from '@/hooks/query/useProfiles';
import { ProfileType as SharedProfileType, type CreateProfileData } from '@/services/profileService';
import { BusinessType, type BusinessDetails } from '@homiio/shared-types';
import { toast } from '@/lib/sonner';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

type ProfileType = 'agency' | 'business' | 'cooperative';

type EmployeeCount = NonNullable<BusinessDetails['employeeCount']>;

export default function ProfileCreateScreen() {
  useTranslation();
  const router = useRouter();
  const { mutateAsync: createProfile, isPending: isCreatingMut } = useCreateProfileMutation();
  const [isCreating, setIsCreating] = useState(false);
  const [selectedType, setSelectedType] = useState<ProfileType | null>(null);
  const [formData, setFormData] = useState({
    businessType: '' as BusinessType | '',
    description: '',
    businessDetails: {
      licenseNumber: '',
      taxId: '',
      yearEstablished: '',
      employeeCount: '' as EmployeeCount | '',
      specialties: [] as string[],
    },
    legalCompanyName: '',
    legalName: '',
  });

  const profileTypes: { type: ProfileType; title: string; description: string; icon: IoniconName }[] = [
    {
      type: 'agency',
      title: 'Agency Profile',
      description: 'For real estate agencies and property management',
      icon: 'business-outline',
    },
    {
      type: 'business',
      title: 'Business Profile',
      description: 'For small businesses and freelancers',
      icon: 'briefcase-outline',
    },
    {
      type: 'cooperative',
      title: 'Cooperative Profile',
      description: 'For housing or member-owned cooperatives',
      icon: 'people-outline',
    },
  ];

  const handleCreateProfile = async () => {
    if (!selectedType) {
      toast.error('Please select a profile type.');
      return;
    }

    setIsCreating(true);
    try {
      const toSharedType = (t: ProfileType): SharedProfileType =>
        ({
          agency: SharedProfileType.AGENCY,
          business: SharedProfileType.BUSINESS,
          cooperative: SharedProfileType.COOPERATIVE,
        } as const)[t];

      const profileData: CreateProfileData = {
        profileType: toSharedType(selectedType),
        data: {},
      };

      // Add type-specific data
      if (selectedType === 'agency') {
        // Validate required fields
        if (!formData.businessType) {
          toast.error('Please select a business type.');
          return;
        }

        const yearEstablished = formData.businessDetails.yearEstablished
          ? parseInt(formData.businessDetails.yearEstablished)
          : undefined;
        const employeeCount = formData.businessDetails.employeeCount || undefined;

        profileData.data = {
          businessType: formData.businessType,
          description: formData.description,
          businessDetails: {
            licenseNumber: formData.businessDetails.licenseNumber || undefined,
            taxId: formData.businessDetails.taxId || undefined,
            yearEstablished,
            employeeCount,
            specialties: formData.businessDetails.specialties,
          },
          legalCompanyName: formData.legalCompanyName,
        };
      } else if (selectedType === 'business') {
        // Validate required fields
        if (!formData.businessType) {
          toast.error('Please select a business type.');
          return;
        }

        const yearEstablished = formData.businessDetails.yearEstablished
          ? parseInt(formData.businessDetails.yearEstablished)
          : undefined;
        const employeeCount = formData.businessDetails.employeeCount || undefined;

        profileData.data = {
          businessType: formData.businessType,
          description: formData.description,
          businessDetails: {
            licenseNumber: formData.businessDetails.licenseNumber || undefined,
            taxId: formData.businessDetails.taxId || undefined,
            yearEstablished,
            employeeCount,
            specialties: formData.businessDetails.specialties,
          },
          legalCompanyName: formData.legalCompanyName,
        };
      } else if (selectedType === 'cooperative') {
        if (!formData.legalName) {
          toast.error('Please enter a legal name for the cooperative.');
          return;
        }
        profileData.data = {
          legalName: formData.legalName,
          description: formData.description,
        };
      }

  await createProfile(profileData);
      toast.success(
        `${profileTypes.find((p) => p.type === selectedType)?.title} created successfully!`,
      );
      router.back();
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : 'Failed to create profile. Please try again.';
      toast.error(message);
    } finally {
      setIsCreating(false);
    }
  };

  const toggleSpecialty = (specialty: string) => {
    setFormData((prev) => ({
      ...prev,
      businessDetails: {
        ...prev.businessDetails,
        specialties: prev.businessDetails.specialties.includes(specialty)
          ? prev.businessDetails.specialties.filter((s) => s !== specialty)
          : [...prev.businessDetails.specialties, specialty],
      },
    }));
  };

  const employeeCountOptions: EmployeeCount[] = ['1-10', '11-50', '51-200', '200+'];

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color={colors.COLOR_BLACK} />
        </TouchableOpacity>
        <ThemedText style={styles.headerTitle}>Create Profile</ThemedText>
        <TouchableOpacity
          onPress={handleCreateProfile}
          style={[styles.createButton, !selectedType && styles.createButtonDisabled]}
          disabled={!selectedType || isCreating || isCreatingMut}
        >
          {isCreating || isCreatingMut ? (
            <Ionicons name="refresh" size={20} color={colors.white} />
          ) : (
            <ThemedText style={styles.createButtonText}>Create</ThemedText>
          )}
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.content}>
        {/* Profile Type Selection */}
        <View style={styles.section}>
          <ThemedText style={styles.sectionTitle}>Choose Business Profile Type</ThemedText>

          {profileTypes.map((profileType, index) => (
            <TouchableOpacity
              key={profileType.type}
              style={[
                styles.settingItem,
                index === 0 && styles.firstSettingItem,
                index === profileTypes.length - 1 && styles.lastSettingItem,
                selectedType === profileType.type && styles.selectedItem,
              ]}
              onPress={() => setSelectedType(profileType.type)}
            >
              <View style={styles.settingInfo}>
                <Ionicons
                  name={profileType.icon}
                  size={20}
                  color={selectedType === profileType.type ? colors.primaryColor : colors.muted}
                  style={styles.settingIcon}
                />
                <View>
                  <ThemedText
                    style={[
                      styles.settingLabel,
                      selectedType === profileType.type && styles.selectedLabel,
                    ]}
                  >
                    {profileType.title}
                  </ThemedText>
                  <ThemedText style={styles.settingDescription}>
                    {profileType.description}
                  </ThemedText>
                </View>
              </View>
              {selectedType === profileType.type && (
                <Ionicons name="checkmark" size={20} color={colors.primaryColor} />
              )}
            </TouchableOpacity>
          ))}
        </View>

        {/* Agency-specific form */}
        {selectedType === 'agency' && (
          <View style={styles.section}>
            <ThemedText style={styles.sectionTitle}>Agency Information</ThemedText>

            <View style={styles.inputGroup}>
              <ThemedText style={styles.label}>Business Type *</ThemedText>
              <View style={styles.radioGroup}>
                {[
                  BusinessType.REAL_ESTATE_AGENCY,
                  BusinessType.PROPERTY_MANAGEMENT,
                  BusinessType.BROKERAGE,
                  BusinessType.DEVELOPER,
                  BusinessType.OTHER,
                ].map((type) => (
                  <TouchableOpacity
                    key={type}
                    style={[
                      styles.radioButton,
                      formData.businessType === type && styles.radioButtonSelected,
                    ]}
                    onPress={() => setFormData((prev) => ({ ...prev, businessType: type }))}
                  >
                    <ThemedText
                      style={[
                        styles.radioButtonText,
                        formData.businessType === type && styles.radioButtonTextSelected,
                      ]}
                    >
                      {type.replace('_', ' ').replace(/\b\w/g, (l) => l.toUpperCase())}
                    </ThemedText>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            <View style={styles.inputGroup}>
              <ThemedText style={styles.label}>Description</ThemedText>
              <TextInput
                style={[styles.input, styles.textArea]}
                value={formData.description}
                onChangeText={(text) => setFormData((prev) => ({ ...prev, description: text }))}
                placeholder="Describe your agency..."
                multiline
                numberOfLines={4}
              />
            </View>

            <View style={styles.inputGroup}>
              <ThemedText style={styles.label}>License Number</ThemedText>
              <TextInput
                style={styles.input}
                value={formData.businessDetails.licenseNumber}
                onChangeText={(text) =>
                  setFormData((prev) => ({
                    ...prev,
                    businessDetails: { ...prev.businessDetails, licenseNumber: text },
                  }))
                }
                placeholder="Enter license number"
              />
            </View>

            <View style={styles.inputGroup}>
              <ThemedText style={styles.label}>Tax ID</ThemedText>
              <TextInput
                style={styles.input}
                value={formData.businessDetails.taxId}
                onChangeText={(text) =>
                  setFormData((prev) => ({
                    ...prev,
                    businessDetails: { ...prev.businessDetails, taxId: text },
                  }))
                }
                placeholder="Enter tax ID"
              />
            </View>

            <View style={styles.inputGroup}>
              <ThemedText style={styles.label}>Year Established</ThemedText>
              <TextInput
                style={styles.input}
                value={formData.businessDetails.yearEstablished}
                onChangeText={(text) =>
                  setFormData((prev) => ({
                    ...prev,
                    businessDetails: { ...prev.businessDetails, yearEstablished: text },
                  }))
                }
                placeholder="e.g., 2020"
                keyboardType="numeric"
              />
            </View>

            <View style={styles.inputGroup}>
              <ThemedText style={styles.label}>Number of Employees</ThemedText>
              <View style={styles.radioGroup}>
                {employeeCountOptions.map((count) => (
                  <TouchableOpacity
                    key={count}
                    style={[
                      styles.radioButton,
                      formData.businessDetails.employeeCount === count &&
                        styles.radioButtonSelected,
                    ]}
                    onPress={() =>
                      setFormData((prev) => ({
                        ...prev,
                        businessDetails: { ...prev.businessDetails, employeeCount: count },
                      }))
                    }
                  >
                    <ThemedText
                      style={[
                        styles.radioButtonText,
                        formData.businessDetails.employeeCount === count &&
                          styles.radioButtonTextSelected,
                      ]}
                    >
                      {count}
                    </ThemedText>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            <View style={styles.inputGroup}>
              <ThemedText style={styles.label}>Specialties</ThemedText>
              <View style={styles.checkboxGroup}>
                {['residential', 'commercial', 'investment', 'rental', 'new_construction'].map(
                  (specialty) => (
                    <TouchableOpacity
                      key={specialty}
                      style={[
                        styles.checkbox,
                        formData.businessDetails.specialties.includes(specialty) &&
                          styles.checkboxSelected,
                      ]}
                      onPress={() => toggleSpecialty(specialty)}
                    >
                      <ThemedText
                        style={[
                          styles.checkboxText,
                          formData.businessDetails.specialties.includes(specialty) &&
                            styles.checkboxTextSelected,
                        ]}
                      >
                        {specialty.replace('_', ' ').replace(/\b\w/g, (l) => l.toUpperCase())}
                      </ThemedText>
                    </TouchableOpacity>
                  ),
                )}
              </View>
            </View>

            <View style={styles.inputGroup}>
              <ThemedText style={styles.label}>Legal Company Name *</ThemedText>
              <TextInput
                style={styles.input}
                value={formData.legalCompanyName}
                onChangeText={(text) =>
                  setFormData((prev) => ({ ...prev, legalCompanyName: text }))
                }
                placeholder="Enter your legal company name"
              />
            </View>
          </View>
        )}

        {/* Business-specific form */}
        {selectedType === 'business' && (
          <View style={styles.section}>
            <ThemedText style={styles.sectionTitle}>Business Information</ThemedText>

            <View style={styles.inputGroup}>
              <ThemedText style={styles.label}>Business Type *</ThemedText>
              <View style={styles.radioGroup}>
                {[
                  BusinessType.SMALL_BUSINESS,
                  BusinessType.STARTUP,
                  BusinessType.FREELANCER,
                  BusinessType.CONSULTANT,
                  BusinessType.OTHER,
                ].map((type) => (
                  <TouchableOpacity
                    key={type}
                    style={[
                      styles.radioButton,
                      formData.businessType === type && styles.radioButtonSelected,
                    ]}
                    onPress={() => setFormData((prev) => ({ ...prev, businessType: type }))}
                  >
                    <ThemedText
                      style={[
                        styles.radioButtonText,
                        formData.businessType === type && styles.radioButtonTextSelected,
                      ]}
                    >
                      {type.replace('_', ' ').replace(/\b\w/g, (l) => l.toUpperCase())}
                    </ThemedText>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            <View style={styles.inputGroup}>
              <ThemedText style={styles.label}>Description</ThemedText>
              <TextInput
                style={[styles.input, styles.textArea]}
                value={formData.description}
                onChangeText={(text) => setFormData((prev) => ({ ...prev, description: text }))}
                placeholder="Describe your business..."
                multiline
                numberOfLines={4}
              />
            </View>

            <View style={styles.inputGroup}>
              <ThemedText style={styles.label}>License Number</ThemedText>
              <TextInput
                style={styles.input}
                value={formData.businessDetails.licenseNumber}
                onChangeText={(text) =>
                  setFormData((prev) => ({
                    ...prev,
                    businessDetails: { ...prev.businessDetails, licenseNumber: text },
                  }))
                }
                placeholder="Enter license number (if applicable)"
              />
            </View>

            <View style={styles.inputGroup}>
              <ThemedText style={styles.label}>Tax ID</ThemedText>
              <TextInput
                style={styles.input}
                value={formData.businessDetails.taxId}
                onChangeText={(text) =>
                  setFormData((prev) => ({
                    ...prev,
                    businessDetails: { ...prev.businessDetails, taxId: text },
                  }))
                }
                placeholder="Enter tax ID"
              />
            </View>

            <View style={styles.inputGroup}>
              <ThemedText style={styles.label}>Year Established</ThemedText>
              <TextInput
                style={styles.input}
                value={formData.businessDetails.yearEstablished}
                onChangeText={(text) =>
                  setFormData((prev) => ({
                    ...prev,
                    businessDetails: { ...prev.businessDetails, yearEstablished: text },
                  }))
                }
                placeholder="e.g., 2020"
                keyboardType="numeric"
              />
            </View>

            <View style={styles.inputGroup}>
              <ThemedText style={styles.label}>Number of Employees</ThemedText>
              <View style={styles.radioGroup}>
                {(['1-5', '6-10', '11-25', '26+'] satisfies EmployeeCount[]).map((count) => (
                  <TouchableOpacity
                    key={count}
                    style={[
                      styles.radioButton,
                      formData.businessDetails.employeeCount === count &&
                        styles.radioButtonSelected,
                    ]}
                    onPress={() =>
                      setFormData((prev) => ({
                        ...prev,
                        businessDetails: { ...prev.businessDetails, employeeCount: count },
                      }))
                    }
                  >
                    <ThemedText
                      style={[
                        styles.radioButtonText,
                        formData.businessDetails.employeeCount === count &&
                          styles.radioButtonTextSelected,
                      ]}
                    >
                      {count}
                    </ThemedText>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            <View style={styles.inputGroup}>
              <ThemedText style={styles.label}>Specialties</ThemedText>
              <View style={styles.checkboxGroup}>
                {[
                  'consulting',
                  'technology',
                  'design',
                  'marketing',
                  'finance',
                  'healthcare',
                  'education',
                  'retail',
                  'services',
                ].map((specialty) => (
                  <TouchableOpacity
                    key={specialty}
                    style={[
                      styles.checkbox,
                      formData.businessDetails.specialties.includes(specialty) &&
                        styles.checkboxSelected,
                    ]}
                    onPress={() => toggleSpecialty(specialty)}
                  >
                    <ThemedText
                      style={[
                        styles.checkboxText,
                        formData.businessDetails.specialties.includes(specialty) &&
                          styles.checkboxTextSelected,
                      ]}
                    >
                      {specialty.replace('_', ' ').replace(/\b\w/g, (l) => l.toUpperCase())}
                    </ThemedText>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            <View style={styles.inputGroup}>
              <ThemedText style={styles.label}>Legal Company Name *</ThemedText>
              <TextInput
                style={styles.input}
                value={formData.legalCompanyName}
                onChangeText={(text) =>
                  setFormData((prev) => ({ ...prev, legalCompanyName: text }))
                }
                placeholder="Enter your legal company name"
              />
            </View>
          </View>
        )}

        {/* Cooperative-specific form */}
        {selectedType === 'cooperative' && (
          <View style={styles.section}>
            <ThemedText style={styles.sectionTitle}>Cooperative Information</ThemedText>
            <View style={styles.inputGroup}>
              <ThemedText style={styles.label}>Legal Name *</ThemedText>
              <TextInput
                style={styles.input}
                value={formData.legalName}
                onChangeText={(text) => setFormData((prev) => ({ ...prev, legalName: text }))}
                placeholder="Cooperative Legal Name"
              />
            </View>
            <View style={styles.inputGroup}>
              <ThemedText style={styles.label}>Description</ThemedText>
              <TextInput
                style={[styles.input, { height: 80 }]}
                value={formData.description}
                onChangeText={(text) => setFormData((prev) => ({ ...prev, description: text }))}
                placeholder="Describe the cooperative"
                multiline
              />
            </View>
          </View>
        )}

        {/* Profile Type Info */}
        {selectedType && (
          <View style={styles.section}>
            <ThemedText style={styles.sectionTitle}>What&apos;s Next?</ThemedText>
            <View style={[styles.settingItem, styles.firstSettingItem, styles.lastSettingItem]}>
              <View style={styles.settingInfo}>
                <Ionicons
                  name="information-circle"
                  size={20}
                  color={colors.muted}
                  style={styles.settingIcon}
                />
                <View style={styles.infoContent}>
                  <ThemedText style={styles.settingLabel}>Profile Setup</ThemedText>
                  <ThemedText style={styles.settingDescription}>
                    After creating your {selectedType} profile, you can customize preferences, add
                    verification documents, and build your trust score.
                  </ThemedText>
                </View>
              </View>
            </View>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 16,
    backgroundColor: colors.white,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  backButton: {
    padding: 8,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: colors.COLOR_BLACK,
  },
  createButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: colors.primaryColor,
    borderRadius: 20,
  },
  createButtonDisabled: {
    backgroundColor: colors.border,
  },
  createButtonText: {
    color: colors.white,
    fontSize: 16,
    fontWeight: '600',
  },
  content: {
    flex: 1,
    padding: 16,
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.COLOR_BLACK_LIGHT_3,
    marginBottom: 12,
  },
  settingItem: {
    backgroundColor: colors.white,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 2,
  },
  firstSettingItem: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    marginBottom: 2,
  },
  lastSettingItem: {
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
    marginBottom: 8,
  },
  settingInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  settingIcon: {
    marginRight: 12,
  },
  settingLabel: {
    fontSize: 16,
    fontWeight: '500',
    color: colors.COLOR_BLACK_LIGHT_3,
    marginBottom: 2,
  },
  settingDescription: {
    fontSize: 14,
    color: colors.muted,
    flexWrap: 'wrap',
    flexShrink: 1,
  },
  selectedItem: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.primaryColor,
  },
  selectedLabel: {
    color: colors.primaryColor,
    fontWeight: '600',
  },
  inputGroup: {
    marginBottom: 16,
  },
  label: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.COLOR_BLACK_LIGHT_3,
    marginBottom: 8,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 16,
    backgroundColor: colors.white,
  },
  textArea: {
    height: 100,
    textAlignVertical: 'top',
  },
  radioGroup: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  radioButton: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
  },
  radioButtonSelected: {
    backgroundColor: colors.primaryColor,
    borderColor: colors.primaryColor,
  },
  radioButtonText: {
    fontSize: 14,
    color: colors.COLOR_BLACK_LIGHT_3,
  },
  radioButtonTextSelected: {
    color: colors.white,
  },
  checkboxGroup: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  checkbox: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.white,
  },
  checkboxSelected: {
    backgroundColor: colors.primaryColor,
    borderColor: colors.primaryColor,
  },
  checkboxText: {
    fontSize: 14,
    color: colors.COLOR_BLACK_LIGHT_3,
  },
  checkboxTextSelected: {
    color: colors.white,
  },
  infoContent: {
    flex: 1,
  },
});
