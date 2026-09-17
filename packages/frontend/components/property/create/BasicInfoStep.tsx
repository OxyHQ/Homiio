import React from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Chip } from '@oxy.so/bloom/chip';
import { Field } from '@oxy.so/bloom/field';
import { StepperRow } from '@oxy.so/bloom/stepper';
import { ThemedText } from '@/components/ThemedText';
import { PROPERTY_TYPES } from './constants';
import { WizardTextField, WizardTextarea } from './fields';
import { createPropertyStyles as styles } from './styles';
import type { PropertyStepProps } from './types';

interface BasicInfoStepProps extends PropertyStepProps {
  onPropertyTypeChange: (typeId: string) => void;
}

/** Upper bound for the bedroom/bathroom counters (the old picker's 2-digit field). */
const MAX_ROOM_COUNT = 99;

/**
 * "Basic Info" wizard step: property type selector plus the conditionally
 * visible bedrooms/bathrooms (Bloom `StepperRow` counters — each shown on its
 * own, so a studio or room still gets its bathroom count), square footage,
 * year and description fields.
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
              variant={basicInfo.propertyType === type.id ? 'solid' : 'outlined'}
              onPress={() => onPropertyTypeChange(type.id)}
            >
              {type.label}
            </Chip>
          ))}
        </View>
      </Field>

      {fieldsToShow.includes('bedrooms') || fieldsToShow.includes('bathrooms') ? (
        <View>
          {fieldsToShow.includes('bedrooms') ? (
            <Field error={validationErrors.bedrooms}>
              <StepperRow
                title={t('property.bedrooms')}
                value={basicInfo.bedrooms || 0}
                onValueChange={(value) => updateFormField('basicInfo', 'bedrooms', value)}
                min={0}
                max={MAX_ROOM_COUNT}
                decrementLabel={t('common.decreaseItem', { title: t('property.bedrooms') })}
                incrementLabel={t('common.increaseItem', { title: t('property.bedrooms') })}
                divider={fieldsToShow.includes('bathrooms')}
                testID="create-bedrooms"
              />
            </Field>
          ) : null}
          {fieldsToShow.includes('bathrooms') ? (
            <Field error={validationErrors.bathrooms}>
              <StepperRow
                title={t('property.bathrooms')}
                value={basicInfo.bathrooms || 0}
                onValueChange={(value) => updateFormField('basicInfo', 'bathrooms', value)}
                min={0}
                max={MAX_ROOM_COUNT}
                decrementLabel={t('common.decreaseItem', { title: t('property.bathrooms') })}
                incrementLabel={t('common.increaseItem', { title: t('property.bathrooms') })}
                testID="create-bathrooms"
              />
            </Field>
          ) : null}
        </View>
      ) : null}

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
