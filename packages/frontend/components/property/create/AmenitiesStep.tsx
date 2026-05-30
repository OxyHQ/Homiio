import React from 'react';
import { View, TextInput, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '@/styles/colors';
import { ThemedText } from '@/components/ThemedText';
import { AmenitiesSelector } from '@/components/AmenitiesSelector';
import { createPropertyStyles as styles } from './styles';
import type { AmenitiesStepProps } from './types';

interface RuleToggleProps {
  label: string;
  value: boolean | undefined;
  onToggle: () => void;
}

/**
 * A single yes/no house-rule toggle. Markup matches the previous inline toggles
 * exactly (icon, colour, and label behaviour).
 */
function RuleToggle({ label, value, onToggle }: RuleToggleProps) {
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
        <ThemedText style={styles.toggleText}>{value ? 'Yes' : 'No'}</ThemedText>
      </TouchableOpacity>
    </View>
  );
}

/**
 * "Amenities" wizard step: amenities selector plus the combined house-rules
 * toggles and the conditional max-guests field.
 */
export function AmenitiesStep({
  formData,
  validationErrors,
  updateFormField,
  onAmenityToggle,
}: AmenitiesStepProps) {
  const { amenities, rules, basicInfo } = formData;

  return (
    <View>
      <ThemedText type="subtitle">Amenities & Rules</ThemedText>

      <AmenitiesSelector
        selectedAmenities={amenities.selectedAmenities || []}
        onAmenityToggle={onAmenityToggle}
        propertyType={basicInfo.propertyType}
        style={styles.amenitiesSelector}
      />

      <View>
        <ThemedText type="subtitle" style={styles.rulesSectionTitle}>
          House Rules
        </ThemedText>

        <RuleToggle
          label="Pets Allowed"
          value={rules?.petsAllowed}
          onToggle={() => updateFormField('rules', 'petsAllowed', !rules?.petsAllowed)}
        />

        <RuleToggle
          label="Smoking Allowed"
          value={rules?.smokingAllowed}
          onToggle={() => updateFormField('rules', 'smokingAllowed', !rules?.smokingAllowed)}
        />

        <RuleToggle
          label="Parties Allowed"
          value={rules?.partiesAllowed}
          onToggle={() => updateFormField('rules', 'partiesAllowed', !rules?.partiesAllowed)}
        />

        <RuleToggle
          label="Guests Allowed"
          value={rules?.guestsAllowed}
          onToggle={() => updateFormField('rules', 'guestsAllowed', !rules?.guestsAllowed)}
        />

        {rules?.guestsAllowed && (
          <View style={styles.formGroup}>
            <ThemedText style={styles.label}>Maximum Number of Guests</ThemedText>
            <TextInput
              style={[styles.input, validationErrors.maxGuests && styles.inputError]}
              value={rules.maxGuests?.toString() || ''}
              onChangeText={(text) =>
                updateFormField('rules', 'maxGuests', parseInt(text, 10) || undefined)
              }
              placeholder="e.g., 2"
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
