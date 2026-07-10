import React, { useCallback } from 'react';
import { StyleSheet, View, TextInput, TouchableOpacity } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { ThemedText } from '@/components/ThemedText';
import { PriceBreakdown } from '@/components/PriceBreakdown';
import { colors } from '@/styles/colors';
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
    <View>
      <ThemedText type="subtitle">
        {t('listing.offering.nightlyStepTitle')}
      </ThemedText>

      <View style={styles.formGroup}>
        <ThemedText style={styles.label}>
          {t('listing.nightly.nightlyRate')}
        </ThemedText>
        <TextInput
          style={[styles.input, validationErrors.nightlyRate && styles.inputError]}
          value={pricing.nightlyRate ? pricing.nightlyRate.toString() : ''}
          onChangeText={handleNumber('nightlyRate')}
          keyboardType="numeric"
          placeholder="0"
        />
        {validationErrors.nightlyRate ? (
          <ThemedText style={styles.errorText}>{validationErrors.nightlyRate}</ThemedText>
        ) : null}
      </View>

      <View style={styles.formRow}>
        <View style={[styles.formGroup, styles.formGroupLeft]}>
          <ThemedText style={styles.label}>
            {t('listing.nightly.cleaningFee')}
          </ThemedText>
          <TextInput
            style={styles.input}
            value={pricing.cleaningFee ? pricing.cleaningFee.toString() : ''}
            onChangeText={handleNumber('cleaningFee')}
            keyboardType="numeric"
            placeholder="0"
          />
        </View>
        <View style={[styles.formGroup, styles.formGroupRight]}>
          <ThemedText style={styles.label}>
            {t('listing.nightly.serviceFee')}
          </ThemedText>
          <TextInput
            style={styles.input}
            value={pricing.serviceFee ? pricing.serviceFee.toString() : ''}
            onChangeText={handleNumber('serviceFee')}
            keyboardType="numeric"
            placeholder="0"
          />
        </View>
      </View>

      <View style={styles.formGroup}>
        <ThemedText style={styles.label}>
          {t('listing.nightly.taxesPercent')}
        </ThemedText>
        <TextInput
          style={[styles.input, validationErrors.taxesPercent && styles.inputError]}
          value={pricing.taxesPercent ? pricing.taxesPercent.toString() : ''}
          onChangeText={handleNumber('taxesPercent')}
          keyboardType="numeric"
          placeholder="0"
        />
        {validationErrors.taxesPercent ? (
          <ThemedText style={styles.errorText}>{validationErrors.taxesPercent}</ThemedText>
        ) : null}
      </View>

      <View style={styles.formRow}>
        <View style={[styles.formGroup, styles.formGroupLeft]}>
          <ThemedText style={styles.label}>
            {t('listing.nightly.minNights')}
          </ThemedText>
          <TextInput
            style={[styles.input, validationErrors.minNights && styles.inputError]}
            value={pricing.minNights !== undefined ? pricing.minNights.toString() : ''}
            onChangeText={handleNights('minNights')}
            keyboardType="number-pad"
            placeholder="1"
          />
        </View>
        <View style={[styles.formGroup, styles.formGroupRight]}>
          <ThemedText style={styles.label}>
            {t('listing.nightly.maxNights')}
          </ThemedText>
          <TextInput
            style={styles.input}
            value={pricing.maxNights !== undefined ? pricing.maxNights.toString() : ''}
            onChangeText={handleNights('maxNights')}
            keyboardType="number-pad"
            placeholder={t('listing.nightly.noMax')}
          />
        </View>
      </View>
      {validationErrors.minNights ? (
        <ThemedText style={styles.errorText}>{validationErrors.minNights}</ThemedText>
      ) : null}

      <View style={styles.toggleContainer}>
        <ThemedText style={styles.label}>
          {t('listing.nightly.instantBook')}
        </ThemedText>
        <TouchableOpacity
          style={[styles.toggleButton, pricing.instantBook ? styles.toggleButtonActive : null]}
          onPress={() => updateFormField('pricing', 'instantBook', !pricing.instantBook)}
          accessibilityRole="switch"
          accessibilityState={{ checked: pricing.instantBook }}
        >
          <Ionicons
            name={pricing.instantBook ? 'flash' : 'flash-outline'}
            size={20}
            color={pricing.instantBook ? colors.primaryColor : colors.COLOR_BLACK_LIGHT_4}
          />
          <ThemedText style={styles.toggleText}>
            {pricing.instantBook ? t('common.yes') : t('common.no')}
          </ThemedText>
        </TouchableOpacity>
      </View>

      {/* Live booking-quote preview for a representative short stay so the host
          sees how the nightly rate, fees and taxes compound into a total. */}
      {pricing.nightlyRate > 0 ? (
        <View style={nightlyPricingStyles.previewWrap}>
          <ThemedText style={styles.label}>
            {t('listing.nightly.previewTitle', {
              count: PREVIEW_NIGHTS,
            })}
          </ThemedText>
          <PriceBreakdown
            nights={PREVIEW_NIGHTS}
            nightlyRate={pricing.nightlyRate}
            cleaningFee={pricing.cleaningFee ?? 0}
            serviceFee={pricing.serviceFee ?? 0}
            taxesPercent={pricing.taxesPercent ?? 0}
            currency={currency}
            compact
          />
        </View>
      ) : null}
    </View>
  );
}

const nightlyPricingStyles = StyleSheet.create({
  previewWrap: {
    marginTop: 8,
  },
});
