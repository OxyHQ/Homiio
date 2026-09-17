import React from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Field } from '@oxy.so/bloom/field';
import { SettingsListDivider, SettingsListGroup } from '@oxy.so/bloom/settings-list';
import { StepperRow } from '@oxy.so/bloom/stepper';
import { ThemedText } from '@/components/ThemedText';
import { AmenitiesSelector } from '@/components/AmenitiesSelector';
import { WizardSwitchItem } from './fields';
import { createPropertyStyles as styles } from './styles';
import type { AmenitiesStepProps } from './types';

/** Upper bound for the guest-limit counter (the old field's 2-digit range). */
const MAX_GUESTS = 99;

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
        <Field error={validationErrors.maxGuests}>
          {/* 0 draws "—" and stores `undefined`: an unset limit stays unset. */}
          <StepperRow
            title={t('propertyCreate.amenities.maxGuests')}
            value={rules.maxGuests ?? 0}
            onValueChange={(value) => updateFormField('rules', 'maxGuests', value || undefined)}
            min={0}
            max={MAX_GUESTS}
            formatValue={(value) => (value === 0 ? '—' : String(value))}
            decrementLabel={t('common.decreaseItem', {
              title: t('propertyCreate.amenities.maxGuests'),
            })}
            incrementLabel={t('common.increaseItem', {
              title: t('propertyCreate.amenities.maxGuests'),
            })}
            testID="create-max-guests"
          />
        </Field>
      )}
    </View>
  );
}
