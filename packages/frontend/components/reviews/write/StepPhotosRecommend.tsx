/**
 * StepPhotosRecommend — the final step: optional photos (uploaded to the
 * 'reviews' folder), the required overall star rating, and the required
 * recommendation. Submit is the wizard's `WizardProgress` "Submit" action.
 */
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';

import { Text as BloomText } from '@oxyhq/bloom/typography';

import { ImageUpload } from '@/components/ImageUpload';
import { StepHeader } from '@/components/reviews/write/StepHeader';
import { YesNoSelector } from '@/components/reviews/write/YesNoSelector';
import type { StepProps } from '@/components/reviews/write/types';
import { colors } from '@/styles/colors';
import { spacing } from '@/constants/styles';

const MAX_REVIEW_PHOTOS = 6;
const STAR_SIZE = 34;

export const StepPhotosRecommend: React.FC<StepProps> = ({ data, update }) => {
  const { t } = useTranslation();

  return (
    <View style={styles.container}>
      <StepHeader
        title={t('reviews.write.steps.photos.title')}
        subtitle={t('reviews.write.steps.photos.subtitle')}
      />

      <View style={styles.block}>
        <BloomText style={styles.fieldLabel}>
          {t('reviews.write.fields.photos')}
        </BloomText>
        <ImageUpload
          images={data.images}
          onImagesChange={(images) => update('images', images)}
          folder="reviews"
          maxImages={MAX_REVIEW_PHOTOS}
        />
      </View>

      <View style={styles.block}>
        <BloomText style={styles.fieldLabel}>
          {t('reviews.write.fields.rating')}
        </BloomText>
        <View style={styles.starsRow}>
          {[1, 2, 3, 4, 5].map((star) => {
            const active = star <= data.rating;
            return (
              <Pressable
                key={star}
                onPress={() => update('rating', star)}
                style={styles.starButton}
                accessibilityRole="button"
                accessibilityLabel={t('reviews.write.rateStar', { star })}
              >
                <Ionicons
                  name={active ? 'star' : 'star-outline'}
                  size={STAR_SIZE}
                  color={active ? colors.ratingStar : colors.COLOR_BLACK_LIGHT_5}
                />
              </Pressable>
            );
          })}
        </View>
        <BloomText style={styles.ratingHint}>
          {data.rating > 0
            ? t('reviews.write.ratingValue', { rating: data.rating })
            : t('reviews.write.ratingNone')}
        </BloomText>
      </View>

      <YesNoSelector
        label={t('reviews.write.fields.recommendation')}
        value={data.recommendation}
        onChange={(value) => update('recommendation', value)}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    gap: spacing.xl,
  },
  block: {
    gap: spacing.sm,
  },
  fieldLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.COLOR_BLACK_LIGHT_2,
  },
  starsRow: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  starButton: {
    padding: spacing.xs,
  },
  ratingHint: {
    fontSize: 13,
    color: colors.muted,
  },
});

export default StepPhotosRecommend;
