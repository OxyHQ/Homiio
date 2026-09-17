import React from 'react';
import { View } from 'react-native';
import { Chip } from '@oxy.so/bloom/chip';
import { Field } from '@oxy.so/bloom/field';
import { SettingsListDivider, SettingsListGroup } from '@oxy.so/bloom/settings-list';
import { ThemedText } from '@/components/ThemedText';
import { SHARED_SPACE_OPTIONS } from './constants';
import { WizardSwitchItem, WizardTextField } from './fields';
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
    <View style={styles.step}>
      <ThemedText type="subtitle">Coliving Features</ThemedText>

      <SettingsListGroup>
        <WizardSwitchItem
          title="Shared Spaces"
          value={colivingFeatures?.sharedSpaces}
          onValueChange={(value) => updateFormField('colivingFeatures', 'sharedSpaces', value)}
        />
        <SettingsListDivider />
        <WizardSwitchItem
          title="Community Events"
          value={colivingFeatures?.communityEvents}
          onValueChange={(value) => updateFormField('colivingFeatures', 'communityEvents', value)}
        />
      </SettingsListGroup>

      {colivingFeatures?.sharedSpaces && (
        <>
          <Field label="Which shared spaces?">
            <View style={styles.optionRow}>
              {SHARED_SPACE_OPTIONS.map((space) => {
                const selected = sharedSpacesList.includes(space);
                return (
                  <Chip
                    key={space}
                    size="large"
                    selected={selected}
                    variant={selected ? 'solid' : 'outlined'}
                    onPress={() => {
                      const updated = selected
                        ? sharedSpacesList.filter((value) => value !== space)
                        : [...sharedSpacesList, space];
                      updateFormField('colivingFeatures', 'sharedSpacesList', updated);
                    }}
                  >
                    {space}
                  </Chip>
                );
              })}
            </View>
          </Field>
          <WizardTextField
            label="Other shared spaces or features"
            value={colivingFeatures?.otherFeatures || ''}
            onChangeText={(text) => updateFormField('colivingFeatures', 'otherFeatures', text)}
            placeholder="e.g., Rooftop, Cinema Room, Pool, etc."
          />
        </>
      )}
    </View>
  );
}
