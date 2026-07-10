import React, { useMemo, useState } from 'react';
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

const AGENCY_BUSINESS_TYPES = [
  BusinessType.REAL_ESTATE_AGENCY,
  BusinessType.PROPERTY_MANAGEMENT,
  BusinessType.BROKERAGE,
  BusinessType.DEVELOPER,
  BusinessType.OTHER,
] as const;

const BUSINESS_BUSINESS_TYPES = [
  BusinessType.SMALL_BUSINESS,
  BusinessType.STARTUP,
  BusinessType.FREELANCER,
  BusinessType.CONSULTANT,
  BusinessType.OTHER,
] as const;

const AGENCY_SPECIALTIES = [
  'residential',
  'commercial',
  'investment',
  'rental',
  'new_construction',
] as const;

const BUSINESS_SPECIALTIES = [
  'consulting',
  'technology',
  'design',
  'marketing',
  'finance',
  'healthcare',
  'education',
  'retail',
  'services',
] as const;

export default function ProfileCreateScreen() {
  const { t } = useTranslation();
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

  const profileTypes = useMemo(
    (): { type: ProfileType; title: string; description: string; icon: IoniconName }[] => [
      {
        type: 'agency',
        title: t('profile.create.types.agency.title'),
        description: t('profile.create.types.agency.description'),
        icon: 'business-outline',
      },
      {
        type: 'business',
        title: t('profile.create.types.business.title'),
        description: t('profile.create.types.business.description'),
        icon: 'briefcase-outline',
      },
      {
        type: 'cooperative',
        title: t('profile.create.types.cooperative.title'),
        description: t('profile.create.types.cooperative.description'),
        icon: 'people-outline',
      },
    ],
    [t],
  );

  const handleCreateProfile = async () => {
    if (!selectedType) {
      toast.error(t('profile.create.selectType'));
      return;
    }

    setIsCreating(true);
    try {
      const toSharedType = (profileType: ProfileType): SharedProfileType =>
        ({
          agency: SharedProfileType.AGENCY,
          business: SharedProfileType.BUSINESS,
          cooperative: SharedProfileType.COOPERATIVE,
        } as const)[profileType];

      const profileData: CreateProfileData = {
        profileType: toSharedType(selectedType),
        data: {},
      };

      if (selectedType === 'agency' || selectedType === 'business') {
        if (!formData.businessType) {
          toast.error(t('profile.create.selectBusinessType'));
          return;
        }

        const yearEstablished = formData.businessDetails.yearEstablished
          ? parseInt(formData.businessDetails.yearEstablished, 10)
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
          toast.error(t('profile.create.cooperativeLegalNameRequired'));
          return;
        }
        profileData.data = {
          legalName: formData.legalName,
          description: formData.description,
        };
      }

      await createProfile(profileData);
      toast.success(
        t('profile.create.createdSuccess', {
          type: profileTypes.find((p) => p.type === selectedType)?.title ?? '',
        }),
      );
      router.back();
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : t('profile.toast.createFailed');
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

  const agencyEmployeeCounts: EmployeeCount[] = ['1-10', '11-50', '51-200', '200+'];
  const businessEmployeeCounts = ['1-5', '6-10', '11-25', '26+'] as const satisfies readonly EmployeeCount[];

  const businessTypeLabel = (type: BusinessType, profileType: 'agency' | 'business') => {
    const namespace =
      profileType === 'agency'
        ? 'profile.edit.options.agencyBusinessType'
        : 'profile.edit.options.businessType';
    return t(`${namespace}.${type}`);
  };

  const specialtyLabel = (specialty: string, profileType: 'agency' | 'business') => {
    const namespace =
      profileType === 'agency'
        ? 'profile.create.options.agencySpecialty'
        : 'profile.create.options.businessSpecialty';
    return t(`${namespace}.${specialty}`);
  };

  const renderBusinessForm = (profileType: 'agency' | 'business') => {
    const businessTypes =
      profileType === 'agency' ? AGENCY_BUSINESS_TYPES : BUSINESS_BUSINESS_TYPES;
    const employeeCounts =
      profileType === 'agency' ? agencyEmployeeCounts : businessEmployeeCounts;
    const specialties =
      profileType === 'agency' ? AGENCY_SPECIALTIES : BUSINESS_SPECIALTIES;
    const sectionKey =
      profileType === 'agency' ? 'profile.create.sections.agencyInfo' : 'profile.create.sections.businessInfo';
    const descriptionPlaceholder =
      profileType === 'agency'
        ? t('profile.create.placeholders.agencyDescription')
        : t('profile.create.placeholders.businessDescription');

    return (
      <View style={styles.section}>
        <ThemedText style={styles.sectionTitle}>{t(sectionKey)}</ThemedText>

        <View style={styles.inputGroup}>
          <ThemedText style={styles.label}>{t('profile.edit.labels.businessType')}</ThemedText>
          <View style={styles.radioGroup}>
            {businessTypes.map((type) => (
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
                  {businessTypeLabel(type, profileType)}
                </ThemedText>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <View style={styles.inputGroup}>
          <ThemedText style={styles.label}>{t('profile.edit.labels.description')}</ThemedText>
          <TextInput
            style={[styles.input, styles.textArea]}
            value={formData.description}
            onChangeText={(text) => setFormData((prev) => ({ ...prev, description: text }))}
            placeholder={descriptionPlaceholder}
            multiline
            numberOfLines={4}
          />
        </View>

        <View style={styles.inputGroup}>
          <ThemedText style={styles.label}>{t('profile.edit.labels.licenseNumber')}</ThemedText>
          <TextInput
            style={styles.input}
            value={formData.businessDetails.licenseNumber}
            onChangeText={(text) =>
              setFormData((prev) => ({
                ...prev,
                businessDetails: { ...prev.businessDetails, licenseNumber: text },
              }))
            }
            placeholder={
              profileType === 'business'
                ? t('profile.create.placeholders.licenseOptional')
                : t('profile.edit.placeholders.licenseNumber')
            }
          />
        </View>

        <View style={styles.inputGroup}>
          <ThemedText style={styles.label}>{t('profile.edit.labels.taxId')}</ThemedText>
          <TextInput
            style={styles.input}
            value={formData.businessDetails.taxId}
            onChangeText={(text) =>
              setFormData((prev) => ({
                ...prev,
                businessDetails: { ...prev.businessDetails, taxId: text },
              }))
            }
            placeholder={t('profile.edit.placeholders.taxId')}
          />
        </View>

        <View style={styles.inputGroup}>
          <ThemedText style={styles.label}>{t('profile.edit.labels.yearEstablished')}</ThemedText>
          <TextInput
            style={styles.input}
            value={formData.businessDetails.yearEstablished}
            onChangeText={(text) =>
              setFormData((prev) => ({
                ...prev,
                businessDetails: { ...prev.businessDetails, yearEstablished: text },
              }))
            }
            placeholder={t('profile.edit.placeholders.yearEstablished')}
            keyboardType="numeric"
          />
        </View>

        <View style={styles.inputGroup}>
          <ThemedText style={styles.label}>{t('profile.edit.labels.employeeCount')}</ThemedText>
          <View style={styles.radioGroup}>
            {employeeCounts.map((count) => (
              <TouchableOpacity
                key={count}
                style={[
                  styles.radioButton,
                  formData.businessDetails.employeeCount === count && styles.radioButtonSelected,
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
          <ThemedText style={styles.label}>{t('profile.edit.labels.specialties')}</ThemedText>
          <View style={styles.checkboxGroup}>
            {specialties.map((specialty) => (
              <TouchableOpacity
                key={specialty}
                style={[
                  styles.checkbox,
                  formData.businessDetails.specialties.includes(specialty) && styles.checkboxSelected,
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
                  {specialtyLabel(specialty, profileType)}
                </ThemedText>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <View style={styles.inputGroup}>
          <ThemedText style={styles.label}>{t('profile.edit.labels.legalCompanyName')}</ThemedText>
          <TextInput
            style={styles.input}
            value={formData.legalCompanyName}
            onChangeText={(text) => setFormData((prev) => ({ ...prev, legalCompanyName: text }))}
            placeholder={t('profile.edit.placeholders.legalCompanyName')}
          />
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} style={styles.backButton}>
          <Ionicons name="arrow-back" size={24} color={colors.COLOR_BLACK} />
        </TouchableOpacity>
        <ThemedText style={styles.headerTitle}>{t('profile.create.headerTitle')}</ThemedText>
        <TouchableOpacity
          onPress={handleCreateProfile}
          style={[styles.createButton, !selectedType && styles.createButtonDisabled]}
          disabled={!selectedType || isCreating || isCreatingMut}
        >
          {isCreating || isCreatingMut ? (
            <Ionicons name="refresh" size={20} color={colors.primaryForeground} />
          ) : (
            <ThemedText style={styles.createButtonText}>{t('profile.create.createButton')}</ThemedText>
          )}
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.content}>
        <View style={styles.section}>
          <ThemedText style={styles.sectionTitle}>{t('profile.create.chooseType')}</ThemedText>

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
              {selectedType === profileType.type ? (
                <Ionicons name="checkmark" size={20} color={colors.primaryColor} />
              ) : null}
            </TouchableOpacity>
          ))}
        </View>

        {selectedType === 'agency' ? renderBusinessForm('agency') : null}
        {selectedType === 'business' ? renderBusinessForm('business') : null}

        {selectedType === 'cooperative' ? (
          <View style={styles.section}>
            <ThemedText style={styles.sectionTitle}>
              {t('profile.create.sections.cooperativeInfo')}
            </ThemedText>
            <View style={styles.inputGroup}>
              <ThemedText style={styles.label}>{t('profile.edit.labels.legalName')}</ThemedText>
              <TextInput
                style={styles.input}
                value={formData.legalName}
                onChangeText={(text) => setFormData((prev) => ({ ...prev, legalName: text }))}
                placeholder={t('profile.create.placeholders.cooperativeLegalName')}
              />
            </View>
            <View style={styles.inputGroup}>
              <ThemedText style={styles.label}>{t('profile.edit.labels.description')}</ThemedText>
              <TextInput
                style={[styles.input, { height: 80 }]}
                value={formData.description}
                onChangeText={(text) => setFormData((prev) => ({ ...prev, description: text }))}
                placeholder={t('profile.create.placeholders.cooperativeDescription')}
                multiline
              />
            </View>
          </View>
        ) : null}

        {selectedType ? (
          <View style={styles.section}>
            <ThemedText style={styles.sectionTitle}>{t('profile.create.sections.whatsNext')}</ThemedText>
            <View style={[styles.settingItem, styles.firstSettingItem, styles.lastSettingItem]}>
              <View style={styles.settingInfo}>
                <Ionicons
                  name="information-circle"
                  size={20}
                  color={colors.muted}
                  style={styles.settingIcon}
                />
                <View style={styles.infoContent}>
                  <ThemedText style={styles.settingLabel}>
                    {t('profile.create.sections.profileSetup')}
                  </ThemedText>
                  <ThemedText style={styles.settingDescription}>
                    {t('profile.create.whatsNext.description', { type: selectedType })}
                  </ThemedText>
                </View>
              </View>
            </View>
          </View>
        ) : null}
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
    color: colors.primaryForeground,
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
    color: colors.primaryForeground,
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
    color: colors.primaryForeground,
  },
  infoContent: {
    flex: 1,
  },
});
