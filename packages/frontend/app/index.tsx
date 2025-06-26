import React, { useState, useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity, Image, RefreshControl } from 'react-native';
import LoadingSpinner from '@/components/LoadingSpinner';
import { useTranslation } from 'react-i18next';
import { useRouter } from 'expo-router';
import { colors } from '@/styles/colors';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useDocumentTitle, useSEO } from '@/hooks/useDocumentTitle';
import { useColorScheme } from "@/hooks/useColorScheme";
import { Toaster } from '@/lib/sonner';
import { LinearGradient } from 'expo-linear-gradient';

// Import real data hooks
import { useProperties } from '@/hooks/usePropertyQueries';
import { useOxy } from '@oxyhq/services';

// Import components
import { PropertyCard } from '@/components/PropertyCard';
import { RecentlyViewedWidget } from '@/components/widgets/RecentlyViewedWidget';
import { FeaturedPropertiesWidget } from '@/components/widgets/FeaturedPropertiesWidget';

// Import utils
import { generatePropertyTitle } from '@/utils/propertyTitleGenerator';
import { getPropertyImageSource } from '@/utils/propertyUtils';
import { AMENITY_CATEGORIES, getAmenitiesByCategory, ESSENTIAL_AMENITIES } from '@/constants/amenities';

// Type assertion for Ionicons compatibility with React 19
const IconComponent = Ionicons as any;

