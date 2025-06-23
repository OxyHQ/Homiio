import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, FlatList, ActivityIndicator, TouchableOpacity, Image } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { colors } from '@/styles/colors';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Header } from '@/components/Header';
import { generatePropertyTitle } from '@/utils/propertyTitleGenerator';
import { useProperties } from '@/hooks/usePropertyQueries';
import { Property } from '@/services/propertyService';
import { getPropertyImageSource } from '@/utils/propertyUtils';

type City = {
  id: string;
  name: string;
  country: string;
  description: string;
  propertiesCount: number;
  averagePrice: string;
  popularNeighborhoods: string[];
};

export default function CityPropertiesPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const { id } = useLocalSearchParams();
  const [activeFilter, setActiveFilter] = useState<string | null>(null);
  const [activeSort, setActiveSort] = useState<string | null>(null);
  const [properties, setProperties] = useState<Property[]>([]);
  const [loading, setLoading] = useState(true);

  // Use real API data instead of mock data
  const { data: apiData, isLoading, error } = useProperties({
    city: id as string
  });

  // City data definitions
  const cities: { [key: string]: City } = {
    'barcelona': {
      id: 'barcelona',
      name: 'Barcelona',
      country: 'Spain',
      description: t('Cosmopolitan city with stunning architecture and vibrant culture'),
      propertiesCount: apiData?.properties?.length || 0,
      averagePrice: '⊜1,200',
      popularNeighborhoods: ['Eixample', 'Gràcia', 'Sant Martí', 'Sants-Montjuïc', 'Sarrià-Sant Gervasi'],
    },
    'berlin': {
      id: 'berlin',
      name: 'Berlin',
      country: 'Germany',
      description: t('Creative capital with rich history and diverse neighborhoods'),
      propertiesCount: apiData?.properties?.length || 0,
      averagePrice: '⊜1,100',
      popularNeighborhoods: ['Kreuzberg', 'Neukölln', 'Mitte', 'Friedrichshain', 'Prenzlauer Berg'],
    },
    'amsterdam': {
      id: 'amsterdam',
      name: 'Amsterdam',
      country: 'Netherlands',
      description: t('Charming canals and bike-friendly city with international appeal'),
      propertiesCount: apiData?.properties?.length || 0,
      averagePrice: '⊜1,400',
      popularNeighborhoods: ['Jordaan', 'De Pijp', 'Oud-West', 'Centrum', 'Oost'],
    },
    'stockholm': {
      id: 'stockholm',
      name: 'Stockholm',
      country: 'Sweden',
      description: t('Scandinavian beauty with islands and modern sustainability'),
      propertiesCount: apiData?.properties?.length || 0,
      averagePrice: '⊜1,300',
      popularNeighborhoods: ['Södermalm', 'Östermalm', 'Vasastan', 'Kungsholmen', 'Norrmalm'],
    },
  };

  const city = cities[id as string];

  // Update properties when API data changes
  useEffect(() => {
    if (apiData?.properties) {
      setProperties(apiData.properties);
      setLoading(false);
    }
  }, [apiData]);

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
        styles.filterOption,
        activeFilter === option.id && styles.activeFilterOption
      ]}
      onPress={() => toggleFilter(option.id)}
    >
      <Ionicons
        name={option.icon as any}
        size={18}
        color={activeFilter === option.id ? 'white' : colors.COLOR_BLACK}
      />
      <Text style={[
        styles.filterText,
        activeFilter === option.id && styles.activeFilterText
      ]}>
        {option.label}
      </Text>
    </TouchableOpacity>
  );

  const renderPropertyItem = ({ item }: { item: Property }) => (
    <TouchableOpacity
      style={styles.propertyCard}
      onPress={() => router.push(`/properties/${item.id}`)}
    >
      <Image
        source={getPropertyImageSource(item.images)}
        style={styles.propertyImage}
        resizeMode="cover"
      />
      {item.isVerified && (
        <View style={styles.verifiedBadge}>
          <Ionicons name="shield-checkmark" size={14} color="white" />
        </View>
      )}
      {item.isEcoCertified && (
        <View style={styles.ecoBadge}>
          <Ionicons name="leaf" size={14} color="white" />
        </View>
      )}

      <View style={styles.propertyContent}>
        <Text style={styles.propertyTitle} numberOfLines={1}>{item.title}</Text>

        <Text style={styles.propertyLocation}>
          <Ionicons name="location-outline" size={14} color={colors.COLOR_BLACK_LIGHT_3} /> {item.location}
        </Text>

        <View style={styles.propertyDetailsRow}>
          <View style={styles.propertyDetail}>
            <Ionicons name="bed-outline" size={16} color={colors.COLOR_BLACK_LIGHT_3} />
            <Text style={styles.detailText}>{item.bedrooms}</Text>
          </View>

          <View style={styles.propertyDetail}>
            <Ionicons name="water-outline" size={16} color={colors.COLOR_BLACK_LIGHT_3} />
            <Text style={styles.detailText}>{item.bathrooms}</Text>
          </View>

          <View style={styles.propertyDetail}>
            <Ionicons name="resize-outline" size={16} color={colors.COLOR_BLACK_LIGHT_3} />
            <Text style={styles.detailText}>{item.size} m²</Text>
          </View>
        </View>

        <View style={styles.propertyFooter}>
          <Text style={styles.propertyPrice}>{item.price}</Text>
          <View style={styles.ratingContainer}>
            <Ionicons name="star" size={14} color="#FFD700" />
            <Text style={styles.ratingText}>{item.rating}</Text>
          </View>
        </View>
      </View>
    </TouchableOpacity>
  );

  if (loading || !city) {
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

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <Header
        options={{
          showBackButton: true,
          title: city.name,
          titlePosition: 'center',
        }}
      />

      <View style={styles.container}>
        {/* City Overview */}
        <View style={styles.cityOverview}>
          <Text style={styles.cityTitle}>
            {city.name}, <Text style={styles.countryText}>{city.country}</Text>
          </Text>
          <Text style={styles.cityDescription}>{city.description}</Text>

          <View style={styles.cityStats}>
            <View style={styles.statItem}>
              <Text style={styles.statValue}>{city.propertiesCount}</Text>
              <Text style={styles.statLabel}>{t("Properties")}</Text>
            </View>

            <View style={styles.statItem}>
              <Text style={styles.statValue}>{city.averagePrice}</Text>
              <Text style={styles.statLabel}>{t("Avg. Price")}</Text>
            </View>

            <View style={styles.statItem}>
              <Text style={styles.statValue}>{city.popularNeighborhoods.length}</Text>
              <Text style={styles.statLabel}>{t("Neighborhoods")}</Text>
            </View>
          </View>
        </View>

        {/* Neighborhood Pills */}
        <View style={styles.neighborhoodSection}>
          <Text style={styles.sectionTitle}>{t("Popular Neighborhoods")}</Text>
          <View style={styles.neighborhoodPills}>
            {city.popularNeighborhoods.map((neighborhood, index) => (
              <TouchableOpacity key={index} style={styles.neighborhoodPill}>
                <Text style={styles.neighborhoodText}>{neighborhood}</Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Properties List */}
        <View style={styles.propertiesSection}>
          <View style={styles.propertiesHeader}>
            <Text style={styles.sectionTitle}>{t("Available Properties")}</Text>
            <View style={styles.sortContainer}>
              <Text style={styles.sortLabel}>{t("Sort by:")}</Text>
              <TouchableOpacity
                style={[styles.sortOption, activeSort === 'price_asc' && styles.activeSortOption]}
                onPress={() => setActiveSort('price_asc')}
              >
                <Text style={styles.sortText}>⊜↑</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.sortOption, activeSort === 'price_desc' && styles.activeSortOption]}
                onPress={() => setActiveSort('price_desc')}
              >
                <Text style={styles.sortText}>⊜↓</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.sortOption, activeSort === 'rating' && styles.activeSortOption]}
                onPress={() => setActiveSort('rating')}
              >
                <Ionicons name="star" size={14} color={activeSort === 'rating' ? 'white' : colors.COLOR_BLACK} />
              </TouchableOpacity>
            </View>
          </View>

          <View style={styles.filtersContainer}>
            {filterOptions.map(renderFilterOption)}
          </View>

          <FlatList
            data={getFilteredAndSortedProperties()}
            renderItem={renderPropertyItem}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.propertiesList}
            ListEmptyComponent={
              <View style={styles.emptyContainer}>
                <Ionicons name="home" size={60} color={colors.COLOR_BLACK_LIGHT_3} />
                <Text style={styles.emptyText}>
                  {t("No properties match your filters")}
                </Text>
                <TouchableOpacity
                  style={styles.resetButton}
                  onPress={() => setActiveFilter(null)}
                >
                  <Text style={styles.resetButtonText}>{t("Reset Filters")}</Text>
                </TouchableOpacity>
              </View>
            }
          />
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
  },
  container: {
    flex: 1,
    padding: 15,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 10,
    fontSize: 16,
    color: colors.COLOR_BLACK_LIGHT_3,
  },
  cityOverview: {
    backgroundColor: 'white',
    borderRadius: 15,
    padding: 15,
    marginBottom: 15,
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  cityTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: colors.COLOR_BLACK,
    marginBottom: 5,
  },
  countryText: {
    fontWeight: 'normal',
  },
  cityDescription: {
    fontSize: 14,
    color: colors.COLOR_BLACK_LIGHT_3,
    marginBottom: 15,
    lineHeight: 20,
  },
  cityStats: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: '#f0f0f0',
    paddingTop: 15,
  },
  statItem: {
    alignItems: 'center',
  },
  statValue: {
    fontSize: 18,
    fontWeight: 'bold',
    color: colors.primaryColor,
  },
  statLabel: {
    fontSize: 12,
    color: colors.COLOR_BLACK_LIGHT_3,
    marginTop: 5,
  },
  neighborhoodSection: {
    marginBottom: 15,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: colors.COLOR_BLACK,
    marginBottom: 10,
  },
  neighborhoodPills: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  neighborhoodPill: {
    backgroundColor: colors.primaryLight,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 20,
    marginRight: 8,
    marginBottom: 8,
  },
  neighborhoodText: {
    fontSize: 14,
    color: colors.primaryColor,
  },
  propertiesSection: {
    flex: 1,
  },
  propertiesHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  sortContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  sortLabel: {
    fontSize: 14,
    color: colors.COLOR_BLACK_LIGHT_3,
    marginRight: 8,
  },
  sortOption: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: colors.primaryLight,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 5,
  },
  activeSortOption: {
    backgroundColor: colors.primaryColor,
  },
  sortText: {
    fontSize: 14,
    fontWeight: 'bold',
    color: colors.COLOR_BLACK,
  },
  filtersContainer: {
    flexDirection: 'row',
    marginBottom: 15,
    flexWrap: 'wrap',
    gap: 8,
  },
  filterOption: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    paddingHorizontal: 12,
    backgroundColor: colors.primaryLight,
    borderRadius: 20,
  },
  activeFilterOption: {
    backgroundColor: colors.primaryColor,
  },
  filterText: {
    marginLeft: 6,
    fontSize: 14,
    color: colors.COLOR_BLACK,
  },
  activeFilterText: {
    color: 'white',
  },
  propertiesList: {
    paddingBottom: 20,
  },
  propertyCard: {
    backgroundColor: 'white',
    borderRadius: 15,
    marginBottom: 15,
    overflow: 'hidden',
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  propertyImage: {
    width: '100%',
    height: 150,
    borderTopLeftRadius: 15,
    borderTopRightRadius: 15,
  },
  propertyContent: {
    padding: 15,
  },
  propertyTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: colors.COLOR_BLACK,
    marginBottom: 5,
  },
  propertyLocation: {
    fontSize: 14,
    color: colors.COLOR_BLACK_LIGHT_3,
    marginBottom: 10,
  },
  propertyDetailsRow: {
    flexDirection: 'row',
    marginBottom: 10,
  },
  propertyDetail: {
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: 15,
  },
  detailText: {
    fontSize: 14,
    color: colors.COLOR_BLACK_LIGHT_3,
    marginLeft: 4,
  },
  propertyFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 5,
  },
  propertyPrice: {
    fontSize: 16,
    fontWeight: 'bold',
    color: colors.COLOR_BLACK,
  },
  ratingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  ratingText: {
    marginLeft: 4,
    fontSize: 14,
    color: colors.COLOR_BLACK,
  },
  verifiedBadge: {
    position: 'absolute',
    top: 10,
    right: 10,
    backgroundColor: colors.primaryColor,
    borderRadius: 20,
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  ecoBadge: {
    position: 'absolute',
    top: 10,
    left: 10,
    backgroundColor: 'green',
    borderRadius: 20,
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  emptyContainer: {
    padding: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: {
    fontSize: 16,
    color: colors.COLOR_BLACK_LIGHT_3,
    textAlign: 'center',
    marginTop: 10,
    marginBottom: 15,
  },
  resetButton: {
    backgroundColor: colors.primaryColor,
    paddingVertical: 8,
    paddingHorizontal: 15,
    borderRadius: 20,
  },
  resetButtonText: {
    color: 'white',
    fontWeight: '600',
  },
});