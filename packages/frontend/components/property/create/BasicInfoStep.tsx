import React from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Chip } from '@oxy.so/bloom/chip';
import { Field } from '@oxy.so/bloom/field';
import { ThemedText } from '@/components/ThemedText';
import { NumberSelector } from '@/components/NumberSelector';
import { PROPERTY_TYPES } from './constants';
import { WizardTextField, WizardTextarea } from './fields';
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
    <View style={styles.step}>
      <ThemedText type="subtitle">Basic Information</ThemedText>

      {/* Property title is auto-generated */}

      <Field label="Property Type" error={validationErrors.propertyType}>
        <View style={styles.optionRow}>
          {PROPERTY_TYPES.map((type) => (
            <Chip
              key={type.id}
              size="large"
              selected={basicInfo.propertyType === type.id}
              onPress={() => onPropertyTypeChange(type.id)}
            >
              {type.label}
            </Chip>
          ))}
        </View>
      </Field>

      {fieldsToShow.includes('bedrooms') && (
        <View style={styles.optionRow}>
          <Field label={t('property.bedrooms')} error={validationErrors.bedrooms}>
            <NumberSelector
              label={t('property.bedrooms')}
              value={basicInfo.bedrooms || 0}
              onChange={(value) => updateFormField('basicInfo', 'bedrooms', value)}
            />
          </Field>

          {fieldsToShow.includes('bathrooms') && (
            <Field label={t('property.bathrooms')} error={validationErrors.bathrooms}>
              <NumberSelector
                label={t('property.bathrooms')}
                value={basicInfo.bathrooms || 0}
                onChange={(value) => updateFormField('basicInfo', 'bathrooms', value)}
              />
            </Field>
          )}
        </View>
      )}

      {fieldsToShow.includes('squareFootage') && (
        <WizardTextField
          label="Square Footage"
          value={basicInfo.squareFootage?.toString() || ''}
          onChangeText={(text) =>
            updateFormField('basicInfo', 'squareFootage', parseInt(text, 10) || 0)
          }
          error={validationErrors.squareFootage}
          keyboardType="numeric"
          placeholder="0"
        />
      )}

      {fieldsToShow.includes('yearBuilt') && (
        <WizardTextField
          label="Year Built (optional)"
          value={basicInfo.yearBuilt?.toString() || ''}
          onChangeText={(text) =>
            updateFormField('basicInfo', 'yearBuilt', parseInt(text, 10) || undefined)
          }
          keyboardType="numeric"
          placeholder="2023"
        />
      )}

      {fieldsToShow.includes('description') && (
        <WizardTextarea
          label="Description"
          value={basicInfo.description}
          onChangeText={(text) => updateFormField('basicInfo', 'description', text)}
          placeholder="Describe your property..."
        />
      )}
    </View>
  );
}
