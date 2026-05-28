/**
 * ReviewsSection — Airbnb-style "Reviews" block for the property detail.
 *
 * Layout:
 *  - Large rating number + summary line (e.g. "4.8 · 124 reviews").
 *  - 2-column grid of review cards on web, 1-column on mobile.
 *  - "Show all N reviews" Bloom Button when more than `maxVisible`
 *    exist.
 *
 * Migrated to Bloom Typography, Bloom Button, Bloom Skeleton for
 * the loading state. The actual review-card rendering still uses
 * the shared `ReviewCard` component.
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';

import { Button } from '@oxyhq/bloom/button';
import * as Skeleton from '@oxyhq/bloom/skeleton';
import { H1, H2, Text as BloomText } from '@oxyhq/bloom/typography';

import { ReviewCard, type ReviewData } from '@/components/ReviewCard';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { api } from '@/utils/api';
import { colors } from '@/styles/colors';
import { cardShadow, hairline, radius, spacing } from '@/constants/styles';
import type { Property } from '@homiio/shared-types';

interface ReviewsSectionProps {
  property: Property;
  variant?: 'full' | 'preview';
}

interface AggregatedStats {
  averageRating: number;
  totalReviews: number;
  recommendationPercentage: number;
  verifiedCount: number;
  withEvidenceCount: number;
}

type ReviewsResponse = {
  success?: boolean;
  buildingReviews?: ReviewData[];
  unitReviews?: ReviewData[];
  data?: {
    buildingReviews?: ReviewData[];
    unitReviews?: ReviewData[];
  };
};

const normalizeReview = (raw: ReviewData): ReviewData => ({
  ...raw,
  positiveComment: raw.positiveComment ?? '',
  negativeComment: raw.negativeComment ?? '',
  images: raw.images ?? [],
  services: raw.services ?? [],
  isAnonymous: raw.isAnonymous ?? true,
  confidenceScore: raw.confidenceScore ?? 75,
  evidenceAttached: raw.evidenceAttached ?? false,
  flaggedIssues: raw.flaggedIssues ?? [],
  karmaScore: raw.karmaScore ?? 0,
  replyAllowed: raw.replyAllowed ?? true,
  moderationStatus: raw.moderationStatus ?? 'approved',
  helpfulVotes: raw.helpfulVotes ?? 0,
  unhelpfulVotes: raw.unhelpfulVotes ?? 0,
  reportCount: raw.reportCount ?? 0,
  evidenceCount: raw.evidenceCount ?? 0,
});

const computeStats = (reviews: ReviewData[]): AggregatedStats | null => {
  if (reviews.length === 0) return null;
  const avg = reviews.reduce((sum, r) => sum + (r.rating || 0), 0) / reviews.length;
  const recommended = reviews.filter((r) => (r.rating || 0) >= 4).length;
  return {
    averageRating: avg,
    totalReviews: reviews.length,
    recommendationPercentage: (recommended / reviews.length) * 100,
    verifiedCount: reviews.filter((r) => r.verified).length,
    withEvidenceCount: reviews.filter((r) => r.evidenceAttached).length,
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
          · {stats.totalReviews}{' '}
          {t('property.reviews.count', 'reviews') || 'reviews'}
        </BloomText>
      </View>
      <View style={styles.statsRow}>
        <View style={styles.statItem}>
          <BloomText style={styles.statValue}>
            {Math.round(stats.recommendationPercentage)}%
          </BloomText>
          <BloomText style={styles.statLabel}>
            {t('property.reviews.recommend', 'Recommend') || 'Recommend'}
          </BloomText>
        </View>
        <View style={styles.statItem}>
          <BloomText style={styles.statValue}>{stats.verifiedCount}</BloomText>
          <BloomText style={styles.statLabel}>
            {t('property.reviews.verified', 'Verified') || 'Verified'}
          </BloomText>
        </View>
        <View style={styles.statItem}>
          <BloomText style={styles.statValue}>
            {stats.withEvidenceCount}
          </BloomText>
          <BloomText style={styles.statLabel}>
            {t('property.reviews.evidence', 'With evidence') || 'With evidence'}
          </BloomText>
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
  const [reviews, setReviews] = useState<ReviewData[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isPreview = variant === 'preview';
  const maxVisible = isPreview ? 6 : 10;

  // Defensive type extraction — address can land in a few shapes
  // depending on whether the property was hydrated from list vs detail
  // endpoint.
  const addressId = useMemo<string | undefined>(() => {
    const address = property?.address;
    if (!address) return undefined;
    if (typeof address === 'object' && '_id' in address) {
      const id = (address as { _id?: unknown })._id;
      if (typeof id === 'string') return id;
    }
    if (typeof address === 'object' && 'id' in address) {
      const id = (address as { id?: unknown }).id;
      if (typeof id === 'string') return id;
    }
    return undefined;
  }, [property?.address]);

  const fetchReviews = useCallback(async () => {
    if (!addressId) return;
    setLoading(true);
    setError(null);
    try {
      const response = await api.get<ReviewsResponse>(
        `/api/reviews/address/${addressId}`,
      );
      const payload = response.data;
      const responseData = payload?.success ? payload : payload?.data ?? payload;
      const buildingReviews = responseData?.buildingReviews ?? [];
      const unitReviews = responseData?.unitReviews ?? [];
      const all = [...buildingReviews, ...unitReviews].map(normalizeReview);
      setReviews(all);
    } catch (e) {
      const message =
        e instanceof Error ? e.message : 'Unable to load reviews';
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [addressId]);

  useEffect(() => {
    fetchReviews();
  }, [fetchReviews]);

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
    <View style={styles.section}>
      <H2 style={styles.title}>
        {t('property.reviews.title', 'Reviews') || 'Reviews'}
      </H2>
      <BloomText style={styles.disclaimer}>
        {t(
          'property.reviews.disclaimer',
          'Community-verified reviews about the building. Experiences may vary by unit.',
        ) ||
          'Community-verified reviews about the building. Experiences may vary by unit.'}
      </BloomText>

      {loading ? (
        <View style={styles.skeletonGrid}>
          {Array.from({ length: 4 }).map((_, idx) => (
            <View key={idx} style={[styles.skeletonCard, cardShadow.sm]}>
              <Skeleton.Box width="60%" height={14} borderRadius={4} />
              <Skeleton.Box
                width="100%"
                height={12}
                borderRadius={4}
                style={styles.skeletonLine}
              />
              <Skeleton.Box
                width="85%"
                height={12}
                borderRadius={4}
                style={styles.skeletonLine}
              />
              <Skeleton.Box
                width="70%"
                height={12}
                borderRadius={4}
                style={styles.skeletonLine}
              />
            </View>
          ))}
        </View>
      ) : null}

      {error ? (
        <ErrorState
          icon="chatbubbles-outline"
          title={
            t('property.reviews.errorTitle', 'Could not load reviews') ||
            'Could not load reviews'
          }
          description={error}
          retryLabel={t('common.tryAgain', 'Try again') || 'Try again'}
          onRetry={fetchReviews}
        />
      ) : null}

      {!loading && !error && reviews.length === 0 ? (
        <EmptyState
          icon="chatbubbles-outline"
          title={
            t('property.reviews.emptyTitle', 'No reviews yet') ||
            'No reviews yet'
          }
          description={
            t(
              'property.reviews.emptyDescription',
              'Be the first to share what it was like to live here.',
            ) || 'Be the first to share what it was like to live here.'
          }
          actionText={
            t('property.reviews.writeAction', 'Write a review') ||
            'Write a review'
          }
          actionIcon="create-outline"
          onAction={handleWriteReview}
        />
      ) : null}

      {!loading && !error && reviews.length > 0 ? (
        <>
          {stats ? <RatingHeader stats={stats} /> : null}
          <View style={styles.grid}>
            {visibleReviews.map((review) => (
              <View key={review._id} style={styles.gridCell}>
                <ReviewCard
                  review={review}
                  variant={isPreview ? 'compact' : 'default'}
                  showActions={!isPreview}
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
                accessibilityLabel={
                  t(
                    'property.reviews.showAll',
                    `Show all ${reviews.length} reviews`,
                  ) || `Show all ${reviews.length} reviews`
                }
              >
                {t(
                  'property.reviews.showAll',
                  `Show all ${reviews.length} reviews`,
                ) || `Show all ${reviews.length} reviews`}
              </Button>
            ) : null}
            <Button
              onPress={handleWriteReview}
              variant="ghost"
              size="medium"
              icon={
                <Ionicons
                  name="create-outline"
                  size={16}
                  color={colors.COLOR_BLACK}
                />
              }
              iconPosition="left"
              accessibilityLabel={
                t('property.reviews.writeAction', 'Write a review') ||
                'Write a review'
              }
            >
              {t('property.reviews.writeAction', 'Write a review') ||
                'Write a review'}
            </Button>
          </View>
        </>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  section: {
    marginTop: spacing['3xl'],
    marginBottom: spacing['3xl'],
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: colors.COLOR_BLACK,
    marginBottom: spacing.sm,
  },
  disclaimer: {
    fontSize: 13,
    color: colors.COLOR_BLACK_LIGHT_3,
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
    backgroundColor: colors.surfaceElevated,
    borderRadius: radius.lg,
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
