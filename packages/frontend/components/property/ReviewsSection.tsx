/**
 * ReviewsSection — Airbnb-style "Reviews" block for the property detail.
 *
 * Layout:
 *  - Large rating number + summary line (e.g. "4.8 · 124 reviews").
 *  - 2-column grid of review cards on web, 1-column on mobile.
 *  - "Show all N reviews" Bloom Button when more than `maxVisible` exist.
 *
 * Reads the shared `['addressReviews', addressId]` cache via `useAddressReviews`
 * and hydrates the authors ONCE (`useOxyAvatars`) so each `ReviewCard` renders a
 * real avatar + display name.
 */
import React, { useMemo } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';

import { Button } from '@oxyhq/bloom/button';
import * as Skeleton from '@oxyhq/bloom/skeleton';
import { H1, Text as BloomText } from '@oxyhq/bloom/typography';

import { ReviewCard } from '@/components/ReviewCard';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { SectionHeader, SECTION_GUTTER } from '@/components/property/Section';
import { useAddressReviews } from '@/hooks/useAddressReviews';
import { useOxyAvatars } from '@/hooks/useOxyAvatars';
import { colors } from '@/styles/colors';
import { hairline, radius, spacing } from '@/constants/styles';
import type { Property, ReviewDTO } from '@homiio/shared-types';

interface ReviewsSectionProps {
  property: Property;
  variant?: 'full' | 'preview';
}

interface AggregatedStats {
  averageRating: number;
  totalReviews: number;
  recommendationPercentage: number;
  verifiedCount: number;
}

const computeStats = (reviews: ReviewDTO[]): AggregatedStats | null => {
  if (reviews.length === 0) return null;
  const avg = reviews.reduce((sum, r) => sum + (r.rating || 0), 0) / reviews.length;
  const recommended = reviews.filter((r) => r.recommendation).length;
  return {
    averageRating: avg,
    totalReviews: reviews.length,
    recommendationPercentage: (recommended / reviews.length) * 100,
    verifiedCount: reviews.filter((r) => r.verified).length,
  };
};

interface RatingHeaderProps {
  stats: AggregatedStats;
}

const RatingHeader: React.FC<RatingHeaderProps> = ({ stats }) => {
  const { t } = useTranslation();
  return (
    <View style={styles.ratingHeader}>
      <View style={styles.ratingNumberWrap}>
        <Ionicons name="star" size={28} color={colors.COLOR_BLACK} />
        <H1 style={styles.ratingNumber}>{stats.averageRating.toFixed(1)}</H1>
        <BloomText style={styles.ratingMeta}>
          · {stats.totalReviews} {t('property.reviews.count')}
        </BloomText>
      </View>
      <View style={styles.statsRow}>
        <View style={styles.statItem}>
          <BloomText style={styles.statValue}>
            {Math.round(stats.recommendationPercentage)}%
          </BloomText>
          <BloomText style={styles.statLabel}>{t('property.reviews.recommend')}</BloomText>
        </View>
        <View style={styles.statItem}>
          <BloomText style={styles.statValue}>{stats.verifiedCount}</BloomText>
          <BloomText style={styles.statLabel}>{t('property.reviews.verified')}</BloomText>
        </View>
      </View>
    </View>
  );
};

