/**
 * The five sections of the personal profile edit form, one per tab.
 *
 * Every control is a Bloom family: `TextFieldInput` / `Textarea` inside
 * `Field`, `Select` for single choices, `Checkbox` for multi-choice lists,
 * `DatePicker` for dates, `PhoneInput` for phone numbers, `Card` for each
 * reference / rental entry and `SettingsListGroup` + `Switch` for the boolean
 * settings. The value adapters live in `./fields`.
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Button } from '@oxy.so/bloom/button';
import { Card } from '@oxy.so/bloom/card';
import { Checkbox } from '@oxy.so/bloom/checkbox';
import { Field } from '@oxy.so/bloom/field';
import { RiAddLine, RiDeleteBinLine } from '@oxy.so/bloom/icons';
import { SettingsListGroup, SettingsListItem } from '@oxy.so/bloom/settings-list';
import { Switch } from '@oxy.so/bloom/switch';
import { TextFieldInput } from '@oxy.so/bloom/text-field';
import { Textarea } from '@oxy.so/bloom/textarea';
import { H3 } from '@oxy.so/bloom/typography';

import { spacing } from '@/constants/styles';
import { DateField, OptionSelect, PhoneField } from './fields';
import type {
  PersonalInfoForm,
  PreferencesForm,
  ReferenceForm,
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

type PreferenceToggle = 'petFriendly' | 'smokingAllowed' | 'furnished' | 'parkingRequired' | 'accessibility';

const PREFERENCE_TOGGLES: readonly { key: PreferenceToggle; label: string }[] = [
  { key: 'petFriendly', label: 'profile.edit.toggles.petFriendly' },
  { key: 'smokingAllowed', label: 'profile.edit.toggles.smokingAllowed' },
  { key: 'furnished', label: 'profile.edit.toggles.furnished' },
  { key: 'parkingRequired', label: 'profile.edit.toggles.parkingRequired' },
  { key: 'accessibility', label: 'profile.edit.toggles.accessibilityFeatures' },
];

type PrivacyToggle = 'showContactInfo' | 'showIncome' | 'showRentalHistory' | 'showReferences';

const PRIVACY_TOGGLES: readonly { key: PrivacyToggle; label: string }[] = [
  { key: 'showContactInfo', label: 'profile.edit.toggles.showContactInfo' },
  { key: 'showIncome', label: 'profile.edit.toggles.showIncome' },
  { key: 'showRentalHistory', label: 'profile.edit.toggles.showRentalHistory' },
  { key: 'showReferences', label: 'profile.edit.toggles.showReferences' },
];

interface PersonalProfileSectionsProps {
  activeSection: string;
  personalInfo: PersonalInfoForm;
  preferences: PreferencesForm;
  settings: SettingsForm;
  references: ReferenceForm[];
  rentalHistory: RentalHistoryForm[];
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

/** Two controls side by side on a wide screen, stacked when they cannot fit. */
const Row: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <View style={styles.row}>
    {React.Children.map(children, (child) =>
      child ? <View style={styles.rowItem}>{child}</View> : null,
    )}
  </View>
);

const SectionHeader: React.FC<{ title: string; action?: React.ReactNode }> = ({ title, action }) => (
  <View style={styles.sectionHeader}>
    <H3 style={styles.sectionTitle}>{title}</H3>
    {action}
  </View>
);

