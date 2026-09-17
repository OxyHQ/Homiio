import React, { useMemo } from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Field } from '@oxy.so/bloom/field';
import {
  DEFAULT_PROPERTY_TYPES,
  PropertyTypeSelector,
} from '@oxy.so/bloom/listing-editor';
import { StepperRow } from '@oxy.so/bloom/stepper';
import { PROPERTY_TYPE_IDS } from './constants';
import { WizardTextField, WizardTextarea } from './fields';
import { createPropertyStyles as styles } from './styles';
import type { PropertyStepProps } from './types';

type PublishablePropertyType = (typeof PROPERTY_TYPE_IDS)[number];

interface BasicInfoStepProps extends PropertyStepProps {
  onPropertyTypeChange: (typeId: string) => void;
}

/** Upper bound for the bedroom/bathroom counters (the old picker's 2-digit field). */
const MAX_ROOM_COUNT = 99;

const isPublishableType = (value: string): value is PublishablePropertyType =>
  (PROPERTY_TYPE_IDS as readonly string[]).includes(value);

/**
 * The three steps about the home itself, each drawing only its own
 * `fieldsToShow`: "Property Type" (Bloom's `PropertyTypeSelector` tiles),
 * "Basic Info" (bedrooms/bathrooms as Bloom `StepperRow` counters — each shown
 * on its own, so a studio or room still gets its bathroom count — floor area
 * and year) and "Description".
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

  // Bloom's tiles (and icons) for the types Homiio publishes — the same order
  // as PROPERTY_TYPE_IDS — with Homiio's localized labels.
  const typeOptions = useMemo(
    () =>
      DEFAULT_PROPERTY_TYPES.flatMap((option) =>
        isPublishableType(option.value)
          ? [{ value: option.value, label: t(`properties.titles.types.${option.value}`), icon: option.icon }]
          : [],
      ),
    [t],
  );

  return (
    <View style={styles.step}>
      {fieldsToShow.includes('propertyType') ? (
        <PropertyTypeSelector<PublishablePropertyType>
          value={isPublishableType(basicInfo.propertyType) ? basicInfo.propertyType : null}
          onValueChange={onPropertyTypeChange}
          options={typeOptions}
          accessibilityLabel={t('propertyCreate.basicInfo.propertyType')}
          error={
            validationErrors.propertyType
              ? t('propertyCreate.basicInfo.propertyTypeRequired')
              : undefined
          }
          testID="create-property-type"
        />
      ) : null}

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
          label={t('propertyCreate.basicInfo.area')}
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
          label={t('propertyCreate.basicInfo.yearBuilt')}
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
          label={t('propertyCreate.basicInfo.description')}
          value={basicInfo.description}
          onChangeText={(text) => updateFormField('basicInfo', 'description', text)}
          placeholder={t('propertyCreate.basicInfo.descriptionPlaceholder')}
        />
      )}
    </View>
  );
}
