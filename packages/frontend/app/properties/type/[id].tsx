import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, FlatList, ActivityIndicator, TouchableOpacity } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useRouter, useLocalSearchParams } from 'expo-router';
import { colors } from '@/styles/colors';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Header } from '@/components/Header';
import { generatePropertyTitle } from '@/utils/propertyTitleGenerator';
import { useProperties } from '@/hooks/usePropertyQueries';
import { Property } from '@/services/propertyService';

type PropertyType = {
  id: string;
  name: string;
  description: string;
  icon: string;
  propertiesCount: number;
};

export default function PropertyTypePage() {
  const { t } = useTranslation();
  const router = useRouter();
  const { id } = useLocalSearchParams();
  const [activeFilter, setActiveFilter] = useState<string | null>(null);
  const [properties, setProperties] = useState<Property[]>([]);
  const [loading, setLoading] = useState(true);

  // Use real API data instead of mock data
  const { data: apiData, isLoading, error } = useProperties({ type: id as string });

  // Property type definitions
  const propertyTypes: { [key: string]: PropertyType } = {
    'apartment': {
      id: 'apartment',
      name: t('Apartments'),
      description: t('Modern apartments with all amenities'),
      icon: 'business-outline',
      propertiesCount: apiData?.properties?.length || 0,
    },
    'house': {
      id: 'house',
      name: t('Houses'),
      description: t('Spacious houses with gardens'),
      icon: 'home-outline',
      propertiesCount: apiData?.properties?.length || 0,
    },
    'room': {
      id: 'room',
      name: t('Rooms'),
      description: t('Individual rooms in shared spaces'),
      icon: 'bed-outline',
      propertiesCount: apiData?.properties?.length || 0,
    },
    'studio': {
      id: 'studio',
      name: t('Studios'),
      description: t('Compact studio apartments'),
      icon: 'home-outline',
      propertiesCount: apiData?.properties?.length || 0,
    },
    'coliving': {
      id: 'coliving',
      name: t('Co-Living'),
      description: t('Shared spaces for community living'),
      icon: 'people-outline',
      propertiesCount: apiData?.properties?.length || 0,
    },
  };

  const propertyType = propertyTypes[id as string];

  // Update properties when API data changes
  useEffect(() => {
    if (apiData?.properties) {
      setProperties(apiData.properties);
      setLoading(false);
    }
  }, [apiData]);

  // Filter options
  const filterOptions = [
    { id: 'balcony', label: t('Balcony'), icon: 'sunny-outline' },
    { id: 'elevator', label: t('Elevator'), icon: 'arrow-up-outline' },
    { id: 'furnished', label: t('Furnished'), icon: 'bed-outline' },
    { id: 'garden', label: t('Garden'), icon: 'leaf-outline' },
    { id: 'parking', label: t('Parking'), icon: 'car-outline' },
    { id: 'fireplace', label: t('Fireplace'), icon: 'flame-outline' },
    { id: 'workspace', label: t('Workspace'), icon: 'laptop-outline' },
    { id: 'events', label: t('Events'), icon: 'calendar-outline' },
    { id: 'gym', label: t('Gym'), icon: 'fitness-outline' },
    { id: 'cleaning', label: t('Cleaning'), icon: 'brush-outline' },
    { id: 'solar', label: t('Solar'), icon: 'sunny-outline' },
    { id: 'ecoRating', label: t('Eco Rating'), icon: 'leaf-outline' },
    { id: 'water', label: t('Water'), icon: 'water-outline' },
    { id: 'pets', label: t('Pets'), icon: 'paw-outline' },
  ];

  const getFilteredProperties = () => {
    if (!activeFilter) return properties;

    switch (activeFilter) {
      case 'balcony':
        return properties.filter(p => p.amenities?.some(a => a.toLowerCase().includes('balcony')));
      case 'elevator':
        return properties.filter(p => p.amenities?.some(a => a.toLowerCase().includes('elevator')));
      case 'furnished':
        return properties.filter(p => p.amenities?.some(a =>
          a.toLowerCase().includes('furnished') || a.toLowerCase().includes('bed')
        ));
      case 'garden':
        return properties.filter(p => p.amenities?.some(a => a.toLowerCase().includes('garden')));
      case 'parking':
        return properties.filter(p => p.amenities?.some(a => a.toLowerCase().includes('parking')));
      case 'fireplace':
        return properties.filter(p => p.amenities?.some(a => a.toLowerCase().includes('fireplace')));
      case 'workspace':
        return properties.filter(p => p.amenities?.some(a =>
          a.toLowerCase().includes('workspace') || a.toLowerCase().includes('working')
        ));
      case 'events':
        return properties.filter(p => p.amenities?.some(a =>
          a.toLowerCase().includes('event') || a.toLowerCase().includes('activities')
        ));
      case 'gym':
        return properties.filter(p => p.amenities?.some(a => a.toLowerCase().includes('gym')));
      case 'cleaning':
        return properties.filter(p => p.amenities?.some(a =>
          a.toLowerCase().includes('cleaning') || a.toLowerCase().includes('laundry') || a.toLowerCase().includes('service')
        ));
      case 'solar':
        return properties.filter(p => p.amenities?.some(a => a.toLowerCase().includes('solar')));
      case 'ecoRating':
        return properties.filter(p => p.amenities?.some(a => a.toLowerCase().includes('eco')));
      case 'water':
        return properties.filter(p => p.amenities?.some(a => a.toLowerCase().includes('water')));
      case 'pets':
        return properties.filter(p => p.amenities?.some(a => a.toLowerCase().includes('pet')));
      default:
        return properties;
    }
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

  const renderPropertyItem = ({ item }: { item: Property }) => {
    // Generate title dynamically from real property data
    const generatedTitle = generatePropertyTitle({
      type: item.type,
      address: item.address,
      bedrooms: item.bedrooms,
      bathrooms: item.bathrooms
    });

    const isEcoCertified = item.amenities?.some(a =>
      a.toLowerCase().includes('eco') ||
      a.toLowerCase().includes('green') ||
      a.toLowerCase().includes('solar')
    );

    return (
      <TouchableOpacity
        style={styles.propertyCard}
        onPress={() => router.push(`/properties/${item._id || item.id}`)}
      >
        <View style={styles.propertyImagePlaceholder}>
          <Ionicons name={propertyType?.icon as any} size={40} color={colors.COLOR_BLACK_LIGHT_3} />

          {item.status === 'available' && (
            <View style={styles.verifiedBadge}>
              <Ionicons name="shield-checkmark" size={14} color="white" />
            </View>
          )}

          {isEcoCertified && (
            <View style={styles.ecoBadge}>
              <Ionicons name="leaf" size={14} color="white" />
            </View>
          )}
        </View>

        <View style={styles.propertyContent}>
          <Text style={styles.propertyTitle} numberOfLines={1}>{generatedTitle}</Text>

          <Text style={styles.propertyLocation}>
            <Ionicons name="location-outline" size={14} color={colors.COLOR_BLACK_LIGHT_3} />
            {item.address?.city}, {item.address?.state}
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
              <Text style={styles.detailText}>{item.squareFootage} m²</Text>
            </View>
          </View>

          <View style={styles.featuresContainer}>
            {item.amenities?.slice(0, 3).map((amenity, index) => (
              <View key={index} style={styles.featureTag}>
                <Text style={styles.featureText}>{amenity}</Text>
              </View>
            ))}
            {item.amenities && item.amenities.length > 3 && (
              <Text style={styles.moreFeatures}>+{item.amenities.length - 3}</Text>
            )}
          </View>

          <View style={styles.propertyFooter}>
            <Text style={styles.propertyPrice}>
              {item.rent?.currency || '⊜'}{item.rent?.amount}/{item.rent?.paymentFrequency || 'month'}
            </Text>
            <View style={styles.ratingContainer}>
              <Ionicons name="star" size={14} color="#FFD700" />
              <Text style={styles.ratingText}>4.5</Text>
            </View>
          </View>
        </View>
      </TouchableOpacity>
    );
  };

  if (loading || !propertyType) {
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
          <Text style={styles.loadingText}>
            {!propertyType ? t("Property type not found") : t("Loading properties...")}
          </Text>
        </View>
      </SafeAreaView>
    );
  }

  if (error) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <Header
          options={{
            showBackButton: true,
            title: t("Error"),
            titlePosition: 'center',
          }}
        />
        <View style={styles.loadingContainer}>
          <Ionicons name="alert-circle-outline" size={60} color={colors.COLOR_BLACK_LIGHT_3} />
          <Text style={styles.loadingText}>
            {t("Failed to load properties")}
          </Text>
          <TouchableOpacity
            style={styles.resetButton}
            onPress={() => window.location.reload()}
          >
            <Text style={styles.resetButtonText}>{t("Try Again")}</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <Header
        options={{
          showBackButton: true,
          title: propertyType.name,
          titlePosition: 'center',
        }}
      />

      <View style={styles.container}>
        {/* Type Overview */}
        <View style={styles.typeOverview}>
          <View style={styles.typeIconContainer}>
            <Ionicons name={propertyType.icon as any} size={30} color={colors.primaryColor} />
          </View>

          <View style={styles.typeContent}>
            <Text style={styles.typeTitle}>{propertyType.name}</Text>
            <Text style={styles.typeDescription}>{propertyType.description}</Text>
            <Text style={styles.typeCount}>
              {propertyType.propertiesCount} {t("available properties")}
            </Text>
          </View>
        </View>

        {/* Filters */}
        <View style={styles.filtersContainer}>
          <Text style={styles.filtersTitle}>{t("Filter by:")}</Text>
          <View style={styles.filtersRow}>
            {filterOptions.map(renderFilterOption)}
          </View>
        </View>

        {/* Properties List */}
        <FlatList
          data={getFilteredProperties()}
          renderItem={renderPropertyItem}
          keyExtractor={(item) => item._id || item.id}
          contentContainerStyle={styles.propertiesList}
          showsVerticalScrollIndicator={false}
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
  typeOverview: {
    flexDirection: 'row',
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
  typeIconContainer: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: colors.primaryLight,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 15,
  },
  typeContent: {
    flex: 1,
    justifyContent: 'center',
  },
  typeTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: colors.COLOR_BLACK,
    marginBottom: 5,
  },
  typeDescription: {
    fontSize: 14,
    color: colors.COLOR_BLACK_LIGHT_3,
    lineHeight: 20,
    marginBottom: 5,
  },
  typeCount: {
    fontSize: 14,
    color: colors.primaryColor,
    fontWeight: '600',
  },
  filtersContainer: {
    marginBottom: 15,
  },
  filtersTitle: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 10,
    color: colors.COLOR_BLACK,
  },
  filtersRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  filterOption: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: colors.primaryLight,
    borderRadius: 20,
    marginBottom: 8,
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
  featuresContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: 10,
    alignItems: 'center',
  },
  featureTag: {
    backgroundColor: '#f0f0f0',
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 4,
    marginRight: 6,
    marginBottom: 6,
  },
  featureText: {
    fontSize: 12,
    color: colors.COLOR_BLACK_LIGHT_3,
  },
  moreFeatures: {
    fontSize: 12,
    color: colors.COLOR_BLACK_LIGHT_3,
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
    marginTop: 40,
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