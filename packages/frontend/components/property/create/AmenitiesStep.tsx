import React from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { SettingsListDivider, SettingsListGroup } from '@oxy.so/bloom/settings-list';
import { ThemedText } from '@/components/ThemedText';
import { AmenitiesSelector } from '@/components/AmenitiesSelector';
import { WizardSwitchItem, WizardTextField } from './fields';
import { createPropertyStyles as styles } from './styles';
import type { AmenitiesStepProps } from './types';

export function AmenitiesStep({
  formData,
  validationErrors,
  updateFormField,
  onAmenityToggle,
}: AmenitiesStepProps) {
  const { t } = useTranslation();
  const { amenities, rules, basicInfo } = formData;

  return (
    <View style={styles.step}>
      <ThemedText type="subtitle">{t('propertyCreate.amenities.rulesTitle')}</ThemedText>

      <AmenitiesSelector
        selectedAmenities={amenities.selectedAmenities || []}
        onAmenityToggle={onAmenityToggle}
        propertyType={basicInfo.propertyType}
      />

      <ThemedText type="subtitle">{t('propertyCreate.amenities.houseRules')}</ThemedText>

      <SettingsListGroup>
        <WizardSwitchItem
          title={t('propertyCreate.amenities.petsAllowed')}
          value={rules?.petsAllowed}
          onValueChange={(value) => updateFormField('rules', 'petsAllowed', value)}
        />
        <SettingsListDivider />
        <WizardSwitchItem
          title={t('propertyCreate.amenities.smokingAllowed')}
          value={rules?.smokingAllowed}
          onValueChange={(value) => updateFormField('rules', 'smokingAllowed', value)}
        />
        <SettingsListDivider />
        <WizardSwitchItem
          title={t('propertyCreate.amenities.partiesAllowed')}
          value={rules?.partiesAllowed}
          onValueChange={(value) => updateFormField('rules', 'partiesAllowed', value)}
        />
        <SettingsListDivider />
        <WizardSwitchItem
          title={t('propertyCreate.amenities.guestsAllowed')}
          value={rules?.guestsAllowed}
          onValueChange={(value) => updateFormField('rules', 'guestsAllowed', value)}
        />
      </SettingsListGroup>

      {rules?.guestsAllowed && (
        <WizardTextField
          label={t('propertyCreate.amenities.maxGuests')}
          value={rules.maxGuests?.toString() || ''}
          onChangeText={(text) =>
            updateFormField('rules', 'maxGuests', parseInt(text, 10) || undefined)
          }
          placeholder={t('propertyCreate.amenities.maxGuestsPlaceholder')}
          keyboardType="numeric"
          error={validationErrors.maxGuests}
        />
      )}
    </View>
  );
}
