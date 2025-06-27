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
import { useProperties } from '@/hooks';
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
  const { properties, loading: propertiesLoading, loadProperties } = useProperties();

  // Load properties on component mount
  React.useEffect(() => {
    loadProperties({
      limit: 8,
      status: 'available'
    });
  }, [loadProperties]);

  // Memoized data processing
  const featuredProperties = useMemo(() => {
    if (!properties) return [];
    return properties.slice(0, 4);
  }, [properties]);

  const propertyTypes = [
    { id: 'apartment', name: 'Apartments', icon: 'business-outline', count: 0 },
    { id: 'house', name: 'Houses', icon: 'home-outline', count: 0 },
    { id: 'room', name: 'Rooms', icon: 'bed-outline', count: 0 },
    { id: 'studio', name: 'Studios', icon: 'home-outline', count: 0 },
    { id: 'coliving', name: 'Co-living', icon: 'people-outline', count: 0 },
    { id: 'public_housing', name: 'Public Housing', icon: 'library-outline', count: 0 },
  ];

  // Calculate property type counts
  const propertyTypeCounts = useMemo(() => {
    if (!properties) return propertyTypes;

    const counts = properties.reduce((acc: Record<string, number>, property: any) => {
      acc[property.type] = (acc[property.type] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    return propertyTypes.map(type => ({
      ...type,
      count: counts[type.id] || 0
    }));
  }, [properties, propertyTypes]);

  // Get top cities from real data
  const topCities = useMemo(() => {
    if (!properties) return [];

    const cityCounts = properties.reduce((acc: Record<string, number>, property: any) => {
      const city = property.address?.city;
      if (city) {
        acc[city] = (acc[city] || 0) + 1;
      }
      return acc;
    }, {} as Record<string, number>);

    return Object.entries(cityCounts)
      .sort(([, a], [, b]) => (b as number) - (a as number))
      .slice(0, 4)
      .map(([city, count]) => ({ id: city, name: city, count }));
  }, [properties]);

  const handleSearch = () => {
    if (searchQuery.trim()) {
      router.push(`/search/${encodeURIComponent(searchQuery)}`);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await loadProperties({
        limit: 8,
        status: 'available'
      });
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

        {/* Property Types */}
        <View style={styles.typesSection}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>{t("home.categories.title")}</Text>
          </View>
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

        {/* Trust Features */}
        <View style={styles.trustSection}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>{t("home.trust.title")}</Text>
          </View>
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
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.horizontalScroll}
              contentContainerStyle={{ paddingHorizontal: 16 }}
            >
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
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>{t("home.cities.title")}</Text>
          </View>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.horizontalScroll}
            contentContainerStyle={{ paddingHorizontal: 16 }}
          >
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

        {/* Stats Section */}
        <View style={styles.statsSection}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Platform Statistics</Text>
          </View>
          <View style={styles.statsChipsContainer}>
            <TouchableOpacity style={styles.statChip} activeOpacity={0.8}>
              <LinearGradient
                colors={[colors.primaryColor, colors.secondaryLight]}
                style={styles.statChipGradient}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
              >
                <IconComponent name="home" size={20} color="white" />
                <View style={styles.statChipContent}>
                  <Text style={styles.statChipNumber}>{properties?.length || 0}</Text>
                  <Text style={styles.statChipLabel}>Total Properties</Text>
                </View>
              </LinearGradient>
            </TouchableOpacity>

            <TouchableOpacity style={styles.statChip} activeOpacity={0.8}>
              <LinearGradient
                colors={[colors.primaryColor, colors.secondaryLight]}
                style={styles.statChipGradient}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
              >
                <IconComponent name="people" size={20} color="white" />
                <View style={styles.statChipContent}>
                  <Text style={styles.statChipNumber}>{properties?.filter(p => p.status === 'available').length || 0}</Text>
                  <Text style={styles.statChipLabel}>Available Now</Text>
                </View>
              </LinearGradient>
            </TouchableOpacity>

            <TouchableOpacity style={styles.statChip} activeOpacity={0.8}>
              <LinearGradient
                colors={['#16a34a', '#22c55e']}
                style={styles.statChipGradient}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
              >
                <IconComponent name="leaf" size={20} color="white" />
                <View style={styles.statChipContent}>
                  <Text style={styles.statChipNumber}>
                    {properties?.filter(p =>
                      p.amenities?.some(a => a.includes('eco') || a.includes('green') || a.includes('solar'))
                    ).length || 0}
                  </Text>
                  <Text style={styles.statChipLabel}>Eco-Friendly</Text>
                </View>
              </LinearGradient>
            </TouchableOpacity>

            <TouchableOpacity style={styles.statChip} activeOpacity={0.8}>
              <LinearGradient
                colors={['#f59e0b', '#fbbf24']}
                style={styles.statChipGradient}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
              >
                <IconComponent name="star" size={20} color="white" />
                <View style={styles.statChipContent}>
                  <Text style={styles.statChipNumber}>{topCities.length}</Text>
                  <Text style={styles.statChipLabel}>Cities Covered</Text>
                </View>
              </LinearGradient>
            </TouchableOpacity>
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
    marginHorizontal: 16,
    marginBottom: 8,
    marginTop: 16,
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
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
    paddingHorizontal: 16,
  },
  sectionTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    color: colors.COLOR_BLACK,
    fontFamily: 'Phudu',
  },
  viewAllText: {
    color: colors.primaryColor,
    fontWeight: '600',
    fontSize: 16,
  },
  trustSection: {
    paddingVertical: 12,
  },
  trustFeatures: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
  },
  trustFeature: {
    width: '30%',
    alignItems: 'center',
    marginBottom: 16,
  },
  featureIconCircle: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: '#f0f0f0',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 8,
  },
  featureTitle: {
    fontWeight: 'bold',
    marginBottom: 4,
    textAlign: 'center',
  },
  featureDescription: {
    textAlign: 'center',
    fontSize: 12,
    color: colors.COLOR_BLACK_LIGHT_3,
  },
  featuredSection: {
    paddingVertical: 12,
  },
  loadingContainer: {
    alignItems: 'center',
    paddingVertical: 40,
    paddingHorizontal: 16,
  },
  loadingText: {
    marginTop: 10,
    color: colors.COLOR_BLACK_LIGHT_3,
  },
  emptyContainer: {
    alignItems: 'center',
    paddingVertical: 40,
    paddingHorizontal: 16,
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
    paddingVertical: 12,
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
    paddingVertical: 12,
  },
  propertyChipsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingHorizontal: 16,
  },
  propertyChip: {
    flex: 1,
    minWidth: '45%',
    borderRadius: 25,
    borderWidth: 1,
    borderColor: colors.COLOR_BLACK,
    overflow: 'hidden',
  },
  propertyChipGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 8,
    justifyContent: 'space-between',
  },
  propertyChipName: {
    fontFamily: 'Phudu',
    fontWeight: 'bold',
    fontSize: 14,
    color: 'white',
    flex: 1,
    marginLeft: 6,
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
  statsSection: {
    paddingVertical: 12,
  },
  statsChipsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingHorizontal: 16,
  },
  statChip: {
    flex: 1,
    minWidth: '45%',
    borderRadius: 25,
    borderWidth: 1,
    borderColor: colors.COLOR_BLACK,
    overflow: 'hidden',
  },
  statChipGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 8,
  },
  statChipContent: {
    flex: 1,
    marginLeft: 6,
    alignItems: 'flex-start',
  },
  statChipNumber: {
    fontFamily: 'Phudu',
    fontSize: 20,
    fontWeight: 'bold',
    color: 'white',
    marginBottom: 2,
  },
  statChipLabel: {
    fontSize: 12,
    color: 'white',
    opacity: 0.9,
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
    paddingHorizontal: 16,
    paddingVertical: 20,
    backgroundColor: '#f8f9fa',
  },
  amenitySectionSubtitle: {
    fontSize: 14,
    color: colors.COLOR_BLACK_LIGHT_3,
    marginBottom: 12,
    textAlign: 'center',
  },
  amenityChipsContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 24,
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