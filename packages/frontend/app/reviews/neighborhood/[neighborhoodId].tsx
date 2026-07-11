/**
 * Review explore — a neighborhood's reviewed buildings (street + number, review
 * count, average rating, recommend %). Paginated: infinite scroll wires BOTH
 * primitives — `LoadMoreSentinel` (web) + `useInfiniteScroll` (native). Tapping a
 * building opens its address page on the reviews tab.
 */
import React from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import * as Skeleton from '@oxyhq/bloom/skeleton';

import { Header } from '@/components/Header';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { ExploreRow } from '@/components/reviews/ExploreRow';
import { LoadMoreSentinel } from '@/components/common/LoadMoreSentinel';
import { useExploreNeighborhood } from '@/hooks/useExploreReviews';
import { useInfiniteScroll } from '@/hooks/useInfiniteScroll';
import { colors } from '@/styles/colors';
import { radius, spacing } from '@/constants/styles';

export default function ReviewExploreNeighborhoodScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const { neighborhoodId } = useLocalSearchParams<{ neighborhoodId: string }>();
  const query = useExploreNeighborhood(neighborhoodId);
  const buildings = query.buildings;

  const loadMore = () => {
    if (query.hasNextPage && !query.isFetchingNextPage) {
      query.fetchNextPage();
    }
  };

  const { onScroll } = useInfiniteScroll({
    onEndReached: loadMore,
    enabled: Boolean(query.hasNextPage),
  });

  const buildingTitle = (street: string, number?: string) =>
    number ? `${street}, ${number}` : street;

  return (
    <View style={styles.root}>
      <Header options={{ title: t('reviews.explore.buildingsTitle'), showBackButton: true }} />
      <SafeAreaView edges={['bottom']} style={styles.safeArea}>
        <ScrollView
          contentContainerStyle={styles.content}
          onScroll={onScroll}
          scrollEventThrottle={16}
        >
          {query.isLoading ? (
            <View style={styles.list}>
              {Array.from({ length: 6 }).map((_, idx) => (
                <Skeleton.Box key={idx} width="100%" height={56} borderRadius={radius.md} />
              ))}
            </View>
          ) : query.isError ? (
            <ErrorState
              icon="cloud-offline-outline"
              title={t('reviews.explore.errorTitle')}
              description={t('reviews.explore.errorDescription')}
              retryLabel={t('common.tryAgain')}
              onRetry={() => query.refetch()}
            />
          ) : buildings.length === 0 ? (
            <EmptyState
              icon="business-outline"
              title={t('reviews.explore.emptyBuildingsTitle')}
              description={t('reviews.explore.emptyBuildingsDescription')}
            />
          ) : (
            <View style={styles.list}>
              {buildings.map((building) => (
                <ExploreRow
                  key={building.buildingLevelId}
                  title={buildingTitle(building.street, building.number)}
                  subtitle={t('reviews.explore.buildingMeta', {
                    count: building.reviewCount,
                    recommend: Math.round(building.recommendationPercentage),
                  })}
                  rightLabel={`${building.averageRating.toFixed(1)} ★`}
                  onPress={() =>
                    router.push(`/addresses/${building.buildingLevelId}?tab=reviews`)
                  }
                />
              ))}
              <LoadMoreSentinel onLoadMore={loadMore} enabled={Boolean(query.hasNextPage)} />
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
    gap: spacing.md,
    paddingBottom: spacing['4xl'],
  },
  list: {
    gap: spacing.sm,
  },
});
