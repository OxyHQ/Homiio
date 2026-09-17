/**
 * Agency profile — an agency's aggregate reputation, reviews, and listings.
 *
 * Header: name over a Bloom `Rating` (the real average + review count; "no
 * rating yet" when the agency has no reviews) + stat tiles on Bloom `Card`s
 * (recommend % and deposit-full % only when there are reviews, listings count). Bloom `Tabs`: Reviews
 * (paginated `useAgencyReviews`, each review linking to its address page) and
 * Listings (paginated `useAgencyProperties` rendered with the shared
 * `PropertyResultsGrid`). Infinite scroll wires BOTH primitives —
 * `LoadMoreSentinel` (web) + `useInfiniteScroll` (native).
 */
import React, { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { Button } from '@oxy.so/bloom/button';
import { Card } from '@oxy.so/bloom/card';
import {
  RiArrowRightSLine,
  RiBuilding2Line,
  RiDiscussLine,
  RiHomeLine,
  RiMapPinLine,
} from '@oxy.so/bloom/icons';
import * as Skeleton from '@oxy.so/bloom/skeleton';
import { Rating } from '@oxy.so/bloom/rating';
import { Tabs, TabsTrigger } from '@oxy.so/bloom/tabs';
import { useTheme } from '@oxy.so/bloom/theme';
import { H1, Text as BloomText } from '@oxy.so/bloom/typography';

import { formatPercentage } from '@homiio/shared-types';
import { Header } from '@/components/Header';
import { useFormatting } from '@/utils/format';
import { ReviewCard } from '@/components/ReviewCard';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { PropertyResultsGrid } from '@/components/ui/PropertyResultsGrid';
import { LoadMoreSentinel } from '@/components/common/LoadMoreSentinel';
import { useAgency, useAgencyReviews, useAgencyProperties } from '@/hooks/useAgencyReviews';
import { useOxyAvatars } from '@/hooks/useOxyAvatars';
import { useInfiniteScroll } from '@/hooks/useInfiniteScroll';
import type { ReviewDTO } from '@homiio/shared-types';
import type { User } from '@oxy.so/core';
import { colors } from '@/styles/colors';
import { hairline, radius, spacing } from '@/constants/styles';

type AgencyTab = 'reviews' | 'listings';

interface StatTileProps {
  value: string;
  label: string;
}

const StatTile: React.FC<StatTileProps> = ({ value, label }) => (
  <Card variant="outlined" radius="radius-12" style={styles.statTile}>
    <BloomText style={styles.statValue}>{value}</BloomText>
    <BloomText style={styles.statLabel}>{label}</BloomText>
  </Card>
);

interface AgencyReviewItemProps {
  review: ReviewDTO;
  author?: User;
  onPressAddress: () => void;
}

/** One agency review — a Bloom link `Button` to its address above the review card. */
const AgencyReviewItem: React.FC<AgencyReviewItemProps> = ({ review, author, onPressAddress }) => {
  const { t } = useTranslation();
  const label = review.populatedAddress?.street || t('agency.viewAddress');
  return (
    <View style={styles.reviewItem}>
      <Button
        variant="ghost"
        size="small"
        leadingIcon={RiMapPinLine}
        trailingIcon={RiArrowRightSLine}
        onPress={onPressAddress}
        accessibilityLabel={label}
        style={styles.addressLink}
      >
        {label}
      </Button>
      <ReviewCard review={review} author={author} />
    </View>
  );
};

export default function AgencyProfileScreen() {
  const { locale } = useFormatting();
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const router = useRouter();
  const { t } = useTranslation();
  const theme = useTheme();
  const [tab, setTab] = useState<AgencyTab>('reviews');

  const agencyQuery = useAgency(slug);
  const reviewsQuery = useAgencyReviews(slug);
  const propertiesQuery = useAgencyProperties(slug);

  const reviews = reviewsQuery.reviews;
  const properties = propertiesQuery.properties;
  const { usersById } = useOxyAvatars(reviews.map((review) => review.oxyUserId));

  const loadMoreReviews = () => {
    if (reviewsQuery.hasNextPage && !reviewsQuery.isFetchingNextPage) {
      reviewsQuery.fetchNextPage();
    }
  };
  const loadMoreProperties = () => {
    if (propertiesQuery.hasNextPage && !propertiesQuery.isFetchingNextPage) {
      propertiesQuery.fetchNextPage();
    }
  };

  const onReviewsTab = tab === 'reviews';
  const { onScroll } = useInfiniteScroll({
    onEndReached: onReviewsTab ? loadMoreReviews : loadMoreProperties,
    enabled: onReviewsTab
      ? Boolean(reviewsQuery.hasNextPage)
      : Boolean(propertiesQuery.hasNextPage),
  });

  const agency = agencyQuery.data?.agency;
  const stats = agencyQuery.data?.stats;
  const title = agency?.name ?? t('agency.title');

  if (agencyQuery.isLoading) {
    return (
      <View style={styles.root}>
        <Header options={{ title: t('agency.title'), showBackButton: true }} />
        <View style={styles.content}>
          <Skeleton.Box width="60%" height={28} borderRadius={radius.md} />
          <Skeleton.Box width="100%" height={80} borderRadius={radius.md} />
        </View>
      </View>
    );
  }

  if (agencyQuery.isError || !agency || !stats) {
    return (
      <View style={styles.root}>
        <Header options={{ title: t('agency.title'), showBackButton: true }} />
        <ErrorState
          icon={RiBuilding2Line}
          title={t('agency.notFound')}
          description={t('agency.notFoundDescription')}
          retryLabel={t('common.goBack')}
          onRetry={() => router.back()}
        />
      </View>
    );
  }

  const hasReviews = stats.totalReviews > 0;

  return (
    <View style={styles.root}>
      <Header options={{ title, showBackButton: true }} />
      <SafeAreaView edges={['bottom']} style={styles.safeArea}>
        <ScrollView
          contentContainerStyle={styles.content}
          onScroll={onScroll}
          scrollEventThrottle={16}
        >
          <View style={styles.headerBlock}>
            <View style={[styles.agencyIcon, { backgroundColor: theme.colors.primarySubtle }]}>
              <RiBuilding2Line width={28} height={28} fill={theme.colors.primary} />
            </View>
            <View style={styles.agencyTitle}>
              <H1 style={styles.agencyName}>{agency.name}</H1>
              <Rating
                value={hasReviews ? stats.averageRating : null}
                count={stats.totalReviews}
                newLabel={t('reviews.write.ratingNone')}
                accessibilityLabel={
                  hasReviews
                    ? `${t('reviews.ratingA11y', {
                        rating: Number(stats.averageRating.toFixed(2)),
                      })}, ${t('reviews.explore.reviewCount', { count: stats.totalReviews })}`
                    : t('reviews.write.ratingNone')
                }
              />
            </View>
          </View>

          <View style={styles.statsRow}>
            {/* Review-derived shares are 0 when there are no reviews — not a real 0%. */}
            {hasReviews ? (
              <StatTile
                value={formatPercentage(stats.recommendationPercentage, locale, {
                  input: 'percent',
                  maximumFractionDigits: 0,
                })}
                label={t('agency.stats.recommend')}
              />
            ) : null}
            {hasReviews && typeof stats.depositFullPct === 'number' ? (
              <StatTile
                value={formatPercentage(stats.depositFullPct, locale, {
                  input: 'percent',
                  maximumFractionDigits: 0,
                })}
                label={t('agency.stats.depositFull')}
              />
            ) : null}
            {typeof stats.listingsCount === 'number' ? (
              <StatTile value={String(stats.listingsCount)} label={t('agency.stats.listings')} />
            ) : null}
          </View>

          <Tabs value={tab} onValueChange={(next) => setTab(next as AgencyTab)}>
            <TabsTrigger value="reviews" label={t('agency.tabs.reviews')} />
            <TabsTrigger value="listings" label={t('agency.tabs.listings')} />
          </Tabs>

          {tab === 'reviews' ? (
            reviewsQuery.isLoading ? (
              <Skeleton.Box width="100%" height={120} borderRadius={radius.md} />
            ) : reviews.length === 0 ? (
              <EmptyState
                icon={RiDiscussLine}
                title={t('agency.emptyReviewsTitle')}
                description={t('agency.emptyReviewsDescription')}
              />
            ) : (
              <View style={styles.reviewsList}>
                {reviews.map((review) => (
                  <AgencyReviewItem
                    key={review.id}
                    review={review}
                    author={usersById.get(review.oxyUserId)}
                    onPressAddress={() =>
                      router.push(`/addresses/${review.addressId}?tab=reviews`)
                    }
                  />
                ))}
                <LoadMoreSentinel
                  onLoadMore={loadMoreReviews}
                  enabled={Boolean(reviewsQuery.hasNextPage)}
                />
              </View>
            )
          ) : propertiesQuery.isLoading ? (
            <Skeleton.Box width="100%" height={200} borderRadius={radius.md} />
          ) : properties.length === 0 ? (
            <EmptyState
              icon={RiHomeLine}
              title={t('agency.emptyListingsTitle')}
              description={t('agency.emptyListingsDescription')}
            />
          ) : (
            <View>
              <PropertyResultsGrid
                properties={properties}
                onPropertyPress={(property) => router.push(`/properties/${property.id}`)}
              />
              <LoadMoreSentinel
                onLoadMore={loadMoreProperties}
                enabled={Boolean(propertiesQuery.hasNextPage)}
              />
            </View>
          )}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  safeArea: {
    flex: 1,
  },
  content: {
    padding: spacing.lg,
    gap: spacing.lg,
    paddingBottom: spacing['4xl'],
  },
  headerBlock: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  agencyIcon: {
    width: 56,
    height: 56,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  agencyTitle: {
    flex: 1,
    gap: spacing.xs,
  },
  agencyName: {
    textAlign: 'left',
    letterSpacing: -0.5,
  },
  statsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  statTile: {
    flexGrow: 1,
    minWidth: 96,
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
  },
  statValue: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.COLOR_BLACK,
    letterSpacing: -0.4,
  },
  statLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: colors.COLOR_BLACK_LIGHT_3,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    textAlign: 'center',
  },
  reviewsList: {
    gap: spacing.lg,
  },
  reviewItem: {
    gap: spacing.xs,
    borderBottomWidth: hairline.width,
    borderBottomColor: hairline.color,
    paddingBottom: spacing.lg,
  },
  addressLink: {
    alignSelf: 'flex-start',
  },
});
