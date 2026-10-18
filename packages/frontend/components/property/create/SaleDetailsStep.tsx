import React, { useCallback } from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { PropertySale } from '@homiio/shared-types';
import { Field } from '@oxy.so/bloom/field';
import {
  SegmentedControl,
  SegmentedControlItem,
  SegmentedControlItemText,
} from '@oxy.so/bloom/segmented-control';
import { SwitchFilterRow } from '@oxy.so/bloom/stay-filters';
import { CHAIN_STATUS_OPTIONS, CURRENCY_OPTIONS } from './constants';
import { WizardTextField } from './fields';
import { createPropertyStyles as styles } from './styles';
import type { PropertyStepProps } from './types';
import { parseLocaleNumber } from '@/utils/number';

type ChainStatus = NonNullable<PropertySale['chainStatus']>;

const isChainStatus = (value: string): value is ChainStatus =>
  CHAIN_STATUS_OPTIONS.some((option) => option.value === value);

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

  return (
    <View style={styles.step}>
      <WizardTextField
        label={t('listing.sale.askingPrice')}
        value={offering.salePrice?.toString() ?? ''}
        onChangeText={handlePriceChange}
        keyboardType="numeric"
        placeholder="0"
        error={validationErrors.salePrice}
      />

      <Field label={t('listing.sale.currency')}>
        {/* Unset until picked: the sale then uses the listing's currency. */}
        <SegmentedControl<string>
          value={offering.saleCurrency ?? ''}
          onChange={(value) => updateFormField('offering', 'saleCurrency', value)}
          label={t('listing.sale.currency')}
          style={{ alignSelf: 'stretch' }}
          type="radio"
          size="lg"
        >
          {CURRENCY_OPTIONS.map((code) => (
            <SegmentedControlItem key={code} value={code} testID={`create-sale-currency-${code}`}>
              <SegmentedControlItemText>{code}</SegmentedControlItemText>
            </SegmentedControlItem>
          ))}
        </SegmentedControl>
      </Field>

      <Field label={t('listing.sale.chainStatus.label')}>
        <SegmentedControl<ChainStatus | ''>
          value={
            offering.chainStatus && isChainStatus(offering.chainStatus) ? offering.chainStatus : ''
          }
          onChange={(value) => updateFormField('offering', 'chainStatus', value || undefined)}
          label={t('listing.sale.chainStatus.label')}
          style={{ alignSelf: 'stretch' }}
          type="radio"
          size="lg"
        >
          {CHAIN_STATUS_OPTIONS.map((option) => (
            <SegmentedControlItem
              key={option.value}
              value={option.value}
              testID={`create-sale-chain-${option.value}`}
            >
              <SegmentedControlItemText>{t(option.i18nKey)}</SegmentedControlItemText>
            </SegmentedControlItem>
          ))}
        </SegmentedControl>
      </Field>

      <SwitchFilterRow
        title={t('listing.sale.priceReduced')}
        value={Boolean(offering.isPriceReduced)}
        onValueChange={(value) => updateFormField('offering', 'isPriceReduced', value)}
      />
    </View>
  );
}
