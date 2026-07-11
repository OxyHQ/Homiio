/**
 * Agency profile — an agency's aggregate reputation, reviews, and listings.
 *
 * Header: name + stat tiles (avg rating, total reviews, recommend %, deposit-full
 * %, listings count). Tabs: Reviews (paginated `useAgencyReviews`, each review
 * linking to its address page) and Listings (paginated `useAgencyProperties`
 * rendered with the shared `PropertyResultsGrid`). Infinite scroll wires BOTH
 * primitives — `LoadMoreSentinel` (web) + `useInfiniteScroll` (native).
 */
import React, { useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';

import * as Skeleton from '@oxyhq/bloom/skeleton';
import { H1, Text as BloomText } from '@oxyhq/bloom/typography';

import { Header } from '@/components/Header';
import { ReviewCard } from '@/components/ReviewCard';
import { ReviewTabPill } from '@/components/reviews/ReviewTabPill';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { PropertyResultsGrid } from '@/components/ui/PropertyResultsGrid';
import { LoadMoreSentinel } from '@/components/common/LoadMoreSentinel';
import { useAgency, useAgencyReviews, useAgencyProperties } from '@/hooks/useAgencyReviews';
import { useOxyAvatars } from '@/hooks/useOxyAvatars';
import { useInfiniteScroll } from '@/hooks/useInfiniteScroll';
import type { ReviewDTO } from '@homiio/shared-types';
import type { User } from '@oxyhq/core';
import { colors } from '@/styles/colors';
import { hairline, radius, spacing } from '@/constants/styles';

const IS_WEB = Platform.OS === 'web';

type AgencyTab = 'reviews' | 'listings';

interface StatTileProps {
  value: string;
  label: string;
}

const StatTile: React.FC<StatTileProps> = ({ value, label }) => (
  <View style={styles.statTile}>
    <BloomText style={styles.statValue}>{value}</BloomText>
    <BloomText style={styles.statLabel}>{label}</BloomText>
  </View>
);

interface AgencyReviewItemProps {
  review: ReviewDTO;
  author?: User;
  onPressAddress: () => void;
}

/** One agency review — an address link (own press state) above the review card. */
const AgencyReviewItem: React.FC<AgencyReviewItemProps> = ({ review, author, onPressAddress }) => {
  const { t } = useTranslation();
  const [pressed, setPressed] = useState(false);
  const [hovered, setHovered] = useState(false);
  const label = review.populatedAddress?.street || t('agency.viewAddress');
  return (
    <View style={styles.reviewItem}>
      <Pressable
        onPress={onPressAddress}
        onPressIn={() => setPressed(true)}
        onPressOut={() => setPressed(false)}
        onHoverIn={IS_WEB ? () => setHovered(true) : undefined}
        onHoverOut={IS_WEB ? () => setHovered(false) : undefined}
        accessibilityRole="link"
        accessibilityLabel={label}
        style={[styles.addressLink, (pressed || hovered) && styles.addressLinkActive]}
      >
        <Ionicons name="location-outline" size={14} color={colors.primaryColor} />
        <BloomText style={styles.addressLinkText}>{label}</BloomText>
        <Ionicons name="chevron-forward" size={13} color={colors.primaryColor} />
      </Pressable>
      <ReviewCard review={review} author={author} />
    </View>
  );
};

export default function AgencyProfileScreen() {
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const router = useRouter();
  const { t } = useTranslation();
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
          icon="business-outline"
          title={t('agency.notFound')}
          description={t('agency.notFoundDescription')}
          retryLabel={t('common.goBack')}
          onRetry={() => router.back()}
        />
      </View>
    );
  }

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
            <View style={styles.agencyIcon}>
              <Ionicons name="business" size={28} color={colors.primaryColor} />
            </View>
            <H1 style={styles.agencyName}>{agency.name}</H1>
          </View>

          <View style={styles.statsRow}>
            <StatTile value={stats.averageRating.toFixed(1)} label={t('agency.stats.rating')} />
            <StatTile value={String(stats.totalReviews)} label={t('agency.stats.reviews')} />
            <StatTile
              value={`${Math.round(stats.recommendationPercentage)}%`}
              label={t('agency.stats.recommend')}
            />
            {typeof stats.depositFullPct === 'number' ? (
              <StatTile
                value={`${Math.round(stats.depositFullPct)}%`}
                label={t('agency.stats.depositFull')}
              />
            ) : null}
            {typeof stats.listingsCount === 'number' ? (
              <StatTile value={String(stats.listingsCount)} label={t('agency.stats.listings')} />
            ) : null}
          </View>

          <View style={styles.tabsRow}>
            <ReviewTabPill
              label={t('agency.tabs.reviews')}
              active={tab === 'reviews'}
              onPress={() => setTab('reviews')}
            />
            <ReviewTabPill
              label={t('agency.tabs.listings')}
              active={tab === 'listings'}
              onPress={() => setTab('listings')}
            />
          </View>

          {tab === 'reviews' ? (
            reviewsQuery.isLoading ? (
              <Skeleton.Box width="100%" height={120} borderRadius={radius.md} />
            ) : reviews.length === 0 ? (
              <EmptyState
                icon="chatbubbles-outline"
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
              icon="home-outline"
              title={t('agency.emptyListingsTitle')}
              description={t('agency.emptyListingsDescription')}
            />
          ) : (
            <View>
              <PropertyResultsGrid
                properties={properties}
                onPropertyPress={(property) => router.push(`/properties/${property._id}`)}
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
    backgroundColor: colors.primaryLight_2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  agencyName: {
    flex: 1,
    fontSize: 26,
    fontWeight: '700',
    color: colors.COLOR_BLACK,
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
    borderRadius: radius.md,
    borderWidth: hairline.width,
    borderColor: colors.COLOR_BLACK_LIGHT_6,
    backgroundColor: colors.surfaceElevated,
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
  tabsRow: {
    flexDirection: 'row',
    gap: spacing.sm,
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
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radius.md,
  },
  addressLinkActive: {
    backgroundColor: colors.COLOR_BLACK_LIGHT_7,
  },
  addressLinkText: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.primaryColor,
  },
});
