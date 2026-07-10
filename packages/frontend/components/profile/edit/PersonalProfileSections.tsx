import React from 'react';
import { View, Text, TextInput, TouchableOpacity } from 'react-native';
import { useTranslation } from 'react-i18next';
import { TrustScore } from '@/components/TrustScore';
import { profileEditStyles as styles } from './styles';
import type {
  PersonalInfoForm,
  PreferencesForm,
  ReasonForLeavingValue,
  ReferenceForm,
  ReferenceRelationshipValue,
  RentalHistoryForm,
  SettingsForm,
} from './types';

const EMPLOYMENT_STATUSES = [
  'employed',
  'self_employed',
  'student',
  'retired',
  'unemployed',
  'other',
] as const;

const LEASE_DURATIONS = ['monthly', '3_months', '6_months', 'yearly', 'flexible'] as const;

const PRICE_UNITS = ['day', 'night', 'week', 'month', 'year'] as const;

const PROPERTY_TYPES = ['apartment', 'house', 'room', 'studio'] as const;

const AMENITIES = [
  'parking',
  'gym',
  'pool',
  'washer',
  'dishwasher',
  'balcony',
  'elevator',
  'ac',
  'heating',
  'internet',
] as const;

const REFERENCE_RELATIONSHIPS = ['landlord', 'employer', 'personal', 'other'] as const;

const REASONS_FOR_LEAVING = [
  'lease_ended',
  'bought_home',
  'job_relocation',
  'family_reasons',
  'upgrade',
  'other',
] as const;

interface PersonalProfileSectionsProps {
  activeSection: string;
  personalInfo: PersonalInfoForm;
  preferences: PreferencesForm;
  settings: SettingsForm;
  references: ReferenceForm[];
  rentalHistory: RentalHistoryForm[];
  trustScoreData: { score: number; factors: { type: string; value: number; maxValue: number; label: string }[] };
  updatePersonalInfo: (updates: Partial<PersonalInfoForm>) => void;
  updatePreferences: (updates: Partial<PreferencesForm>) => void;
  updateSettings: (updates: Partial<SettingsForm>) => void;
  toggleAmenity: (amenity: string) => void;
  togglePropertyType: (type: string) => void;
  addReference: () => void;
  updateReference: (index: number, updates: Partial<ReferenceForm>) => void;
  removeReference: (index: number) => void;
  addRentalHistory: () => void;
  updateRentalHistory: (index: number, updates: Partial<RentalHistoryForm>) => void;
  removeRentalHistory: (index: number) => void;
}

