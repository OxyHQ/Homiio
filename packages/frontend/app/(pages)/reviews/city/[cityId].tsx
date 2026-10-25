/**
 * Review explore — a city's neighborhoods (name + review count + average
 * rating). Tapping a neighborhood drills into its reviewed buildings.
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
import { useExploreCity } from '@/hooks/useExploreReviews';
import { radius, spacing } from '@/constants/styles';
import { RiAlertLine } from '@oxy.so/bloom/icons/RiAlertLine';
import { RiMapPinLine } from '@oxy.so/bloom/icons/RiMapPinLine';

export default function ReviewExploreCityScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const { cityId } = useLocalSearchParams<{ cityId: string }>();
  const cityQuery = useExploreCity(cityId);
  const neighborhoods = cityQuery.data ?? [];

  return (
    <Screen
      documentScroll
      header={
        <PageHeader
          title={t('reviews.explore.neighborhoodsTitle')}
          titleAlign="center"
          leading={<AppShellMenuButton accessibilityLabel={t('sidebar.open')} />}
          onBack={router.canGoBack() ? router.back : undefined}
          backLabel={t('goBack')}
        />
      }
    >
      <ScreenScrollView contentContainerStyle={styles.content}>
        {cityQuery.isLoading ? (
          <View style={styles.list}>
            {Array.from({ length: 5 }).map((_, idx) => (
              <Skeleton.Box key={idx} width="100%" height={56} borderRadius={radius.md} />
            ))}
          </View>
        ) : cityQuery.isError ? (
          <ErrorState
            icon={RiAlertLine}
            title={t('reviews.explore.errorTitle')}
            description={t('reviews.explore.errorDescription')}
            retryLabel={t('common.tryAgain')}
            onRetry={() => cityQuery.refetch()}
          />
        ) : neighborhoods.length === 0 ? (
          <EmptyState
            icon={RiMapPinLine}
            title={t('reviews.explore.emptyNeighborhoodsTitle')}
            description={t('reviews.explore.emptyNeighborhoodsDescription')}
          />
        ) : (
          <ExploreList>
            {neighborhoods.map((neighborhood) => (
              <ExploreRow
                key={neighborhood.neighborhoodId}
                title={neighborhood.name}
                subtitle={t('reviews.explore.reviewCount', { count: neighborhood.reviewCount })}
                rating={neighborhood.averageRating}
                onPress={() => router.push(`/reviews/neighborhood/${neighborhood.neighborhoodId}`)}
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
