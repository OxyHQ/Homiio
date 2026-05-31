/**
 * ProfileExchangeReviews — a profile's home-exchange trust signal.
 *
 * Shows the aggregate average rating (via `Stars`) + review count, then each
 * review using the same flat, anonymous-friendly presentation as the property
 * Community Notes card (avatar glyph + author line + per-review stars + comment).
 * Reuses `Stars` so the rating language matches the rest of the app.
 *
 * Fails soft: renders nothing while loading on first paint, on error, or when
 * the profile has no exchange reviews — it never leaves an empty heading behind.
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { format } from 'date-fns';
import { Ionicons } from '@expo/vector-icons';

import { Text as BloomText } from '@oxyhq/bloom/typography';
import type { ExchangeReview } from '@homiio/shared-types';

import { Stars } from '@/components/ui/Stars';
import { useProfileExchangeReviews } from '@/hooks/useExchangeQueries';
import { colors } from '@/styles/colors';
import { radius, spacing } from '@/constants/styles';

interface Props {
  profileId: string;
}

const AVATAR_SIZE = 40;
const RATING_FRACTION_DIGITS = 1;

const ReviewItem: React.FC<{ review: ExchangeReview }> = ({ review }) => {
  const { t } = useTranslation();
  const date = (() => {
    const parsed = new Date(review.createdAt);
    return Number.isNaN(parsed.getTime()) ? '' : format(parsed, 'MMMM yyyy');
  })();

  return (
    <View style={styles.reviewCard}>
      <View style={styles.reviewHeader}>
        <View style={styles.avatar}>
          <Ionicons name="person" size={20} color={colors.COLOR_BLACK_LIGHT_3} />
        </View>
        <View style={styles.reviewHeaderText}>
          <BloomText style={styles.author}>
            {t('listing.exchange.review.guestAuthor', 'Exchange guest')}
          </BloomText>
          {date ? <BloomText style={styles.reviewDate}>{date}</BloomText> : null}
        </View>
        <Stars rating={review.rating} />
      </View>
      {review.comment ? (
        <BloomText style={styles.comment}>{review.comment}</BloomText>
      ) : null}
    </View>
  );
};

export const ProfileExchangeReviews: React.FC<Props> = ({ profileId }) => {
  const { t } = useTranslation();
  const { data, isPending, isError } = useProfileExchangeReviews(profileId, {
    limit: 10,
  });

  // Fail soft: nothing to show on the first load, on error, or when empty.
  if (isPending || isError) return null;
  const reviewCount = data?.meta.reviewCount ?? 0;
  if (reviewCount === 0) return null;

  const average = data?.meta.averageRating ?? 0;
  const items = data?.items ?? [];

  return (
    <View style={styles.container}>
      <View style={styles.summary}>
        <BloomText style={styles.heading}>
          {t('listing.exchange.review.profileHeading', 'Exchange reviews')}
        </BloomText>
        <View style={styles.summaryRow}>
          <Stars rating={average} size={16} />
          <BloomText style={styles.summaryText}>
            {t('listing.exchange.review.summary', '{{average}} · {{count}} reviews', {
              average: average.toFixed(RATING_FRACTION_DIGITS),
              count: reviewCount,
            })}
          </BloomText>
        </View>
      </View>
      <View style={styles.list}>
        {items.map((review) => (
          <ReviewItem key={review.id} review={review} />
        ))}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    gap: spacing.lg,
    backgroundColor: colors.white,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
  },
  summary: {
    gap: spacing.sm,
  },
  heading: {
    fontSize: 16,
    fontWeight: '700',
    color: colors.COLOR_BLACK,
  },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  summaryText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.COLOR_BLACK,
  },
  list: {
    gap: spacing.lg,
  },
  reviewCard: {
    gap: spacing.sm,
  },
  reviewHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
  },
  avatar: {
    width: AVATAR_SIZE,
    height: AVATAR_SIZE,
    borderRadius: AVATAR_SIZE / 2,
    backgroundColor: colors.COLOR_BLACK_LIGHT_7,
    alignItems: 'center',
    justifyContent: 'center',
  },
  reviewHeaderText: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  author: {
    fontSize: 15,
    fontWeight: '600',
    color: colors.COLOR_BLACK,
  },
  reviewDate: {
    fontSize: 13,
    color: colors.COLOR_BLACK_LIGHT_3,
  },
  comment: {
    fontSize: 15,
    lineHeight: 22,
    color: colors.COLOR_BLACK_LIGHT_2,
  },
});

export default ProfileExchangeReviews;
