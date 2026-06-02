/**
 * Recently viewed — the small, personal list of listings the user has opened.
 *
 * Rebuilt to match the `/properties` browse surface: the shared
 * `PropertyListHeader` over a responsive `PropertyResultsGrid` of the standard
 * photo-carousel `PropertyCard`, with `PropertyResultsGridSkeleton` /
 * `EmptyState` / `ErrorState` for the non-content states.
 *
 * Data source is unchanged — `useRecentlyViewed` (the recently-viewed Zustand
 * store, hydrated from the backend when authenticated). There is no search bar:
 * this is a short, capped history (≤10 items), not a searchable catalog, so the
 * old `SearchBar` + view-mode toggle were removed. The "clear history" action is
 * preserved as a header action.
 */
import React, { useCallback } from 'react';
import { Platform, ScrollView, StyleSheet, View, type ViewStyle } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useRouter } from 'expo-router';

import { Button } from '@oxyhq/bloom/button';

import { PropertyListHeader } from '@/components/ui/PropertyListHeader';
import { PropertyResultsGrid } from '@/components/ui/PropertyResultsGrid';
import { PropertyResultsGridSkeleton } from '@/components/ui/PropertyResultsGridSkeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { useRecentlyViewed } from '@/hooks/useRecentlyViewed';
import { colors } from '@/styles/colors';
import { contentClamp, spacing } from '@/constants/styles';
import type { Property } from '@homiio/shared-types';

/** Number of skeleton cards shown during the first load. */
const SKELETON_COUNT = 4;

export default function RecentlyViewedScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { properties, isLoading, error, refetch, clear } = useRecentlyViewed();

  const handlePropertyPress = useCallback(
    (property: Property) => {
      router.push(`/properties/${property._id || property.id}`);
    },
    [router],
  );

  const handleRefresh = useCallback(() => {
    void refetch();
  }, [refetch]);

  const handleClear = useCallback(() => {
    void clear();
  }, [clear]);

  const body = (() => {
    if (isLoading && properties.length === 0) {
      return (
        <PropertyResultsGridSkeleton
          count={SKELETON_COUNT}
          style={styles.gridPadding}
        />
      );
    }
    if (error) {
      return (
        <ErrorState
          title={t('home.recentlyViewed.errorTitle')}
          description={error}
          retryLabel={t('home.recentlyViewed.retry')}
          onRetry={handleRefresh}
        />
      );
    }
    if (properties.length === 0) {
      return (
        <EmptyState
          icon="time-outline"
          title={t('home.recentlyViewed.noProperties')}
          description={t('home.recentlyViewed.noPropertiesDescription')}
          actionText={t('home.recentlyViewed.browseProperties')}
          actionIcon="home"
          onAction={() => router.push('/properties')}
        />
      );
    }
    return (
      <PropertyResultsGrid
        properties={properties}
        onPropertyPress={handlePropertyPress}
        style={styles.gridPadding}
      />
    );
  })();

  return (
    <View style={styles.container}>
      <PropertyListHeader
        title={t('home.recentlyViewed.title')}
        subtitle={
          properties.length > 0
            ? `${t('home.recentlyViewed.results')}: ${properties.length}`
            : undefined
        }
        right={
          properties.length > 0 ? (
            <Button
              variant="ghost"
              size="small"
              onPress={handleClear}
              accessibilityLabel={t('home.recentlyViewed.retry')}
            >
              {t('common.clear', 'Clear')}
            </Button>
          ) : undefined
        }
      />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {body}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scroll: Platform.select<ViewStyle>({
    web: { flex: 1, overflow: 'auto' } as unknown as ViewStyle,
    default: { flex: 1 },
  }) as ViewStyle,
  scrollContent: {
    paddingTop: spacing.lg,
    paddingBottom: spacing['4xl'],
    maxWidth: contentClamp.page,
    width: '100%',
    alignSelf: 'center',
  },
  gridPadding: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
  },
});