export default function HomePage() {
  const { t } = useTranslation();
  const router = useRouter();
  const [searchQuery, setSearchQuery] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const { oxyServices, activeSessionId } = useOxy();

  // Set enhanced SEO for home page
  useSEO({
    title: 'Find Your Ethical Home',
    description: 'Discover transparent rentals with fair agreements and verified properties. Join thousands of users finding their perfect ethical home on Homiio.',
    keywords: 'ethical housing, transparent rentals, verified properties, fair agreements, housing platform, rental search',
    type: 'website'
  });

  // Fetch real data
  const { data: propertiesData, isLoading: propertiesLoading, refetch: refetchProperties } = useProperties({
    limit: 8,
    status: 'available'
  });

  // Memoized data processing
  const featuredProperties = useMemo(() => {
    if (!propertiesData?.properties) return [];
    return propertiesData.properties.slice(0, 4);
  }, [propertiesData]);

  const propertyTypes = [
    { id: 'apartment', name: 'Apartments', icon: 'business-outline', count: 0 },
    { id: 'house', name: 'Houses', icon: 'home-outline', count: 0 },
    { id: 'room', name: 'Rooms', icon: 'bed-outline', count: 0 },
    { id: 'studio', name: 'Studios', icon: 'home-outline', count: 0 },
    { id: 'coliving', name: 'Co-living', icon: 'people-outline', count: 0 },
  ];

  // Calculate property type counts
  const propertyTypeCounts = useMemo(() => {
    if (!propertiesData?.properties) return propertyTypes;

    const counts = propertiesData.properties.reduce((acc, property) => {
      acc[property.type] = (acc[property.type] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    return propertyTypes.map(type => ({
      ...type,
      count: counts[type.id] || 0
    }));
  }, [propertiesData, propertyTypes]);

  // Get top cities from real data
  const topCities = useMemo(() => {
    if (!propertiesData?.properties) return [];

    const cityCounts = propertiesData.properties.reduce((acc, property) => {
      const city = property.address?.city;
      if (city) {
        acc[city] = (acc[city] || 0) + 1;
      }
      return acc;
    }, {} as Record<string, number>);

    return Object.entries(cityCounts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 4)
      .map(([city, count]) => ({ id: city, name: city, count }));
  }, [propertiesData]);

  const handleSearch = () => {
    if (searchQuery.trim()) {
      router.push(`/search/${encodeURIComponent(searchQuery)}`);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await refetchProperties();
    } catch (error) {
      console.error('Error refreshing data:', error);
    } finally {
      setRefreshing(false);
    }
  };

  const isAuthenticated = !!(oxyServices && activeSessionId);

  return (
    <SafeAreaView style={{ flex: 1 }} edges={['top']}>
      <ScrollView
        style={styles.container}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
      >
        {/* Hero Section */}
        <LinearGradient
          // Background Linear Gradient
          colors={[colors.primaryColor, colors.secondaryLight]}
          style={styles.heroSection}
        >
          <View style={styles.heroContent}>
            <Text style={styles.heroTitle}>{t("home.hero.title")}</Text>
            <Text style={styles.heroSubtitle}>
              {t("home.hero.subtitle")}
            </Text>

            <View style={styles.searchContainer}>
              <View style={styles.searchBar}>
                <IconComponent name="search" size={20} color={colors.COLOR_BLACK_LIGHT_4} />
                <TextInput
                  style={styles.searchInput}
                  placeholder={t("home.hero.searchPlaceholder")}
                  value={searchQuery}
                  onChangeText={setSearchQuery}
                  onSubmitEditing={handleSearch}
                />
              </View>
              <TouchableOpacity style={styles.searchButton} onPress={handleSearch}>
                <Text style={styles.searchButtonText}>{t("home.hero.searchButton")}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </LinearGradient>

        {/* Trust Features */}
        <View style={styles.trustSection}>
          <Text style={styles.sectionTitle}>{t("home.trust.title")}</Text>
          <View style={styles.trustFeatures}>
            <View style={styles.trustFeature}>
              <View style={styles.featureIconCircle}>
                <IconComponent name="shield-checkmark" size={24} color={colors.primaryColor} />
              </View>
              <Text style={styles.featureTitle}>{t("home.trust.verifiedListings.title")}</Text>
              <Text style={styles.featureDescription}>
                {t("home.trust.verifiedListings.description")}
              </Text>
            </View>

            <View style={styles.trustFeature}>
              <View style={styles.featureIconCircle}>
                <IconComponent name="document-text" size={24} color={colors.primaryColor} />
              </View>
              <Text style={styles.featureTitle}>{t("home.trust.fairAgreements.title")}</Text>
              <Text style={styles.featureDescription}>
                {t("home.trust.fairAgreements.description")}
              </Text>
            </View>

            <View style={styles.trustFeature}>
              <View style={styles.featureIconCircle}>
                <IconComponent name="star" size={24} color={colors.primaryColor} />
              </View>
              <Text style={styles.featureTitle}>{t("home.trust.trustScore.title")}</Text>
              <Text style={styles.featureDescription}>
                {t("home.trust.trustScore.description")}
              </Text>
            </View>
          </View>
        </View>

        {/* Featured Properties */}
        <View style={styles.featuredSection}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>{t("home.featured.title")}</Text>
            <TouchableOpacity onPress={() => router.push('/properties')}>
              <Text style={styles.viewAllText}>{t("home.viewAll")}</Text>
            </TouchableOpacity>
          </View>

          {propertiesLoading ? (
            <View style={styles.loadingContainer}>
              <LoadingSpinner size={32} />
              <Text style={styles.loadingText}>Loading properties...</Text>
            </View>
          ) : featuredProperties.length > 0 ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.horizontalScroll}>
              {featuredProperties.map((property) => (
                <View key={property._id || property.id} style={styles.propertyCardContainer}>
                  <PropertyCard
                    property={property}
                    variant="featured"
                    onPress={() => router.push(`/properties/${property._id || property.id}`)}
                    badgeContent={
                      property.amenities?.includes('verified') && (
                        <View style={styles.verifiedBadge}>
                          <Text style={styles.verifiedBadgeText}>VERIFIED</Text>
                        </View>
                      )
                    }
                  />
                </View>
              ))}
            </ScrollView>
          ) : (
            <View style={styles.emptyContainer}>
              <IconComponent name="home-outline" size={48} color={colors.COLOR_BLACK_LIGHT_4} />
              <Text style={styles.emptyText}>No properties available</Text>
              <Text style={styles.emptySubtext}>Check back later for new listings</Text>
            </View>
          )}
        </View>

        {/* Top Cities */}
        <View style={styles.citiesSection}>
          <Text style={styles.sectionTitle}>{t("home.cities.title")}</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.horizontalScroll}>
            {topCities.map((city, index) => (
              <TouchableOpacity
                key={city.id}
                style={styles.cityCard}
                onPress={() => router.push(`/properties/city/${city.id}`)}
                activeOpacity={0.8}
              >
                <LinearGradient
                  colors={[colors.primaryColor, colors.secondaryLight]}
                  style={styles.cityImagePlaceholder}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                >
                  {/* Location Icon */}
                  <View style={styles.cityIconContainer}>
                    <IconComponent name="location" size={24} color="white" />
                  </View>

                  {/* City Name */}
                  <Text style={styles.cityName}>{city.name}</Text>

                  {/* Property Count Badge */}
                  <View style={styles.propertyCountBadge}>
                    <IconComponent name="home" size={12} color={colors.COLOR_BLACK} />
                    <Text style={styles.propertyCountText}>{city.count}</Text>
                  </View>
                </LinearGradient>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>

        {/* Property Types */}
        <View style={styles.typesSection}>
          <Text style={styles.sectionTitle}>{t("home.categories.title")}</Text>
          <View style={styles.propertyChipsContainer}>
            {propertyTypeCounts.map((type) => (
              <TouchableOpacity
                key={type.id}
                style={styles.propertyChip}
                onPress={() => router.push(`/properties/type/${type.id}`)}
                activeOpacity={0.8}
              >
                <LinearGradient
                  colors={[colors.primaryColor, colors.secondaryLight]}
                  style={styles.propertyChipGradient}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                >
                  <IconComponent name={type.icon as keyof typeof IconComponent.glyphMap} size={20} color="white" />
                  <Text style={styles.propertyChipName}>{type.name}</Text>
                  <View style={styles.propertyChipCountBadge}>
                    <Text style={styles.propertyChipCountText}>{type.count}</Text>
                  </View>
                </LinearGradient>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Popular Amenities Showcase */}
        <View style={styles.amenitiesShowcase}>
          <Text style={styles.sectionTitle}>Popular Amenities</Text>
          <Text style={styles.amenitySectionSubtitle}>
            Essential features most renters look for
          </Text>
          <View style={styles.amenityChipsContainer}>
            {ESSENTIAL_AMENITIES.slice(0, 12).map((amenityId) => {
              const amenity = getAmenitiesByCategory('essential').find(a => a.id === amenityId) ||
                getAmenitiesByCategory('accessibility').find(a => a.id === amenityId) ||
                getAmenitiesByCategory('eco').find(a => a.id === amenityId);

              if (!amenity) return null;

              return (
                <TouchableOpacity
                  key={amenity.id}
                  style={[
                    styles.homeAmenityChip,
                    amenity.essential && styles.homeEssentialChip,
                    amenity.accessibility && styles.homeAccessibilityChip,
                    amenity.environmental === 'positive' && styles.homeEcoChip,
                  ]}
                  onPress={() => router.push(`/properties/search?amenities=${amenity.id}`)}
                >
                  <IconComponent
                    name={amenity.icon as keyof typeof IconComponent.glyphMap}
                    size={16}
                    color={
                      amenity.accessibility ? '#6366f1' :
                        amenity.essential ? '#059669' :
                          amenity.environmental === 'positive' ? '#16a34a' :
                            colors.primaryColor
                    }
                  />
                  <Text style={[
                    styles.homeAmenityChipText,
                    amenity.essential && styles.homeEssentialChipText,
                    amenity.accessibility && styles.homeAccessibilityChipText,
                    amenity.environmental === 'positive' && styles.homeEcoChipText,
                  ]}>
                    {amenity.nameKey ? t(amenity.nameKey) : amenity.name}
                  </Text>
                  {amenity.maxFairValue === 0 && (
                    <View style={styles.homeIncludedDot} />
                  )}
                </TouchableOpacity>
              );
            })}
          </View>
          <TouchableOpacity
            style={styles.viewAllAmenitiesButton}
            onPress={() => router.push('/properties/search')}
          >
            <Text style={styles.viewAllAmenitiesText}>View All Properties</Text>
            <IconComponent name="arrow-forward" size={16} color={colors.primaryColor} />
          </TouchableOpacity>
        </View>

        {/* Horizon Initiative */}
        <View style={styles.horizonSection}>
          <View style={styles.horizonContent}>
            <Text style={styles.horizonTitle}>{t("home.horizon.title")}</Text>
            <Text style={styles.horizonDescription}>
              {t("home.horizon.description")}
            </Text>
            <TouchableOpacity style={styles.horizonButton} onPress={() => router.push('/horizon')}>
              <Text style={styles.horizonButtonText}>{t("home.horizon.learnMore")}</Text>
              <IconComponent name="arrow-forward" size={16} color="#333" style={{ marginLeft: 5 }} />
            </TouchableOpacity>
          </View>
          <View style={styles.horizonImagePlaceholder}>
            <IconComponent name="globe-outline" size={50} color="#FFD700" />
          </View>
        </View>

        {/* Stats Section */}
        <View style={styles.statsSection}>
          <Text style={styles.sectionTitle}>Platform Statistics</Text>
          <View style={styles.statsGrid}>
            <View style={styles.statCard}>
              <IconComponent name="home" size={24} color={colors.primaryColor} />
              <Text style={styles.statNumber}>{propertiesData?.total || 0}</Text>
              <Text style={styles.statLabel}>Total Properties</Text>
            </View>
            <View style={styles.statCard}>
              <IconComponent name="people" size={24} color={colors.primaryColor} />
              <Text style={styles.statNumber}>{propertiesData?.properties?.filter(p => p.status === 'available').length || 0}</Text>
              <Text style={styles.statLabel}>Available Now</Text>
            </View>
            <View style={styles.statCard}>
              <IconComponent name="leaf" size={24} color="green" />
              <Text style={styles.statNumber}>
                {propertiesData?.properties?.filter(p =>
                  p.amenities?.some(a => a.includes('eco') || a.includes('green') || a.includes('solar'))
                ).length || 0}
              </Text>
              <Text style={styles.statLabel}>Eco-Friendly</Text>
            </View>
            <View style={styles.statCard}>
              <IconComponent name="star" size={24} color="#FFD700" />
              <Text style={styles.statNumber}>{topCities.length}</Text>
              <Text style={styles.statLabel}>Cities Covered</Text>
            </View>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  heroSection: {
    height: 300,
    backgroundColor: colors.primaryColor,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
    borderRadius: 35,
    margin: 10,
    borderColor: colors.COLOR_BLACK,
    borderWidth: 1,
  },
  heroContent: {
    width: '100%',
    maxWidth: 800,
    alignItems: 'center',
  },
  heroTitle: {
    fontSize: 28,
    fontWeight: 'bold',
    fontFamily: 'Phudu',
    color: 'white',
    textAlign: 'center',
    marginBottom: 10,
  },
  heroSubtitle: {
    fontSize: 16,
    color: 'white',
    opacity: 0.9,
    textAlign: 'center',
    marginBottom: 30,
    maxWidth: 400,
  },
  searchContainer: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 10,
  },
  searchBar: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'white',
    borderRadius: 30,
    paddingHorizontal: 15,
    height: 50,
    marginRight: 10,
  },
  searchInput: {
    flex: 1,
    marginLeft: 10,
    fontSize: 16,
  },
  searchButton: {
    backgroundColor: colors.secondaryColor,
    borderRadius: 30,
    padding: 15,
    height: 50,
    justifyContent: 'center',
  },
  searchButtonText: {
    color: colors.COLOR_BLACK,
    fontWeight: 'bold',
  },
  sectionTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    marginBottom: 20,
    color: colors.COLOR_BLACK,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  viewAllText: {
    color: colors.primaryColor,
    fontWeight: '600',
    fontSize: 16,
  },
  trustSection: {
    padding: 20,
    marginTop: 20,
  },
  trustFeatures: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  trustFeature: {
    width: '30%',
    alignItems: 'center',
    marginBottom: 20,
  },
  featureIconCircle: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#f0f0f0',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 10,
  },
  featureTitle: {
    fontWeight: 'bold',
    marginBottom: 5,
    textAlign: 'center',
  },
  featureDescription: {
    textAlign: 'center',
    fontSize: 12,
    color: colors.COLOR_BLACK_LIGHT_3,
  },
  featuredSection: {
    padding: 20,
  },
  loadingContainer: {
    alignItems: 'center',
    paddingVertical: 40,
  },
  loadingText: {
    marginTop: 10,
    color: colors.COLOR_BLACK_LIGHT_3,
  },
  emptyContainer: {
    alignItems: 'center',
    paddingVertical: 40,
  },
  emptyText: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.COLOR_BLACK_LIGHT_3,
    marginTop: 10,
  },
  emptySubtext: {
    fontSize: 14,
    color: colors.COLOR_BLACK_LIGHT_4,
    marginTop: 5,
  },
  horizontalScroll: {
    flexDirection: 'row',
  },
  propertyCardContainer: {
    marginRight: 15,
    width: 280,
  },
  citiesSection: {
    padding: 20,
  },
  cityCard: {
    width: 170,
    marginRight: 15,
    backgroundColor: 'white',
    borderRadius: 12,
  },
  cityImagePlaceholder: {
    width: '100%',
    height: 120,
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
    paddingVertical: 0,
    borderWidth: 1,
    borderColor: colors.COLOR_BLACK,
    borderRadius: 35,
    overflow: 'hidden',
  },
  propertyCountBadge: {
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
    borderRadius: 15,
    paddingHorizontal: 8,
    paddingVertical: 4,
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
  },
  propertyCountText: {
    fontSize: 12,
    fontWeight: 'bold',
    color: colors.COLOR_BLACK,
    marginLeft: 4,
  },
  cityIconContainer: {
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    borderRadius: 20,
    padding: 8,
    marginBottom: 8,
  },
  cityName: {
    fontFamily: 'Phudu',
    fontWeight: 'bold',
    fontSize: 18,
    color: 'white',
    textAlign: 'center',
    letterSpacing: 0.5,
  },
  typesSection: {
    padding: 20,
  },
  propertyChipsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    justifyContent: 'space-between',
  },
  propertyChip: {
    width: '48%',
    borderRadius: 25,
    borderWidth: 1,
    borderColor: colors.COLOR_BLACK,
    overflow: 'hidden',
  },
  propertyChipGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    justifyContent: 'space-between',
  },
  propertyChipName: {
    fontFamily: 'Phudu',
    fontWeight: 'bold',
    fontSize: 14,
    color: 'white',
    flex: 1,
    marginLeft: 8,
  },
  propertyChipCountBadge: {
    backgroundColor: 'rgba(255, 255, 255, 0.9)',
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 4,
    minWidth: 24,
    alignItems: 'center',
  },
  propertyChipCountText: {
    fontSize: 12,
    fontWeight: 'bold',
    color: colors.COLOR_BLACK,
  },
  horizonSection: {
    backgroundColor: colors.primaryLight,
    padding: 20,
    margin: 20,
    borderRadius: 15,
    flexDirection: 'row',
    alignItems: 'center',
  },
  horizonContent: {
    flex: 1,
  },
  horizonTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 10,
  },
  horizonDescription: {
    marginBottom: 15,
    lineHeight: 20,
  },
  horizonButton: {
    backgroundColor: '#FFD700',
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 20,
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: 'auto',
  },
  horizonButtonText: {
    fontWeight: 'bold',
    color: '#333',
  },
  horizonImagePlaceholder: {
    marginLeft: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  statsSection: {
    padding: 20,
    marginTop: 20,
  },
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  statCard: {
    width: '48%',
    backgroundColor: 'white',
    padding: 20,
    borderRadius: 12,
    alignItems: 'center',
    marginBottom: 15,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  statNumber: {
    fontSize: 24,
    fontWeight: 'bold',
    color: colors.primaryColor,
    marginTop: 8,
  },
  statLabel: {
    fontSize: 12,
    color: colors.COLOR_BLACK_LIGHT_3,
    marginTop: 4,
    textAlign: 'center',
  },
  verifiedBadge: {
    backgroundColor: colors.primaryColor,
    borderRadius: 20,
    paddingVertical: 6,
    paddingHorizontal: 15,
    marginTop: 5,
  },
  verifiedBadgeText: {
    color: 'white',
    fontSize: 12,
    fontWeight: '600',
  },
  // Popular Amenities Section
  amenitiesShowcase: {
    padding: 20,
    backgroundColor: '#f8f9fa',
  },
  amenitySectionSubtitle: {
    fontSize: 14,
    color: colors.COLOR_BLACK_LIGHT_3,
    marginBottom: 20,
    textAlign: 'center',
  },
  amenityChipsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 20,
  },
  homeAmenityChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'white',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#e9ecef',
  },
  homeEssentialChip: {
    backgroundColor: '#f0fdf4',
    borderColor: '#059669',
  },
  homeAccessibilityChip: {
    backgroundColor: '#f0f0ff',
    borderColor: '#6366f1',
  },
  homeEcoChip: {
    backgroundColor: '#f0fdf4',
    borderColor: '#16a34a',
  },
  homeAmenityChipText: {
    fontSize: 13,
    fontWeight: '500',
    color: colors.COLOR_BLACK,
    marginLeft: 6,
  },
  homeEssentialChipText: {
    color: '#059669',
  },
  homeAccessibilityChipText: {
    color: '#6366f1',
  },
  homeEcoChipText: {
    color: '#16a34a',
  },
  homeIncludedDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.primaryColor,
    marginLeft: 6,
  },
  viewAllAmenitiesButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'white',
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 25,
    borderWidth: 1,
    borderColor: colors.primaryColor,
  },
  viewAllAmenitiesText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.primaryColor,
    marginRight: 6,
  },
});