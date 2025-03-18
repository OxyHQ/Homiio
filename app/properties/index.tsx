import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, ActivityIndicator, ScrollView } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { colors } from '@/styles/colors';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Header } from '@/components/Header';
import { SearchBar } from '@/components/SearchBar';

export type Property = {
  id: string;
  title: string;
  location: string;
  price: string;
  bedrooms: number;
  bathrooms: number;
  size: number;
  isVerified: boolean;
  isEcoCertified: boolean;
  rating: number;
  image: string; // placeholder for now
};

export default function PropertiesPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [properties, setProperties] = useState<Property[]>([]);
  const [activeFilter, setActiveFilter] = useState<string | null>(null);

  const filterOptions = [
    { id: 'verified', label: t('Verified'), icon: 'shield-checkmark' },
    { id: 'eco', label: t('Eco-Certified'), icon: 'leaf' },
    { id: 'coliving', label: t('Co-Living'), icon: 'people' },
    { id: 'price', label: t('Price'), icon: 'cash' },
  ];

  useEffect(() => {
    // Simulating API call with a timeout
    const fetchProperties = setTimeout(() => {
      const mockProperties: Property[] = [
        {
          id: '1',
          title: 'Modern Studio Apartment',
          location: 'Barcelona, Spain',
          price: '€850/month',
          bedrooms: 1,
          bathrooms: 1,
          size: 45,
          isVerified: true,
          isEcoCertified: true,
          rating: 4.8,
          image: '',
        },
        {
          id: '2',
          title: 'Co-living Space with Garden',
          location: 'Berlin, Germany',
          price: '€550/month',
          bedrooms: 1,
          bathrooms: 1,
          size: 30,
          isVerified: true,
          isEcoCertified: false,
          rating: 4.9,
          image: '',
        },
        {
          id: '3',
          title: 'Spacious 2-Bedroom Apartment',
          location: 'Amsterdam, Netherlands',
          price: '€1200/month',
          bedrooms: 2,
          bathrooms: 1,
          size: 65,
          isVerified: true,
          isEcoCertified: false,
          rating: 4.7,
          image: '',
        },
        {
          id: '4',
          title: 'Eco-friendly Family Home',
          location: 'Stockholm, Sweden',
          price: '€1500/month',
          bedrooms: 3,
          bathrooms: 2,
          size: 95,
          isVerified: true,
          isEcoCertified: true,
          rating: 4.9,
          image: '',
        },
        {
          id: '5',
          title: 'City Center Loft',
          location: 'Barcelona, Spain',
          price: '€950/month',
          bedrooms: 1,
          bathrooms: 1,
          size: 55,
          isVerified: true,
          isEcoCertified: false,
          rating: 4.6,
          image: '',
        },
        {
          id: '6',
          title: 'Student Co-living Hub',
          location: 'Berlin, Germany',
          price: '€450/month',
          bedrooms: 1,
          bathrooms: 1,
          size: 25,
          isVerified: true,
          isEcoCertified: true,
          rating: 4.5,
          image: '',
        },
      ];
      
      setProperties(mockProperties);
      setLoading(false);
    }, 1000);

    return () => clearTimeout(fetchProperties);
  }, []);

  const handleFilterPress = (filterId: string) => {
    setActiveFilter(activeFilter === filterId ? null : filterId);
  };

  const getFilteredProperties = () => {
    if (!activeFilter) return properties;

    switch (activeFilter) {
      case 'verified':
        return properties.filter(property => property.isVerified);
      case 'eco':
        return properties.filter(property => property.isEcoCertified);
      case 'coliving':
        return properties.filter(property => property.title.toLowerCase().includes('co-living'));
      case 'price':
        return properties.sort((a, b) => {
          const priceA = parseInt(a.price.replace(/[^0-9]/g, ''));
          const priceB = parseInt(b.price.replace(/[^0-9]/g, ''));
          return priceA - priceB;
        });
      default:
        return properties;
    }
  };

  const renderPropertyItem = ({ item }: { item: Property }) => (
    <TouchableOpacity
      style={styles.propertyCard}
      onPress={() => router.push(`/properties/${item.id}`)}
    >
      <View style={styles.imageContainer}>
        <View style={styles.propertyImagePlaceholder}>
          <Text style={styles.propertyImageText}>Property Image</Text>
        </View>
        
        {/* Badges */}
        <View style={styles.badgeContainer}>
          {item.isVerified && (
            <View style={styles.verifiedBadge}>
              <Ionicons name="shield-checkmark" size={12} color="white" />
              <Text style={styles.badgeText}>{t("Verified")}</Text>
            </View>
          )}
          
          {item.isEcoCertified && (
            <View style={styles.ecoBadge}>
              <Ionicons name="leaf" size={12} color="white" />
              <Text style={styles.badgeText}>{t("Eco")}</Text>
            </View>
          )}
        </View>
      </View>
      
      <View style={styles.propertyInfo}>
        <Text style={styles.propertyTitle} numberOfLines={1}>{item.title}</Text>
        
        <View style={styles.locationContainer}>
          <Ionicons name="location" size={14} color={colors.COLOR_BLACK_LIGHT_3} />
          <Text style={styles.locationText}>{item.location}</Text>
        </View>
        
        <View style={styles.propertyDetails}>
          <View style={styles.detailItem}>
            <Ionicons name="bed-outline" size={16} color={colors.COLOR_BLACK} />
            <Text style={styles.detailText}>{item.bedrooms}</Text>
          </View>
          
          <View style={styles.detailItem}>
            <Ionicons name="water-outline" size={16} color={colors.COLOR_BLACK} />
            <Text style={styles.detailText}>{item.bathrooms}</Text>
          </View>
          
          <View style={styles.detailItem}>
            <Ionicons name="resize-outline" size={16} color={colors.COLOR_BLACK} />
            <Text style={styles.detailText}>{item.size} m²</Text>
          </View>
          
          <View style={styles.ratingContainer}>
            <Ionicons name="star" size={16} color="#FFD700" />
            <Text style={styles.ratingText}>{item.rating}</Text>
          </View>
        </View>
        
        <Text style={styles.priceText}>{item.price}</Text>
      </View>
    </TouchableOpacity>
  );

  const renderFilterOption = (option: { id: string; label: string; icon: string }) => (
    <TouchableOpacity
      key={option.id}
      style={[
        styles.filterOption,
        activeFilter === option.id && styles.activeFilterOption
      ]}
      onPress={() => handleFilterPress(option.id)}
    >
      <Ionicons
        name={option.icon as any}
        size={18}
        color={activeFilter === option.id ? 'white' : colors.COLOR_BLACK}
      />
      <Text
        style={[
          styles.filterText,
          activeFilter === option.id && styles.activeFilterText
        ]}
      >
        {option.label}
      </Text>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <Header
        options={{
          title: t("Explore Properties"),
          titlePosition: 'center',
          rightComponents: [
            <TouchableOpacity
              key="add"
              style={styles.headerButton}
              onPress={() => router.push('/properties/add')}
            >
              <Ionicons name="add-circle-outline" size={24} color={colors.COLOR_BLACK} />
            </TouchableOpacity>,
          ],
        }}
      />
      
      <View style={styles.container}>
        <View style={styles.searchContainer}>
          <SearchBar />
          
          <TouchableOpacity
            style={styles.mapButton}
            onPress={() => router.push('/properties/map')}
          >
            <Ionicons name="map-outline" size={22} color={colors.COLOR_BLACK} />
          </TouchableOpacity>
        </View>
        
        <View style={styles.filtersContainer}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.filtersScrollView}
          >
            {filterOptions.map(renderFilterOption)}
          </ScrollView>
        </View>
        
        {loading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={colors.primaryColor} />
            <Text style={styles.loadingText}>{t("Loading properties...")}</Text>
          </View>
        ) : (
          <FlatList
            data={getFilteredProperties()}
            renderItem={renderPropertyItem}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.listContainer}
            numColumns={1}
          />
        )}
      </View>
      
      <TouchableOpacity 
        style={styles.addPropertyButton}
        onPress={() => router.push('/properties/add')}
      >
        <Ionicons name="add" size={24} color="white" />
      </TouchableOpacity>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: colors.primaryLight,
  },
  container: {
    flex: 1,
    padding: 15,
  },
  headerButton: {
    padding: 8,
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 15,
  },
  mapButton: {
    width: 45,
    height: 45,
    backgroundColor: colors.primaryLight,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 10,
    marginLeft: 10,
  },
  filtersContainer: {
    marginBottom: 15,
  },
  filtersScrollView: {
    paddingRight: 20,
  },
  filterOption: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: colors.primaryLight,
    borderRadius: 20,
    marginRight: 10,
  },
  activeFilterOption: {
    backgroundColor: colors.primaryColor,
  },
  filterText: {
    marginLeft: 6,
    fontWeight: '500',
    color: colors.COLOR_BLACK,
  },
  activeFilterText: {
    color: 'white',
  },
  listContainer: {
    paddingBottom: 20,
  },
  propertyCard: {
    backgroundColor: 'white',
    borderRadius: 15,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
    marginBottom: 15,
    overflow: 'hidden',
  },
  imageContainer: {
    position: 'relative',
  },
  propertyImagePlaceholder: {
    width: '100%',
    height: 180,
    backgroundColor: '#e0e0e0',
    justifyContent: 'center',
    alignItems: 'center',
  },
  propertyImageText: {
    color: colors.COLOR_BLACK_LIGHT_4,
  },
  badgeContainer: {
    position: 'absolute',
    top: 10,
    left: 10,
    flexDirection: 'row',
  },
  verifiedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.primaryColor,
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 12,
    marginRight: 8,
  },
  ecoBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'green',
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 12,
  },
  badgeText: {
    color: 'white',
    fontSize: 11,
    marginLeft: 4,
    fontWeight: '500',
  },
  propertyInfo: {
    padding: 15,
  },
  propertyTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 5,
  },
  locationContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  locationText: {
    marginLeft: 4,
    fontSize: 14,
    color: colors.COLOR_BLACK_LIGHT_3,
  },
  propertyDetails: {
    flexDirection: 'row',
    marginBottom: 10,
  },
  detailItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: 15,
  },
  detailText: {
    fontSize: 14,
    marginLeft: 5,
    color: colors.COLOR_BLACK,
  },
  ratingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: 'auto',
  },
  ratingText: {
    fontSize: 14,
    fontWeight: '500',
    marginLeft: 5,
  },
  priceText: {
    fontSize: 18,
    fontWeight: 'bold',
    color: colors.primaryColor,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 10,
    color: colors.COLOR_BLACK_LIGHT_3,
  },
  addPropertyButton: {
    position: 'absolute',
    bottom: 20,
    right: 20,
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: colors.primaryColor,
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
  },
});