import React, { useCallback } from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { PropertySale } from '@homiio/shared-types';
import { Chip } from '@oxy.so/bloom/chip';
import { Field } from '@oxy.so/bloom/field';
import { SettingsListGroup } from '@oxy.so/bloom/settings-list';
import { ThemedText } from '@/components/ThemedText';
import { CHAIN_STATUS_OPTIONS, CURRENCY_OPTIONS } from './constants';
import { WizardSwitchItem, WizardTextField } from './fields';
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
    <View style={styles.step}>
      <ThemedText type="subtitle">
        {t('listing.sale.stepTitle')}
      </ThemedText>

      <WizardTextField
        label={t('listing.sale.askingPrice')}
        value={offering.salePrice?.toString() ?? ''}
        onChangeText={handlePriceChange}
        keyboardType="numeric"
        placeholder="0"
        error={validationErrors.salePrice}
      />

      <Field label={t('listing.sale.currency')}>
        <View style={styles.optionRow}>
          {CURRENCY_OPTIONS.map((option) => (
            <Chip
              key={option.value}
              size="large"
              selected={offering.saleCurrency === option.value}
              onPress={() => updateFormField('offering', 'saleCurrency', option.value)}
            >
              {option.label}
            </Chip>
          ))}
        </View>
      </Field>

      <Field label={t('listing.sale.chainStatus.label')}>
        <View style={styles.optionRow}>
          {CHAIN_STATUS_OPTIONS.map((option) => (
            <Chip
              key={option.value}
              size="large"
              selected={offering.chainStatus === option.value}
              onPress={() => handleChainStatus(option.value)}
            >
              {t(option.i18nKey)}
            </Chip>
          ))}
        </View>
      </Field>

      <SettingsListGroup>
        <WizardSwitchItem
          title={t('listing.sale.priceReduced')}
          value={offering.isPriceReduced}
          onValueChange={(value) => updateFormField('offering', 'isPriceReduced', value)}
        />
      </SettingsListGroup>
    </View>
  );
}
