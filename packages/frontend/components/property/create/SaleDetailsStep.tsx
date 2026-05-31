import React, { useCallback } from 'react';
import { View, TextInput, TouchableOpacity } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import type { PropertySale } from '@homiio/shared-types';
import { colors } from '@/styles/colors';
import { ThemedText } from '@/components/ThemedText';
import { CHAIN_STATUS_OPTIONS, CURRENCY_OPTIONS } from './constants';
import { createPropertyStyles as styles } from './styles';
import type { PropertyStepProps } from './types';
import { parseLocaleNumber } from '@/utils/number';

type ChainStatus = NonNullable<PropertySale['chainStatus']>;

/**
 * "Sale Details" wizard step — only reachable when the listing is for sale.
 *
 * Captures the asking price (required, validated > 0), the sale currency (reuses
 * the shared CURRENCY_OPTIONS), the onward-chain status, and a "price reduced"
 * flag. The price-per-m² is derived server-side from price + square footage, so
 * it is not entered here. These map to the property `sale` block on submit.
 */
export function SaleDetailsStep({
  formData,
  validationErrors,
  updateFormField,
}: PropertyStepProps) {
  const { t } = useTranslation();
  const { offering } = formData;

  const handlePriceChange = useCallback(
    (text: string) => {
      // es/it/ca numeric keyboards emit a comma decimal; normalise before parse
      // (shared with the mortgage calculator) so "1234,5" isn't truncated to 1234.
      const parsed = parseLocaleNumber(text);
      updateFormField('offering', 'salePrice', Number.isNaN(parsed) ? undefined : parsed);
    },
    [updateFormField],
  );

  const handleChainStatus = useCallback(
    (value: ChainStatus) => {
      // Toggle off when re-tapping the active option.
      updateFormField(
        'offering',
        'chainStatus',
        offering.chainStatus === value ? undefined : value,
      );
    },
    [offering.chainStatus, updateFormField],
  );

  return (
    <View>
      <ThemedText type="subtitle">
        {t('listing.sale.stepTitle', 'Sale details')}
      </ThemedText>

      <View style={styles.formRow}>
        <View style={[styles.formGroup, styles.formGroupLeft]}>
          <ThemedText style={styles.label}>
            {t('listing.sale.askingPrice', 'Asking price')}
          </ThemedText>
          <TextInput
            style={[styles.input, validationErrors.salePrice && styles.inputError]}
            value={offering.salePrice?.toString() ?? ''}
            onChangeText={handlePriceChange}
            keyboardType="numeric"
            placeholder="0"
          />
          {validationErrors.salePrice ? (
            <ThemedText style={styles.errorText}>{validationErrors.salePrice}</ThemedText>
          ) : null}
        </View>

        <View style={[styles.formGroup, styles.formGroupRight]}>
          <ThemedText style={styles.label}>{t('listing.sale.currency', 'Currency')}</ThemedText>
          <View style={styles.optionRow}>
            {CURRENCY_OPTIONS.map((option) => (
              <TouchableOpacity
                key={option.value}
                style={[
                  styles.propertyTypeButton,
                  offering.saleCurrency === option.value && styles.propertyTypeButtonSelected,
                ]}
                onPress={() => updateFormField('offering', 'saleCurrency', option.value)}
              >
                <ThemedText
                  style={[
                    styles.propertyTypeText,
                    offering.saleCurrency === option.value && styles.propertyTypeTextSelected,
                  ]}
                >
                  {option.label}
                </ThemedText>
              </TouchableOpacity>
            ))}
          </View>
        </View>
      </View>

      <View style={styles.formGroup}>
        <ThemedText style={styles.label}>
          {t('listing.sale.chainStatus.label', 'Chain status')}
        </ThemedText>
        <View style={styles.optionRow}>
          {CHAIN_STATUS_OPTIONS.map((option) => (
            <TouchableOpacity
              key={option.value}
              style={[
                styles.propertyTypeButton,
                offering.chainStatus === option.value && styles.propertyTypeButtonSelected,
              ]}
              onPress={() => handleChainStatus(option.value)}
            >
              <ThemedText
                style={[
                  styles.propertyTypeText,
                  offering.chainStatus === option.value && styles.propertyTypeTextSelected,
                ]}
              >
                {t(option.i18nKey, option.fallback)}
              </ThemedText>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      <View style={styles.toggleContainer}>
        <ThemedText style={styles.label}>
          {t('listing.sale.priceReduced', 'Price reduced')}
        </ThemedText>
        <TouchableOpacity
          style={[
            styles.toggleButton,
            offering.isPriceReduced ? styles.toggleButtonActive : null,
          ]}
          onPress={() =>
            updateFormField('offering', 'isPriceReduced', !offering.isPriceReduced)
          }
          accessibilityRole="switch"
          accessibilityState={{ checked: Boolean(offering.isPriceReduced) }}
        >
          <Ionicons
            name={offering.isPriceReduced ? 'checkmark-circle' : 'close-circle'}
            size={24}
            color={offering.isPriceReduced ? colors.primaryColor : colors.COLOR_BLACK_LIGHT_4}
          />
          <ThemedText style={styles.toggleText}>
            {offering.isPriceReduced
              ? t('common.yes', 'Yes')
              : t('common.no', 'No')}
          </ThemedText>
        </TouchableOpacity>
      </View>
    </View>
  );
}
