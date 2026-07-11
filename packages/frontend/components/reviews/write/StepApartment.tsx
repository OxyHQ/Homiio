/**
 * StepApartment — optional apartment dimensions: summer/winter temperature,
 * noise, light, condition & maintenance. Every field is skippable.
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import {
  TemperatureRating,
  NoiseLevel,
  LightLevel,
  ConditionRating,
} from '@homiio/shared-types';

import { EnumChipSelector } from '@/components/reviews/EnumChipSelector';
import { StepHeader } from '@/components/reviews/write/StepHeader';
import type { StepProps } from '@/components/reviews/write/types';
import { spacing } from '@/constants/styles';

export const StepApartment: React.FC<StepProps> = ({ data, update }) => {
  const { t } = useTranslation();

  return (
    <View style={styles.container}>
      <StepHeader
        title={t('reviews.write.steps.apartment.title')}
        subtitle={t('reviews.write.steps.apartment.subtitle')}
      />

      <EnumChipSelector
        label={t('reviews.write.fields.summerTemperature')}
        labelPrefix="reviews.enums.temperature"
        values={Object.values(TemperatureRating)}
        selected={data.summerTemperature ? [data.summerTemperature] : []}
        onChange={(next) => update('summerTemperature', next[0])}
      />
      <EnumChipSelector
        label={t('reviews.write.fields.winterTemperature')}
        labelPrefix="reviews.enums.temperature"
        values={Object.values(TemperatureRating)}
        selected={data.winterTemperature ? [data.winterTemperature] : []}
        onChange={(next) => update('winterTemperature', next[0])}
      />
      <EnumChipSelector
        label={t('reviews.write.fields.noise')}
        labelPrefix="reviews.enums.noise"
        values={Object.values(NoiseLevel)}
        selected={data.noise ? [data.noise] : []}
        onChange={(next) => update('noise', next[0])}
      />
      <EnumChipSelector
        label={t('reviews.write.fields.light')}
        labelPrefix="reviews.enums.light"
        values={Object.values(LightLevel)}
        selected={data.light ? [data.light] : []}
        onChange={(next) => update('light', next[0])}
      />
      <EnumChipSelector
        label={t('reviews.write.fields.conditionAndMaintenance')}
        labelPrefix="reviews.enums.condition"
        values={Object.values(ConditionRating)}
        selected={data.conditionAndMaintenance ? [data.conditionAndMaintenance] : []}
        onChange={(next) => update('conditionAndMaintenance', next[0])}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    gap: spacing.xl,
  },
});

export default StepApartment;
