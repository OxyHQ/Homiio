import React, { useCallback } from 'react';
import { View, TouchableOpacity } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { ListingIntent } from '@homiio/shared-types';
import { colors } from '@/styles/colors';
import { ThemedText } from '@/components/ThemedText';
import { OFFERING_OPTIONS } from './constants';
import { createPropertyStyles as styles } from './styles';
import type { PropertyStepProps } from './types';

const CHIP_ICON_SIZE = 16;

/**
 * "Offering" wizard step — the multi-intent picker.
 *
 * Hosts pick how the listing is offered: Rent, For sale, and/or Exchange. The
 * selection is MULTI-select (a listing can be both rent and sale), so each chip
 * toggles independently. Rent is the default; deselecting the last intent falls
 * back to Rent so a listing always carries at least one intent (and the backend
 * defaults an empty list to `['rent']` regardless). Picking "For sale" reveals
 * the Sale Details step (the flow resolver inserts it); picking "Exchange"
 * alone is allowed — its dedicated settings step lands in a later phase.
 */
export function OfferingStep({ formData, setFormData }: PropertyStepProps) {
  const { t } = useTranslation();
  const { intents } = formData.offering;

  const toggleIntent = useCallback(
    (intent: ListingIntent) => {
      const isSelected = intents.includes(intent);
      const next = isSelected
        ? intents.filter((value) => value !== intent)
        : [...intents, intent];
      // Never leave the listing with no intent — fall back to rent-only.
      setFormData('offering', {
        intents: next.length > 0 ? next : [ListingIntent.RENT],
      });
    },
    [intents, setFormData],
  );

  return (
    <View>
      <ThemedText type="subtitle">
        {t('listing.offering.stepTitle', 'How are you offering this?')}
      </ThemedText>
      <ThemedText style={styles.addressInstructions}>
        {t(
          'listing.offering.stepHelp',
          'Choose one or more. You can rent and sell the same place.',
        )}
      </ThemedText>

      <View style={styles.propertyTypeContainer}>
        {OFFERING_OPTIONS.map((option) => {
          const selected = intents.includes(option.value);
          return (
            <TouchableOpacity
              key={option.value}
              style={[
                styles.propertyTypeButton,
                selected && styles.propertyTypeButtonSelected,
              ]}
              onPress={() => toggleIntent(option.value)}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: selected }}
              accessibilityLabel={t(option.i18nKey, option.fallback)}
            >
              <View style={styles.labelContainer}>
                <Ionicons
                  name={selected ? 'checkmark-circle' : 'ellipse-outline'}
                  size={CHIP_ICON_SIZE}
                  color={selected ? colors.white : colors.COLOR_BLACK_LIGHT_4}
                />
                <ThemedText
                  style={[
                    styles.propertyTypeText,
                    selected && styles.propertyTypeTextSelected,
                  ]}
                >
                  {t(option.i18nKey, option.fallback)}
                </ThemedText>
              </View>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );
}
