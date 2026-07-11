/**
 * StepPriceDates — the tenancy money + timeline: monthly rent, currency, and
 * the lived-from / lived-to dates (kept as the existing YYYY-MM-DD text inputs).
 * `livedForMonths` is NOT collected — the server derives it from the dates.
 * Hard-required: price, both dates.
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { TextFieldInput } from '@oxyhq/bloom/text-field';

import { EnumChipSelector } from '@/components/reviews/EnumChipSelector';
import { StepHeader } from '@/components/reviews/write/StepHeader';
import type { StepProps } from '@/components/reviews/write/types';
import { spacing } from '@/constants/styles';

const CURRENCIES = ['EUR', 'USD', 'GBP', 'CAD'] as const;

export const StepPriceDates: React.FC<StepProps> = ({ data, update }) => {
  const { t } = useTranslation();

  return (
    <View style={styles.container}>
      <StepHeader
        title={t('reviews.write.steps.priceDates.title')}
        subtitle={t('reviews.write.steps.priceDates.subtitle')}
      />

      <TextFieldInput
        label={t('reviews.write.fields.price')}
        placeholder={t('reviews.write.placeholders.price')}
        value={data.price}
        onChangeText={(text) => update('price', text)}
        keyboardType="numeric"
      />

      <EnumChipSelector
        label={t('reviews.write.fields.currency')}
        labelPrefix="reviews.write.currencies"
        values={CURRENCIES}
        selected={[data.currency]}
        onChange={(next) => update('currency', next[0] ?? data.currency)}
      />

      <View style={styles.row}>
        <View style={styles.rowField}>
          <TextFieldInput
            label={t('reviews.write.fields.livedFrom')}
            placeholder={t('reviews.write.placeholders.date')}
            value={data.livedFrom}
            onChangeText={(text) => update('livedFrom', text)}
          />
        </View>
        <View style={styles.rowField}>
          <TextFieldInput
            label={t('reviews.write.fields.livedTo')}
            placeholder={t('reviews.write.placeholders.date')}
            value={data.livedTo}
            onChangeText={(text) => update('livedTo', text)}
          />
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    gap: spacing.xl,
  },
  row: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  rowField: {
    flex: 1,
  },
});

export default StepPriceDates;
