import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity, Image, RefreshControl, FlatList } from 'react-native';
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
import { useDebouncedAddressSearch, type AddressSuggestion } from '@/hooks/useAddressSearch';
import { cityService } from '@/services/cityService';

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
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [suggestionsFocused, setSuggestionsFocused] = useState(false);
  const [cities, setCities] = useState<any[]>([]);
  const [citiesLoading, setCitiesLoading] = useState(false);
  // Use the reusable address search hook
  const {
    suggestions: addressSuggestions,
    loading: isLoadingAddresses,
    error: addressSearchError,
    debouncedSearch: fetchAddressSuggestions,
    clearSuggestions: clearAddressSuggestions
  } = useDebouncedAddressSearch({
    minQueryLength: 3,
    debounceDelay: 500,
    maxResults: 5,
    includeAddressDetails: true
  });
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

  // Load cities on component mount
  React.useEffect(() => {
    const loadCities = async () => {
      try {
        setCitiesLoading(true);
        const response = await cityService.getPopularCities(8);
        setCities(response.data || []);
      } catch (error) {
        console.error('Failed to load cities:', error);
        // Fallback to empty array
        setCities([]);
      } finally {
        setCitiesLoading(false);
      }
    };

    loadCities();
  }, []);

  // Memoized data processing
  const featuredProperties = useMemo(() => {
    if (!properties) return [];
    return properties.slice(0, 4);
  }, [properties]);

  const propertyTypes = [
    { id: 'apartment', name: t('search.propertyType.apartments'), icon: 'business-outline', count: 0 },
    { id: 'house', name: t('search.propertyType.houses'), icon: 'home-outline', count: 0 },
    { id: 'room', name: t('search.propertyType.rooms'), icon: 'bed-outline', count: 0 },
    { id: 'studio', name: t('search.propertyType.studios'), icon: 'home-outline', count: 0 },
    { id: 'coliving', name: t('search.propertyType.coliving'), icon: 'people-outline', count: 0 },
    { id: 'public_housing', name: t('search.propertyType.publicHousing'), icon: 'library-outline', count: 0 },
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

  // Get top cities from API
  const topCities = useMemo(() => {
    if (!cities || cities.length === 0) return [];

    return cities
      .sort((a, b) => (b.propertiesCount || 0) - (a.propertiesCount || 0))
      .slice(0, 4)
      .map((city) => ({
        id: city._id || city.id,
        name: city.name,
        count: city.propertiesCount || 0,
        state: city.state,
        country: city.country
      }));
  }, [cities]);

  const isAuthenticated = !!(oxyServices && activeSessionId);

  // Generate suggestions data
  const suggestionsData = useMemo(() => {
    const suggestions = [];

    // Address suggestions (when user is typing)
    if (searchQuery.trim() && addressSuggestions.length > 0) {
      suggestions.push({
        type: 'addresses',
        title: t('search.addressSuggestions') || 'Address Suggestions',
        items: addressSuggestions.map(suggestion => ({
          text: suggestion.text,
          icon: suggestion.icon,
          action: () => {
            setSearchQuery(suggestion.text);
            router.push(`/search/address/${encodeURIComponent(suggestion.text)}`);
          }
        }))
      });
    }

    // Property types
    suggestions.push({
      type: 'propertyTypes',
      title: t('search.propertyTypes'),
      items: propertyTypes.slice(0, 4).map(type => ({
        text: type.name,
        icon: type.icon,
        action: () => router.push(`/properties/type/${type.id}`)
      }))
    });

    // Top cities (location-based)
    if (topCities.length > 0) {
      suggestions.push({
        type: 'cities',
        title: t('search.popularCities'),
        items: topCities.map(city => ({
          text: city.name,
          icon: 'location-outline',
          action: () => router.push(`/properties/city/${city.id}`)
        }))
      });
    }

    // Common neighborhoods/areas (if available)
    const commonAreas = [
      { text: t('search.areas.downtown'), icon: 'business-outline' },
      { text: t('search.areas.universityDistrict'), icon: 'school-outline' },
      { text: t('search.areas.businessDistrict'), icon: 'briefcase-outline' },
      { text: t('search.areas.residentialArea'), icon: 'home-outline' }
    ];

    suggestions.push({
      type: 'areas',
      title: t('search.popularAreas') || 'Popular Areas',
      items: commonAreas
    });

    // Quick filters
    suggestions.push({
      type: 'quickFilters',
      title: t('search.quickFilters'),
      items: [
        { text: t('search.Furnished'), icon: 'bed-outline', filter: 'furnished' },
        { text: t('search.Pets Allowed'), icon: 'paw-outline', filter: 'pets' },
        { text: t('search.Eco-friendly'), icon: 'leaf-outline', filter: 'eco' },
        { text: t('search.Co-living'), icon: 'people-outline', filter: 'coliving' }
      ]
    });

    return suggestions;
  }, [searchQuery, addressSuggestions, propertyTypes, topCities, t, router]);

  const handleSearch = () => {
    if (searchQuery.trim()) {
      setShowSuggestions(false);
      // Search by address/location
      router.push(`/search/address/${encodeURIComponent(searchQuery)}`);
    }
  };

  const handleSuggestionPress = useCallback((suggestion: any) => {
    if (suggestion.action) {
      suggestion.action();
    } else if (suggestion.filter) {
      // For filters, search by the filter term
      router.push(`/search/filter/${encodeURIComponent(suggestion.text)}`);
    } else {
      // For location-based suggestions, search by address
      setSearchQuery(suggestion.text);
      router.push(`/search/address/${encodeURIComponent(suggestion.text)}`);
    }
    setShowSuggestions(false);
  }, [router]);



  const handleSearchFocus = () => {
    setShowSuggestions(true);
    setSuggestionsFocused(true);
  };

  const handleSearchBlur = () => {
    // Delay hiding suggestions to allow for touch events
    setTimeout(() => {
      setSuggestionsFocused(false);
      if (!suggestionsFocused) {
        setShowSuggestions(false);
      }
    }, 200);
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
                  placeholder={t("home.hero.searchPlaceholder") || "Search by address, city, or neighborhood..."}
                  value={searchQuery}
                  onChangeText={(text) => {
                    setSearchQuery(text);
                    fetchAddressSuggestions(text);
                  }}
                  onSubmitEditing={handleSearch}
                  onFocus={handleSearchFocus}
                  onBlur={handleSearchBlur}
                />
              </View>
              <TouchableOpacity style={styles.searchButton} onPress={handleSearch}>
                <IconComponent name="search" size={20} color={colors.COLOR_BLACK} />
              </TouchableOpacity>
            </View>

            {/* Search Suggestions Dropdown */}
            {showSuggestions && (
              <View style={styles.suggestionsContainer}>
                {isLoadingAddresses && searchQuery.trim() && (
                  <View style={styles.suggestionSection}>
                    <View style={styles.suggestionItems}>
                      <View style={styles.suggestionItem}>
                        <LoadingSpinner size={16} />
                        <Text style={styles.suggestionText}>{t('search.searchingAddresses')}</Text>
                      </View>
                    </View>
                  </View>
                )}
                <FlatList
                  data={suggestionsData}
                  keyExtractor={(item, index) => `${item.type}-${index}`}
                  renderItem={({ item: section }) => (
                    <View style={styles.suggestionSection}>
                      <Text style={styles.suggestionSectionTitle}>{section.title}</Text>
                      <View style={styles.suggestionItems}>
                        {section.items.map((suggestion, index) => (
                          <TouchableOpacity
                            key={`${section.type}-${index}`}
                            style={styles.suggestionItem}
                            onPress={() => handleSuggestionPress(suggestion)}
                            activeOpacity={0.7}
                          >
                            <IconComponent
                              name={suggestion.icon}
                              size={16}
                              color={colors.COLOR_BLACK_LIGHT_4}
                            />
                            <Text style={styles.suggestionText}>{suggestion.text}</Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                    </View>
                  )}
                  style={styles.suggestionsList}
                  showsVerticalScrollIndicator={false}
                />
              </View>
            )}
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
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.horizontalScroll}
              contentContainerStyle={{ paddingHorizontal: 16 }}
            >
              {Array.from({ length: 4 }).map((_, index) => (
                <View key={index} style={styles.propertyCardContainer}>
                  <View style={styles.propertyCardSkeleton}>
                    {/* Image skeleton */}
                    <View style={styles.propertyCardImageSkeleton}>
                      <LinearGradient
                        colors={['#f0f0f0', '#e0e0e0']}
                        style={{ width: '100%', height: '100%' }}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 1 }}
                      />
                      {/* Save button skeleton */}
                      <View style={styles.propertyCardSaveButtonSkeleton} />
                      {/* Badge skeleton */}
                      <View style={styles.propertyCardBadgeSkeleton} />
                    </View>
                    {/* Content skeleton */}
                    <View style={styles.propertyCardContentSkeleton}>
                      {/* Title skeleton */}
                      <View style={{ backgroundColor: '#e0e0e0', height: 18, borderRadius: 4, width: '85%', marginBottom: 6 }} />
                      {/* Location skeleton */}
                      <View style={{ backgroundColor: '#f0f0f0', height: 14, borderRadius: 4, width: '70%', marginBottom: 8 }} />
                      {/* Price and rating row */}
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                        <View style={{ backgroundColor: '#e0e0e0', height: 16, borderRadius: 4, width: '40%' }} />
                        <View style={{ backgroundColor: '#f0f0f0', height: 14, borderRadius: 4, width: '25%' }} />
                      </View>
                    </View>
                  </View>
                </View>
              ))}
            </ScrollView>
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
            {citiesLoading ? (
              // Loading state
              Array.from({ length: 4 }).map((_, index) => (
                <View key={index} style={styles.cityCard}>
                  <LinearGradient
                    colors={['#f0f0f0', '#e0e0e0']}
                    style={styles.cityImagePlaceholder}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                  >
                    {/* Subtle overlay */}
                    <View style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      right: 0,
                      bottom: 0,
                      backgroundColor: 'rgba(0, 0, 0, 0.1)',
                      borderRadius: 25,
                    }} />
                    {/* City Info at bottom */}
                    <View style={{ width: '100%' }}>
                      <View style={{ backgroundColor: '#d0d0d0', height: 22, borderRadius: 4, width: '70%', marginBottom: 4 }} />
                      <View style={{ backgroundColor: '#e0e0e0', height: 14, borderRadius: 4, width: '50%' }} />
                    </View>
                  </LinearGradient>
                </View>
              ))
            ) : (
              topCities.map((city, index) => (
                <TouchableOpacity
                  key={city.id}
                  style={styles.cityCard}
                  onPress={() => router.push(`/properties/city/${city.id}`)}
                  activeOpacity={0.85}
                >
                  <LinearGradient
                    colors={[colors.primaryColor, colors.secondaryLight]}
                    style={styles.cityImagePlaceholder}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                  >
                    {/* Subtle overlay for better text readability */}
                    <View style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      right: 0,
                      bottom: 0,
                      backgroundColor: 'rgba(0, 0, 0, 0.15)',
                      borderRadius: 25,
                    }} />

                    {/* City Info at bottom */}
                    <View style={{ width: '100%' }}>
                      <Text style={styles.cityName}>{city.name}</Text>
                      {(city.state || city.country) && (
                        <Text style={styles.cityLocation}>
                          {[city.state, city.country].filter(Boolean).join(', ')}
                        </Text>
                      )}
                    </View>
                  </LinearGradient>
                </TouchableOpacity>
              ))
            )}
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
    position: 'relative',
    zIndex: 1000,
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
    fontSize: 24,
    fontWeight: '600',
    color: colors.COLOR_BLACK,
    fontFamily: 'Phudu',
    letterSpacing: -0.3,
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
  propertyCardSkeleton: {
    backgroundColor: '#ffffff',
    borderRadius: 12,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
    width: '100%',
    height: 280,
  },
  propertyCardImageSkeleton: {
    height: 140,
    backgroundColor: '#f0f0f0',
    position: 'relative',
  },
  propertyCardContentSkeleton: {
    padding: 12,
    flex: 1,
    justifyContent: 'space-between',
  },
  propertyCardSaveButtonSkeleton: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#d0d0d0',
  },
  propertyCardBadgeSkeleton: {
    position: 'absolute',
    top: 8,
    left: 8,
    width: 60,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#d0d0d0',
  },
  citiesSection: {
    paddingVertical: 24,
    marginTop: 16,
  },
  cityCard: {
    width: 200,
    marginRight: 16,
    backgroundColor: '#ffffff',
    borderRadius: 25,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
  cityImagePlaceholder: {
    width: '100%',
    height: 160,
    justifyContent: 'flex-end',
    alignItems: 'flex-start',
    position: 'relative',
    padding: 16,
    borderRadius: 25,
    overflow: 'hidden',
  },
  propertyCountBadge: {
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 6,
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-end',
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  propertyCountText: {
    fontSize: 11,
    fontWeight: 'bold',
    color: colors.COLOR_BLACK,
    marginLeft: 4,
    fontFamily: 'Phudu',
  },
  cityIconContainer: {
    backgroundColor: 'rgba(255, 255, 255, 0.25)',
    borderRadius: 24,
    padding: 10,
    alignSelf: 'flex-start',
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 2,
  },
  cityName: {
    fontFamily: 'Phudu',
    fontWeight: '600',
    fontSize: 22,
    color: 'white',
    textAlign: 'left',
    letterSpacing: -0.2,
    textShadowColor: 'rgba(0, 0, 0, 0.4)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
    marginBottom: 4,
  },
  cityLocation: {
    fontFamily: 'Phudu',
    fontSize: 14,
    color: 'white',
    textAlign: 'left',
    opacity: 0.9,
    textShadowColor: 'rgba(0, 0, 0, 0.3)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
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
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
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
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
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
  },
  // Search Suggestions Styles
  suggestionsContainer: {
    position: 'absolute',
    top: '100%',
    left: 0,
    right: 0,
    backgroundColor: 'white',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.COLOR_BLACK_LIGHT_4,
    maxHeight: 400,
    zIndex: 1001,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 10,
  },
  suggestionsList: {
    maxHeight: 400,
  },
  suggestionSection: {
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.COLOR_BLACK_LIGHT_4,
  },
  suggestionSectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.COLOR_BLACK,
    marginBottom: 8,
    paddingHorizontal: 16,
  },
  suggestionItems: {
    paddingHorizontal: 16,
  },
  suggestionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 8,
    marginBottom: 4,
  },
  suggestionText: {
    fontSize: 14,
    color: colors.COLOR_BLACK,
    marginLeft: 12,
    flex: 1,
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