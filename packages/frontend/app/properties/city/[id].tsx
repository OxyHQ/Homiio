import React, { useState, useMemo, useCallback, useContext } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  ActivityIndicator,
} from 'react-native';
import { Image } from 'expo-image';
import { useTranslation } from 'react-i18next';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { colors } from '@/styles/colors';

import { Header } from '@/components/Header';
import { PropertyCard } from '@/components/PropertyCard';
import { Property } from '@homiio/shared-types';
import { useCity, usePropertiesByCity } from '@/hooks/useCityQueries';
import { cityCountryName, getCityImageSource } from '@/utils/cityDisplay';
import { LinearGradient } from 'expo-linear-gradient';
import { EmptyState } from '@/components/ui/EmptyState';
import { FiltersBar } from '@/components/FiltersBar';
import { FiltersBottomSheet, type FilterSection, type FilterValue } from '@/components/FiltersBar/FiltersBottomSheet';

import { BottomSheetContext } from '@/context/BottomSheetContext';

export default function CityPropertiesPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const cityId = typeof id === 'string' ? id : undefined;
  const [headerHeight, setHeaderHeight] = useState(0);
  const bottomSheet = useContext(BottomSheetContext);

  // City + its published properties from the DB (relational geo + self-hosted
  // cover image). React Query owns loading/error/caching — no local effects.
  const { data: city, isLoading: cityLoading, isError: cityError } = useCity(cityId);
  const { data: cityProperties, isLoading: propertiesLoading } = usePropertiesByCity(cityId, {
    limit: 50,
    sort: 'createdAt',
  });
  const properties = useMemo<Property[]>(
    () => cityProperties?.properties ?? [],
    [cityProperties],
  );
  const loading = cityLoading || propertiesLoading;
  const error = cityError ? 'City not found' : null;
  const cityImageSource = getCityImageSource(city ?? undefined, 'large');
  const countryName = cityCountryName(city ?? undefined);

  const [filters, setFilters] = useState({
    verified: false,
    ecoFriendly: false,
    bedrooms: '',
    bathrooms: '',
    amenities: [] as string[],
    sortBy: 'newest'
  });

  const filterSections: FilterSection[] = useMemo(() => [
    {
      id: 'verified',
      title: t('Verified Properties'),
      type: 'chips',
      options: [
        { id: 'true', label: t('Verified Only'), value: 'true' }
      ],
      value: filters.verified ? 'true' : undefined
    },
    {
      id: 'ecoFriendly',
      title: t('Eco-Friendly'),
      type: 'chips',
      options: [
        { id: 'true', label: t('Eco-Friendly Only'), value: 'true' }
      ],
      value: filters.ecoFriendly ? 'true' : undefined
    },
    {
      id: 'bedrooms',
      title: t('Bedrooms'),
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
      title: t('Bathrooms'),
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
          setFilters({
            verified: false,
            ecoFriendly: false,
            bedrooms: '',
            bathrooms: '',
            amenities: [],
            sortBy: 'newest'
          });
          bottomSheet.closeBottomSheet();
        }}
      />
    );
  }, [bottomSheet, filterSections, handleFilterChange]);

  const getFilteredAndSortedProperties = () => {
    if (!properties || !Array.isArray(properties)) {
      return [];
    }

    let result = [...properties];

    // Apply filters
    if (filters.verified) {
      result = result.filter(p => p.status === 'published');
    }

    if (filters.ecoFriendly) {
      result = result.filter(p =>
        p.amenities?.some((a: string) =>
          a.toLowerCase().includes('eco') ||
          a.toLowerCase().includes('green') ||
          a.toLowerCase().includes('solar')
        )
      );
    }

    if (filters.bedrooms) {
      result = result.filter(p => (p.bedrooms || 0) >= parseInt(filters.bedrooms));
    }

    if (filters.bathrooms) {
      result = result.filter(p => (p.bathrooms || 0) >= parseInt(filters.bathrooms));
    }

    // Apply sorting. Sort by the listing's headline rent — monthly when present,
    // else the nightly rate for vacation-only listings — so the order is stable.
    const sortPrice = (p: Property): number =>
      p.longTermRent?.monthlyAmount ?? p.shortTermRent?.nightlyRate ?? 0;
    switch (filters.sortBy) {
      case 'priceAsc':
        result.sort((a, b) => sortPrice(a) - sortPrice(b));
        break;
      case 'priceDesc':
        result.sort((a, b) => sortPrice(b) - sortPrice(a));
        break;
      case 'newest':
      default:
        result.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        break;
    }

    return result;
  };

  const renderPropertyItem = ({ item }: { item: Property }) => (
    <PropertyCard
      property={item}
      // The city-properties endpoint returns lean docs (only `_id`, no `id`
      // virtual), so prefer `_id` for navigation.
      onPress={() => router.push(`/properties/${item._id || item.id}`)}
      style={styles.propertyCard}
    />
  );

  if (loading) {
    return (
      <View style={styles.safeArea}>
        <View
          style={styles.stickyHeaderWrapper}
          onLayout={(e) => setHeaderHeight(e.nativeEvent.layout.height)}
        >
          <Header
            options={{
              showBackButton: true,
              title: t('Loading...'),
              titlePosition: 'center',
            }}
          />
        </View>
        <View style={{ paddingTop: headerHeight, flex: 1 }}>
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={colors.primaryColor} />
            <Text style={styles.loadingText}>{t('Loading properties...')}</Text>
          </View>
        </View>
      </View>
    );
  }

  if (error || !city) {
    return (
      <View style={styles.safeArea}>
        <View
          style={styles.stickyHeaderWrapper}
          onLayout={(e) => setHeaderHeight(e.nativeEvent.layout.height)}
        >
          <Header
            options={{
              showBackButton: true,
              title: t('Error'),
              titlePosition: 'center',
            }}
          />
        </View>
        <View style={{ paddingTop: headerHeight, flex: 1 }}>
          <EmptyState
            icon="alert-circle"
            title={error || t('City not found')}
            actionText={t('Go Back')}
            actionIcon="arrow-back"
            onAction={() => router.back()}
          />
        </View>
      </View>
    );
  }

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
      <View style={{ paddingTop: headerHeight, flex: 1 }}>
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
              style={styles.heroScrim}
              pointerEvents="none"
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
            <Text style={styles.statLabel}>{t('Properties')}</Text>
          </View>
          {typeof city.population === 'number' && city.population > 0 ? (
            <View style={styles.statCard}>
              <Text style={styles.statNumber}>{city.population.toLocaleString()}</Text>
              <Text style={styles.statLabel}>{t('Population')}</Text>
            </View>
          ) : null}
        </View>

        {/* Properties Section */}
        <View style={styles.propertiesSection}>
          <View style={styles.propertiesHeader}>
            <View>
              <Text style={styles.sectionTitle}>{t('Available Properties')}</Text>
              <Text style={styles.propertiesSubtitle}>
                {getFilteredAndSortedProperties().length} {t('properties found')}
              </Text>
            </View>
          </View>

          <FiltersBar
            activeFiltersCount={
              Object.values(filters).filter(value =>
                value !== false &&
                value !== '' &&
                value !== 'newest' &&
                (Array.isArray(value) ? value.length > 0 : true)
              ).length
            }
            onFilterPress={handleOpenFilters}
            sortBy={filters.sortBy}
            onSortPress={() => {
              bottomSheet.openBottomSheet(
                <FiltersBottomSheet
                  sections={[
                    {
                      id: 'sort',
                      title: t('Sort By'),
                      type: 'chips',
                      options: [
                        { id: 'newest', label: t('Newest First'), value: 'newest' },
                        { id: 'priceAsc', label: t('Price: Low to High'), value: 'priceAsc' },
                        { id: 'priceDesc', label: t('Price: High to Low'), value: 'priceDesc' },
                      ],
                      value: filters.sortBy
                    }
                  ]}
                  onFilterChange={(_, value) => setFilters(prev => ({ ...prev, sortBy: value.toString() }))}
                  onApply={bottomSheet.closeBottomSheet}
                  onClear={() => {
                    setFilters(prev => ({ ...prev, sortBy: 'newest' }));
                    bottomSheet.closeBottomSheet();
                  }}
                />
              );
            }}
          />

          {/* Properties List */}
          <FlatList
            data={getFilteredAndSortedProperties()}
            renderItem={renderPropertyItem}
            keyExtractor={(item) => item._id || item.id || Math.random().toString()}
            scrollEnabled={false}
            contentContainerStyle={styles.propertiesList}
            ListEmptyComponent={
              <EmptyState
                icon="home-outline"
                title={t('No properties found')}
                description={t('Try adjusting your filters or check back later')}
                actionText={t('Clear Filters')}
                actionIcon="refresh"
                onAction={() => {
                  setFilters(prev => ({
                    ...prev,
                    verified: false,
                    ecoFriendly: false,
                    bedrooms: '',
                    bathrooms: '',
                    amenities: [],
                    sortBy: 'newest'
                  }));
                }}
              />
            }
          />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.background,
  },
  container: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.surface,
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
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
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
  sortContainer: {
    flexDirection: 'row',
    gap: 12,
  },
  sortButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: colors.white,
    borderRadius: 20,
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 2,
  },
  sortButtonText: {
    fontSize: 14,
    color: colors.COLOR_BLACK_LIGHT_3,
    marginLeft: 6,
    fontWeight: '500',
  },
  activeSortButtonText: {
    color: colors.primaryColor,
    fontWeight: '600',
  },

  // Filters
  filtersScroll: {
    paddingRight: 20,
    marginBottom: 24,
  },
  filterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 16,
    backgroundColor: colors.white,
    borderRadius: 25,
    marginRight: 12,
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 2,
  },
  activeFilterChip: {
    backgroundColor: colors.primaryColor,
  },
  filterChipText: {
    marginLeft: 8,
    fontSize: 14,
    color: colors.COLOR_BLACK,
    fontWeight: '500',
  },
  activeFilterChipText: {
    color: colors.primaryForeground,
  },

  // Properties List
  propertiesList: {
    gap: 16,
  },
  propertyCard: {
    backgroundColor: colors.white,
    borderRadius: 16,
    overflow: 'hidden',
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
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
