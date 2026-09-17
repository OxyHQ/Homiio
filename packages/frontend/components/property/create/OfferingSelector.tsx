import React, { useCallback } from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { CheckboxCard } from '@oxy.so/bloom/checkbox';
import { Field } from '@oxy.so/bloom/field';
import { SegmentedFilter } from '@oxy.so/bloom/stay-filters';
import { OfferingType } from '@homiio/shared-types';
import { PRICING_OFFERING_OPTIONS, CURRENCY_OPTIONS } from './constants';
import { createPropertyStyles as styles } from './styles';
import type { PropertyStepProps } from './types';

/**
 * "Offering" wizard step — the 4-way offering selector.
 *
 * Hosts pick how the listing is offered: Rent monthly, Rent by night, Sell,
 * and/or Exchange. The selection is MULTI-select (a place can be rented monthly
 * AND by the night AND for sale), so each option is a Bloom `CheckboxCard`. A
 * listing must keep at least one offering — deselecting the last one falls back
 * to long-term rent. Each selected offering reveals its own pricing/details step
 * (the flow resolver inserts them). The shared currency selector applies to the
 * rent offerings (sale carries its own currency on the Sale Details step).
 *
 * Not Bloom's `OfferingEditor`: its cards open fields Homiio's listing cannot
 * store (a deposit in months, a minimum stay in months, an available-from date
 * on the rent block) and have no way to hide them, so a host would fill in
 * values that are silently dropped. Homiio's own pricing steps follow instead.
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
    <View style={styles.step}>
      <View style={styles.cards}>
        {PRICING_OFFERING_OPTIONS.map((option) => (
          <CheckboxCard
            key={option.value}
            checked={offerings.includes(option.value)}
            onCheckedChange={() => toggleOffering(option.value)}
            title={t(option.i18nKey)}
            description={t(option.descriptionKey)}
            testID={`create-offering-${option.value}`}
          />
        ))}
      </View>

      <Field label={t('listing.offering.currency')}>
        <SegmentedFilter<string>
          options={CURRENCY_OPTIONS.map((code) => ({ value: code, label: code }))}
          value={currency}
          onValueChange={(value) => setFormData('pricing', { currency: value })}
          accessibilityLabel={t('listing.offering.currency')}
          testID="create-currency"
        />
      </Field>
    </View>
  );
}
