import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, FlatList, ActivityIndicator, TouchableOpacity, Image } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { colors } from '@/styles/colors';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Header } from '@/components/Header';

type Property = {
  id: string;
  title: string;
  location: string;
  neighborhood: string;
  price: string;
  bedrooms: number;
  bathrooms: number;
  size: number;
  isVerified: boolean;
  isEcoCertified: boolean;
  rating: number;
  imageUrl?: string;
};

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
  const [loading, setLoading] = useState(true);
  const [properties, setProperties] = useState<Property[]>([]);
  const [city, setCity] = useState<City | null>(null);
  const [activeSort, setActiveSort] = useState<'price_asc' | 'price_desc' | 'rating'>('rating');
  const [activeFilter, setActiveFilter] = useState<string | null>(null);

  const filterOptions = [
    { id: 'verified', label: t('Verified'), icon: 'shield-checkmark' },
    { id: 'eco', label: t('Eco'), icon: 'leaf' },
    { id: '1bed', label: t('1+ Bed'), icon: 'bed' },
    { id: '2bed', label: t('2+ Bed'), icon: 'bed' },
  ];

  useEffect(() => {
    // Simulate API calls to fetch city data and properties
    const fetchData = setTimeout(() => {
      let cityData: City | null = null;
      
      // Mock city data based on ID
      switch(id) {
        case '1': // Barcelona
          cityData = {
            id: '1',
            name: 'Barcelona',
            country: 'Spain',
            description: 'A vibrant coastal city known for its art, architecture, and Mediterranean lifestyle.',
            propertiesCount: 128,
            averagePrice: '€950',
            popularNeighborhoods: ['Gracia', 'El Born', 'Eixample', 'Barceloneta']
          };
          break;
        case '2': // Berlin
          cityData = {
            id: '2',
            name: 'Berlin',
            country: 'Germany',
            description: 'A cultural hub with a rich history, diverse neighborhoods, and thriving arts scene.',
            propertiesCount: 94,
            averagePrice: '€750',
            popularNeighborhoods: ['Kreuzberg', 'Neukölln', 'Mitte', 'Prenzlauer Berg']
          };
          break;
        case '3': // Stockholm
          cityData = {
            id: '3',
            name: 'Stockholm',
            country: 'Sweden',
            description: 'A beautiful city built on islands, offering a perfect blend of historical charm and innovation.',
            propertiesCount: 75,
            averagePrice: '€1,050',
            popularNeighborhoods: ['Södermalm', 'Östermalm', 'Kungsholmen', 'Vasastan']
          };
          break;
        case '4': // Amsterdam
          cityData = {
            id: '4',
            name: 'Amsterdam',
            country: 'Netherlands',
            description: 'Famous for its canals, historical houses, and progressive culture.',
            propertiesCount: 103,
            averagePrice: '€1,200',
            popularNeighborhoods: ['Jordaan', 'De Pijp', 'Oud-West', 'Amsterdam Noord']
          };
          break;
        default:
          cityData = {
            id: id as string,
            name: 'City',
            country: 'Country',
            description: 'A beautiful city with many properties.',
            propertiesCount: 50,
            averagePrice: '€900',
            popularNeighborhoods: ['Downtown', 'Riverside', 'University District']
          };
      }
      
      setCity(cityData);
      
      // Generate mock properties for the selected city
      const mockProperties: Property[] = [];
      const neighborhoodOptions = cityData.popularNeighborhoods;
      
      for (let i = 1; i <= 10; i++) {
        const neighborhood = neighborhoodOptions[Math.floor(Math.random() * neighborhoodOptions.length)];
        mockProperties.push({
          id: `${id}-${i}`,
          title: `${i % 3 === 0 ? 'Modern' : i % 3 === 1 ? 'Cozy' : 'Spacious'} ${i % 2 === 0 ? 'Studio' : 'Apartment'} in ${neighborhood}`,
          location: `${cityData.name}, ${cityData.country}`,
          neighborhood,
          price: `€${Math.floor(600 + Math.random() * 900)}/month`,
          bedrooms: Math.floor(Math.random() * 3) + 1,
          bathrooms: Math.floor(Math.random() * 2) + 1,
          size: Math.floor(45 + Math.random() * 60),
          isVerified: Math.random() > 0.3,
          isEcoCertified: Math.random() > 0.7,
          rating: parseFloat((3.8 + Math.random() * 1.2).toFixed(1)),
        });
      }
      
      setProperties(mockProperties);
      setLoading(false);
    }, 1000);
    
    return () => clearTimeout(fetchData);
  }, [id]);

  const getFilteredAndSortedProperties = () => {
    let result = [...properties];
    
    // Apply filters
    if (activeFilter) {
      switch(activeFilter) {
        case 'verified':
          result = result.filter(p => p.isVerified);
          break;
        case 'eco':
          result = result.filter(p => p.isEcoCertified);
          break;
        case '1bed':
          result = result.filter(p => p.bedrooms >= 1);
          break;
        case '2bed':
          result = result.filter(p => p.bedrooms >= 2);
          break;
      }
    }
    
    // Apply sorting
    switch(activeSort) {
      case 'price_asc':
        result.sort((a, b) => {
          const priceA = parseInt(a.price.replace(/[^0-9]/g, ''));
          const priceB = parseInt(b.price.replace(/[^0-9]/g, ''));
          return priceA - priceB;
        });
        break;
      case 'price_desc':
        result.sort((a, b) => {
          const priceA = parseInt(a.price.replace(/[^0-9]/g, ''));
          const priceB = parseInt(b.price.replace(/[^0-9]/g, ''));
          return priceB - priceA;
        });
        break;
      case 'rating':
        result.sort((a, b) => parseFloat(b.rating.toString()) - parseFloat(a.rating.toString()));
        break;
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
      <View style={styles.propertyImagePlaceholder}>
        <Text style={styles.placeholderText}>{item.neighborhood}</Text>
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
      </View>
      
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
                <Text style={styles.sortText}>€↑</Text>
              </TouchableOpacity>
              <TouchableOpacity 
                style={[styles.sortOption, activeSort === 'price_desc' && styles.activeSortOption]}
                onPress={() => setActiveSort('price_desc')}
              >
                <Text style={styles.sortText}>€↓</Text>
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
    backgroundColor: colors.COLOR_BACKGROUND,
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
  propertyImagePlaceholder: {
    height: 150,
    backgroundColor: '#f5f5f5',
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
  },
  placeholderText: {
    fontSize: 18,
    fontWeight: 'bold',
    color: colors.COLOR_BLACK_LIGHT_3,
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