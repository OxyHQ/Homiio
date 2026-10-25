import { ApiError } from '@/utils/api';
/**
 * Agency profile — an agency's aggregate reputation, reviews, and listings.
 *
 * Header: the name, then Bloom's `PlaceReviewSummary` (the real average and
 * count, with the recommend and deposit-back shares above the publication
 * floor; "no rating yet" when the agency has no reviews) and a listings tile.
 * Bloom `Tabs`: Reviews
 * (paginated `useAgencyReviews`, each review linking to its address page) and
 * Listings (paginated `useAgencyProperties` rendered with the shared
 * `PropertyResultsGrid`). The active tab's list pages through
 * `ScreenScrollView`'s `onEndReached`.
 */
import type React from 'react';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { AppShellMenuButton } from '@oxy.so/bloom/app-shell';
import { Button } from '@oxy.so/bloom/button';
import { Card } from '@oxy.so/bloom/card';
import { RiArrowRightSLine } from '@oxy.so/bloom/icons/RiArrowRightSLine';
import { RiBuilding2Line } from '@oxy.so/bloom/icons/RiBuilding2Line';
import { RiDiscussLine } from '@oxy.so/bloom/icons/RiDiscussLine';
import { RiHomeLine } from '@oxy.so/bloom/icons/RiHomeLine';
import { RiMapPinLine } from '@oxy.so/bloom/icons/RiMapPinLine';
import { PageHeader } from '@oxy.so/bloom/page-header';
import { Screen, ScreenScrollView } from '@oxy.so/bloom/screen';
import * as Skeleton from '@oxy.so/bloom/skeleton';
import { Rating } from '@oxy.so/bloom/rating';
import { Tabs, TabsTrigger } from '@oxy.so/bloom/tabs';
import { useTheme } from '@oxy.so/bloom/theme';
import { H1, Text as BloomText } from '@oxy.so/bloom/typography';

import { ReviewCard } from '@/components/ReviewCard';
import {
  AGGREGATE_MIN_AUTHORS,
  AGGREGATE_MIN_RECORDS,
  PlaceReviewsSummary,
} from '@/components/reviews/PlaceReviewsSummary';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { PropertyResultsGrid } from '@/components/ui/PropertyResultsGrid';
import { useAgency, useAgencyReviews, useAgencyProperties } from '@/hooks/useAgencyReviews';
import { useOxyAvatars } from '@/hooks/useOxyAvatars';
import type { ReviewDTO } from '@homiio/shared-types';
import type { User } from '@oxy.so/core';
import { hairline, radius, spacing } from '@/constants/styles';

type AgencyTab = 'reviews' | 'listings';

interface StatTileProps {
  value: string;
  label: string;
}

const StatTile: React.FC<StatTileProps> = ({ value, label }) => (
  <Card radius="radius-12" style={styles.statTile} appearance="outline">
    <BloomText style={styles.statValue}>{value}</BloomText>
    <BloomText className="text-muted-foreground" style={styles.statLabel}>
      {label}
    </BloomText>
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
    <View className="border-border" style={styles.reviewItem}>
      <Button
        size="sm"
        leadingIcon={RiMapPinLine}
        trailingIcon={RiArrowRightSLine}
        onPress={onPressAddress}
        accessibilityLabel={label}
        style={styles.addressLink}
        tone="accent"
        appearance="subtle"
      >
        {label}
      </Button>
      <ReviewCard review={review} author={author} />
    </View>
  );
};

