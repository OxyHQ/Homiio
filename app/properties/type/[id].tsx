import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, FlatList, ActivityIndicator, TouchableOpacity } from 'react-native';
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
  price: string;
  bedrooms: number;
  bathrooms: number;
  size: number;
  isVerified: boolean;
  isEcoCertified: boolean;
  features: string[];
  rating: number;
  imageUrl?: string;
};

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
  const [loading, setLoading] = useState(true);
  const [properties, setProperties] = useState<Property[]>([]);
  const [propertyType, setPropertyType] = useState<PropertyType | null>(null);
  const [activeFilter, setActiveFilter] = useState<string | null>(null);

  // Filter options can vary based on property type
  const [filterOptions, setFilterOptions] = useState<Array<{ id: string; label: string; icon: string }>>([]);

  useEffect(() => {
    // Simulate API call to get property type details and properties
    const fetchData = setTimeout(() => {
      let typeData: PropertyType | null = null;

      // Mock property type data based on ID
      switch(id) {
        case '1': // Apartments
          typeData = {
            id: '1',
            name: 'Apartments',
            description: 'Modern apartments in urban centers with convenient access to amenities and transportation.',
            icon: 'business-outline',
            propertiesCount: 85
          };
          setFilterOptions([
            { id: 'balcony', label: t('Balcony'), icon: 'sunny-outline' },
            { id: 'elevator', label: t('Elevator'), icon: 'arrow-up-outline' },
            { id: 'furnished', label: t('Furnished'), icon: 'bed-outline' },
            { id: 'pets', label: t('Pets Allowed'), icon: 'paw-outline' },
          ]);
          break;
        case '2': // Houses
          typeData = {
            id: '2',
            name: 'Houses',
            description: 'Spacious houses with private gardens and multiple bedrooms for families and shared living.',
            icon: 'home-outline',
            propertiesCount: 62
          };
          setFilterOptions([
            { id: 'garden', label: t('Garden'), icon: 'leaf-outline' },
            { id: 'parking', label: t('Parking'), icon: 'car-outline' },
            { id: 'fireplace', label: t('Fireplace'), icon: 'flame-outline' },
            { id: 'pets', label: t('Pets Allowed'), icon: 'paw-outline' },
          ]);
          break;
        case '3': // Co-living
          typeData = {
            id: '3',
            name: 'Co-Living Spaces',
            description: 'Shared living environments with private bedrooms and community-oriented common spaces.',
            icon: 'people-outline',
            propertiesCount: 43
          };
          setFilterOptions([
            { id: 'workspace', label: t('Workspace'), icon: 'laptop-outline' },
            { id: 'events', label: t('Events'), icon: 'calendar-outline' },
            { id: 'gym', label: t('Gym Access'), icon: 'barbell-outline' },
            { id: 'cleaning', label: t('Cleaning'), icon: 'sparkles-outline' },
          ]);
          break;
        case '4': // Eco-friendly
          typeData = {
            id: '4',
            name: 'Eco-Friendly',
            description: 'Sustainable properties with energy-efficient features and environmentally-conscious design.',
            icon: 'leaf-outline',
            propertiesCount: 38
          };
          setFilterOptions([
            { id: 'solar', label: t('Solar Panels'), icon: 'sunny-outline' },
            { id: 'garden', label: t('Garden'), icon: 'leaf-outline' },
            { id: 'ecoRating', label: t('A+ Rating'), icon: 'ribbon-outline' },
            { id: 'water', label: t('Water Saving'), icon: 'water-outline' },
          ]);
          break;
        default:
          typeData = {
            id: id as string,
            name: 'Properties',
            description: 'Browse our selection of quality properties.',
            icon: 'home-outline',
            propertiesCount: 30
          };
          setFilterOptions([
            { id: 'verified', label: t('Verified'), icon: 'shield-checkmark-outline' },
            { id: 'furnished', label: t('Furnished'), icon: 'bed-outline' },
            { id: 'pets', label: t('Pets Allowed'), icon: 'paw-outline' },
          ]);
      }
      
      setPropertyType(typeData);

      // Generate mock properties based on the type
      const mockProperties: Property[] = [];
      const featureSets = {
        '1': ['Balcony', 'City View', 'Elevator', 'Security', 'Close to Transport'],
        '2': ['Garden', 'Parking', 'Terrace', 'Storage', 'Family Room'],
        '3': ['Shared Kitchen', 'Events Space', 'Co-working Area', 'Laundry Service', 'Community Activities'],
        '4': ['Solar Panels', 'Rainwater Collection', 'Energy Efficient', 'Sustainable Materials', 'Green Roof'],
      };

      const features = featureSets[id as keyof typeof featureSets] || 
        ['Wi-Fi', 'Central Location', 'Modern Design', 'Well Maintained'];
      
      for (let i = 1; i <= 12; i++) {
        const randomFeatures: string[] = [];
        const featureCount = Math.floor(Math.random() * 3) + 2; // 2-4 features
        
        for (let j = 0; j < featureCount; j++) {
          const feature = features[Math.floor(Math.random() * features.length)];
          if (!randomFeatures.includes(feature)) {
            randomFeatures.push(feature);
          }
        }

        const isEco = id === '4' || Math.random() > 0.7;

        mockProperties.push({
          id: `${id}-${i}`,
          title: `${i % 3 === 0 ? 'Modern' : i % 3 === 1 ? 'Cozy' : 'Spacious'} ${
            id === '1' ? 'Apartment' : 
            id === '2' ? 'House' : 
            id === '3' ? 'Co-Living Space' : 
            'Property'
          }`,
          location: ['Barcelona', 'Berlin', 'Amsterdam', 'Stockholm'][Math.floor(Math.random() * 4)],
          price: `€${Math.floor(600 + Math.random() * 900)}/month`,
          bedrooms: id === '3' ? 1 : Math.floor(Math.random() * 3) + 1,
          bathrooms: Math.floor(Math.random() * 2) + 1,
          size: Math.floor(45 + Math.random() * 60),
          isVerified: Math.random() > 0.2,
          isEcoCertified: isEco,
          features: randomFeatures,
          rating: parseFloat((3.8 + Math.random() * 1.2).toFixed(1)),
        });
      }
      
      setProperties(mockProperties);
      setLoading(false);
    }, 1000);

    return () => clearTimeout(fetchData);
  }, [id, t]);

  const getFilteredProperties = () => {
    if (!activeFilter) return properties;
    
    switch(activeFilter) {
      case 'balcony':
        return properties.filter(p => p.features.some(f => f.toLowerCase().includes('balcony')));
      case 'elevator':
        return properties.filter(p => p.features.some(f => f.toLowerCase().includes('elevator')));
      case 'furnished':
        return properties.filter(p => p.features.some(f => 
          f.toLowerCase().includes('furnished') || f.toLowerCase().includes('bed')
        ));
      case 'garden':
        return properties.filter(p => p.features.some(f => f.toLowerCase().includes('garden')));
      case 'parking':
        return properties.filter(p => p.features.some(f => f.toLowerCase().includes('parking')));
      case 'fireplace':
        return properties.filter(p => p.features.some(f => f.toLowerCase().includes('fireplace')));
      case 'workspace':
        return properties.filter(p => p.features.some(f => 
          f.toLowerCase().includes('workspace') || f.toLowerCase().includes('working')
        ));
      case 'events':
        return properties.filter(p => p.features.some(f => 
          f.toLowerCase().includes('event') || f.toLowerCase().includes('activities')
        ));
      case 'gym':
        return properties.filter(p => p.features.some(f => f.toLowerCase().includes('gym')));
      case 'cleaning':
        return properties.filter(p => p.features.some(f => 
          f.toLowerCase().includes('cleaning') || f.toLowerCase().includes('laundry') || f.toLowerCase().includes('service')
        ));
      case 'solar':
        return properties.filter(p => p.features.some(f => f.toLowerCase().includes('solar')));
      case 'ecoRating':
        return properties.filter(p => p.isEcoCertified);
      case 'water':
        return properties.filter(p => p.features.some(f => f.toLowerCase().includes('water')));
      case 'pets':
        return properties.filter(p => p.features.some(f => f.toLowerCase().includes('pet')));
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

  const renderPropertyItem = ({ item }: { item: Property }) => (
    <TouchableOpacity 
      style={styles.propertyCard}
      onPress={() => router.push(`/properties/${item.id}`)}
    >
      <View style={styles.propertyImagePlaceholder}>
        {/* This would be replaced with an actual image in a real app */}
        <Ionicons name={propertyType?.icon as any} size={40} color={colors.COLOR_BLACK_LIGHT_3} />
        
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
        
        <View style={styles.featuresContainer}>
          {item.features.slice(0, 3).map((feature, index) => (
            <View key={index} style={styles.featureTag}>
              <Text style={styles.featureText}>{feature}</Text>
            </View>
          ))}
          {item.features.length > 3 && (
            <Text style={styles.moreFeatures}>+{item.features.length - 3}</Text>
          )}
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
          keyExtractor={(item) => item.id}
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