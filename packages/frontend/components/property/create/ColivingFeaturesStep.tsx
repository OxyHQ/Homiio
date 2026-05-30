import React from 'react';
import { View, TextInput, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '@/styles/colors';
import { ThemedText } from '@/components/ThemedText';
import { SHARED_SPACE_OPTIONS } from './constants';
import { createPropertyStyles as styles } from './styles';
import type { PropertyStepProps } from './types';

/**
 * "Coliving Features" wizard step (coliving listings only): shared-spaces and
 * community-events toggles plus the selectable shared-space chips.
 */
export function ColivingFeaturesStep({ formData, updateFormField }: PropertyStepProps) {
  const { colivingFeatures } = formData;
  const sharedSpacesList = colivingFeatures?.sharedSpacesList || [];

  return (
    <View>
      <ThemedText type="subtitle">Coliving Features</ThemedText>

      <View style={styles.toggleContainer}>
        <ThemedText style={styles.label}>Shared Spaces</ThemedText>
        <TouchableOpacity
          style={[
            styles.toggleButton,
            colivingFeatures?.sharedSpaces ? styles.toggleButtonActive : null,
          ]}
          onPress={() =>
            updateFormField('colivingFeatures', 'sharedSpaces', !colivingFeatures?.sharedSpaces)
          }
        >
          <Ionicons
            name={colivingFeatures?.sharedSpaces ? 'checkmark-circle' : 'close-circle'}
            size={24}
            color={colivingFeatures?.sharedSpaces ? colors.primaryColor : colors.COLOR_BLACK_LIGHT_4}
          />
          <ThemedText style={styles.toggleText}>
            {colivingFeatures?.sharedSpaces ? 'Yes' : 'No'}
          </ThemedText>
        </TouchableOpacity>
      </View>

      {colivingFeatures?.sharedSpaces && (
        <View style={styles.formGroup}>
          <ThemedText style={styles.label}>Which shared spaces?</ThemedText>
          <View style={styles.optionRow}>
            {SHARED_SPACE_OPTIONS.map((space) => {
              const selected = sharedSpacesList.includes(space);
              return (
                <TouchableOpacity
                  key={space}
                  style={[styles.propertyTypeButton, selected && styles.propertyTypeButtonSelected]}
                  onPress={() => {
                    const updated = selected
                      ? sharedSpacesList.filter((value) => value !== space)
                      : [...sharedSpacesList, space];
                    updateFormField('colivingFeatures', 'sharedSpacesList', updated);
                  }}
                >
                  <ThemedText
                    style={[
                      styles.propertyTypeText,
                      selected && styles.propertyTypeTextSelected,
                    ]}
                  >
                    {space}
                  </ThemedText>
                </TouchableOpacity>
              );
            })}
          </View>
          <ThemedText style={[styles.label, styles.sharedSpacesLabel]}>
            Other shared spaces or features
          </ThemedText>
          <TextInput
            style={styles.input}
            value={colivingFeatures?.otherFeatures || ''}
            onChangeText={(text) => updateFormField('colivingFeatures', 'otherFeatures', text)}
            placeholder="e.g., Rooftop, Cinema Room, Pool, etc."
          />
        </View>
      )}

      <View style={styles.toggleContainer}>
        <ThemedText style={styles.label}>Community Events</ThemedText>
        <TouchableOpacity
          style={[
            styles.toggleButton,
            colivingFeatures?.communityEvents ? styles.toggleButtonActive : null,
          ]}
          onPress={() =>
            updateFormField(
              'colivingFeatures',
              'communityEvents',
              !colivingFeatures?.communityEvents,
            )
          }
        >
          <Ionicons
            name={colivingFeatures?.communityEvents ? 'checkmark-circle' : 'close-circle'}
            size={24}
            color={
              colivingFeatures?.communityEvents ? colors.primaryColor : colors.COLOR_BLACK_LIGHT_4
            }
          />
          <ThemedText style={styles.toggleText}>
            {colivingFeatures?.communityEvents ? 'Yes' : 'No'}
          </ThemedText>
        </TouchableOpacity>
      </View>
    </View>
  );
}