export function PersonalProfileSections({
  activeSection,
  personalInfo,
  preferences,
  settings,
  references,
  rentalHistory,
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
          <SectionHeader title={t('profile.edit.sections.personalInformation')} />

          <Textarea
            label={t('profile.edit.labels.bio')}
            value={personalInfo.bio}
            onChangeText={(text) => updatePersonalInfo({ bio: text })}
            placeholder={t('profile.edit.placeholders.bio')}
            rows={4}
            autoResize
          />

          <Row>
            <Field label={t('profile.edit.labels.occupation')}>
              <TextFieldInput
                label={t('profile.edit.labels.occupation')}
                value={personalInfo.occupation}
                onChangeText={(text) => updatePersonalInfo({ occupation: text })}
                placeholder={t('profile.edit.placeholders.occupation')}
              />
            </Field>
            <Field label={t('profile.edit.labels.employer')}>
              <TextFieldInput
                label={t('profile.edit.labels.employer')}
                value={personalInfo.employer}
                onChangeText={(text) => updatePersonalInfo({ employer: text })}
                placeholder={t('profile.edit.placeholders.employer')}
              />
            </Field>
          </Row>

          <Row>
            <Field label={t('profile.edit.labels.annualIncome')}>
              <TextFieldInput
                label={t('profile.edit.labels.annualIncome')}
                value={personalInfo.annualIncome}
                onChangeText={(text) => updatePersonalInfo({ annualIncome: text })}
                placeholder={t('profile.edit.placeholders.annualIncome')}
                keyboardType="numeric"
              />
            </Field>
            <OptionSelect
              label={t('profile.edit.labels.employmentStatus')}
              value={personalInfo.employmentStatus}
              options={EMPLOYMENT_STATUSES}
              labelPrefix="profile.edit.options.employmentStatus"
              onChange={(employmentStatus) => updatePersonalInfo({ employmentStatus })}
            />
          </Row>

          <Row>
            <DateField
              label={t('profile.edit.labels.moveInDate')}
              value={personalInfo.moveInDate}
              onChange={(moveInDate) => updatePersonalInfo({ moveInDate })}
            />
            <OptionSelect
              label={t('profile.edit.labels.leaseDuration')}
              value={personalInfo.leaseDuration}
              options={LEASE_DURATIONS}
              labelPrefix="profile.edit.options.leaseDuration"
              onChange={(leaseDuration) => updatePersonalInfo({ leaseDuration })}
            />
          </Row>
        </View>
      );

    case 'preferences':
      return (
        <View style={styles.section}>
          <SectionHeader title={t('profile.edit.sections.propertyPreferences')} />

          <Row>
            <Field label={t('profile.edit.labels.maxRent')}>
              <TextFieldInput
                label={t('profile.edit.labels.maxRent')}
                value={preferences.maxRent}
                onChangeText={(text) => updatePreferences({ maxRent: text })}
                placeholder={t('profile.edit.placeholders.maxRent')}
                keyboardType="numeric"
              />
            </Field>
            <OptionSelect
              label={t('profile.edit.labels.rentPeriod')}
              value={preferences.priceUnit}
              options={PRICE_UNITS}
              labelPrefix="profile.edit.options.priceUnit"
              onChange={(priceUnit) => updatePreferences({ priceUnit })}
            />
          </Row>

          <Row>
            <Field label={t('profile.edit.labels.minBedrooms')}>
              <TextFieldInput
                label={t('profile.edit.labels.minBedrooms')}
                value={preferences.minBedrooms}
                onChangeText={(text) => updatePreferences({ minBedrooms: text })}
                placeholder="0"
                keyboardType="numeric"
              />
            </Field>
            <Field label={t('profile.edit.labels.minBathrooms')}>
              <TextFieldInput
                label={t('profile.edit.labels.minBathrooms')}
                value={preferences.minBathrooms}
                onChangeText={(text) => updatePreferences({ minBathrooms: text })}
                placeholder="0"
                keyboardType="numeric"
              />
            </Field>
          </Row>

          <Field label={t('profile.edit.labels.propertyTypes')}>
            <View style={styles.checkboxGrid}>
              {PROPERTY_TYPES.map((type) => (
                <Checkbox
                  key={type}
                  style={styles.checkboxCell}
                  label={t(`profile.edit.options.propertyType.${type}`)}
                  checked={preferences.propertyTypes.includes(type)}
                  onCheckedChange={() => togglePropertyType(type)}
                />
              ))}
            </View>
          </Field>

          <Field label={t('profile.edit.labels.preferredAmenities')}>
            <View style={styles.checkboxGrid}>
              {AMENITIES.map((amenity) => (
                <Checkbox
                  key={amenity}
                  style={styles.checkboxCell}
                  label={t(`profile.edit.options.amenity.${amenity}`)}
                  checked={preferences.preferredAmenities.includes(amenity)}
                  onCheckedChange={() => toggleAmenity(amenity)}
                />
              ))}
            </View>
          </Field>

          <Field label={t('profile.edit.labels.additionalPreferences')}>
            <View style={styles.checkboxGrid}>
              {PREFERENCE_TOGGLES.map(({ key, label }) => (
                <Checkbox
                  key={key}
                  style={styles.checkboxCell}
                  label={t(label)}
                  checked={preferences[key]}
                  onCheckedChange={(checked) => updatePreferences({ [key]: checked })}
                />
              ))}
            </View>
          </Field>
        </View>
      );

    case 'references':
      return (
        <View style={styles.section}>
          <SectionHeader
            title={t('profile.edit.sections.references')}
            action={
              <Button variant="secondary" size="small" leadingIcon={RiAddLine} onPress={addReference}>
                {t('profile.edit.actions.addReference')}
              </Button>
            }
          />

          {references.map((reference, index) => {
            const cardTitle = t('profile.edit.actions.referenceLabel', { index: index + 1 });
            return (
              <Card key={index} variant="outlined" radius="radius-16" style={styles.entryCard}>
                <SectionHeader
                  title={cardTitle}
                  action={
                    <Button
                      variant="ghost"
                      size="small"
                      leadingIcon={RiDeleteBinLine}
                      accessibilityLabel={`${t('profile.edit.actions.remove')} ${cardTitle}`}
                      onPress={() => removeReference(index)}
                    >
                      {t('profile.edit.actions.remove')}
                    </Button>
                  }
                />

                <Row>
                  <Field label={t('profile.edit.labels.name')}>
                    <TextFieldInput
                      label={t('profile.edit.labels.name')}
                      value={reference.name}
                      onChangeText={(text) => updateReference(index, { name: text })}
                      placeholder={t('profile.edit.placeholders.fullName')}
                    />
                  </Field>
                  <OptionSelect
                    label={t('profile.edit.labels.relationship')}
                    value={reference.relationship}
                    options={REFERENCE_RELATIONSHIPS}
                    labelPrefix="profile.edit.options.referenceRelationship"
                    onChange={(relationship) => updateReference(index, { relationship })}
                  />
                </Row>

                <Row>
                  <PhoneField
                    label={t('profile.edit.labels.phone')}
                    value={reference.phone}
                    onChange={(phone) => updateReference(index, { phone })}
                    placeholder={t('profile.edit.placeholders.phoneNumber')}
                  />
                  <Field label={t('profile.edit.labels.email')}>
                    <TextFieldInput
                      label={t('profile.edit.labels.email')}
                      value={reference.email}
                      onChangeText={(text) => updateReference(index, { email: text })}
                      placeholder={t('profile.edit.placeholders.emailAddress')}
                      keyboardType="email-address"
                      autoCapitalize="none"
                    />
                  </Field>
                </Row>
              </Card>
            );
          })}
        </View>
      );

    case 'rental-history':
      return (
        <View style={styles.section}>
          <SectionHeader
            title={t('profile.edit.sections.rentalHistory')}
            action={
              <Button variant="secondary" size="small" leadingIcon={RiAddLine} onPress={addRentalHistory}>
                {t('profile.edit.actions.addHistory')}
              </Button>
            }
          />

          {rentalHistory.map((history, index) => {
            const cardTitle = t('profile.edit.actions.rentalLabel', { index: index + 1 });
            const updateLandlord = (updates: Partial<RentalHistoryForm['landlordContact']>) =>
              updateRentalHistory(index, {
                landlordContact: { ...history.landlordContact, ...updates },
              });
            return (
              <Card key={index} variant="outlined" radius="radius-16" style={styles.entryCard}>
                <SectionHeader
                  title={cardTitle}
                  action={
                    <Button
                      variant="ghost"
                      size="small"
                      leadingIcon={RiDeleteBinLine}
                      accessibilityLabel={`${t('profile.edit.actions.remove')} ${cardTitle}`}
                      onPress={() => removeRentalHistory(index)}
                    >
                      {t('profile.edit.actions.remove')}
                    </Button>
                  }
                />

                <Field label={t('profile.edit.labels.address')}>
                  <TextFieldInput
                    label={t('profile.edit.labels.address')}
                    value={history.address}
                    onChangeText={(text) => updateRentalHistory(index, { address: text })}
                    placeholder={t('profile.edit.placeholders.fullAddress')}
                  />
                </Field>

                <Row>
                  <DateField
                    label={t('profile.edit.labels.startDate')}
                    value={history.startDate}
                    onChange={(startDate) => updateRentalHistory(index, { startDate })}
                  />
                  <DateField
                    label={t('profile.edit.labels.endDate')}
                    value={history.endDate}
                    onChange={(endDate) => updateRentalHistory(index, { endDate })}
                  />
                </Row>

                <Row>
                  <Field label={t('profile.edit.labels.monthlyRent')}>
                    <TextFieldInput
                      label={t('profile.edit.labels.monthlyRent')}
                      value={history.monthlyRent}
                      onChangeText={(text) => updateRentalHistory(index, { monthlyRent: text })}
                      placeholder={t('profile.edit.placeholders.monthlyRent')}
                      keyboardType="numeric"
                    />
                  </Field>
                  <OptionSelect
                    label={t('profile.edit.labels.reasonForLeaving')}
                    value={history.reasonForLeaving}
                    options={REASONS_FOR_LEAVING}
                    labelPrefix="profile.edit.options.reasonForLeaving"
                    onChange={(reasonForLeaving) => updateRentalHistory(index, { reasonForLeaving })}
                  />
                </Row>

                <Field label={t('profile.edit.labels.landlordContact')}>
                  <View style={styles.stack}>
                    <Row>
                      <TextFieldInput
                        label={t('profile.edit.placeholders.landlordName')}
                        value={history.landlordContact.name}
                        onChangeText={(name) => updateLandlord({ name })}
                      />
                      <TextFieldInput
                        label={t('profile.edit.placeholders.email')}
                        value={history.landlordContact.email}
                        onChangeText={(email) => updateLandlord({ email })}
                        keyboardType="email-address"
                        autoCapitalize="none"
                      />
                    </Row>
                    <PhoneField
                      label={t('profile.edit.placeholders.phone')}
                      value={history.landlordContact.phone}
                      onChange={(phone) => updateLandlord({ phone })}
                    />
                  </View>
                </Field>
              </Card>
            );
          })}
        </View>
      );

    case 'settings':
      return (
        <View style={styles.section}>
          <SectionHeader title={t('profile.edit.sections.settings')} />

          <SettingsListGroup title={t('profile.edit.labels.notifications')}>
            <SettingsListItem
              title={t('profile.edit.toggles.emailNotifications')}
              rightElement={
                <Switch
                  accessibilityLabel={t('profile.edit.toggles.emailNotifications')}
                  value={settings.notifications.email}
                  onValueChange={(email) =>
                    updateSettings({ notifications: { ...settings.notifications, email } })
                  }
                />
              }
            />
            <SettingsListItem
              title={t('profile.edit.toggles.pushNotifications')}
              rightElement={
                <Switch
                  accessibilityLabel={t('profile.edit.toggles.pushNotifications')}
                  value={settings.notifications.push}
                  onValueChange={(push) =>
                    updateSettings({ notifications: { ...settings.notifications, push } })
                  }
                />
              }
            />
          </SettingsListGroup>

          <SettingsListGroup title={t('profile.edit.labels.privacy')}>
            {PRIVACY_TOGGLES.map(({ key, label }) => (
              <SettingsListItem
                key={key}
                title={t(label)}
                rightElement={
                  <Switch
                    accessibilityLabel={t(label)}
                    value={settings.privacy[key]}
                    onValueChange={(value) =>
                      updateSettings({ privacy: { ...settings.privacy, [key]: value } })
                    }
                  />
                }
              />
            ))}
          </SettingsListGroup>
        </View>
      );

    default:
      return null;
  }
}

const styles = StyleSheet.create({
  section: {
    padding: spacing.lg,
    gap: spacing.xl,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  sectionTitle: {
    flexShrink: 1,
  },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.lg,
  },
  rowItem: {
    flexGrow: 1,
    flexBasis: 240,
    minWidth: 0,
  },
  stack: {
    gap: spacing.md,
  },
  checkboxGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    rowGap: spacing.md,
    columnGap: spacing.lg,
  },
  checkboxCell: {
    flexBasis: 160,
    flexGrow: 1,
  },
  entryCard: {
    padding: spacing.lg,
    gap: spacing.lg,
  },
});
