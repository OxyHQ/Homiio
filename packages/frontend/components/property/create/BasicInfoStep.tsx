import React from 'react';
import { View, TextInput, TouchableOpacity } from 'react-native';
import { useTranslation } from 'react-i18next';
import { ThemedText } from '@/components/ThemedText';
import { NumberSelector } from '@/components/NumberSelector';
import { PROPERTY_TYPES } from './constants';
import { createPropertyStyles as styles } from './styles';
import type { PropertyStepProps } from './types';

interface BasicInfoStepProps extends PropertyStepProps {
  onPropertyTypeChange: (typeId: string) => void;
}

/**
 * "Basic Info" wizard step: property type selector plus the conditionally
 * visible bedrooms/bathrooms/square footage/year/description fields.
 */
export function BasicInfoStep({
  formData,
  validationErrors,
  fieldsToShow,
  updateFormField,
  onPropertyTypeChange,
}: BasicInfoStepProps) {
  const { t } = useTranslation();
  const { basicInfo } = formData;

  return (
    <View>
      <ThemedText type="subtitle">Basic Information</ThemedText>

      {/* Property title is auto-generated */}

      <View style={styles.formGroup}>
        <ThemedText style={styles.label}>Property Type</ThemedText>
        <View style={styles.propertyTypeContainer}>
          {PROPERTY_TYPES.map((type) => (
            <TouchableOpacity
              key={type.id}
              style={[
                styles.propertyTypeButton,
                basicInfo.propertyType === type.id && styles.propertyTypeButtonSelected,
              ]}
              onPress={() => onPropertyTypeChange(type.id)}
            >
              <ThemedText
                style={[
                  styles.propertyTypeText,
                  basicInfo.propertyType === type.id && styles.propertyTypeTextSelected,
                ]}
              >
                {type.label}
              </ThemedText>
            </TouchableOpacity>
          ))}
        </View>
        {validationErrors.propertyType && (
          <ThemedText style={styles.errorText}>{validationErrors.propertyType}</ThemedText>
        )}
      </View>

      {fieldsToShow.includes('bedrooms') && (
        <View style={styles.formRow}>
          <View style={[styles.formGroup, styles.formGroupLeft]}>
            <ThemedText style={styles.label}>{t('property.bedrooms')}</ThemedText>
            <NumberSelector
              value={basicInfo.bedrooms || 0}
              onChange={(value) => updateFormField('basicInfo', 'bedrooms', value)}
            />
            {validationErrors.bedrooms && (
              <ThemedText style={styles.errorText}>{validationErrors.bedrooms}</ThemedText>
            )}
          </View>

          {fieldsToShow.includes('bathrooms') && (
            <View style={[styles.formGroup, styles.formGroupRight]}>
              <ThemedText style={styles.label}>{t('property.bathrooms')}</ThemedText>
              <NumberSelector
                value={basicInfo.bathrooms || 0}
                onChange={(value) => updateFormField('basicInfo', 'bathrooms', value)}
              />
              {validationErrors.bathrooms && (
                <ThemedText style={styles.errorText}>{validationErrors.bathrooms}</ThemedText>
              )}
            </View>
          )}
        </View>
      )}

      <View style={styles.formRow}>
        {fieldsToShow.includes('squareFootage') && (
          <View style={[styles.formGroup, styles.formGroupLeft]}>
            <ThemedText style={styles.label}>Square Footage</ThemedText>
            <TextInput
              style={[styles.input, validationErrors.squareFootage && styles.inputError]}
              value={basicInfo.squareFootage?.toString() || ''}
              onChangeText={(text) =>
                updateFormField('basicInfo', 'squareFootage', parseInt(text, 10) || 0)
              }
              keyboardType="numeric"
              placeholder="0"
            />
            {validationErrors.squareFootage && (
              <ThemedText style={styles.errorText}>{validationErrors.squareFootage}</ThemedText>
            )}
          </View>
        )}
      </View>

      {fieldsToShow.includes('yearBuilt') && (
        <View style={styles.formGroup}>
          <ThemedText style={styles.label}>Year Built (optional)</ThemedText>
          <TextInput
            style={styles.input}
            value={basicInfo.yearBuilt?.toString() || ''}
            onChangeText={(text) =>
              updateFormField('basicInfo', 'yearBuilt', parseInt(text, 10) || undefined)
            }
            keyboardType="numeric"
            placeholder="2023"
          />
        </View>
      )}

      {fieldsToShow.includes('description') && (
        <View style={styles.formGroup}>
          <ThemedText style={styles.label}>Description</ThemedText>
          <TextInput
            style={styles.textArea}
            value={basicInfo.description}
            onChangeText={(text) => updateFormField('basicInfo', 'description', text)}
            placeholder="Describe your property..."
            multiline
            numberOfLines={5}
            textAlignVertical="top"
          />
        </View>
      )}
    </View>
  );
}
