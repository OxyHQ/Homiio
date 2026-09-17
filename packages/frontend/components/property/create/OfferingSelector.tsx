import React, { useCallback } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { CheckboxCard } from '@oxy.so/bloom/checkbox';
import { Chip } from '@oxy.so/bloom/chip';
import { Field } from '@oxy.so/bloom/field';
import { OfferingType } from '@homiio/shared-types';
import { ThemedText } from '@/components/ThemedText';
import { spacing } from '@/constants/styles';
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
      <ThemedText type="subtitle">
        {t('listing.offering.stepTitle')}
      </ThemedText>
      <ThemedText style={styles.instructions}>
        {t('listing.offering.stepHelp')}
      </ThemedText>

      <View style={offeringSelectorStyles.list}>
        {PRICING_OFFERING_OPTIONS.map((option) => (
          <CheckboxCard
            key={option.value}
            checked={offerings.includes(option.value)}
            onCheckedChange={() => toggleOffering(option.value)}
            title={t(option.i18nKey)}
            description={t(option.descriptionKey)}
          />
        ))}
      </View>

      <Field label={t('listing.offering.currency')}>
        <View style={styles.optionRow}>
          {CURRENCY_OPTIONS.map((option) => (
            <Chip
              key={option.value}
              size="large"
              selected={currency === option.value}
              onPress={() => setFormData('pricing', { currency: option.value })}
            >
              {option.label}
            </Chip>
          ))}
        </View>
      </Field>
    </View>
  );
}

const offeringSelectorStyles = StyleSheet.create({
  list: {
    gap: spacing.md,
  },
});
