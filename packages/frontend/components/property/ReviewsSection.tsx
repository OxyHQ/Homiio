/**
 * ReviewsSection — the reviews of the listing's ADDRESS on the property detail.
 *
 * Reviews are about the place, not the advertisement (ADR 0001): they outlive
 * every listing that points at the address, so this section reads the shared
 * `['addressReviews', addressId]` cache via `useAddressReviews` and links out to
 * the address page for the full set.
 *
 * Layout, on Bloom's `place-reviews`:
 *  - `PlaceReviewsSummary` (`PlaceReviewSummary`): the average, the count, and
 *    the tenancy stat lines once the set clears the publication floor.
 *  - A 2-column grid of `ReviewCard`s on web, 1-column on mobile. The card stays
 *    Homiio's: `PlaceReviewCard` has no room for a review's title, pros and
 *    cons, categorical answers, advice, agency or photos.
 *  - "Show all N reviews" when more than `maxVisible` exist.
 *  - `WriteReviewPrompt`, inviting a past resident to add theirs — the whole
 *    body while there are no reviews yet.
 *
 * Authors are hydrated ONCE (`useOxyAvatars`).
 */
import React, { useMemo } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { RiDiscussLine } from '@oxy.so/bloom/icons';

import { Button } from '@oxy.so/bloom/button';
import { WriteReviewPrompt } from '@oxy.so/bloom/place-reviews';
import * as Skeleton from '@oxy.so/bloom/skeleton';
import { Text as BloomText } from '@oxy.so/bloom/typography';

import { ReviewCard } from '@/components/ReviewCard';
import { PlaceReviewsSummary, placeReviewStats } from '@/components/reviews/PlaceReviewsSummary';
import { ErrorState } from '@/components/ui/ErrorState';
import { SectionHeader, SECTION_GUTTER } from '@/components/property/Section';
import { useAddressReviews } from '@/hooks/useAddressReviews';
import { useOxyAvatars } from '@/hooks/useOxyAvatars';
import { getPropertyLocationLabel } from '@/utils/propertyUtils';
import { colors } from '@/styles/colors';
import { radius, spacing } from '@/constants/styles';
import type { Property } from '@homiio/shared-types';

interface ReviewsSectionProps {
  property: Property;
  variant?: 'full' | 'preview';
}

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
      : t('property.reviews.errorTitle')
    : null;

  const stats = useMemo(() => placeReviewStats(reviews), [reviews]);
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

  const place = property.address?.street || getPropertyLocationLabel(property) || '';
  const writePrompt = (
    <WriteReviewPrompt
      buildingTitle={place}
      title={t('reviews.prompt.title')}
      description={
        place ? t('reviews.prompt.description', { place }) : t('property.reviews.emptyDescription')
      }
      actionLabel={t('property.reviews.writeAction')}
      onStart={handleWriteReview}
    />
  );

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
            icon={RiDiscussLine}
            title={t('property.reviews.errorTitle')}
            description={error}
            retryLabel={t('common.tryAgain')}
            onRetry={() => {
              refetch();
            }}
          />
        ) : null}

        {!loading && !error && reviews.length === 0 ? writePrompt : null}

        {!loading && !error && reviews.length > 0 ? (
          <View style={styles.stack}>
            <PlaceReviewsSummary stats={stats} />
            <View style={styles.grid}>
              {visibleReviews.map((review) => (
                <View key={review.id} style={styles.gridCell}>
                  <ReviewCard
                    review={review}
                    author={review.oxyUserId ? usersById.get(review.oxyUserId) : undefined}
                    onPressAgency={(slug) => router.push(`/agency/${slug}`)}
                  />
                </View>
              ))}
            </View>
            {reviews.length > maxVisible ? (
              <View style={styles.actionsRow}>
                <Button
                  onPress={handleViewAll}
                  variant="secondary"
                  size="medium"
                  accessibilityLabel={t('property.reviews.showAll', { count: reviews.length })}
                >
                  {t('property.reviews.showAll', { count: reviews.length })}
                </Button>
              </View>
            ) : null}
            {writePrompt}
          </View>
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
  stack: {
    gap: spacing.xl,
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
    flexWrap: 'wrap',
  },
});

export default ReviewsSection;
