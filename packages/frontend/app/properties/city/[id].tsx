import React, { useState, useEffect, useMemo, useCallback, useContext } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  ActivityIndicator,
  TouchableOpacity,
  ScrollView,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { colors } from '@/styles/colors';

import { Header } from '@/components/Header';
import { PropertyCard } from '@/components/PropertyCard';
import { Property } from '@/services/propertyService';
import { cityService, City } from '@/services/cityService';
import { LinearGradient } from 'expo-linear-gradient';
import { EmptyState } from '@/components/ui/EmptyState';
import { FiltersBar } from '@/components/FiltersBar';
import { FiltersBottomSheet, FilterSection } from '@/components/FiltersBar/FiltersBottomSheet';

import { BottomSheetContext } from '@/context/BottomSheetContext';

export default function CityPropertiesPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const { id } = useLocalSearchParams();
  const [properties, setProperties] = useState<Property[]>([]);
  const [city, setCity] = useState<City | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [headerHeight, setHeaderHeight] = useState(0);
  const bottomSheet = useContext(BottomSheetContext);

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

  // Load city and properties data
  useEffect(() => {
    const loadCityData = async () => {
      try {
        setLoading(true);
        setError(null);

        // Get city data by slug
        const cityResponse = await cityService.getCityBySlug(id as string);
        if (!cityResponse) {
          setError('City not found');
          setLoading(false);
          return;
        }

        setCity(cityResponse.data);

        // Get properties for this city using the city service
        const propertiesResponse = await cityService.getPropertiesByCity(cityResponse.data._id, {
          limit: 50,
          sort: 'createdAt',
        });

        // Ensure we always set an array
        setProperties(propertiesResponse?.properties || []);
      } catch (err) {
        console.error('Error loading city data:', err);
        setError('Failed to load city data');
        setProperties([]); // Ensure properties is always an array
      } finally {
        setLoading(false);
      }
    };

    if (id) {
      loadCityData();
    }
  }, [id]);

  const handleFilterChange = useCallback((sectionId: string, value: any) => {
    setFilters(prev => {
      switch (sectionId) {
        case 'verified':
          return { ...prev, verified: value === 'true' };
        case 'ecoFriendly':
          return { ...prev, ecoFriendly: value === 'true' };
        case 'bedrooms':
          return { ...prev, bedrooms: value };
        case 'bathrooms':
          return { ...prev, bathrooms: value };
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
      result = result.filter(p => p.status === 'available');
    }

    if (filters.ecoFriendly) {
      result = result.filter(p =>
        p.amenities?.some(a =>
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

    // Apply sorting
    switch (filters.sortBy) {
      case 'priceAsc':
        result.sort((a, b) => (a.rent?.amount || 0) - (b.rent?.amount || 0));
        break;
      case 'priceDesc':
        result.sort((a, b) => (b.rent?.amount || 0) - (a.rent?.amount || 0));
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
      onPress={() => router.push(`/properties/${item.id}`)}
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
        {/* Hero Section */}
        <View style={styles.heroSection}>
          <LinearGradient
            colors={[colors.primaryColor, colors.secondaryLight]}
            style={styles.heroContainer}
          >
            <View style={styles.heroContent}>
              <Text style={styles.heroTitle}>{city.name}</Text>
              <Text style={styles.heroSubtitle}>{city.country}</Text>
              <Text style={styles.heroDescription}>{city.description}</Text>
            </View>
          </LinearGradient>
        </View>

        {/* City Stats Cards */}
        <View style={styles.statsSection}>
          <View style={styles.statCard}>
            <Text style={styles.statNumber}>{city.propertiesCount}</Text>
            <Text style={styles.statLabel}>{t('Properties')}</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statNumber}>
              {city.averageRent ? `⊜${city.averageRent.toLocaleString()}` : 'N/A'}
            </Text>
            <Text style={styles.statLabel}>{t('Avg. Price')}</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statNumber}>{city.popularNeighborhoods?.length || 0}</Text>
            <Text style={styles.statLabel}>{t('Neighborhoods')}</Text>
          </View>
        </View>

        {/* Neighborhood Pills */}
        {city.popularNeighborhoods && city.popularNeighborhoods.length > 0 && (
          <View style={styles.neighborhoodSection}>
            <Text style={styles.sectionTitle}>{t('Popular Neighborhoods')}</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.neighborhoodScroll}
            >
              {city.popularNeighborhoods.map((neighborhood, index) => (
                <TouchableOpacity key={index} style={styles.neighborhoodPill}>
                  <Text style={styles.neighborhoodText}>{neighborhood}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        )}

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
    backgroundColor: '#f8f9fa',
  },
  container: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f8f9fa',
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
    height: 200,
    justifyContent: 'flex-end',
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
    fontFamily: 'Phudu',
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
    backgroundColor: 'white',
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
    fontFamily: 'Phudu',
  },
  statLabel: {
    fontSize: 14,
    color: colors.COLOR_BLACK_LIGHT_3,
    fontWeight: '500',
  },

  // Neighborhood Section
  neighborhoodSection: {
    marginBottom: 32,
    paddingHorizontal: 20,
  },
  sectionTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    color: colors.COLOR_BLACK,
    marginBottom: 16,
    fontFamily: 'Phudu',
  },
  neighborhoodScroll: {
    paddingRight: 20,
  },
  neighborhoodPill: {
    backgroundColor: 'white',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 25,
    marginRight: 12,
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 3,
    elevation: 2,
  },
  neighborhoodText: {
    fontSize: 14,
    color: colors.COLOR_BLACK,
    fontWeight: '500',
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
    backgroundColor: 'white',
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
    backgroundColor: 'white',
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
    color: 'white',
  },

  // Properties List
  propertiesList: {
    gap: 16,
  },
  propertyCard: {
    backgroundColor: 'white',
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
