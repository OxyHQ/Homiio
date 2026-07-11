import React, { useState, useMemo, useCallback, useContext } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Platform,
  ScrollView,
  ActivityIndicator,
  type ViewStyle,
} from 'react-native';
import { Image } from 'expo-image';
import { useTranslation } from 'react-i18next';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { colors } from '@/styles/colors';
import { spacing } from '@/constants/styles';

import { Header } from '@/components/Header';
import { PropertyResultsGrid } from '@/components/ui/PropertyResultsGrid';
import { PropertyResultsGridSkeleton } from '@/components/ui/PropertyResultsGridSkeleton';
import { LoadMoreSentinel } from '@/components/common/LoadMoreSentinel';
import { Property } from '@homiio/shared-types';
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
import { FiltersBar } from '@/components/FiltersBar';
import { FiltersBottomSheet, type FilterSection, type FilterValue } from '@/components/FiltersBar/FiltersBottomSheet';

import { BottomSheetContext } from '@/context/BottomSheetContext';

/** Number of skeleton cards shown during the first properties load. */
const SKELETON_COUNT = 6;

interface CityFilterState {
  verified: boolean;
  ecoFriendly: boolean;
  bedrooms: string;
  bathrooms: string;
  sortBy: CitySortBy;
}

const DEFAULT_FILTERS: CityFilterState = {
  verified: false,
  ecoFriendly: false,
  bedrooms: '',
  bathrooms: '',
  sortBy: 'newest',
};

export default function CityPropertiesPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const cityId = typeof id === 'string' ? id : undefined;
  const [headerHeight, setHeaderHeight] = useState(0);
  const bottomSheet = useContext(BottomSheetContext);

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
      minBedrooms: filters.bedrooms ? Number(filters.bedrooms) : undefined,
      minBathrooms: filters.bathrooms ? Number(filters.bathrooms) : undefined,
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

  const filterSections: FilterSection[] = useMemo(() => [
    {
      id: 'verified',
      title: t('properties.city.verifiedProperties'),
      type: 'chips',
      options: [
        { id: 'true', label: t('properties.city.verifiedOnly'), value: 'true' }
      ],
      value: filters.verified ? 'true' : undefined
    },
    {
      id: 'ecoFriendly',
      title: t('properties.city.ecoFriendly'),
      type: 'chips',
      options: [
        { id: 'true', label: t('properties.city.ecoFriendlyOnly'), value: 'true' }
      ],
      value: filters.ecoFriendly ? 'true' : undefined
    },
    {
      id: 'bedrooms',
      title: t('property.sections.bedrooms'),
      type: 'chips',
      options: [
        { id: '1', label: '1+', value: '1' },
        { id: '2', label: '2+', value: '2' },
        { id: '3', label: '3+', value: '3' },
        { id: '4', label: '4+', value: '4' },
      ],
      value: filters.bedrooms
    },
    {
      id: 'bathrooms',
      title: t('property.sections.bathrooms'),
      type: 'chips',
      options: [
        { id: '1', label: '1+', value: '1' },
        { id: '2', label: '2+', value: '2' },
        { id: '3', label: '3+', value: '3' },
      ],
      value: filters.bathrooms
    }
  ], [t, filters]);

  const handleFilterChange = useCallback((sectionId: string, value: FilterValue) => {
    setFilters(prev => {
      switch (sectionId) {
        case 'verified':
          return { ...prev, verified: value === 'true' };
        case 'ecoFriendly':
          return { ...prev, ecoFriendly: value === 'true' };
        case 'bedrooms':
          return { ...prev, bedrooms: String(value) };
        case 'bathrooms':
          return { ...prev, bathrooms: String(value) };
        default:
          return prev;
      }
    });
  }, []);

  const handleOpenFilters = useCallback(() => {
    bottomSheet.openBottomSheet(
      <FiltersBottomSheet
        sections={filterSections}
        onFilterChange={handleFilterChange}
        onApply={bottomSheet.closeBottomSheet}
        onClear={() => {
          setFilters(prev => ({
            ...DEFAULT_FILTERS,
            sortBy: prev.sortBy,
          }));
          bottomSheet.closeBottomSheet();
        }}
      />
    );
  }, [bottomSheet, filterSections, handleFilterChange]);

  const handleOpenSort = useCallback(() => {
    bottomSheet.openBottomSheet(
      <FiltersBottomSheet
        sections={[
          {
            id: 'sort',
            title: t('properties.city.sortBy'),
            type: 'chips',
            options: [
              { id: 'newest', label: t('properties.city.sortNewest'), value: 'newest' },
              { id: 'priceAsc', label: t('properties.city.sortPriceAsc'), value: 'priceAsc' },
              { id: 'priceDesc', label: t('properties.city.sortPriceDesc'), value: 'priceDesc' },
            ],
            value: filters.sortBy,
          }
        ]}
        onFilterChange={(_, value) =>
          setFilters(prev => ({ ...prev, sortBy: String(value) as CitySortBy }))
        }
        onApply={bottomSheet.closeBottomSheet}
        onClear={() => {
          setFilters(prev => ({ ...prev, sortBy: 'newest' }));
          bottomSheet.closeBottomSheet();
        }}
      />
    );
  }, [bottomSheet, filters.sortBy, t]);

  const activeFiltersCount =
    (filters.verified ? 1 : 0) +
    (filters.ecoFriendly ? 1 : 0) +
    (filters.bedrooms ? 1 : 0) +
    (filters.bathrooms ? 1 : 0);

  const handlePropertyPress = useCallback(
    (property: Property) => {
      // The city-properties endpoint returns lean docs (only `_id`, no `id`
      // virtual), so prefer `_id` for navigation.
      const propertyId = property._id || property.id;
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
              titlePosition: 'center',
            }}
          />
        </View>
        <View style={{ paddingTop: headerHeight, flex: 1 }}>
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={colors.primaryColor} />
            <Text style={styles.loadingText}>{t('properties.city.loadingProperties')}</Text>
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
              titlePosition: 'center',
            }}
          />
        </View>
        <View style={{ paddingTop: headerHeight, flex: 1 }}>
          <EmptyState
            icon="alert-circle"
            title={t('properties.city.notFound')}
            actionText={t('common.goBack')}
            actionIcon="arrow-back"
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
          icon="home-outline"
          title={t('properties.city.noPropertiesFound')}
          description={t('properties.city.tryAdjustFilters')}
          actionText={t('properties.city.clearFilters')}
          actionIcon="refresh"
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
            titlePosition: 'center',
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
          <View style={styles.statCard}>
            <Text style={styles.statNumber}>{city.propertiesCount}</Text>
            <Text style={styles.statLabel}>{t('properties.city.properties')}</Text>
          </View>
          {typeof city.population === 'number' && city.population > 0 ? (
            <View style={styles.statCard}>
              <Text style={styles.statNumber}>{city.population.toLocaleString()}</Text>
              <Text style={styles.statLabel}>{t('properties.city.population')}</Text>
            </View>
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
            activeFiltersCount={activeFiltersCount}
            onFilterPress={handleOpenFilters}
            sortBy={filters.sortBy}
            onSortPress={handleOpenSort}
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
  loadingText: {
    marginTop: 16,
    fontSize: 16,
    color: colors.COLOR_BLACK_LIGHT_3,
    fontWeight: '500',
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
    backgroundColor: colors.white,
    borderRadius: 16,
    padding: 20,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.border,
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
