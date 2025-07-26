import React, { useState, useMemo, useCallback, useRef } from 'react';
import { View, Text, StyleSheet, ScrollView, TextInput, TouchableOpacity, RefreshControl, FlatList, Platform, type NativeSyntheticEvent, type NativeScrollEvent } from 'react-native';
import LoadingSpinner from '@/components/LoadingSpinner';
import { useTranslation } from 'react-i18next';
import { useRouter } from 'expo-router';
import { colors } from '@/styles/colors';
import { phuduFontWeights } from '@/styles/fonts';
import { Ionicons } from '@expo/vector-icons';
import { Search } from '@/assets/icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSEO } from '@/hooks/useDocumentTitle';
import { LinearGradient } from 'expo-linear-gradient';

// Import real data hooks
import { useProperties } from '@/hooks';
import { useOxy } from '@oxyhq/services';
import { useDebouncedAddressSearch } from '@/hooks/useAddressSearch';
import { cityService } from '@/services/cityService';
import { tipsService, TipArticle } from '@/services/tipsService';

// Import components
import { PropertyCard } from '@/components/PropertyCard';
import { HomePropertyCarouselSection } from '@/components/HomePropertyCarouselSection';

// Type assertion for Ionicons compatibility with React 19
const IconComponent = Ionicons as any;

