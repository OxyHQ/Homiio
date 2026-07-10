import React, { useCallback } from 'react';
import { View, TextInput } from 'react-native';
import { useTranslation } from 'react-i18next';
import { ThemedText } from '@/components/ThemedText';
import { EthicalPricingRecommendation } from './EthicalPricingRecommendation';
import { createPropertyStyles as styles } from './styles';
import type { PropertyStepProps } from './types';
import { parseLocaleNumber } from '@/utils/number';

/**
 * "Long-term Pricing" wizard step — only reachable when the listing is offered
 * for monthly rent. Captures the monthly rent (required, validated > 0, with the
 * ethical-pricing recommendation) plus the optional deposit/fee fields. The
 * currency is shared across rent offerings and chosen on the Offering step.
 * These map to the property `longTermRent` block on submit.
 */
export function LongTermPricingStep({
  formData,
  validationErrors,
  updateFormField,
}: PropertyStepProps) {
  const { t } = useTranslation();
  const { pricing } = formData;

  // es/it/ca numeric keyboards emit a comma decimal; normalise before parse so
  // "1234,5" isn't truncated. NaN → 0 keeps the field a controlled number.
  const handleNumber = useCallback(
    (field: 'monthlyRent' | 'securityDeposit' | 'applicationFee' | 'lateFee') =>
      (text: string) => {
        const parsed = parseLocaleNumber(text);
        updateFormField('pricing', field, Number.isNaN(parsed) ? 0 : parsed);
      },
    [updateFormField],
  );

  return (
    <View>
      <ThemedText type="subtitle">
        {t('listing.offering.longTermStepTitle')}
      </ThemedText>

      <View style={styles.formGroup}>
        <ThemedText style={styles.label}>
          {t('listing.pricing.monthlyRent')}
        </ThemedText>
        <TextInput
          style={[styles.input, validationErrors.monthlyRent && styles.inputError]}
          value={pricing.monthlyRent ? pricing.monthlyRent.toString() : ''}
          onChangeText={handleNumber('monthlyRent')}
          keyboardType="numeric"
          placeholder="0"
        />
        {validationErrors.monthlyRent ? (
          <ThemedText style={styles.errorText}>{validationErrors.monthlyRent}</ThemedText>
        ) : null}

        {pricing.monthlyRent > 0 ? (
          <EthicalPricingRecommendation
            proposedRent={pricing.monthlyRent}
            propertyData={formData}
          />
        ) : null}
      </View>

      <View style={styles.formGroup}>
        <ThemedText style={styles.label}>
          {t('listing.pricing.securityDeposit')}
        </ThemedText>
        <TextInput
          style={styles.input}
          value={pricing.securityDeposit ? pricing.securityDeposit.toString() : ''}
          onChangeText={handleNumber('securityDeposit')}
          keyboardType="numeric"
          placeholder="0"
        />
      </View>

      <View style={styles.formGroup}>
        <ThemedText style={styles.label}>
          {t('listing.pricing.applicationFee')}
        </ThemedText>
        <TextInput
          style={styles.input}
          value={pricing.applicationFee ? pricing.applicationFee.toString() : ''}
          onChangeText={handleNumber('applicationFee')}
          keyboardType="numeric"
          placeholder="0"
        />
      </View>

      <View style={styles.formGroup}>
        <ThemedText style={styles.label}>
          {t('listing.pricing.lateFee')}
        </ThemedText>
        <TextInput
          style={styles.input}
          value={pricing.lateFee ? pricing.lateFee.toString() : ''}
          onChangeText={handleNumber('lateFee')}
          keyboardType="numeric"
          placeholder="0"
        />
      </View>
    </View>
  );
}
