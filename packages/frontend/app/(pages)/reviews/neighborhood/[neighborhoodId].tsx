/**
 * Review explore — a neighborhood's reviewed buildings (street + number, review
 * count, average rating, recommend %). Paginated through `ScreenScrollView`'s
 * `onEndReached`. Tapping a building opens its
 * address page on the reviews tab.
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { AppShellMenuButton } from '@oxy.so/bloom/app-shell';
import { PageHeader } from '@oxy.so/bloom/page-header';
import { Screen, ScreenScrollView } from '@oxy.so/bloom/screen';
import * as Skeleton from '@oxy.so/bloom/skeleton';

import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { ExploreList, ExploreRow } from '@/components/reviews/ExploreRow';
import { useExploreNeighborhood } from '@/hooks/useExploreReviews';
import { radius, spacing } from '@/constants/styles';
import { RiAlertLine } from '@oxy.so/bloom/icons/RiAlertLine';
import { RiBuilding2Line } from '@oxy.so/bloom/icons/RiBuilding2Line';

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
    <Screen
      documentScroll
      header={
        <PageHeader
          title={t('reviews.explore.buildingsTitle')}
          titleAlign="center"
          leading={<AppShellMenuButton accessibilityLabel={t('sidebar.open')} />}
          onBack={router.canGoBack() ? router.back : undefined}
          backLabel={t('goBack')}
        />
      }
    >
      <ScreenScrollView contentContainerStyle={styles.content} onEndReached={loadMore}>
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
        )}
      </ScreenScrollView>
    </Screen>
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
