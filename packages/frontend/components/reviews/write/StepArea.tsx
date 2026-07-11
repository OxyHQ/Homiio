/**
 * StepArea — the surrounding area: tourist pressure, street noise, cleanliness,
 * and safety. All optional.
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import {
  TouristLevel,
  NoiseLevel,
  CleaningRating,
  SecurityLevel,
} from '@homiio/shared-types';

import { EnumChipSelector } from '@/components/reviews/EnumChipSelector';
import { StepHeader } from '@/components/reviews/write/StepHeader';
import type { StepProps } from '@/components/reviews/write/types';
import { spacing } from '@/constants/styles';

export const StepArea: React.FC<StepProps> = ({ data, update }) => {
  const { t } = useTranslation();

  return (
    <View style={styles.container}>
      <StepHeader
        title={t('reviews.write.steps.area.title')}
        subtitle={t('reviews.write.steps.area.subtitle')}
      />

      <EnumChipSelector
        label={t('reviews.write.fields.areaTourists')}
        labelPrefix="reviews.enums.areaTourists"
        values={Object.values(TouristLevel)}
        selected={data.areaTourists ? [data.areaTourists] : []}
        onChange={(next) => update('areaTourists', next[0])}
      />
      <EnumChipSelector
        label={t('reviews.write.fields.areaNoise')}
        labelPrefix="reviews.enums.noise"
        values={Object.values(NoiseLevel)}
        selected={data.areaNoise ? [data.areaNoise] : []}
        onChange={(next) => update('areaNoise', next[0])}
      />
      <EnumChipSelector
        label={t('reviews.write.fields.areaCleanliness')}
        labelPrefix="reviews.enums.cleaning"
        values={Object.values(CleaningRating)}
        selected={data.areaCleanliness ? [data.areaCleanliness] : []}
        onChange={(next) => update('areaCleanliness', next[0])}
      />
      <EnumChipSelector
        label={t('reviews.write.fields.areaSecurity')}
        labelPrefix="reviews.enums.areaSecurity"
        values={Object.values(SecurityLevel)}
        selected={data.areaSecurity ? [data.areaSecurity] : []}
        onChange={(next) => update('areaSecurity', next[0])}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    gap: spacing.xl,
  },
});

export default StepArea;
