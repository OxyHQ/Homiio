import React, { useCallback } from 'react';
import { StyleSheet, View, TouchableOpacity } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { OfferingType } from '@homiio/shared-types';
import { colors } from '@/styles/colors';
import { ThemedText } from '@/components/ThemedText';
import { PRICING_OFFERING_OPTIONS, CURRENCY_OPTIONS } from './constants';
import { createPropertyStyles as styles } from './styles';
import type { PropertyStepProps } from './types';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

const ROW_ICON_SIZE = 20;
const CHECK_ICON_SIZE = 22;

/**
 * "Offering" wizard step — the 4-way offering selector.
 *
 * Hosts pick how the listing is offered: Rent monthly, Rent by night, Sell,
 * and/or Exchange. The selection is MULTI-select (a place can be rented monthly
 * AND by the night AND for sale), so each row toggles independently. A listing
 * must keep at least one offering — deselecting the last one falls back to
 * long-term rent. Each selected offering reveals its own pricing/details step
 * (the flow resolver inserts them). The shared currency selector applies to the
 * rent offerings (sale carries its own currency on the Sale Details step).
 */
export function OfferingSelector({ formData, setFormData }: PropertyStepProps) {
  const { t } = useTranslation();
  const { offerings, currency } = formData.pricing;

  const toggleOffering = useCallback(
    (offering: OfferingType) => {
      const isSelected = offerings.includes(offering);
      const next = isSelected
        ? offerings.filter((value) => value !== offering)
        : [...offerings, offering];
      // Never leave the listing with no offering — fall back to long-term rent.
      setFormData('pricing', {
        offerings: next.length > 0 ? next : [OfferingType.LONG_TERM_RENT],
      });
    },
    [offerings, setFormData],
  );

  return (
    <View>
      <ThemedText type="subtitle">
        {t('listing.offering.stepTitle')}
      </ThemedText>
      <ThemedText style={styles.addressInstructions}>
        {t('listing.offering.stepHelp')}
      </ThemedText>

      <View style={offeringSelectorStyles.list}>
        {PRICING_OFFERING_OPTIONS.map((option) => {
          const selected = offerings.includes(option.value);
          return (
            <TouchableOpacity
              key={option.value}
              style={[
                offeringSelectorStyles.row,
                selected && offeringSelectorStyles.rowSelected,
              ]}
              onPress={() => toggleOffering(option.value)}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: selected }}
              accessibilityLabel={t(option.i18nKey)}
            >
              <View style={offeringSelectorStyles.rowIcon}>
                <Ionicons
                  name={option.icon as IoniconName}
                  size={ROW_ICON_SIZE}
                  color={selected ? colors.primaryColor : colors.COLOR_BLACK_LIGHT_3}
                />
              </View>
              <View style={offeringSelectorStyles.rowText}>
                <ThemedText
                  style={[
                    offeringSelectorStyles.rowTitle,
                    selected && offeringSelectorStyles.rowTitleSelected,
                  ]}
                >
                  {t(option.i18nKey)}
                </ThemedText>
                <ThemedText style={offeringSelectorStyles.rowDescription}>
                  {t(option.descriptionKey)}
                </ThemedText>
              </View>
              <Ionicons
                name={selected ? 'checkmark-circle' : 'ellipse-outline'}
                size={CHECK_ICON_SIZE}
                color={selected ? colors.primaryColor : colors.COLOR_BLACK_LIGHT_5}
              />
            </TouchableOpacity>
          );
        })}
      </View>

      <View style={styles.formGroup}>
        <ThemedText style={styles.label}>
          {t('listing.offering.currency')}
        </ThemedText>
        <View style={styles.optionRow}>
          {CURRENCY_OPTIONS.map((option) => (
            <TouchableOpacity
              key={option.value}
              style={[
                styles.propertyTypeButton,
                currency === option.value && styles.propertyTypeButtonSelected,
              ]}
              onPress={() => setFormData('pricing', { currency: option.value })}
            >
              <ThemedText
                style={[
                  styles.propertyTypeText,
                  currency === option.value && styles.propertyTypeTextSelected,
                ]}
              >
                {option.label}
              </ThemedText>
            </TouchableOpacity>
          ))}
        </View>
      </View>
    </View>
  );
}

const offeringSelectorStyles = StyleSheet.create({
  list: {
    gap: 12,
    marginBottom: 16,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.COLOR_BLACK_LIGHT_6,
    backgroundColor: colors.COLOR_BLACK_LIGHT_9,
  },
  rowSelected: {
    borderColor: colors.primaryColor,
    backgroundColor: colors.primaryLight,
  },
  rowIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.white,
  },
  rowText: {
    flex: 1,
    gap: 2,
  },
  rowTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.COLOR_BLACK_LIGHT_2,
  },
  rowTitleSelected: {
    color: colors.primaryDark,
  },
  rowDescription: {
    fontSize: 13,
    color: colors.COLOR_BLACK_LIGHT_4,
  },
});