export default function AgencyProfileScreen() {
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

  const agency = agencyQuery.data?.agency;
  const stats = agencyQuery.data?.stats;
  const title = agency?.name ?? t('agency.title');
  const header = (
    <PageHeader
      title={title}
      titleAlign="center"
      leading={<AppShellMenuButton accessibilityLabel={t('sidebar.open')} />}
      onBack={router.canGoBack() ? router.back : undefined}
      backLabel={t('goBack')}
    />
  );

  if (agencyQuery.isLoading) {
    return (
      <Screen documentScroll header={header}>
        <ScreenScrollView contentContainerStyle={styles.content}>
          <Skeleton.Box width="60%" height={28} borderRadius={radius.md} />
          <Skeleton.Box width="100%" height={80} borderRadius={radius.md} />
        </ScreenScrollView>
      </Screen>
    );
  }

  if (agencyQuery.isError || !agency || !stats) {
    return (
      <Screen documentScroll header={header}>
        <ScreenScrollView>
          <ErrorState
            icon={RiBuilding2Line}
            title={t('agency.notFound')}
            description={
              agencyQuery.error instanceof ApiError && agencyQuery.error.status === 409
                ? t('agencyDirectory.unresolved')
                : t('agency.notFoundDescription')
            }
            retryLabel={t('common.goBack')}
            onRetry={() => router.back()}
          />
        </ScreenScrollView>
      </Screen>
    );
  }

  const hasReviews = stats.totalReviews > 0;
  // ADR 0003 §4.4 wants BOTH halves: enough records AND enough distinct
  // authors. The author count is the server's (`AgencyStats.distinctAuthors`),
  // counted over the real `oxy_user_id`, because this set spans several
  // buildings and a published pseudonym is stable per BUILDING — one person who
  // reviewed three of an agency's blocks would read as three people here and
  // lift the set over a floor it does not clear. `?? 0` withholds rather than
  // publishes when an older API answers without the field.
  const publishShares =
    stats.totalReviews >= AGGREGATE_MIN_RECORDS &&
    (stats.distinctAuthors ?? 0) >= AGGREGATE_MIN_AUTHORS;

  return (
    <Screen documentScroll header={header}>
      <ScreenScrollView
        contentContainerStyle={styles.content}
        onEndReached={tab === 'reviews' ? loadMoreReviews : loadMoreProperties}
      >
        <View style={styles.headerBlock}>
          <View style={[styles.agencyIcon, { backgroundColor: theme.colors.primarySubtle }]}>
            <RiBuilding2Line width={28} height={28} fill={theme.colors.primary} />
          </View>
          <View style={styles.agencyTitle}>
            <H1 style={styles.agencyName}>{agency.name}</H1>
            {hasReviews ? null : (
              <Rating
                value={null}
                count={0}
                newLabel={t('reviews.write.ratingNone')}
                accessibilityLabel={t('reviews.write.ratingNone')}
              />
            )}
          </View>
        </View>

        {hasReviews ? (
          <PlaceReviewsSummary
            stats={{
              averageRating: stats.averageRating,
              totalReviews: stats.totalReviews,
              // Shares publish only above the aggregate floor — see
              // `publishShares` above for which halves it checks and why the
              // author count has to be the server's.
              ...(publishShares
                ? {
                    recommendRate: stats.recommendationPercentage / 100,
                    ...(typeof stats.depositFullPct === 'number'
                      ? { depositReturnedRate: stats.depositFullPct / 100 }
                      : {}),
                  }
                : {}),
            }}
          />
        ) : null}

        {typeof stats.listingsCount === 'number' ? (
          <View style={styles.statsRow}>
            <StatTile value={String(stats.listingsCount)} label={t('agency.stats.listings')} />
          </View>
        ) : null}

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
                  author={review.oxyUserId ? usersById.get(review.oxyUserId) : undefined}
                  onPressAddress={() => router.push(`/addresses/${review.addressId}?tab=reviews`)}
                />
              ))}
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
          <PropertyResultsGrid
            properties={properties}
            onPropertyPress={(property) => router.push(`/properties/${property.id}`)}
          />
        )}
      </ScreenScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
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
    letterSpacing: -0.4,
  },
  statLabel: {
    fontSize: 11,
    fontWeight: '600',
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
    paddingBottom: spacing.lg,
  },
  addressLink: {
    alignSelf: 'flex-start',
  },
});
