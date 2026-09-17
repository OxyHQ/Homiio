import React from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Field } from '@oxy.so/bloom/field';
import { SwitchFilterRow, ToggleChipGroup } from '@oxy.so/bloom/stay-filters';
import { SHARED_SPACE_OPTIONS } from './constants';
import { WizardTextField } from './fields';
import { createPropertyStyles as styles } from './styles';
import type { PropertyStepProps } from './types';

const SHARED_SPACES = SHARED_SPACE_OPTIONS.map((space) => ({ value: space, label: space }));

/**
 * "Coliving Features" wizard step (coliving listings only): shared-spaces and
 * community-events switches plus the shared spaces as a Bloom `ToggleChipGroup`.
 */
export function ColivingFeaturesStep({ formData, updateFormField }: PropertyStepProps) {
  const { t } = useTranslation();
  const { colivingFeatures } = formData;
  const sharedSpacesList = colivingFeatures?.sharedSpacesList || [];

  // Keep the order the host picked in: apply only the one space that changed.
  const handleSharedSpaces = (next: string[]) => {
    const added = next.find((space) => !sharedSpacesList.includes(space));
    updateFormField(
      'colivingFeatures',
      'sharedSpacesList',
      added
        ? [...sharedSpacesList, added]
        : sharedSpacesList.filter((space) => next.includes(space)),
    );
  };

  return (
    <View style={styles.step}>
      <View style={styles.switches}>
        <SwitchFilterRow
          title={t('propertyCreate.coliving.sharedSpaces')}
          value={Boolean(colivingFeatures?.sharedSpaces)}
          onValueChange={(value) => updateFormField('colivingFeatures', 'sharedSpaces', value)}
        />
        <SwitchFilterRow
          title={t('propertyCreate.coliving.communityEvents')}
          value={Boolean(colivingFeatures?.communityEvents)}
          onValueChange={(value) => updateFormField('colivingFeatures', 'communityEvents', value)}
        />
      </View>

      {colivingFeatures?.sharedSpaces && (
        <>
          <Field label={t('propertyCreate.coliving.whichSharedSpaces')}>
            <ToggleChipGroup
              options={SHARED_SPACES}
              value={sharedSpacesList}
              onValueChange={handleSharedSpaces}
              accessibilityLabel={t('propertyCreate.coliving.whichSharedSpaces')}
              testID="create-coliving-spaces"
            />
          </Field>
          <WizardTextField
            label={t('propertyCreate.coliving.otherFeatures')}
            value={colivingFeatures?.otherFeatures || ''}
            onChangeText={(text) => updateFormField('colivingFeatures', 'otherFeatures', text)}
            placeholder={t('propertyCreate.coliving.otherFeaturesPlaceholder')}
          />
        </>
      )}
    </View>
  );
}
