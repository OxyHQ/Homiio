import React, { useCallback } from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Field } from '@oxy.so/bloom/field';
import { SettingsListGroup } from '@oxy.so/bloom/settings-list';
import { ThemedText } from '@/components/ThemedText';
import { PriceBreakdown } from '@/components/PriceBreakdown';
import { WizardSwitchItem, WizardTextField } from './fields';
import { createPropertyStyles as styles } from './styles';
import type { PropertyStepProps } from './types';
import { parseLocaleNumber } from '@/utils/number';

/** Nights used for the live booking-quote preview (a representative short stay). */
const PREVIEW_NIGHTS = 3;

/**
 * "Nightly Pricing" wizard step — only reachable when the listing is offered by
 * the night. Captures the nightly rate (required, validated > 0), the cleaning
 * and service fees, the taxes percentage, the min/max nights, and instant-book.
 * A live {@link PriceBreakdown} preview shows the booking quote for a sample
 * 3-night stay so the host sees how fees + taxes compound. These map to the
 * property `shortTermRent` block on submit (currency shared via the Offering
 * step).
 */
export function NightlyPricingStep({
  formData,
  validationErrors,
  updateFormField,
}: PropertyStepProps) {
  const { t } = useTranslation();
  const { pricing } = formData;

  // es/it/ca numeric keyboards emit a comma decimal; normalise before parse.
  const handleNumber = useCallback(
    (field: 'nightlyRate' | 'cleaningFee' | 'serviceFee' | 'taxesPercent') =>
      (text: string) => {
        const parsed = parseLocaleNumber(text);
        updateFormField('pricing', field, Number.isNaN(parsed) ? 0 : parsed);
      },
    [updateFormField],
  );

  // Min/max nights are optional whole numbers — empty clears them to undefined.
  const handleNights = useCallback(
    (field: 'minNights' | 'maxNights') => (text: string) => {
      const digits = text.replace(/[^\d]/g, '');
      updateFormField('pricing', field, digits ? Number.parseInt(digits, 10) : undefined);
    },
    [updateFormField],
  );

  const currency = (pricing.currency || 'EUR').toUpperCase();

  return (
    <View style={styles.step}>
      <ThemedText type="subtitle">
        {t('listing.offering.nightlyStepTitle')}
      </ThemedText>

      <WizardTextField
        label={t('listing.nightly.nightlyRate')}
        value={pricing.nightlyRate ? pricing.nightlyRate.toString() : ''}
        onChangeText={handleNumber('nightlyRate')}
        keyboardType="numeric"
        placeholder="0"
        error={validationErrors.nightlyRate}
      />

      <View style={styles.formRow}>
        <WizardTextField
          style={styles.formRowItem}
          label={t('listing.nightly.cleaningFee')}
          value={pricing.cleaningFee ? pricing.cleaningFee.toString() : ''}
          onChangeText={handleNumber('cleaningFee')}
          keyboardType="numeric"
          placeholder="0"
        />
        <WizardTextField
          style={styles.formRowItem}
          label={t('listing.nightly.serviceFee')}
          value={pricing.serviceFee ? pricing.serviceFee.toString() : ''}
          onChangeText={handleNumber('serviceFee')}
          keyboardType="numeric"
          placeholder="0"
        />
      </View>

      <WizardTextField
        label={t('listing.nightly.taxesPercent')}
        value={pricing.taxesPercent ? pricing.taxesPercent.toString() : ''}
        onChangeText={handleNumber('taxesPercent')}
        keyboardType="numeric"
        placeholder="0"
        error={validationErrors.taxesPercent}
      />

      <Field error={validationErrors.minNights}>
        <View style={styles.formRow}>
          <WizardTextField
            style={styles.formRowItem}
            label={t('listing.nightly.minNights')}
            value={pricing.minNights !== undefined ? pricing.minNights.toString() : ''}
            onChangeText={handleNights('minNights')}
            keyboardType="number-pad"
            placeholder="1"
          />
          <WizardTextField
            style={styles.formRowItem}
            label={t('listing.nightly.maxNights')}
            value={pricing.maxNights !== undefined ? pricing.maxNights.toString() : ''}
            onChangeText={handleNights('maxNights')}
            keyboardType="number-pad"
            placeholder={t('listing.nightly.noMax')}
          />
        </View>
      </Field>

      <SettingsListGroup>
        <WizardSwitchItem
          title={t('listing.nightly.instantBook')}
          value={pricing.instantBook}
          onValueChange={(value) => updateFormField('pricing', 'instantBook', value)}
        />
      </SettingsListGroup>

      {/* Live booking-quote preview for a representative short stay so the host
          sees how the nightly rate, fees and taxes compound into a total. */}
      {pricing.nightlyRate > 0 ? (
        <Field label={t('listing.nightly.previewTitle', { count: PREVIEW_NIGHTS })}>
          <PriceBreakdown
            nights={PREVIEW_NIGHTS}
            nightlyRate={pricing.nightlyRate}
            cleaningFee={pricing.cleaningFee ?? 0}
            serviceFee={pricing.serviceFee ?? 0}
            taxesPercent={pricing.taxesPercent ?? 0}
            currency={currency}
          />
        </Field>
      ) : null}
    </View>
  );
}
