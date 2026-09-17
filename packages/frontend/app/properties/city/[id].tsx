import React, { useState, useMemo, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Platform,
  ScrollView,
  type ViewStyle,
} from 'react-native';
import { Image } from 'expo-image';
import { useTranslation } from 'react-i18next';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { Card } from '@oxy.so/bloom/card';
import { Loading } from '@oxy.so/bloom/loading';
import { colors } from '@/styles/colors';
import { spacing } from '@/constants/styles';

import { Header } from '@/components/Header';
import { PropertyResultsGrid } from '@/components/ui/PropertyResultsGrid';
import { PropertyResultsGridSkeleton } from '@/components/ui/PropertyResultsGridSkeleton';
import { LoadMoreSentinel } from '@/components/common/LoadMoreSentinel';
import { Property, formatNumber } from '@homiio/shared-types';
import { useFormatting } from '@/utils/format';
import { useCity } from '@/hooks/useCityQueries';
import {
  useInfiniteCityProperties,
  type CityPropertyFilters,
  type CitySortBy,
} from '@/hooks/useInfiniteCityProperties';
import { useInfiniteScroll } from '@/hooks/useInfiniteScroll';
import { cityCountryName, getCityImageSource } from '@/utils/cityDisplay';
import { LinearGradient } from 'expo-linear-gradient';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { FiltersBar, type CityFilterValues } from '@/components/FiltersBar';

import {
  RiArrowLeftLine,
  RiErrorWarningFill,
  RiHomeLine,
  RiRefreshLine,
} from '@oxy.so/bloom/icons';

/** Number of skeleton cards shown during the first properties load. */
const SKELETON_COUNT = 6;

interface CityFilterState extends CityFilterValues {
  sortBy: CitySortBy;
}

const DEFAULT_FILTERS: CityFilterState = {
  verified: false,
  ecoFriendly: false,
  bedrooms: undefined,
  bathrooms: undefined,
  sortBy: 'newest',
};