export function PersonalProfileSections({
  activeSection,
  personalInfo,
  preferences,
  settings,
  references,
  rentalHistory,
  trustScoreData,
  updatePersonalInfo,
  updatePreferences,
  updateSettings,
  toggleAmenity,
  togglePropertyType,
  addReference,
  updateReference,
  removeReference,
  addRentalHistory,
  updateRentalHistory,
  removeRentalHistory,
}: PersonalProfileSectionsProps) {
  const { t } = useTranslation();

  switch (activeSection) {
    case 'personal':
      return (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('profile.edit.sections.personalInformation')}</Text>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>{t('profile.edit.labels.bio')}</Text>
            <TextInput
              style={[styles.input, styles.textArea]}
              value={personalInfo.bio}
              onChangeText={(text) => updatePersonalInfo({ bio: text })}
              placeholder={t('profile.edit.placeholders.bio')}
              multiline
              numberOfLines={4}
            />
          </View>

          <View style={styles.row}>
            <View style={[styles.inputGroup, styles.halfWidth]}>
              <Text style={styles.label}>{t('profile.edit.labels.occupation')}</Text>
              <TextInput
                style={styles.input}
                value={personalInfo.occupation}
                onChangeText={(text) => updatePersonalInfo({ occupation: text })}
                placeholder={t('profile.edit.placeholders.occupation')}
              />
            </View>
            <View style={[styles.inputGroup, styles.halfWidth]}>
              <Text style={styles.label}>{t('profile.edit.labels.employer')}</Text>
              <TextInput
                style={styles.input}
                value={personalInfo.employer}
                onChangeText={(text) => updatePersonalInfo({ employer: text })}
                placeholder={t('profile.edit.placeholders.employer')}
              />
            </View>
          </View>

          <View style={styles.row}>
            <View style={[styles.inputGroup, styles.halfWidth]}>
              <Text style={styles.label}>{t('profile.edit.labels.annualIncome')}</Text>
              <TextInput
                style={styles.input}
                value={personalInfo.annualIncome}
                onChangeText={(text) => updatePersonalInfo({ annualIncome: text })}
                placeholder={t('profile.edit.placeholders.annualIncome')}
                keyboardType="numeric"
              />
            </View>
            <View style={[styles.inputGroup, styles.halfWidth]}>
              <Text style={styles.label}>{t('profile.edit.labels.employmentStatus')}</Text>
              <View style={styles.pickerContainer}>
                {EMPLOYMENT_STATUSES.map((status) => (
                  <TouchableOpacity
                    key={status}
                    style={[
                      styles.pickerOption,
                      personalInfo.employmentStatus === status && styles.pickerOptionSelected,
                    ]}
                    onPress={() => updatePersonalInfo({ employmentStatus: status })}
                  >
                    <Text
                      style={[
                        styles.pickerOptionText,
                        personalInfo.employmentStatus === status &&
                          styles.pickerOptionTextSelected,
                      ]}
                    >
                      {t(`profile.edit.options.employmentStatus.${status}`)}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          </View>

          <View style={styles.row}>
            <View style={[styles.inputGroup, styles.halfWidth]}>
              <Text style={styles.label}>{t('profile.edit.labels.moveInDate')}</Text>
              <TextInput
                style={styles.input}
                value={personalInfo.moveInDate}
                onChangeText={(text) => updatePersonalInfo({ moveInDate: text })}
                placeholder={t('profile.edit.placeholders.moveInDate')}
              />
            </View>
            <View style={[styles.inputGroup, styles.halfWidth]}>
              <Text style={styles.label}>{t('profile.edit.labels.leaseDuration')}</Text>
              <View style={styles.pickerContainer}>
                {LEASE_DURATIONS.map((duration) => (
                  <TouchableOpacity
                    key={duration}
                    style={[
                      styles.pickerOption,
                      personalInfo.leaseDuration === duration && styles.pickerOptionSelected,
                    ]}
                    onPress={() => updatePersonalInfo({ leaseDuration: duration })}
                  >
                    <Text
                      style={[
                        styles.pickerOptionText,
                        personalInfo.leaseDuration === duration &&
                          styles.pickerOptionTextSelected,
                      ]}
                    >
                      {t(`profile.edit.options.leaseDuration.${duration}`)}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          </View>
        </View>
      );

    case 'preferences':
      return (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('profile.edit.sections.propertyPreferences')}</Text>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>{t('profile.edit.labels.maxRent')}</Text>
            <TextInput
              style={styles.input}
              value={preferences.maxRent}
              onChangeText={(text) => updatePreferences({ maxRent: text })}
              placeholder={t('profile.edit.placeholders.maxRent')}
              keyboardType="numeric"
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>{t('profile.edit.labels.rentPeriod')}</Text>
            <View style={styles.pickerContainer}>
              {PRICE_UNITS.map((unit) => (
                <TouchableOpacity
                  key={unit}
                  style={[
                    styles.pickerOption,
                    preferences.priceUnit === unit && styles.pickerOptionSelected,
                  ]}
                  onPress={() => updatePreferences({ priceUnit: unit })}
                >
                  <Text
                    style={[
                      styles.pickerOptionText,
                      preferences.priceUnit === unit && styles.pickerOptionTextSelected,
                    ]}
                  >
                    {t(`profile.edit.options.priceUnit.${unit}`)}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          <View style={styles.row}>
            <View style={[styles.inputGroup, styles.halfWidth]}>
              <Text style={styles.label}>{t('profile.edit.labels.minBedrooms')}</Text>
              <TextInput
                style={styles.input}
                value={preferences.minBedrooms}
                onChangeText={(text) => updatePreferences({ minBedrooms: text })}
                placeholder="0"
                keyboardType="numeric"
              />
            </View>
            <View style={[styles.inputGroup, styles.halfWidth]}>
              <Text style={styles.label}>{t('profile.edit.labels.minBathrooms')}</Text>
              <TextInput
                style={styles.input}
                value={preferences.minBathrooms}
                onChangeText={(text) => updatePreferences({ minBathrooms: text })}
                placeholder="0"
                keyboardType="numeric"
              />
            </View>
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>{t('profile.edit.labels.propertyTypes')}</Text>
            <View style={styles.checkboxGroup}>
              {PROPERTY_TYPES.map((type) => (
                <TouchableOpacity
                  key={type}
                  style={[
                    styles.checkbox,
                    preferences.propertyTypes.includes(type) && styles.checkboxSelected,
                  ]}
                  onPress={() => togglePropertyType(type)}
                >
                  <Text
                    style={[
                      styles.checkboxText,
                      preferences.propertyTypes.includes(type) && styles.checkboxTextSelected,
                    ]}
                  >
                    {t(`profile.edit.options.propertyType.${type}`)}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>{t('profile.edit.labels.preferredAmenities')}</Text>
            <View style={styles.checkboxGroup}>
              {AMENITIES.map((amenity) => (
                <TouchableOpacity
                  key={amenity}
                  style={[
                    styles.checkbox,
                    preferences.preferredAmenities.includes(amenity) && styles.checkboxSelected,
                  ]}
                  onPress={() => toggleAmenity(amenity)}
                >
                  <Text
                    style={[
                      styles.checkboxText,
                      preferences.preferredAmenities.includes(amenity) &&
                        styles.checkboxTextSelected,
                    ]}
                  >
                    {t(`profile.edit.options.amenity.${amenity}`)}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>{t('profile.edit.labels.additionalPreferences')}</Text>
            <View style={styles.switchGroup}>
              <TouchableOpacity
                style={[styles.switch, preferences.petFriendly && styles.switchActive]}
                onPress={() => updatePreferences({ petFriendly: !preferences.petFriendly })}
              >
                <Text
                  style={[styles.switchText, preferences.petFriendly && styles.switchTextActive]}
                >
                  {t('profile.edit.toggles.petFriendly')}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.switch, preferences.smokingAllowed && styles.switchActive]}
                onPress={() => updatePreferences({ smokingAllowed: !preferences.smokingAllowed })}
              >
                <Text
                  style={[styles.switchText, preferences.smokingAllowed && styles.switchTextActive]}
                >
                  {t('profile.edit.toggles.smokingAllowed')}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.switch, preferences.furnished && styles.switchActive]}
                onPress={() => updatePreferences({ furnished: !preferences.furnished })}
              >
                <Text style={[styles.switchText, preferences.furnished && styles.switchTextActive]}>
                  {t('profile.edit.toggles.furnished')}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.switch, preferences.parkingRequired && styles.switchActive]}
                onPress={() => updatePreferences({ parkingRequired: !preferences.parkingRequired })}
              >
                <Text
                  style={[
                    styles.switchText,
                    preferences.parkingRequired && styles.switchTextActive,
                  ]}
                >
                  {t('profile.edit.toggles.parkingRequired')}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.switch, preferences.accessibility && styles.switchActive]}
                onPress={() => updatePreferences({ accessibility: !preferences.accessibility })}
              >
                <Text
                  style={[styles.switchText, preferences.accessibility && styles.switchTextActive]}
                >
                  {t('profile.edit.toggles.accessibilityFeatures')}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      );

    case 'references':
      return (
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>{t('profile.edit.sections.references')}</Text>
            <TouchableOpacity style={styles.addButton} onPress={addReference}>
              <Text style={styles.addButtonText}>{t('profile.edit.actions.addReference')}</Text>
            </TouchableOpacity>
          </View>

          {references.map((reference, index) => (
            <View key={index} style={styles.referenceCard}>
              <View style={styles.cardHeader}>
                <Text style={styles.cardTitle}>
                  {t('profile.edit.actions.referenceLabel', { index: index + 1 })}
                </Text>
                <TouchableOpacity onPress={() => removeReference(index)}>
                  <Text style={styles.removeButton}>{t('profile.edit.actions.remove')}</Text>
                </TouchableOpacity>
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.label}>{t('profile.edit.labels.name')}</Text>
                <TextInput
                  style={styles.input}
                  value={reference.name}
                  onChangeText={(text) => updateReference(index, { name: text })}
                  placeholder={t('profile.edit.placeholders.fullName')}
                />
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.label}>{t('profile.edit.labels.relationship')}</Text>
                <View style={styles.pickerContainer}>
                  {REFERENCE_RELATIONSHIPS.map((rel) => (
                    <TouchableOpacity
                      key={rel}
                      style={[
                        styles.pickerOption,
                        reference.relationship === rel && styles.pickerOptionSelected,
                      ]}
                      onPress={() =>
                        updateReference(index, {
                          relationship: rel as ReferenceRelationshipValue,
                        })
                      }
                    >
                      <Text
                        style={[
                          styles.pickerOptionText,
                          reference.relationship === rel && styles.pickerOptionTextSelected,
                        ]}
                      >
                        {t(`profile.edit.options.referenceRelationship.${rel}`)}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              <View style={styles.row}>
                <View style={[styles.inputGroup, styles.halfWidth]}>
                  <Text style={styles.label}>{t('profile.edit.labels.phone')}</Text>
                  <TextInput
                    style={styles.input}
                    value={reference.phone}
                    onChangeText={(text) => updateReference(index, { phone: text })}
                    placeholder={t('profile.edit.placeholders.phoneNumber')}
                    keyboardType="phone-pad"
                  />
                </View>
                <View style={[styles.inputGroup, styles.halfWidth]}>
                  <Text style={styles.label}>{t('profile.edit.labels.email')}</Text>
                  <TextInput
                    style={styles.input}
                    value={reference.email}
                    onChangeText={(text) => updateReference(index, { email: text })}
                    placeholder={t('profile.edit.placeholders.emailAddress')}
                    keyboardType="email-address"
                  />
                </View>
              </View>
            </View>
          ))}
        </View>
      );

    case 'rental-history':
      return (
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>{t('profile.edit.sections.rentalHistory')}</Text>
            <TouchableOpacity style={styles.addButton} onPress={addRentalHistory}>
              <Text style={styles.addButtonText}>{t('profile.edit.actions.addHistory')}</Text>
            </TouchableOpacity>
          </View>

          {rentalHistory.map((history, index) => (
            <View key={index} style={styles.referenceCard}>
              <View style={styles.cardHeader}>
                <Text style={styles.cardTitle}>
                  {t('profile.edit.actions.rentalLabel', { index: index + 1 })}
                </Text>
                <TouchableOpacity onPress={() => removeRentalHistory(index)}>
                  <Text style={styles.removeButton}>{t('profile.edit.actions.remove')}</Text>
                </TouchableOpacity>
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.label}>{t('profile.edit.labels.address')}</Text>
                <TextInput
                  style={styles.input}
                  value={history.address}
                  onChangeText={(text) => updateRentalHistory(index, { address: text })}
                  placeholder={t('profile.edit.placeholders.fullAddress')}
                />
              </View>

              <View style={styles.row}>
                <View style={[styles.inputGroup, styles.halfWidth]}>
                  <Text style={styles.label}>{t('profile.edit.labels.startDate')}</Text>
                  <TextInput
                    style={styles.input}
                    value={history.startDate}
                    onChangeText={(text) => updateRentalHistory(index, { startDate: text })}
                    placeholder={t('profile.edit.placeholders.moveInDate')}
                  />
                </View>
                <View style={[styles.inputGroup, styles.halfWidth]}>
                  <Text style={styles.label}>{t('profile.edit.labels.endDate')}</Text>
                  <TextInput
                    style={styles.input}
                    value={history.endDate}
                    onChangeText={(text) => updateRentalHistory(index, { endDate: text })}
                    placeholder={t('profile.edit.placeholders.endDateOptional')}
                  />
                </View>
              </View>

              <View style={styles.row}>
                <View style={[styles.inputGroup, styles.halfWidth]}>
                  <Text style={styles.label}>{t('profile.edit.labels.monthlyRent')}</Text>
                  <TextInput
                    style={styles.input}
                    value={history.monthlyRent}
                    onChangeText={(text) => updateRentalHistory(index, { monthlyRent: text })}
                    placeholder={t('profile.edit.placeholders.monthlyRent')}
                    keyboardType="numeric"
                  />
                </View>
                <View style={[styles.inputGroup, styles.halfWidth]}>
                  <Text style={styles.label}>{t('profile.edit.labels.reasonForLeaving')}</Text>
                  <View style={styles.pickerContainer}>
                    {REASONS_FOR_LEAVING.map((reason) => (
                      <TouchableOpacity
                        key={reason}
                        style={[
                          styles.pickerOption,
                          history.reasonForLeaving === reason && styles.pickerOptionSelected,
                        ]}
                        onPress={() =>
                          updateRentalHistory(index, {
                            reasonForLeaving: reason as ReasonForLeavingValue,
                          })
                        }
                      >
                        <Text
                          style={[
                            styles.pickerOptionText,
                            history.reasonForLeaving === reason &&
                              styles.pickerOptionTextSelected,
                          ]}
                        >
                          {t(`profile.edit.options.reasonForLeaving.${reason}`)}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </View>
              </View>

              <View style={styles.inputGroup}>
                <Text style={styles.label}>{t('profile.edit.labels.landlordContact')}</Text>
                <View style={styles.row}>
                  <View style={[styles.inputGroup, styles.halfWidth]}>
                    <TextInput
                      style={styles.input}
                      value={history.landlordContact.name}
                      onChangeText={(text) =>
                        updateRentalHistory(index, {
                          landlordContact: { ...history.landlordContact, name: text },
                        })
                      }
                      placeholder={t('profile.edit.placeholders.landlordName')}
                    />
                  </View>
                  <View style={[styles.inputGroup, styles.halfWidth]}>
                    <TextInput
                      style={styles.input}
                      value={history.landlordContact.phone}
                      onChangeText={(text) =>
                        updateRentalHistory(index, {
                          landlordContact: { ...history.landlordContact, phone: text },
                        })
                      }
                      placeholder={t('profile.edit.placeholders.phone')}
                      keyboardType="phone-pad"
                    />
                  </View>
                </View>
                <TextInput
                  style={styles.input}
                  value={history.landlordContact.email}
                  onChangeText={(text) =>
                    updateRentalHistory(index, {
                      landlordContact: { ...history.landlordContact, email: text },
                    })
                  }
                  placeholder={t('profile.edit.placeholders.email')}
                  keyboardType="email-address"
                />
              </View>
            </View>
          ))}
        </View>
      );

    case 'trust-score':
      return (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('profile.edit.sections.trustScore')}</Text>
          <TrustScore
            score={trustScoreData.score}
            size="large"
            showDetails={true}
            factors={trustScoreData.factors}
          />
        </View>
      );

    case 'settings':
      return (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>{t('profile.edit.sections.settings')}</Text>

          <View style={styles.subsection}>
            <Text style={styles.subsectionTitle}>{t('profile.edit.labels.notifications')}</Text>
            <View style={styles.switchGroup}>
              <TouchableOpacity
                style={[styles.switch, settings.notifications.email && styles.switchActive]}
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
                    styles.switchText,
                    settings.notifications.email && styles.switchTextActive,
                  ]}
                >
                  {t('profile.edit.toggles.emailNotifications')}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.switch, settings.notifications.push && styles.switchActive]}
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
                    styles.switchText,
                    settings.notifications.push && styles.switchTextActive,
                  ]}
                >
                  {t('profile.edit.toggles.pushNotifications')}
                </Text>
              </TouchableOpacity>
            </View>
          </View>

          <View style={styles.subsection}>
            <Text style={styles.subsectionTitle}>{t('profile.edit.labels.privacy')}</Text>
            <View style={styles.switchGroup}>
              <TouchableOpacity
                style={[styles.switch, settings.privacy.showContactInfo && styles.switchActive]}
                onPress={() =>
                  updateSettings({
                    privacy: {
                      ...settings.privacy,
                      showContactInfo: !settings.privacy.showContactInfo,
                    },
                  })
                }
              >
                <Text
                  style={[
                    styles.switchText,
                    settings.privacy.showContactInfo && styles.switchTextActive,
                  ]}
                >
                  {t('profile.edit.toggles.showContactInfo')}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.switch, settings.privacy.showIncome && styles.switchActive]}
                onPress={() =>
                  updateSettings({
                    privacy: { ...settings.privacy, showIncome: !settings.privacy.showIncome },
                  })
                }
              >
                <Text
                  style={[
                    styles.switchText,
                    settings.privacy.showIncome && styles.switchTextActive,
                  ]}
                >
                  {t('profile.edit.toggles.showIncome')}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.switch, settings.privacy.showRentalHistory && styles.switchActive]}
                onPress={() =>
                  updateSettings({
                    privacy: {
                      ...settings.privacy,
                      showRentalHistory: !settings.privacy.showRentalHistory,
                    },
                  })
                }
              >
                <Text
                  style={[
                    styles.switchText,
                    settings.privacy.showRentalHistory && styles.switchTextActive,
                  ]}
                >
                  {t('profile.edit.toggles.showRentalHistory')}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.switch, settings.privacy.showReferences && styles.switchActive]}
                onPress={() =>
                  updateSettings({
                    privacy: {
                      ...settings.privacy,
                      showReferences: !settings.privacy.showReferences,
                    },
                  })
                }
              >
                <Text
                  style={[
                    styles.switchText,
                    settings.privacy.showReferences && styles.switchTextActive,
                  ]}
                >
                  {t('profile.edit.toggles.showReferences')}
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
