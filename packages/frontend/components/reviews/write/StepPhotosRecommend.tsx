/**
 * StepPhotosRecommend — the final step: optional photos (uploaded to the
 * 'reviews' folder), the required overall star rating, and the required
 * recommendation. Submit is the wizard footer's last-step action.
 *
 * The rating is Bloom's `RatingInput` (2.12): a `radiogroup` of five `radio`
 * stars with a roving tab stop and arrow-key selection, which the five bare
 * `Pressable`s this used to draw never had. Whole stars only and no clearing,
 * which is exactly what the wizard stores — `data.rating` is 1..5, and 0 is
 * "not answered yet" rather than a value the group can express.
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { Label } from '@oxy.so/bloom/label';
import { RatingInput } from '@oxy.so/bloom/rating';
import { useTheme } from '@oxy.so/bloom/theme';
import { Text as BloomText } from '@oxy.so/bloom/typography';

import { ImageUpload } from '@/components/ImageUpload';
import { YesNoSelector } from '@/components/reviews/write/YesNoSelector';
import type { StepProps } from '@/components/reviews/write/types';
import { spacing } from '@/constants/styles';

const MAX_REVIEW_PHOTOS = 6;

export const StepPhotosRecommend: React.FC<StepProps> = ({ data, update }) => {
  const { t } = useTranslation();
  const theme = useTheme();

  return (
    <View style={styles.container}>
      <View style={styles.block}>
        <Label>{t('reviews.write.fields.photos')}</Label>
        <ImageUpload
          images={data.images}
          onImagesChange={(images) => update('images', images)}
          folder="reviews"
          maxImages={MAX_REVIEW_PHOTOS}
        />
      </View>

      <View style={styles.block}>
        <Label required>{t('reviews.write.fields.rating')}</Label>
        <RatingInput
          value={data.rating > 0 ? data.rating : null}
          onChange={(rating) => update('rating', rating)}
          accessibilityLabel={t('reviews.write.fields.rating')}
          formatStarLabel={(star) => t('reviews.write.rateStar', { star })}
          testID="review-rating"
        />
        <BloomText style={[styles.ratingHint, { color: theme.colors.textSecondary }]}>
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
  ratingHint: {
    fontSize: 13,
  },
});

export default StepPhotosRecommend;
