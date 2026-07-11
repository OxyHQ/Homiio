/**
 * Review explore — a city's neighborhoods (name + review count + average
 * rating). Tapping a neighborhood drills into its reviewed buildings.
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
import { useExploreCity } from '@/hooks/useExploreReviews';
import { colors } from '@/styles/colors';
import { radius, spacing } from '@/constants/styles';

export default function ReviewExploreCityScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const { cityId } = useLocalSearchParams<{ cityId: string }>();
  const cityQuery = useExploreCity(cityId);
  const neighborhoods = cityQuery.data ?? [];

  return (
    <View style={styles.root}>
      <Header options={{ title: t('reviews.explore.neighborhoodsTitle'), showBackButton: true }} />
      <SafeAreaView edges={['bottom']} style={styles.safeArea}>
        <ScrollView contentContainerStyle={styles.content}>
          {cityQuery.isLoading ? (
            <View style={styles.list}>
              {Array.from({ length: 5 }).map((_, idx) => (
                <Skeleton.Box key={idx} width="100%" height={56} borderRadius={radius.md} />
              ))}
            </View>
          ) : cityQuery.isError ? (
            <ErrorState
              icon="cloud-offline-outline"
              title={t('reviews.explore.errorTitle')}
              description={t('reviews.explore.errorDescription')}
              retryLabel={t('common.tryAgain')}
              onRetry={() => cityQuery.refetch()}
            />
          ) : neighborhoods.length === 0 ? (
            <EmptyState
              icon="map-outline"
              title={t('reviews.explore.emptyNeighborhoodsTitle')}
              description={t('reviews.explore.emptyNeighborhoodsDescription')}
            />
          ) : (
            <View style={styles.list}>
              {neighborhoods.map((neighborhood) => (
                <ExploreRow
                  key={neighborhood.neighborhoodId}
                  title={neighborhood.name}
                  subtitle={t('reviews.explore.reviewCount', { count: neighborhood.reviewCount })}
                  rightLabel={`${neighborhood.averageRating.toFixed(1)} ★`}
                  onPress={() =>
                    router.push(`/reviews/neighborhood/${neighborhood.neighborhoodId}`)
                  }
                />
              ))}
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