export default function CityPropertiesPage() {
  const { t } = useTranslation();
  const { locale } = useFormatting();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const cityId = typeof id === 'string' ? id : undefined;
  const [headerHeight, setHeaderHeight] = useState(0);

  // City detail (hero + stats) from the DB-owned relational geo layer.
  const { data: city, isLoading: cityLoading, isError: cityError } = useCity(cityId);
  const cityImageSource = getCityImageSource(city ?? undefined, 'large');
  const countryName = cityCountryName(city ?? undefined);

  const [filters, setFilters] = useState<CityFilterState>(DEFAULT_FILTERS);

  // Server-resolved filters so the infinite grid paginates correctly (no
  // client-side re-filtering of already-loaded pages). `verified`/`eco` map to
  // the Property flags; bedrooms/bathrooms to the min-count params.
  const propertyFilters = useMemo<CityPropertyFilters>(
    () => ({
      verified: filters.verified,
      eco: filters.ecoFriendly,
      minBedrooms: filters.bedrooms,
      minBathrooms: filters.bathrooms,
    }),
    [filters.verified, filters.ecoFriendly, filters.bedrooms, filters.bathrooms],
  );

  const {
    properties,
    total,
    isLoading: propertiesLoading,
    isError: propertiesError,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    refetch,
  } = useInfiniteCityProperties(cityId, filters.sortBy, propertyFilters);

  // Shared infinite-scroll primitive: native fires `onScroll` end-detect, web
  // uses the `<LoadMoreSentinel>` at the grid's end.
  const handleEndReached = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) {
      void fetchNextPage();
    }
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);
  const { onScroll: handleListScroll } = useInfiniteScroll({
    onEndReached: handleEndReached,
    enabled: hasNextPage,
  });

  const handleApplyFilters = useCallback(
    (next: CityFilterValues) => setFilters((prev) => ({ ...prev, ...next })),
    [],
  );
  const handleSortChange = useCallback(
    (sortBy: CitySortBy) => setFilters((prev) => ({ ...prev, sortBy })),
    [],
  );

  const handlePropertyPress = useCallback(
    (property: Property) => {
      // The city-properties endpoint returns lean docs (only `id`, no `id`
      // virtual), so prefer `id` for navigation.
      const propertyId = property.id;
      if (propertyId) router.push(`/properties/${propertyId}`);
    },
    [router],
  );

  if (cityLoading) {
    return (
      <View style={styles.safeArea}>
        <View
          style={styles.stickyHeaderWrapper}
          onLayout={(e) => setHeaderHeight(e.nativeEvent.layout.height)}
        >
          <Header
            options={{
              showBackButton: true,
              title: t('app.loading'),
            }}
          />
        </View>
        <View style={{ paddingTop: headerHeight, flex: 1 }}>
          <View style={styles.loadingContainer}>
            <Loading variant="spinner" size="large" text={t('properties.city.loadingProperties')} />
          </View>
        </View>
      </View>
    );
  }

  if (cityError || !city) {
    return (
      <View style={styles.safeArea}>
        <View
          style={styles.stickyHeaderWrapper}
          onLayout={(e) => setHeaderHeight(e.nativeEvent.layout.height)}
        >
          <Header
            options={{
              showBackButton: true,
              title: t('common.error'),
            }}
          />
        </View>
        <View style={{ paddingTop: headerHeight, flex: 1 }}>
          <EmptyState
            icon={RiErrorWarningFill}
            title={t('properties.city.notFound')}
            actionText={t('common.goBack')}
            actionIcon={RiArrowLeftLine}
            onAction={() => router.back()}
          />
        </View>
      </View>
    );
  }

  const propertiesBody = () => {
    if (propertiesLoading && properties.length === 0) {
      return <PropertyResultsGridSkeleton count={SKELETON_COUNT} />;
    }
    if (propertiesError) {
      return (
        <ErrorState
          title={t('properties.city.notFound')}
          retryLabel={t('common.tryAgain')}
          onRetry={() => void refetch()}
        />
      );
    }
    if (properties.length === 0) {
      return (
        <EmptyState
          icon={RiHomeLine}
          title={t('properties.city.noPropertiesFound')}
          description={t('properties.city.tryAdjustFilters')}
          actionText={t('properties.city.clearFilters')}
          actionIcon={RiRefreshLine}
          onAction={() => setFilters(DEFAULT_FILTERS)}
        />
      );
    }
    return (
      <>
        <PropertyResultsGrid properties={properties} onPropertyPress={handlePropertyPress} />
        {isFetchingNextPage ? (
          <View style={styles.nextPageSkeleton}>
            <PropertyResultsGridSkeleton count={2} />
          </View>
        ) : null}
        <LoadMoreSentinel enabled={hasNextPage} onLoadMore={handleEndReached} />
      </>
    );
  };

  return (
    <View style={styles.safeArea}>
      <View
        style={styles.stickyHeaderWrapper}
        onLayout={(e) => setHeaderHeight(e.nativeEvent.layout.height)}
      >
        <Header
          options={{
            showBackButton: true,
            title: city?.name || '',
          }}
        />
      </View>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={{ paddingTop: headerHeight, paddingBottom: spacing['4xl'] }}
        onScroll={handleListScroll}
        scrollEventThrottle={16}
        showsVerticalScrollIndicator={false}
      >
        {/* Hero Section — DB-stored cover image (self-hosted) behind a scrim,
            falling back to a brand gradient when the city has no cover image. */}
        <View style={styles.heroSection}>
          <View style={styles.heroContainer}>
            {cityImageSource ? (
              <Image
                source={cityImageSource}
                style={styles.heroImage}
                contentFit="cover"
                transition={200}
                cachePolicy="memory-disk"
              />
            ) : (
              <LinearGradient
                colors={[colors.primaryColor, colors.secondaryLight]}
                style={styles.heroImage}
              />
            )}
            <LinearGradient
              colors={['rgba(0,0,0,0.05)', 'rgba(0,0,0,0.45)', 'rgba(0,0,0,0.72)']}
              locations={[0, 0.55, 1]}
              style={[styles.heroScrim, { pointerEvents: 'none' }]}
            />
            <View style={styles.heroContent}>
              <Text style={styles.heroTitle}>{city.name}</Text>
              {countryName ? <Text style={styles.heroSubtitle}>{countryName}</Text> : null}
              {city.description ? (
                <Text style={styles.heroDescription} numberOfLines={3}>
                  {city.description}
                </Text>
              ) : null}
            </View>
          </View>
        </View>

        {/* City Stats Cards */}
        <View style={styles.statsSection}>
          <Card variant="outlined" radius="radius-16" style={styles.statCard}>
            <Text style={styles.statNumber}>{city.propertiesCount}</Text>
            <Text style={styles.statLabel}>{t('properties.city.properties')}</Text>
          </Card>
          {typeof city.population === 'number' && city.population > 0 ? (
            <Card variant="outlined" radius="radius-16" style={styles.statCard}>
              <Text style={styles.statNumber}>{formatNumber(city.population, locale)}</Text>
              <Text style={styles.statLabel}>{t('properties.city.population')}</Text>
            </Card>
          ) : null}
        </View>

        {/* Properties Section */}
        <View style={styles.propertiesSection}>
          <View style={styles.propertiesHeader}>
            <View>
              <Text style={styles.sectionTitle}>{t('properties.city.availableProperties')}</Text>
              <Text style={styles.propertiesSubtitle}>
                {total} {t('properties.city.propertiesFound')}
              </Text>
            </View>
          </View>

          <FiltersBar
            filters={filters}
            onApplyFilters={handleApplyFilters}
            sortBy={filters.sortBy}
            onSortChange={handleSortChange}
          />

          <View style={styles.propertiesList}>{propertiesBody()}</View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  scroll: Platform.select<ViewStyle>({
    web: { flex: 1, overflow: 'auto' } as unknown as ViewStyle,
    default: { flex: 1 },
  }) as ViewStyle,
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.background,
  },

  // Hero Section
  heroSection: {
    marginBottom: 24,
  },
  heroContainer: {
    height: 240,
    justifyContent: 'flex-end',
    position: 'relative',
    overflow: 'hidden',
    backgroundColor: colors.COLOR_BLACK_LIGHT_7,
  },
  heroImage: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  heroScrim: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  heroContent: {
    padding: 24,
    paddingBottom: 20,
  },
  heroTitle: {
    fontSize: 32,
    fontWeight: 'bold',
    color: colors.white,
    marginBottom: 4,
  },
  heroSubtitle: {
    fontSize: 18,
    color: 'rgba(255, 255, 255, 0.9)',
    marginBottom: 12,
  },
  heroDescription: {
    fontSize: 16,
    color: 'rgba(255, 255, 255, 0.8)',
    lineHeight: 22,
  },

  // Stats Section
  statsSection: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    marginBottom: 32,
    gap: 12,
  },
  statCard: {
    flex: 1,
    padding: 20,
    alignItems: 'center',
  },
  statNumber: {
    fontSize: 24,
    fontWeight: 'bold',
    color: colors.COLOR_BLACK,
    marginBottom: 4,
  },
  statLabel: {
    fontSize: 14,
    color: colors.COLOR_BLACK_LIGHT_3,
    fontWeight: '500',
  },

  sectionTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    color: colors.COLOR_BLACK,
    marginBottom: 16,
  },

  // Properties Section
  propertiesSection: {
    paddingHorizontal: 20,
    paddingBottom: 40,
  },
  propertiesHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 20,
  },
  propertiesSubtitle: {
    fontSize: 16,
    color: colors.COLOR_BLACK_LIGHT_3,
    marginTop: 4,
  },

  // Properties List
  propertiesList: {
    marginTop: spacing.lg,
  },
  nextPageSkeleton: {
    marginTop: spacing.lg,
  },
  stickyHeaderWrapper: {
    zIndex: 100,
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    backgroundColor: colors.primaryLight,
  },
});
