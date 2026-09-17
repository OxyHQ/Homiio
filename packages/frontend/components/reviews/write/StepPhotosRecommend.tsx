/**
 * StepPhotosRecommend — the final step: optional photos (uploaded to the
 * 'reviews' folder), the required overall star rating, and the required
 * recommendation. Submit is the wizard footer's last-step action.
 *
 * The rating is a row of Remix star glyphs; Bloom has no rating input, so the
 * five press targets stay local (static styles, no function-form `style`).
 */
import React from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { RiStarFill, RiStarLine } from '@oxy.so/bloom/icons';
import { Label } from '@oxy.so/bloom/label';
import { useTheme } from '@oxy.so/bloom/theme';
import { Text as BloomText } from '@oxy.so/bloom/typography';

import { ImageUpload } from '@/components/ImageUpload';
import { YesNoSelector } from '@/components/reviews/write/YesNoSelector';
import type { StepProps } from '@/components/reviews/write/types';
import { colors } from '@/styles/colors';
import { spacing } from '@/constants/styles';

const MAX_REVIEW_PHOTOS = 6;
const STAR_SIZE = 34;

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
        <View style={styles.starsRow}>
          {[1, 2, 3, 4, 5].map((star) => {
            const active = star <= data.rating;
            const StarIcon = active ? RiStarFill : RiStarLine;
            return (
              <Pressable
                key={star}
                onPress={() => update('rating', star)}
                style={styles.starButton}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                accessibilityLabel={t('reviews.write.rateStar', { star })}
              >
                <StarIcon
                  width={STAR_SIZE}
                  height={STAR_SIZE}
                  fill={active ? colors.ratingStar : theme.colors.textTertiary}
                />
              </Pressable>
            );
          })}
        </View>
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
  starsRow: {
    flexDirection: 'row',
    gap: spacing.xs,
  },
  starButton: {
    padding: spacing.xs,
  },
  ratingHint: {
    fontSize: 13,
  },
});

export default StepPhotosRecommend;
