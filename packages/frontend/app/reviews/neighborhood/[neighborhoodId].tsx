/**
 * Review explore — a neighborhood's reviewed buildings (street + number, review
 * count, average rating, recommend %). Paginated via `LoadMoreSentinel` at the
 * end of the list (the shell owns scrolling). Tapping a building opens its
 * address page on the reviews tab.
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { AppShellMenuButton } from '@oxy.so/bloom/app-shell';
import { PageHeader } from '@oxy.so/bloom/page-header';
import * as Skeleton from '@oxy.so/bloom/skeleton';

import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { ExploreList, ExploreRow } from '@/components/reviews/ExploreRow';
import { LoadMoreSentinel } from '@/components/common/LoadMoreSentinel';
import { useExploreNeighborhood } from '@/hooks/useExploreReviews';
import { radius, spacing } from '@/constants/styles';
import { RiAlertLine, RiBuilding2Line } from '@oxy.so/bloom/icons';

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

  const buildingTitle = (street: string, number?: string) =>
    number ? `${street}, ${number}` : street;

  return (
    <>
      <PageHeader
        title={t('reviews.explore.buildingsTitle')}
        titleAlign="center"
        leading={<AppShellMenuButton accessibilityLabel={t('sidebar.open')} />}
        onBack={router.canGoBack() ? router.back : undefined}
        backLabel={t('goBack')}
      />
      <View style={styles.content}>
        {query.isLoading ? (
          <View style={styles.list}>
            {Array.from({ length: 6 }).map((_, idx) => (
              <Skeleton.Box key={idx} width="100%" height={56} borderRadius={radius.md} />
            ))}
          </View>
        ) : query.isError ? (
          <ErrorState
            icon={RiAlertLine}
            title={t('reviews.explore.errorTitle')}
            description={t('reviews.explore.errorDescription')}
            retryLabel={t('common.tryAgain')}
            onRetry={() => query.refetch()}
          />
        ) : buildings.length === 0 ? (
          <EmptyState
            icon={RiBuilding2Line}
            title={t('reviews.explore.emptyBuildingsTitle')}
            description={t('reviews.explore.emptyBuildingsDescription')}
          />
        ) : (
          <>
            <ExploreList>
              {buildings.map((building) => (
                <ExploreRow
                  key={building.buildingLevelId}
                  title={buildingTitle(building.street, building.number)}
                  subtitle={t('reviews.explore.buildingMeta', {
                    count: building.reviewCount,
                    recommend: Math.round(building.recommendationPercentage),
                  })}
                  rating={building.averageRating}
                  onPress={() => router.push(`/addresses/${building.buildingLevelId}?tab=reviews`)}
                />
              ))}
            </ExploreList>
            <LoadMoreSentinel onLoadMore={loadMore} enabled={Boolean(query.hasNextPage)} />
          </>
        )}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  content: {
    padding: spacing.lg,
    gap: spacing.md,
    paddingBottom: spacing['4xl'],
  },
  list: {
    gap: spacing.sm,
  },
});