export default function HomePage() {
  const { t } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [searchQuery, setSearchQuery] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [suggestionsFocused, setSuggestionsFocused] = useState(false);
  const [cities, setCities] = useState<any[]>([]);
  const [citiesLoading, setCitiesLoading] = useState(false);
  const [expandedFaq, setExpandedFaq] = useState<string | null>(null);
  const [tips, setTips] = useState<TipArticle[]>([]);
  const [tipsLoading, setTipsLoading] = useState(false);

  // Use the reusable address search hook
  const {
    suggestions: addressSuggestions,
    loading: isLoadingAddresses,
    debouncedSearch: fetchAddressSuggestions
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

  // Load tips on component mount
  React.useEffect(() => {
    const loadTips = async () => {
      try {
        setTipsLoading(true);
        // Temporarily use fallback data while debugging API
        const tipsData = await tipsService.getHomePageTipsFallback();
        setTips(tipsData);
      } catch (error) {
        console.error('Failed to load tips:', error);
        setTips([]);
      } finally {
        setTipsLoading(false);
      }
    };

    loadTips();
  }, []);

  // Memoized data processing
  const featuredProperties = useMemo(() => {
    if (!properties) return [];
    return properties.slice(0, 4);
  }, [properties]);

  // Memoize property types to prevent unnecessary re-renders
  const propertyTypes = useMemo(() => [
    { id: 'apartment', name: t('search.propertyType.apartments'), icon: 'business-outline', count: 0 },
    { id: 'house', name: t('search.propertyType.houses'), icon: 'home-outline', count: 0 },
    { id: 'room', name: t('search.propertyType.rooms'), icon: 'bed-outline', count: 0 },
    { id: 'studio', name: t('search.propertyType.studios'), icon: 'home-outline', count: 0 },
    { id: 'coliving', name: t('search.propertyType.coliving'), icon: 'people-outline', count: 0 },
    { id: 'public_housing', name: t('search.propertyType.publicHousing'), icon: 'library-outline', count: 0 },
  ], [t]);

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

  const handleSearch = useCallback(() => {
    if (searchQuery.trim()) {
      setShowSuggestions(false);
      // Search by address/location
      router.push(`/search/address/${encodeURIComponent(searchQuery)}`);
    }
  }, [searchQuery, router]);

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

  const handleSearchFocus = useCallback(() => {
    setShowSuggestions(true);
    setSuggestionsFocused(true);
  }, []);

  const handleSearchBlur = useCallback(() => {
    // Delay hiding suggestions to allow for touch events
    setTimeout(() => {
      setSuggestionsFocused(false);
      if (!suggestionsFocused) {
        setShowSuggestions(false);
      }
    }, 200);
  }, [suggestionsFocused]);

  const onRefresh = useCallback(async () => {
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
  }, [loadProperties]);

  const carouselRef = useRef<ScrollView>(null);
  const [carouselIndex, setCarouselIndex] = useState(0);
  const [cardWidth, setCardWidth] = useState(0);
  const itemsPerPage = 2;
  const maxCarouselIndex = Math.max(0, featuredProperties.length - itemsPerPage);

  const handleScrollLeft = () => {
    if (carouselIndex > 0) {
      const newIndex = carouselIndex - 1;
      setCarouselIndex(newIndex);
      if (cardWidth > 0) {
        carouselRef.current?.scrollTo({ x: newIndex * cardWidth, animated: true });
      }
    }
  };

  const handleScrollRight = () => {
    if (carouselIndex < maxCarouselIndex) {
      const newIndex = carouselIndex + 1;
      setCarouselIndex(newIndex);
      if (cardWidth > 0) {
        carouselRef.current?.scrollTo({ x: newIndex * cardWidth, animated: true });
      }
    }
  };

  // Throttle scroll updates to avoid performance issues
  const scrollUpdateTimeout = useRef<NodeJS.Timeout | null>(null);
  const handleScroll = cardWidth > 0 ? (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (scrollUpdateTimeout.current) clearTimeout(scrollUpdateTimeout.current);
    const x = e.nativeEvent.contentOffset.x;
    // Subtract the left spacer (15px)
    const index = Math.round((x - 15) / cardWidth);
    // Use a short timeout to avoid rapid state updates
    scrollUpdateTimeout.current = setTimeout(() => {
      setCarouselIndex(Math.max(0, Math.min(index, maxCarouselIndex)));
    }, 10);
  } : undefined;

  return (
    <View style={{ flex: 1 }}>
      <ScrollView
        style={styles.container}
        contentContainerStyle={{ paddingTop: insets.top }}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
        showsVerticalScrollIndicator={false}
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
                <TouchableOpacity style={styles.searchButton} onPress={handleSearch}>
                  <IconComponent name="search" size={20} color={colors.COLOR_BLACK} />
                </TouchableOpacity>
              </View>
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
        <HomePropertyCarouselSection
          title={t("home.featured.title")}
          properties={featuredProperties}
          loading={propertiesLoading}
          onCardPress={(property) => router.push(`/properties/${property._id || property.id}`)}
        />

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

        {/* Tips Section */}
        <View style={styles.tipsSection}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>{t("home.tips.title")}</Text>
            <TouchableOpacity onPress={() => router.push('/tips')}>
              <Text style={styles.viewAllText}>{t("home.viewAll")}</Text>
            </TouchableOpacity>
          </View>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.horizontalScroll}
            contentContainerStyle={{ paddingHorizontal: 16 }}
          >
            {tipsLoading ? (
              <View style={styles.tipCardContainer}>
                <View style={styles.tipCard}>
                  <View style={styles.tipImageContainer}>
                    <View style={[styles.tipImagePlaceholder, { backgroundColor: colors.COLOR_BLACK_LIGHT_4 }]}>
                      <IconComponent name="hourglass-outline" size={32} color="white" />
                    </View>
                  </View>
                  <View style={styles.tipCardContent}>
                    <View style={[styles.tipCardTitle, { backgroundColor: colors.COLOR_BLACK_LIGHT_4, height: 20, borderRadius: 4 }]} />
                    <View style={[styles.tipCardDescription, { backgroundColor: colors.COLOR_BLACK_LIGHT_4, height: 16, borderRadius: 4, marginBottom: 8 }]} />
                    <View style={[styles.tipCardDescription, { backgroundColor: colors.COLOR_BLACK_LIGHT_4, height: 16, borderRadius: 4, width: '60%' }]} />
                  </View>
                </View>
              </View>
            ) : (
              tips.map((tip) => (
                <TouchableOpacity
                  key={tip.id}
                  style={styles.tipCardContainer}
                  onPress={() => router.push('/tips')}
                  activeOpacity={0.8}
                >
                  <View style={styles.tipCard}>
                    <View style={styles.tipImageContainer}>
                      <LinearGradient
                        colors={tip.gradientColors as [string, string]}
                        style={styles.tipImagePlaceholder}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 1 }}
                      >
                        <IconComponent name={tip.icon} size={32} color="white" />
                      </LinearGradient>
                      <View style={styles.tipCategoryBadge}>
                        <Text style={styles.tipCategoryText}>{t(`home.tips.categories.${tip.category}`)}</Text>
                      </View>
                    </View>
                    <View style={styles.tipCardContent}>
                      <Text style={styles.tipCardTitle}>{tip.title}</Text>
                      <Text style={styles.tipCardDescription}>
                        {tip.description}
                      </Text>
                      <View style={styles.tipCardMeta}>
                        <View style={styles.tipCardMetaItem}>
                          <IconComponent name="time-outline" size={14} color={colors.COLOR_BLACK_LIGHT_4} />
                          <Text style={styles.tipCardMetaText}>{tip.readTime}</Text>
                        </View>
                        <View style={styles.tipCardMetaItem}>
                          <IconComponent name="calendar-outline" size={14} color={colors.COLOR_BLACK_LIGHT_4} />
                          <Text style={styles.tipCardMetaText}>{tip.publishDate}</Text>
                        </View>
                      </View>
                    </View>
                  </View>
                </TouchableOpacity>
              ))
            )}
          </ScrollView>
        </View>

        {/* FAQ Section */}
        <View style={styles.faqSection}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>{t("home.faq.title")}</Text>
          </View>
          <View style={styles.faqContainer}>
            <View style={styles.faqItem}>
              <TouchableOpacity
                style={styles.faqQuestion}
                onPress={() => {
                  // Toggle FAQ answer visibility
                  const faqId = 'faq1';
                  setExpandedFaq(expandedFaq === faqId ? null : faqId);
                }}
                activeOpacity={0.7}
              >
                <Text style={styles.faqQuestionText}>{t("home.faq.scheduleViewing.question")}</Text>
                <IconComponent
                  name={expandedFaq === 'faq1' ? 'chevron-up' : 'chevron-down'}
                  size={20}
                  color={colors.COLOR_BLACK_LIGHT_3}
                />
              </TouchableOpacity>
              {expandedFaq === 'faq1' && (
                <View style={styles.faqAnswer}>
                  <Text style={styles.faqAnswerText}>
                    {t("home.faq.scheduleViewing.answer")}
                  </Text>
                </View>
              )}
            </View>

            <View style={styles.faqItem}>
              <TouchableOpacity
                style={styles.faqQuestion}
                onPress={() => {
                  const faqId = 'faq2';
                  setExpandedFaq(expandedFaq === faqId ? null : faqId);
                }}
                activeOpacity={0.7}
              >
                <Text style={styles.faqQuestionText}>{t("home.faq.verifiedProperty.question")}</Text>
                <IconComponent
                  name={expandedFaq === 'faq2' ? 'chevron-up' : 'chevron-down'}
                  size={20}
                  color={colors.COLOR_BLACK_LIGHT_3}
                />
              </TouchableOpacity>
              {expandedFaq === 'faq2' && (
                <View style={styles.faqAnswer}>
                  <Text style={styles.faqAnswerText}>
                    {t("home.faq.verifiedProperty.answer")}
                  </Text>
                </View>
              )}
            </View>

            <View style={styles.faqItem}>
              <TouchableOpacity
                style={styles.faqQuestion}
                onPress={() => {
                  const faqId = 'faq3';
                  setExpandedFaq(expandedFaq === faqId ? null : faqId);
                }}
                activeOpacity={0.7}
              >
                <Text style={styles.faqQuestionText}>{t("home.faq.reportSuspicious.question")}</Text>
                <IconComponent
                  name={expandedFaq === 'faq3' ? 'chevron-up' : 'chevron-down'}
                  size={20}
                  color={colors.COLOR_BLACK_LIGHT_3}
                />
              </TouchableOpacity>
              {expandedFaq === 'faq3' && (
                <View style={styles.faqAnswer}>
                  <Text style={styles.faqAnswerText}>
                    {t("home.faq.reportSuspicious.answer")}
                  </Text>
                </View>
              )}
            </View>

            <View style={styles.faqItem}>
              <TouchableOpacity
                style={styles.faqQuestion}
                onPress={() => {
                  const faqId = 'faq4';
                  setExpandedFaq(expandedFaq === faqId ? null : faqId);
                }}
                activeOpacity={0.7}
              >
                <Text style={styles.faqQuestionText}>{t("home.faq.applicationRequirements.question")}</Text>
                <IconComponent
                  name={expandedFaq === 'faq4' ? 'chevron-up' : 'chevron-down'}
                  size={20}
                  color={colors.COLOR_BLACK_LIGHT_3}
                />
              </TouchableOpacity>
              {expandedFaq === 'faq4' && (
                <View style={styles.faqAnswer}>
                  <Text style={styles.faqAnswerText}>
                    {t("home.faq.applicationRequirements.answer")}
                  </Text>
                </View>
              )}
            </View>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  heroSection: {
    ...Platform.select({
      web: { height: 300 },
      default: {},
    }),
    backgroundColor: colors.primaryColor,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: Platform.select({
      web: 0,
      ios: 20,
      android: 20,
    }),
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
    fontFamily: phuduFontWeights.bold,
    color: 'white',
    textAlign: 'center',
    marginBottom: 10,
  },
  heroSubtitle: {
    fontSize: 16,
    color: 'white',
    opacity: 0.9,
    textAlign: 'center',
    marginBottom: Platform.select({
      web: 30,
      ios: 8,
      android: 8,
    }),
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
    paddingLeft: 20,
    paddingTop: 8,
    paddingBottom: 8,
    paddingRight: 8,
    height: 52,
    marginRight: 12,
  },
  searchInput: {
    flex: 1,
    marginLeft: 10,
    fontSize: 16,
  },
  searchButton: {
    backgroundColor: colors.secondaryColor,
    borderRadius: 30,
    paddingHorizontal: 12,
    paddingVertical: 6,
    height: 44,
    justifyContent: 'center',
    alignItems: 'center',
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
    color: colors.COLOR_BLACK,
    fontFamily: phuduFontWeights.semiBold,
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
    color: colors.COLOR_BLACK,
    marginLeft: 4,
    fontFamily: phuduFontWeights.medium,
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
    fontFamily: phuduFontWeights.semiBold,
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
    fontFamily: phuduFontWeights.regular,
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
    width: Platform.select({
      web: '31%', // 3 columns on web/larger screens
      default: '48%', // 2 columns on mobile
    }),
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
    fontFamily: phuduFontWeights.medium,
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
    fontFamily: phuduFontWeights.bold,
    fontSize: 20,
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
  // Tips Section Styles
  tipsSection: {
    paddingVertical: 24,
    marginTop: 16,
  },
  tipCardContainer: {
    marginRight: 15,
    width: 280,
  },
  tipCard: {
    backgroundColor: '#ffffff',
    borderRadius: 12,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
    height: 320,
  },
  tipImageContainer: {
    height: 140,
    position: 'relative',
  },
  tipImagePlaceholder: {
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  tipCategoryBadge: {
    position: 'absolute',
    top: 8,
    left: 8,
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  tipCategoryText: {
    fontSize: 10,
    fontWeight: '600',
    color: colors.COLOR_BLACK,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  tipCardContent: {
    padding: 12,
    flex: 1,
    justifyContent: 'space-between',
  },
  tipCardTitle: {
    fontSize: 16,
    color: colors.COLOR_BLACK,
    marginBottom: 6,
    fontFamily: phuduFontWeights.medium,
    lineHeight: 20,
  },
  tipCardDescription: {
    fontSize: 13,
    color: colors.COLOR_BLACK_LIGHT_3,
    lineHeight: 18,
    marginBottom: 12,
  },
  tipCardMeta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  tipCardMetaItem: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  tipCardMetaText: {
    fontSize: 11,
    color: colors.COLOR_BLACK_LIGHT_4,
    marginLeft: 4,
  },
  // FAQ Section Styles
  faqSection: {
    paddingVertical: 24,
    marginTop: 16,
  },
  faqContainer: {
    paddingHorizontal: 16,
  },
  faqItem: {
    backgroundColor: '#ffffff',
    borderRadius: 12,
    marginBottom: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
    overflow: 'hidden',
  },
  faqQuestion: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    backgroundColor: '#ffffff',
  },
  faqQuestionText: {
    fontSize: 16,
    color: colors.COLOR_BLACK,
    flex: 1,
    marginRight: 12,
    fontFamily: phuduFontWeights.medium,
  },
  faqAnswer: {
    paddingHorizontal: 16,
    paddingBottom: 16,
    backgroundColor: '#f8f9fa',
  },
  faqAnswerText: {
    fontSize: 14,
    color: colors.COLOR_BLACK_LIGHT_3,
    lineHeight: 20,
  },
});