import React, { useCallback } from 'react';
import { View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { EthicalPricingRecommendation } from './EthicalPricingRecommendation';
import { WizardTextField } from './fields';
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
    <View style={styles.step}>
      <WizardTextField
        label={t('listing.pricing.monthlyRent')}
        value={pricing.monthlyRent ? pricing.monthlyRent.toString() : ''}
        onChangeText={handleNumber('monthlyRent')}
        keyboardType="numeric"
        placeholder="0"
        error={validationErrors.monthlyRent}
      />

      {pricing.monthlyRent > 0 ? (
        <EthicalPricingRecommendation proposedRent={pricing.monthlyRent} propertyData={formData} />
      ) : null}

      <WizardTextField
        label={t('listing.pricing.securityDeposit')}
        value={pricing.securityDeposit ? pricing.securityDeposit.toString() : ''}
        onChangeText={handleNumber('securityDeposit')}
        keyboardType="numeric"
        placeholder="0"
      />

      <View style={styles.formRow}>
        <WizardTextField
          style={styles.formRowItem}
          label={t('listing.pricing.applicationFee')}
          value={pricing.applicationFee ? pricing.applicationFee.toString() : ''}
          onChangeText={handleNumber('applicationFee')}
          keyboardType="numeric"
          placeholder="0"
        />
        <WizardTextField
          style={styles.formRowItem}
          label={t('listing.pricing.lateFee')}
          value={pricing.lateFee ? pricing.lateFee.toString() : ''}
          onChangeText={handleNumber('lateFee')}
          keyboardType="numeric"
          placeholder="0"
        />
      </View>
    </View>
  );
}
