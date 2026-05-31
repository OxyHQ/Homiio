import React from 'react';
import { View, TextInput, TouchableOpacity } from 'react-native';
import { ThemedText } from '@/components/ThemedText';
import { EthicalPricingRecommendation } from './EthicalPricingRecommendation';
import { CURRENCY_OPTIONS } from './constants';
import { createPropertyStyles as styles } from './styles';
import type { PropertyStepProps } from './types';

/**
 * "Pricing" wizard step: monthly rent (with ethical-pricing recommendation),
 * currency selector, and optional deposit/fee fields.
 */
export function PricingStep({ formData, validationErrors, updateFormField }: PropertyStepProps) {
  const { pricing } = formData;

  return (
    <View>
      <ThemedText type="subtitle">Pricing</ThemedText>

      <View style={styles.formRow}>
        <View style={[styles.formGroup, styles.formGroupLeft]}>
          <ThemedText style={styles.label}>Monthly Rent</ThemedText>
          <TextInput
            style={[styles.input, validationErrors.monthlyRent && styles.inputError]}
            value={pricing.monthlyRent?.toString() || ''}
            onChangeText={(text) => updateFormField('pricing', 'monthlyRent', parseFloat(text) || 0)}
            keyboardType="numeric"
            placeholder="0"
          />
          {validationErrors.monthlyRent && (
            <ThemedText style={styles.errorText}>{validationErrors.monthlyRent}</ThemedText>
          )}

          {pricing.monthlyRent > 0 && (
            <EthicalPricingRecommendation
              proposedRent={pricing.monthlyRent}
              propertyData={formData}
            />
          )}
        </View>

        <View style={[styles.formGroup, styles.formGroupRight]}>
          <ThemedText style={styles.label}>Currency</ThemedText>
          <View style={styles.optionRow}>
            {CURRENCY_OPTIONS.map((option) => (
              <TouchableOpacity
                key={option.value}
                style={[
                  styles.propertyTypeButton,
                  pricing.currency === option.value && styles.propertyTypeButtonSelected,
                ]}
                onPress={() => updateFormField('pricing', 'currency', option.value)}
              >
                <ThemedText
                  style={[
                    styles.propertyTypeText,
                    pricing.currency === option.value && styles.propertyTypeTextSelected,
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
        <ThemedText style={styles.label}>Security Deposit</ThemedText>
        <TextInput
          style={styles.input}
          value={pricing.securityDeposit?.toString() || ''}
          onChangeText={(text) =>
            updateFormField('pricing', 'securityDeposit', parseFloat(text) || 0)
          }
          keyboardType="numeric"
          placeholder="0"
        />
      </View>

      <View style={styles.formGroup}>
        <ThemedText style={styles.label}>Application Fee</ThemedText>
        <TextInput
          style={styles.input}
          value={pricing.applicationFee?.toString() || ''}
          onChangeText={(text) =>
            updateFormField('pricing', 'applicationFee', parseFloat(text) || 0)
          }
          keyboardType="numeric"
          placeholder="0"
        />
      </View>

      <View style={styles.formGroup}>
        <ThemedText style={styles.label}>Late Fee</ThemedText>
        <TextInput
          style={styles.input}
          value={pricing.lateFee?.toString() || ''}
          onChangeText={(text) => updateFormField('pricing', 'lateFee', parseFloat(text) || 0)}
          keyboardType="numeric"
          placeholder="0"
        />
      </View>
    </View>
  );
}
