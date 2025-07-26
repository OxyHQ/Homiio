import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, FlatList, ActivityIndicator, TouchableOpacity, ScrollView, Image } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { colors } from '@/styles/colors';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Header } from '@/components/Header';
import { PropertyCard } from '@/components/PropertyCard';
import { Property } from '@/services/propertyService';
import { cityService, City } from '@/services/cityService';
import { LinearGradient } from 'expo-linear-gradient';
import { EmptyState } from '@/components/ui/EmptyState';

export default function CityPropertiesPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const { id } = useLocalSearchParams();
  const [activeFilter, setActiveFilter] = useState<string | null>(null);
  const [activeSort, setActiveSort] = useState<string | null>(null);
  const [properties, setProperties] = useState<Property[]>([]);
  const [city, setCity] = useState<City | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
          sort: 'createdAt'
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

  const filterOptions = [
    { id: 'verified', label: t('Verified'), icon: 'shield-checkmark' },
    { id: 'eco', label: t('Eco-Friendly'), icon: 'leaf' },
    { id: '1bed', label: t('1+ Bed'), icon: 'bed' },
    { id: '2bed', label: t('2+ Bed'), icon: 'bed' },
  ];

  const sortOptions = [
    { id: 'price_asc', label: t('Price: Low to High'), icon: 'arrow-up' },
    { id: 'price_desc', label: t('Price: High to Low'), icon: 'arrow-down' },
    { id: 'rating', label: t('Rating'), icon: 'star' },
  ];

  const getFilteredAndSortedProperties = () => {
    // Ensure properties is an array
    if (!properties || !Array.isArray(properties)) {
      return [];
    }

    let result = [...properties];

    // Apply filters
    if (activeFilter) {
      switch (activeFilter) {
        case 'verified':
          result = result.filter(p => p.status === 'available');
          break;
        case 'eco':
          result = result.filter(p => p.amenities?.some(a =>
            a.toLowerCase().includes('eco') ||
            a.toLowerCase().includes('green') ||
            a.toLowerCase().includes('solar')
          ));
          break;
        case '1bed':
          result = result.filter(p => (p.bedrooms || 0) >= 1);
          break;
        case '2bed':
          result = result.filter(p => (p.bedrooms || 0) >= 2);
          break;
      }
    }

    // Apply sorting
    if (activeSort) {
      switch (activeSort) {
        case 'price_asc':
          result.sort((a, b) => {
            const priceA = a.rent?.amount || 0;
            const priceB = b.rent?.amount || 0;
            return priceA - priceB;
          });
          break;
        case 'price_desc':
          result.sort((a, b) => {
            const priceA = a.rent?.amount || 0;
            const priceB = b.rent?.amount || 0;
            return priceB - priceA;
          });
          break;
        case 'rating':
          // Use a default rating since it's not in the API
          result.sort((a, b) => 4.5 - 4.5); // No change since we don't have ratings
          break;
      }
    }

    return result;
  };

  const toggleFilter = (filterId: string) => {
    setActiveFilter(activeFilter === filterId ? null : filterId);
  };

  const renderFilterOption = (option: { id: string; label: string; icon: string }) => (
    <TouchableOpacity
      key={option.id}
      style={[
        styles.filterChip,
        activeFilter === option.id && styles.activeFilterChip
      ]}
      onPress={() => toggleFilter(option.id)}
    >
      <Ionicons
        name={option.icon as any}
        size={16}
        color={activeFilter === option.id ? 'white' : colors.COLOR_BLACK}
      />
      <Text style={[
        styles.filterChipText,
        activeFilter === option.id && styles.activeFilterChipText
      ]}>
        {option.label}
      </Text>
    </TouchableOpacity>
  );

  const renderPropertyItem = ({ item }: { item: Property }) => (
    <PropertyCard
      property={item}
      onPress={() => router.push(`/properties/${item.id}`)}
      style={styles.propertyCard}
    />
  );

  if (loading) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <Header
          options={{
            showBackButton: true,
            title: t("Loading..."),
            titlePosition: 'center',
          }}
        />
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={colors.primaryColor} />
          <Text style={styles.loadingText}>{t("Loading properties...")}</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (error || !city) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <Header
          options={{
            showBackButton: true,
            title: t("Error"),
            titlePosition: 'center',
          }}
        />
        <EmptyState
          icon="alert-circle"
          title={error || t("City not found")}
          actionText={t("Go Back")}
          actionIcon="arrow-back"
          onAction={() => router.back()}
        />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <Header
        options={{
          showBackButton: true,
          title: city.name,
          titlePosition: 'center',
        }}
      />

      <ScrollView style={styles.container} showsVerticalScrollIndicator={false}>
        {/* Hero Section */}
        <View style={styles.heroSection}>
          <LinearGradient
            colors={[colors.primaryColor, colors.secondaryLight]}
            style={styles.heroContainer}
          >
            <View style={styles.heroContent}>
              <Text style={styles.heroTitle}>
                {city.name}
              </Text>
              <Text style={styles.heroSubtitle}>
                {city.country}
              </Text>
              <Text style={styles.heroDescription}>
                {city.description}
              </Text>
            </View>
          </LinearGradient>
        </View>

        {/* City Stats Cards */}
        <View style={styles.statsSection}>
          <View style={styles.statCard}>
            <Text style={styles.statNumber}>{city.propertiesCount}</Text>
            <Text style={styles.statLabel}>{t("Properties")}</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statNumber}>
              {city.averageRent ? `⊜${city.averageRent.toLocaleString()}` : 'N/A'}
            </Text>
            <Text style={styles.statLabel}>{t("Avg. Price")}</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statNumber}>{city.popularNeighborhoods?.length || 0}</Text>
            <Text style={styles.statLabel}>{t("Neighborhoods")}</Text>
          </View>
        </View>

        {/* Neighborhood Pills */}
        {city.popularNeighborhoods && city.popularNeighborhoods.length > 0 && (
          <View style={styles.neighborhoodSection}>
            <Text style={styles.sectionTitle}>{t("Popular Neighborhoods")}</Text>
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
              <Text style={styles.sectionTitle}>{t("Available Properties")}</Text>
              <Text style={styles.propertiesSubtitle}>
                {getFilteredAndSortedProperties().length} {t("properties found")}
              </Text>
            </View>

            <View style={styles.sortContainer}>
              <TouchableOpacity
                style={styles.sortButton}
                onPress={() => setActiveSort(activeSort === 'price_asc' ? null : 'price_asc')}
              >
                <Ionicons
                  name="arrow-up"
                  size={16}
                  color={activeSort === 'price_asc' ? colors.primaryColor : colors.COLOR_BLACK_LIGHT_3}
                />
                <Text style={[
                  styles.sortButtonText,
                  activeSort === 'price_asc' && styles.activeSortButtonText
                ]}>
                  {t("Price")}
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.sortButton}
                onPress={() => setActiveSort(activeSort === 'rating' ? null : 'rating')}
              >
                <Ionicons
                  name="star"
                  size={16}
                  color={activeSort === 'rating' ? colors.primaryColor : colors.COLOR_BLACK_LIGHT_3}
                />
                <Text style={[
                  styles.sortButtonText,
                  activeSort === 'rating' && styles.activeSortButtonText
                ]}>
                  {t("Rating")}
                </Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Filters */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.filtersScroll}
          >
            {filterOptions.map(renderFilterOption)}
          </ScrollView>

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
                title={t("No properties found")}
                description={t("Try adjusting your filters or check back later")}
                actionText={t("Clear Filters")}
                actionIcon="refresh"
                onAction={() => {
                  setActiveFilter(null);
                  setActiveSort(null);
                }}
              />
            }
          />
        </View>
      </ScrollView>
    </SafeAreaView>
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


});