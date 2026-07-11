/**
 * StepBuilding — the building & neighbours: staircase neighbours, tourist
 * apartments (yes/no), neighbour relations, common-area cleaning, and the
 * building's shared services (multi-select). All optional.
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import {
  NeighborRating,
  NeighborRelations,
  CleaningRating,
  ServiceType,
} from '@homiio/shared-types';

import { EnumChipSelector } from '@/components/reviews/EnumChipSelector';
import { StepHeader } from '@/components/reviews/write/StepHeader';
import { YesNoSelector } from '@/components/reviews/write/YesNoSelector';
import type { StepProps } from '@/components/reviews/write/types';
import { spacing } from '@/constants/styles';

export const StepBuilding: React.FC<StepProps> = ({ data, update }) => {
  const { t } = useTranslation();

  return (
    <View style={styles.container}>
      <StepHeader
        title={t('reviews.write.steps.building.title')}
        subtitle={t('reviews.write.steps.building.subtitle')}
      />

      <EnumChipSelector
        label={t('reviews.write.fields.staircaseNeighbors')}
        labelPrefix="reviews.enums.staircaseNeighbors"
        values={Object.values(NeighborRating)}
        selected={data.staircaseNeighbors ? [data.staircaseNeighbors] : []}
        onChange={(next) => update('staircaseNeighbors', next[0])}
      />
      <YesNoSelector
        label={t('reviews.write.fields.touristApartments')}
        value={data.touristApartments}
        onChange={(value) => update('touristApartments', value)}
      />
      <EnumChipSelector
        label={t('reviews.write.fields.neighborRelations')}
        labelPrefix="reviews.enums.neighborRelations"
        values={Object.values(NeighborRelations)}
        selected={data.neighborRelations ? [data.neighborRelations] : []}
        onChange={(next) => update('neighborRelations', next[0])}
      />
      <EnumChipSelector
        label={t('reviews.write.fields.cleaning')}
        labelPrefix="reviews.enums.cleaning"
        values={Object.values(CleaningRating)}
        selected={data.cleaning ? [data.cleaning] : []}
        onChange={(next) => update('cleaning', next[0])}
      />
      <EnumChipSelector
        label={t('reviews.write.fields.services')}
        labelPrefix="reviews.enums.services"
        multiple
        values={Object.values(ServiceType)}
        selected={data.services}
        onChange={(next) => update('services', next)}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    gap: spacing.xl,
  },
});

export default StepBuilding;
