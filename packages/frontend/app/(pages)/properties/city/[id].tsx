import { useState, useMemo, useCallback } from 'react';
import { View, StyleSheet, Pressable, Linking } from 'react-native';
import { Text } from '@oxy.so/bloom/typography';
import { Image } from 'expo-image';
import { useTranslation } from 'react-i18next';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { AppShellMenuButton } from '@oxy.so/bloom/app-shell';
import { Card } from '@oxy.so/bloom/card';
import { Loading } from '@oxy.so/bloom/loading';
import { PageHeader } from '@oxy.so/bloom/page-header';
import { Screen, ScreenScrollView } from '@oxy.so/bloom/screen';
import { useTheme } from '@oxy.so/bloom/theme';
import { spacing } from '@/constants/styles';

import { PropertyResultsGrid } from '@/components/ui/PropertyResultsGrid';
import { PropertyResultsGridSkeleton } from '@/components/ui/PropertyResultsGridSkeleton';
import type { Property } from '@homiio/shared-types';
import { formatNumber } from '@homiio/shared-types/format/numbers';
import { useFormatting } from '@/utils/format';
import { useCity } from '@/hooks/useCityQueries';
import {
  useInfiniteCityProperties,
  type CityPropertyFilters,
  type CitySortBy,
} from '@/hooks/useInfiniteCityProperties';
import { cityCountryName, getCityImageAttribution, getCityImageSource } from '@/utils/cityDisplay';
import { LinearGradient } from 'expo-linear-gradient';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { FiltersBar, type CityFilterValues } from '@/components/FiltersBar';

import { RiArrowLeftLine } from '@oxy.so/bloom/icons/RiArrowLeftLine';
import { RiErrorWarningFill } from '@oxy.so/bloom/icons/RiErrorWarningFill';
import { RiHomeLine } from '@oxy.so/bloom/icons/RiHomeLine';
import { RiRefreshLine } from '@oxy.so/bloom/icons/RiRefreshLine';

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
  const { colors } = useTheme();
  const { locale } = useFormatting();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const cityId = typeof id === 'string' ? id : undefined;

  // City detail (hero + stats) from the DB-owned relational geo layer.
  const { data: city, isLoading: cityLoading, isError: cityError } = useCity(cityId);
  const cityImageSource = getCityImageSource(city ?? undefined, 'large');
  // A Commons cover's licence requires its credit beside the photo.
  const cityImageCredit = cityImageSource ? getCityImageAttribution(city ?? undefined) : null;
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

  // The page's `ScreenScrollView` asks for the next page as its end nears.
  const handleEndReached = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) {
      void fetchNextPage();
    }
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

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
      <Screen
        documentScroll
        header={
          <PageHeader
            title={t('app.loading')}
            titleAlign="center"
            leading={<AppShellMenuButton accessibilityLabel={t('sidebar.open')} />}
            onBack={router.canGoBack() ? router.back : undefined}
            backLabel={t('goBack')}
          />
        }
      >
        <ScreenScrollView contentContainerStyle={styles.loadingContainer}>
          <Loading variant="spinner" size="lg" text={t('properties.city.loadingProperties')} />
        </ScreenScrollView>
      </Screen>
    );
  }

  if (cityError || !city) {
    return (
      <Screen
        documentScroll
        header={
          <PageHeader
            title={t('common.error')}
            titleAlign="center"
            leading={<AppShellMenuButton accessibilityLabel={t('sidebar.open')} />}
            onBack={router.canGoBack() ? router.back : undefined}
            backLabel={t('goBack')}
          />
        }
      >
        <ScreenScrollView>
          <EmptyState
            icon={RiErrorWarningFill}
            title={t('properties.city.notFound')}
            actionText={t('common.goBack')}
            actionIcon={RiArrowLeftLine}
            onAction={() => router.back()}
          />
        </ScreenScrollView>
      </Screen>
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
      </>
    );
  };

  return (
    <Screen
      documentScroll
      header={
        <PageHeader
          title={city.name}
          titleAlign="center"
          leading={<AppShellMenuButton accessibilityLabel={t('sidebar.open')} />}
          onBack={router.canGoBack() ? router.back : undefined}
          backLabel={t('goBack')}
        />
      }
    >
      <ScreenScrollView contentContainerStyle={styles.content} onEndReached={handleEndReached}>
        {/* Hero Section — DB-stored cover image (self-hosted) behind a scrim,
            falling back to a brand gradient when the city has no cover image. */}
        <View style={styles.heroSection}>
          <View className="bg-muted" style={styles.heroContainer}>
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
                colors={[colors.primary, colors.secondarySubtle]}
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
              {cityImageCredit ? (
                <Pressable
                  accessibilityRole="link"
                  accessibilityHint={t('properties.city.photoCreditSource')}
                  onPress={() => void Linking.openURL(cityImageCredit.sourceUrl)}
                >
                  <Text style={styles.heroCredit} numberOfLines={1}>
                    {cityImageCredit.author
                      ? t('properties.city.photoCredit', {
                          author: cityImageCredit.author,
                          license: cityImageCredit.license,
                        })
                      : t('properties.city.photoCreditNoAuthor', {
                          license: cityImageCredit.license,
                        })}
                  </Text>
                </Pressable>
              ) : null}
            </View>
          </View>
        </View>

        {/* City Stats Cards */}
        <View style={styles.statsSection}>
          <Card radius="radius-16" style={styles.statCard} appearance="outline">
            <Text className="mb-1 text-2xl font-bold text-foreground">{city.propertiesCount}</Text>
            <Text className="text-sm font-medium text-muted-foreground">
              {t('properties.city.properties')}
            </Text>
          </Card>
          {typeof city.population === 'number' && city.population > 0 ? (
            <Card radius="radius-16" style={styles.statCard} appearance="outline">
              <Text className="mb-1 text-2xl font-bold text-foreground">
                {formatNumber(city.population, locale)}
              </Text>
              <Text className="text-sm font-medium text-muted-foreground">
                {t('properties.city.population')}
              </Text>
            </Card>
          ) : null}
        </View>

        {/* Properties Section */}
        <View style={styles.propertiesSection}>
          <View style={styles.propertiesHeader}>
            <View>
              <Text className="mb-4 text-[22px] font-bold text-foreground">
                {t('properties.city.availableProperties')}
              </Text>
              <Text className="mt-1 text-base text-muted-foreground">
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
      </ScreenScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingBottom: spacing['4xl'],
  },
  loadingContainer: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
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
    color: 'white',
    marginBottom: 4,
  },
  heroSubtitle: {
    fontSize: 18,
    color: 'rgba(255, 255, 255, 0.9)',
    marginBottom: 12,
  },
  heroCredit: {
    marginTop: 8,
    fontSize: 11,
    color: 'rgba(255,255,255,0.8)',
    textDecorationLine: 'underline',
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

  // Properties List
  propertiesList: {
    marginTop: spacing.lg,
  },
  nextPageSkeleton: {
    marginTop: spacing.lg,
  },
});
