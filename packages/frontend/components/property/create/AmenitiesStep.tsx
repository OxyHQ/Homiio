import React from 'react';
import { View, TextInput, TouchableOpacity } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '@/styles/colors';
import { ThemedText } from '@/components/ThemedText';
import { AmenitiesSelector } from '@/components/AmenitiesSelector';
import { createPropertyStyles as styles } from './styles';
import type { AmenitiesStepProps } from './types';

interface RuleToggleProps {
  label: string;
  yesLabel: string;
  noLabel: string;
  value: boolean | undefined;
  onToggle: () => void;
}

function RuleToggle({ label, yesLabel, noLabel, value, onToggle }: RuleToggleProps) {
  return (
    <View style={styles.toggleContainer}>
      <ThemedText style={styles.label}>{label}</ThemedText>
      <TouchableOpacity
        style={[styles.toggleButton, value ? styles.toggleButtonActive : null]}
        onPress={onToggle}
      >
        <Ionicons
          name={value ? 'checkmark-circle' : 'close-circle'}
          size={24}
          color={value ? colors.primaryColor : colors.COLOR_BLACK_LIGHT_4}
        />
        <ThemedText style={styles.toggleText}>{value ? yesLabel : noLabel}</ThemedText>
      </TouchableOpacity>
    </View>
  );
}

export function AmenitiesStep({
  formData,
  validationErrors,
  updateFormField,
  onAmenityToggle,
}: AmenitiesStepProps) {
  const { t } = useTranslation();
  const { amenities, rules, basicInfo } = formData;

  return (
    <View>
      <ThemedText type="subtitle">{t('propertyCreate.amenities.rulesTitle')}</ThemedText>

      <AmenitiesSelector
        selectedAmenities={amenities.selectedAmenities || []}
        onAmenityToggle={onAmenityToggle}
        propertyType={basicInfo.propertyType}
        style={styles.amenitiesSelector}
      />

      <View>
        <ThemedText type="subtitle" style={styles.rulesSectionTitle}>
          {t('propertyCreate.amenities.houseRules')}
        </ThemedText>

        <RuleToggle
          label={t('propertyCreate.amenities.petsAllowed')}
          yesLabel={t('propertyCreate.amenities.yes')}
          noLabel={t('propertyCreate.amenities.no')}
          value={rules?.petsAllowed}
          onToggle={() => updateFormField('rules', 'petsAllowed', !rules?.petsAllowed)}
        />

        <RuleToggle
          label={t('propertyCreate.amenities.smokingAllowed')}
          yesLabel={t('propertyCreate.amenities.yes')}
          noLabel={t('propertyCreate.amenities.no')}
          value={rules?.smokingAllowed}
          onToggle={() => updateFormField('rules', 'smokingAllowed', !rules?.smokingAllowed)}
        />

        <RuleToggle
          label={t('propertyCreate.amenities.partiesAllowed')}
          yesLabel={t('propertyCreate.amenities.yes')}
          noLabel={t('propertyCreate.amenities.no')}
          value={rules?.partiesAllowed}
          onToggle={() => updateFormField('rules', 'partiesAllowed', !rules?.partiesAllowed)}
        />

        <RuleToggle
          label={t('propertyCreate.amenities.guestsAllowed')}
          yesLabel={t('propertyCreate.amenities.yes')}
          noLabel={t('propertyCreate.amenities.no')}
          value={rules?.guestsAllowed}
          onToggle={() => updateFormField('rules', 'guestsAllowed', !rules?.guestsAllowed)}
        />

        {rules?.guestsAllowed && (
          <View style={styles.formGroup}>
            <ThemedText style={styles.label}>{t('propertyCreate.amenities.maxGuests')}</ThemedText>
            <TextInput
              style={[styles.input, validationErrors.maxGuests && styles.inputError]}
              value={rules.maxGuests?.toString() || ''}
              onChangeText={(text) =>
                updateFormField('rules', 'maxGuests', parseInt(text, 10) || undefined)
              }
              placeholder={t('propertyCreate.amenities.maxGuestsPlaceholder')}
              keyboardType="numeric"
            />
            {validationErrors.maxGuests && (
              <ThemedText style={styles.errorText}>{validationErrors.maxGuests}</ThemedText>
            )}
          </View>
        )}
      </View>
    </View>
  );
}