export const ReviewsSection: React.FC<ReviewsSectionProps> = ({
  property,
  variant = 'preview',
}) => {
  const { t } = useTranslation();
  const router = useRouter();

  const isPreview = variant === 'preview';
  const maxVisible = isPreview ? 6 : 10;

  const {
    addressId,
    reviews,
    query: { isLoading: loading, error: queryError, refetch },
  } = useAddressReviews(property);

  const { usersById } = useOxyAvatars(reviews.map((review) => review.oxyUserId));

  const error = queryError
    ? queryError instanceof Error
      ? queryError.message
      : 'Unable to load reviews'
    : null;

  const stats = useMemo(() => computeStats(reviews), [reviews]);
  const visibleReviews = useMemo(
    () => reviews.slice(0, maxVisible),
    [reviews, maxVisible],
  );

  if (!addressId) return null;

  const handleViewAll = () => {
    router.push(`/addresses/${addressId}?tab=reviews`);
  };

  const handleWriteReview = () => {
    router.push(`/reviews/write?addressId=${addressId}`);
  };

  return (
    <View>
      <SectionHeader title={t('property.reviews.title')} />
      <View style={styles.body}>
        <BloomText style={styles.disclaimer}>{t('property.reviews.disclaimer')}</BloomText>

        {loading ? (
          <View style={styles.skeletonGrid}>
            {Array.from({ length: 4 }).map((_, idx) => (
              <View key={idx} style={styles.skeletonCard}>
                <Skeleton.Box width="60%" height={14} borderRadius={4} />
                <Skeleton.Box width="100%" height={12} borderRadius={4} style={styles.skeletonLine} />
                <Skeleton.Box width="85%" height={12} borderRadius={4} style={styles.skeletonLine} />
                <Skeleton.Box width="70%" height={12} borderRadius={4} style={styles.skeletonLine} />
              </View>
            ))}
          </View>
        ) : null}

        {error ? (
          <ErrorState
            icon="chatbubbles-outline"
            title={t('property.reviews.errorTitle')}
            description={error}
            retryLabel={t('common.tryAgain')}
            onRetry={() => {
              refetch();
            }}
          />
        ) : null}

        {!loading && !error && reviews.length === 0 ? (
          <EmptyState
            icon="chatbubbles-outline"
            title={t('property.reviews.emptyTitle')}
            description={t('property.reviews.emptyDescription')}
            actionText={t('property.reviews.writeAction')}
            actionIcon="create-outline"
            onAction={handleWriteReview}
          />
        ) : null}

        {!loading && !error && reviews.length > 0 ? (
          <>
            {stats ? <RatingHeader stats={stats} /> : null}
            <View style={styles.grid}>
              {visibleReviews.map((review) => (
                <View key={review.id} style={styles.gridCell}>
                  <ReviewCard
                    review={review}
                    author={usersById.get(review.oxyUserId)}
                    onPressAgency={(slug) => router.push(`/agency/${slug}`)}
                  />
                </View>
              ))}
            </View>
            <View style={styles.actionsRow}>
              {reviews.length > maxVisible ? (
                <Button
                  onPress={handleViewAll}
                  variant="secondary"
                  size="medium"
                  accessibilityLabel={t('property.reviews.showAll', { count: reviews.length })}
                >
                  {t('property.reviews.showAll', { count: reviews.length })}
                </Button>
              ) : null}
              <Button
                onPress={handleWriteReview}
                variant="ghost"
                size="medium"
                icon={<Ionicons name="create-outline" size={16} color={colors.COLOR_BLACK} />}
                iconPosition="left"
                accessibilityLabel={t('property.reviews.writeAction')}
              >
                {t('property.reviews.writeAction')}
              </Button>
            </View>
          </>
        ) : null}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  body: {
    paddingHorizontal: SECTION_GUTTER,
  },
  disclaimer: {
    fontSize: 13,
    color: colors.COLOR_BLACK_LIGHT_3,
    marginTop: spacing.sm,
    marginBottom: spacing.xl,
    lineHeight: 18,
  },
  ratingHeader: {
    gap: spacing.lg,
    marginBottom: spacing.xl,
    paddingVertical: spacing.lg,
    borderBottomWidth: hairline.width,
    borderBottomColor: hairline.color,
  },
  ratingNumberWrap: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: spacing.sm,
  },
  ratingNumber: {
    fontSize: 36,
    fontWeight: '700',
    color: colors.COLOR_BLACK,
    letterSpacing: -0.5,
  },
  ratingMeta: {
    fontSize: 15,
    color: colors.COLOR_BLACK_LIGHT_3,
  },
  statsRow: {
    flexDirection: 'row',
    gap: spacing['4xl'],
  },
  statItem: {
    gap: 2,
  },
  statValue: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.COLOR_BLACK,
  },
  statLabel: {
    fontSize: 12,
    color: colors.COLOR_BLACK_LIGHT_3,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.lg,
  },
  gridCell: {
    width: Platform.OS === 'web' ? '48%' : '100%',
    minWidth: 240,
    flexGrow: 1,
  },
  skeletonGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.lg,
    marginBottom: spacing.xl,
  },
  skeletonCard: {
    width: Platform.OS === 'web' ? '48%' : '100%',
    minWidth: 240,
    flexGrow: 1,
    padding: spacing.lg,
    backgroundColor: colors.mutedSubtle,
    borderRadius: radius.md,
    gap: spacing.sm,
  },
  skeletonLine: {
    marginTop: spacing.xs,
  },
  actionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginTop: spacing.xl,
    flexWrap: 'wrap',
  },
});

export default ReviewsSection;
