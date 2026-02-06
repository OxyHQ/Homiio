import React, { useState, useMemo, useCallback, useEffect } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  RefreshControl,
  Platform,
  Image,
  Animated,
  ScrollView,
  useWindowDimensions
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useRouter } from 'expo-router';
import { colors } from '@/styles/colors';
import { phuduFontWeights } from '@/styles/fonts';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import * as Location from 'expo-location';
import { Home } from '@/assets/icons';
import { AnimatedSearchPlaceholder } from '@/components/AnimatedSearchPlaceholder';

// Import real data hooks
import { useProperties } from '@/hooks';
// import { useOxy } from '@oxyhq/services'; // Removed unused import
import { cityService } from '@/services/cityService';
import { tipsService, TipArticle } from '@/services/tipsService';
import { useRecentlyViewed } from '@/hooks/useRecentlyViewed';
import { useSavedProperties } from '@/hooks/useSavedProperties';

// Import components
import { PropertyCard } from '@/components/PropertyCard';
import { HomeCarouselSection } from '@/components/HomeCarouselSection';
import { ThemedText } from '@/components/ThemedText';
import { useMediaQuery } from 'react-responsive';
import { useLayoutScroll } from '@/context/LayoutScrollContext';

// Type assertion for Ionicons compatibility with React 19
const IconComponent = Ionicons as any;

export default function HomePage() {
  const { t } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [refreshing, setRefreshing] = useState(false);
  const [cities, setCities] = useState<any[]>([]);
  const [citiesLoading, setCitiesLoading] = useState(false);
  const [expandedFaq, setExpandedFaq] = useState<string | null>(null);
  const [tips, setTips] = useState<TipArticle[]>([]);
  const [tipsLoading, setTipsLoading] = useState(false);

  // Nearby cities state
  const [userLocation, setUserLocation] = useState<{ latitude: number; longitude: number } | null>(
    null,
  );
  const [nearbyCities, setNearbyCities] = useState<any[]>([]);
  const [nearbyProperties, setNearbyProperties] = useState<{ [cityId: string]: any[] }>({});
  const [nearbyLoading, setNearbyLoading] = useState(false);
  const isScreenNotMobile = useMediaQuery({ minWidth: 700 });

  // Get user location on mount
  useEffect(() => {
    (async () => {
      try {
        let { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') return;
        let location = await Location.getCurrentPositionAsync({});
        setUserLocation({
          latitude: location.coords.latitude,
          longitude: location.coords.longitude,
        });
      } catch {
        // Permission denied or error
      }
    })();
  }, []);

  // Find two closest cities and fetch their properties
  useEffect(() => {
    if (!userLocation || !cities || cities.length === 0) return;
    // Calculate distance to each city
    function getDistance(lat1: number, lon1: number, lat2: number, lon2: number) {
      const toRad = (v: number) => (v * Math.PI) / 180;
      const R = 6371; // km
      const dLat = toRad(lat2 - lat1);
      const dLon = toRad(lon2 - lon1);
      const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      return R * c;
    }
    const withDistance = cities
      .filter((city) => city.latitude && city.longitude)
      .map((city) => ({
        ...city,
        distance: getDistance(
          userLocation.latitude,
          userLocation.longitude,
          city.latitude,
          city.longitude,
        ),
      }));
    const sorted = withDistance.sort((a, b) => a.distance - b.distance);
    setNearbyCities(sorted.slice(0, 2));
  }, [userLocation, cities]);

  // Fetch properties for nearby cities
  useEffect(() => {
    if (!nearbyCities || nearbyCities.length === 0) return;
    setNearbyLoading(true);
    Promise.all(
      nearbyCities.map(async (city) => {
        try {
          const res = await cityService.getPropertiesByCity(city._id || city.id, { limit: 8 });
          return { cityId: city._id || city.id, properties: res.properties || [] };
        } catch {
          return { cityId: city._id || city.id, properties: [] };
        }
      }),
    ).then((results) => {
      const map: { [cityId: string]: any[] } = {};
      results.forEach((r) => {
        map[r.cityId] = r.properties;
      });
      setNearbyProperties(map);
      setNearbyLoading(false);
    });
  }, [nearbyCities]);

  // Fetch real data
  const { properties, loading: propertiesLoading, loadProperties } = useProperties();

  // Recently viewed and saved properties
  const { properties: recentlyViewedProperties } = useRecentlyViewed();
  const { savedProperties, isLoading: savedLoading } = useSavedProperties();

  // Load properties, cities and tips in parallel on mount (was 3 separate waterfall useEffects)
  React.useEffect(() => {
    setCitiesLoading(true);
    setTipsLoading(true);

    Promise.all([
      loadProperties({ limit: 8, status: 'published' }),
      cityService.getPopularCities(8).then(r => r.data || []).catch(() => []),
      tipsService.getHomePageTipsFallback().catch(() => []),
    ]).then(([, citiesData, tipsData]) => {
      setCities(citiesData);
      setTips(tipsData);
    }).finally(() => {
      setCitiesLoading(false);
      setTipsLoading(false);
    });
  }, [loadProperties]);

  // Memoized data processing
  const featuredProperties = useMemo(() => {
    if (!properties) return [];
    return properties.slice(0, 4);
  }, [properties]);

  // Memoize property types to prevent unnecessary re-renders
  const propertyTypes = useMemo(
    () => [
      {
        id: 'apartment',
        name: t('search.propertyType.apartments'),
        icon: 'business-outline',
        count: 0,
      },
      { id: 'house', name: t('search.propertyType.houses'), icon: 'home-outline', count: 0 },
      { id: 'room', name: t('search.propertyType.rooms'), icon: 'bed-outline', count: 0 },
      { id: 'studio', name: t('search.propertyType.studios'), icon: 'home-outline', count: 0 },
      { id: 'coliving', name: t('search.propertyType.coliving'), icon: 'people-outline', count: 0 },
      {
        id: 'public_housing',
        name: t('search.propertyType.publicHousing'),
        icon: 'library-outline',
        count: 0,
      },
    ],
    [t],
  );

  // Option A: Pure flex-wrap grid (no explicit width calculations / breakpoints)
  // Each chip gets a flexible basis and minWidth; layout naturally flows into 1..N columns.

  // Calculate property type counts
  const propertyTypeCounts = useMemo(() => {
    if (!properties) return propertyTypes;

    const counts = properties.reduce(
      (acc: Record<string, number>, property: any) => {
        acc[property.type] = (acc[property.type] || 0) + 1;
        return acc;
      },
      {} as Record<string, number>,
    );

    return propertyTypes.map((type) => ({
      ...type,
      count: counts[type.id] || 0,
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
        country: city.country,
      }));
  }, [cities]);

  const handleSearchPress = useCallback(() => {
    // Navigate to search screen with a flag to indicate coming from home
    router.push('/search?fromHome=true');
  }, [router]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await loadProperties({
        limit: 8,
        status: 'published',
      });
    } finally {
      setRefreshing(false);
    }
  }, [loadProperties]);

  // Tip card styles — moved to module-level via useMemo to avoid recreating on every render
  const tipCarouselCardStyles = React.useMemo(() => tipCardStyles, []);

  const layoutScroll = useLayoutScroll();
  const scrollY = layoutScroll?.scrollY || new Animated.Value(0);
  const { height: windowHeight } = useWindowDimensions();
  const styles = React.useMemo(() => createStyles(isScreenNotMobile, windowHeight), [isScreenNotMobile, windowHeight]);

  const translateY = scrollY.interpolate({
    inputRange: [-300, 0, 1000],
    outputRange: [-150, 0, 300],
    extrapolate: 'clamp'
  });

  return (
    <View style={{ flex: 1 }}>
      <ScrollView
        style={styles.container}
        contentContainerStyle={{ paddingBottom: 20 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        showsVerticalScrollIndicator={false}
        onScroll={Animated.event(
          [{ nativeEvent: { contentOffset: { y: scrollY } } }],
          { useNativeDriver: false }
        )}
        scrollEventThrottle={16}
      >
        {/* Hero Section */}
        <View style={[styles.heroSection, { paddingTop: insets.top + 50, overflow: 'hidden' }]}>
          <Animated.View style={{
            position: 'absolute',
            top: -150,
            left: 0,
            right: 0,
            bottom: -150,
            transform: [{ translateY }]
          }}>
            <Image
              source={require('@/assets/images/hero.jpg')}
              style={{
                width: '100%',
                height: '100%',
              }}
              resizeMode="cover"
            />
          </Animated.View>
          <View style={styles.heroOverlay} />
          {!isScreenNotMobile && (
            <LinearGradient
              colors={['transparent', colors.primaryLight]}
              style={{
                position: 'absolute',
                bottom: 0,
                left: 0,
                right: 0,
                height: 200,
                zIndex: 1,
              }}
              pointerEvents="none"
            />
          )}
          <View style={[styles.heroContent, { zIndex: 2 }]}>
            <ThemedText style={styles.heroTitle}>{t('home.hero.title')}</ThemedText>
            <ThemedText style={styles.heroSubtitle}>{t('home.hero.subtitle')}</ThemedText>

            <View style={styles.searchContainer}>
              <TouchableOpacity
                style={styles.searchBar}
                onPress={handleSearchPress}
                activeOpacity={0.8}
              >
                <View style={styles.searchInput}>
                  <AnimatedSearchPlaceholder
                    style={styles.searchPlaceholderText}
                  />
                </View>
                <View style={styles.searchButton}>
                  <IconComponent name="search" size={20} color={colors.COLOR_BLACK} />
                </View>
              </TouchableOpacity>
            </View>

            {/* Property Types */}
            <View style={styles.propertyChipsContainer}>
              {propertyTypeCounts.map((type) => (
                <TouchableOpacity
                  key={type.id}
                  style={styles.propertyChip}
                  onPress={() => router.push(`/properties/type/${type.id}`)}
                  activeOpacity={0.8}
                >
                  <IconComponent
                    name={type.icon as keyof typeof IconComponent.glyphMap}
                    size={20}
                    color={colors.COLOR_BLACK}
                  />
                  <ThemedText style={styles.propertyChipName}>{type.name}</ThemedText>
                  <View style={styles.propertyChipCountBadge}>
                    <ThemedText style={styles.propertyChipCountText}>{type.count}</ThemedText>
                  </View>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </View>

        {/* Trust Features */}
        <View style={styles.trustSection}>
          <View style={styles.sectionHeader}>
            <ThemedText style={styles.sectionTitle}>{t('home.trust.title')}</ThemedText>
          </View>
          <View style={styles.trustFeatures}>
            <View style={styles.trustFeature}>
              <View style={styles.featureIconCircle}>
                <IconComponent name="shield-checkmark" size={24} color={colors.primaryColor} />
              </View>
              <ThemedText style={styles.featureTitle}>
                {t('home.trust.verifiedListings.title')}
              </ThemedText>
              <ThemedText style={styles.featureDescription}>
                {t('home.trust.verifiedListings.description')}
              </ThemedText>
            </View>

            <View style={styles.trustFeature}>
              <View style={styles.featureIconCircle}>
                <IconComponent name="document-text" size={24} color={colors.primaryColor} />
              </View>
              <ThemedText style={styles.featureTitle}>
                {t('home.trust.fairAgreements.title')}
              </ThemedText>
              <ThemedText style={styles.featureDescription}>
                {t('home.trust.fairAgreements.description')}
              </ThemedText>
            </View>

            <View style={styles.trustFeature}>
              <View style={styles.featureIconCircle}>
                <IconComponent name="star" size={24} color={colors.primaryColor} />
              </View>
              <ThemedText style={styles.featureTitle}>
                {t('home.trust.trustScore.title')}
              </ThemedText>
              <ThemedText style={styles.featureDescription}>
                {t('home.trust.trustScore.description')}
              </ThemedText>
            </View>
          </View>
        </View>

        {/* Featured Properties */}
        {featuredProperties.length > 0 ? (
          <HomeCarouselSection
            title={t('home.featured.title')}
            items={featuredProperties}
            loading={propertiesLoading}
            renderItem={(property) => (
              <PropertyCard
                property={property}
                variant="featured"
                onPress={() => router.push(`/properties/${property._id || property.id}`)}
              />
            )}
          />
        ) : null}

        {/* Recently Viewed Properties */}
        {recentlyViewedProperties && recentlyViewedProperties.length > 0 ? (
          <HomeCarouselSection
            title={t('home.recentlyViewed.title') || 'Recently Viewed'}
            items={recentlyViewedProperties}
            loading={false}
            renderItem={(property) => (
              <PropertyCard
                property={property}
                variant="featured"
                onPress={() => router.push(`/properties/${property._id || property.id}`)}
              />
            )}
          />
        ) : null}

        {/* Saved Properties */}
        {savedProperties && savedProperties.length > 0 ? (
          <HomeCarouselSection
            title={t('home.saved.title') || 'Saved Properties'}
            items={savedProperties}
            loading={savedLoading}
            renderItem={(property) => (
              <PropertyCard
                property={property}
                variant="featured"
                onPress={() => router.push(`/properties/${property._id || property.id}`)}
              />
            )}
          />
        ) : null}

        {/* Nearby Cities Sections */}
        {nearbyCities.map((city) => {
          const cityProperties = nearbyProperties[city._id || city.id];
          if (!cityProperties || cityProperties.length === 0) return null;

          return (
            <HomeCarouselSection
              key={city._id || city.id}
              title={t('home.nearby.title', { city: city.name }) || `Properties in ${city.name}`}
              items={cityProperties}
              loading={nearbyLoading}
              renderItem={(property) => (
                <PropertyCard
                  property={property}
                  variant="featured"
                  onPress={() => router.push(`/properties/${property._id || property.id}`)}
                />
              )}
            />
          );
        })}

        {/* Top Cities (Carousel) */}
        {topCities.length > 0 ? (
          <HomeCarouselSection
            title={t('home.cities.title')}
            items={topCities}
            loading={citiesLoading}
            minItemsToShow={1}
            renderItem={(city) => (
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
                  <View
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      right: 0,
                      bottom: 0,
                      backgroundColor: 'rgba(0, 0, 0, 0.15)',
                      borderRadius: 25,
                    }}
                  />
                  {/* City Info at bottom */}
                  <View style={{ width: '100%' }}>
                    <ThemedText style={styles.cityName}>{city.name}</ThemedText>
                    {(city.state || city.country) && (
                      <ThemedText style={styles.cityLocation}>
                        {[city.state, city.country].filter(Boolean).join(', ')}
                      </ThemedText>
                    )}
                  </View>
                </LinearGradient>
              </TouchableOpacity>
            )}
          />
        ) : null}

        {/* Stats Section — memoized to avoid filter recalc on every render */}
        <StatsSection
          properties={properties}
          topCitiesCount={topCities.length}
          styles={styles}
          t={t}
        />

        {/* Tips Section (Carousel) */}
        <HomeCarouselSection
          title={t('home.tips.title')}
          items={tips}
          loading={tipsLoading}
          onViewAll={() => router.push('/tips')}
          viewAllText={t('home.viewAll')}
          minItemsToShow={1}
          maxCardWidth={420}
          renderItem={(tip) => (
            <TouchableOpacity
              key={tip.id}
              style={{ flex: 1 }}
              onPress={() => router.push(`/tips/${tip.id}`)}
              activeOpacity={0.85}
            >
              <View style={tipCarouselCardStyles.card}>
                <View style={tipCarouselCardStyles.imageContainer}>
                  <LinearGradient
                    colors={tip.gradientColors as [string, string]}
                    style={tipCarouselCardStyles.image}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                  >
                    <IconComponent name={tip.icon} size={32} color="white" />
                  </LinearGradient>
                  <View style={tipCarouselCardStyles.badge}>
                    <ThemedText style={tipCarouselCardStyles.badgeText}>
                      {tip.category}
                    </ThemedText>
                  </View>
                </View>
                <View style={tipCarouselCardStyles.content}>
                  <ThemedText style={tipCarouselCardStyles.title} numberOfLines={2}>
                    {tip.title}
                  </ThemedText>
                  <ThemedText style={tipCarouselCardStyles.description} numberOfLines={2}>
                    {tip.description}
                  </ThemedText>
                  <View style={tipCarouselCardStyles.meta}>
                    <View style={tipCarouselCardStyles.metaItem}>
                      <IconComponent name="time-outline" size={14} color={colors.COLOR_BLACK_LIGHT_4} />
                      <ThemedText style={tipCarouselCardStyles.metaText}>{tip.readTime}</ThemedText>
                    </View>
                    <View style={tipCarouselCardStyles.metaItem}>
                      <IconComponent name="calendar-outline" size={14} color={colors.COLOR_BLACK_LIGHT_4} />
                      <ThemedText style={tipCarouselCardStyles.metaText}>{tip.publishDate}</ThemedText>
                    </View>
                  </View>
                </View>

              </View>
            </TouchableOpacity>
          )}
        />

        {/* FAQ Section */}
        <View style={styles.faqSection}>
          <View style={styles.sectionHeader}>
            <ThemedText style={styles.sectionTitle}>{t('home.faq.title')}</ThemedText>
          </View>
          <View style={styles.faqContainer}>
            <View style={[styles.faqItem, styles.faqItemFirst]}>
              <TouchableOpacity
                style={styles.faqQuestion}
                onPress={() => {
                  // Toggle FAQ answer visibility
                  const faqId = 'faq1';
                  setExpandedFaq(expandedFaq === faqId ? null : faqId);
                }}
                activeOpacity={0.7}
              >
                <ThemedText style={styles.faqQuestionText}>
                  {t('home.faq.scheduleViewing.question')}
                </ThemedText>
                <IconComponent
                  name={expandedFaq === 'faq1' ? 'chevron-up' : 'chevron-down'}
                  size={20}
                  color={colors.COLOR_BLACK_LIGHT_3}
                />
              </TouchableOpacity>
              {expandedFaq === 'faq1' && (
                <View style={styles.faqAnswer}>
                  <ThemedText style={styles.faqAnswerText}>
                    {t('home.faq.scheduleViewing.answer')}
                  </ThemedText>
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
                <ThemedText style={styles.faqQuestionText}>
                  {t('home.faq.verifiedProperty.question')}
                </ThemedText>
                <IconComponent
                  name={expandedFaq === 'faq2' ? 'chevron-up' : 'chevron-down'}
                  size={20}
                  color={colors.COLOR_BLACK_LIGHT_3}
                />
              </TouchableOpacity>
              {expandedFaq === 'faq2' && (
                <View style={styles.faqAnswer}>
                  <ThemedText style={styles.faqAnswerText}>
                    {t('home.faq.verifiedProperty.answer')}
                  </ThemedText>
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
                <ThemedText style={styles.faqQuestionText}>
                  {t('home.faq.reportSuspicious.question')}
                </ThemedText>
                <IconComponent
                  name={expandedFaq === 'faq3' ? 'chevron-up' : 'chevron-down'}
                  size={20}
                  color={colors.COLOR_BLACK_LIGHT_3}
                />
              </TouchableOpacity>
              {expandedFaq === 'faq3' && (
                <View style={styles.faqAnswer}>
                  <ThemedText style={styles.faqAnswerText}>
                    {t('home.faq.reportSuspicious.answer')}
                  </ThemedText>
                </View>
              )}
            </View>

            <View style={[styles.faqItem, styles.faqItemLast]}>
              <TouchableOpacity
                style={styles.faqQuestion}
                onPress={() => {
                  const faqId = 'faq4';
                  setExpandedFaq(expandedFaq === faqId ? null : faqId);
                }}
                activeOpacity={0.7}
              >
                <ThemedText style={styles.faqQuestionText}>
                  {t('home.faq.applicationRequirements.question')}
                </ThemedText>
                <IconComponent
                  name={expandedFaq === 'faq4' ? 'chevron-up' : 'chevron-down'}
                  size={20}
                  color={colors.COLOR_BLACK_LIGHT_3}
                />
              </TouchableOpacity>
              {expandedFaq === 'faq4' && (
                <View style={styles.faqAnswer}>
                  <ThemedText style={styles.faqAnswerText}>
                    {t('home.faq.applicationRequirements.answer')}
                  </ThemedText>
                </View>
              )}
            </View>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

// Memoized StatsSection to avoid filter recalculation on every render
const StatsSection = React.memo(function StatsSection({
  properties,
  topCitiesCount,
  styles,
  t,
}: {
  properties: any[] | null | undefined;
  topCitiesCount: number;
  styles: any;
  t: any;
}) {
  const stats = useMemo(() => {
    const total = properties?.length || 0;
    const available = properties?.filter((p) => p.status === 'published').length || 0;
    const ecoFriendly = properties?.filter((p) =>
      p.amenities?.some(
        (a: string) => a.includes('eco') || a.includes('green') || a.includes('solar'),
      ),
    ).length || 0;
    return { total, available, ecoFriendly };
  }, [properties]);

  return (
    <View style={styles.statsSection}>
      <View style={styles.sectionHeader}>
        <ThemedText style={styles.sectionTitle}>{t('home.insights.title')}</ThemedText>
      </View>
      <View style={styles.statsChipsContainer}>
        <TouchableOpacity style={styles.statChip} activeOpacity={0.8}>
          <View style={styles.statChipGradient}>
            <View style={styles.statChipContent}>
              <ThemedText style={styles.statChipNumber}>{stats.total}</ThemedText>
              <ThemedText style={styles.statChipLabel}>Total Properties</ThemedText>
            </View>
            <View style={styles.statChipIcon}>
              <Home size={22} color={colors.COLOR_BLACK} />
            </View>
          </View>
        </TouchableOpacity>

        <TouchableOpacity style={styles.statChip} activeOpacity={0.8}>
          <View style={styles.statChipGradient}>
            <View style={styles.statChipContent}>
              <ThemedText style={styles.statChipNumber}>{stats.available}</ThemedText>
              <ThemedText style={styles.statChipLabel}>Available Now</ThemedText>
            </View>
            <View style={styles.statChipIcon}>
              <IconComponent name="people" size={22} color={colors.COLOR_BLACK} />
            </View>
          </View>
        </TouchableOpacity>

        <TouchableOpacity style={styles.statChip} activeOpacity={0.8}>
          <View style={styles.statChipGradient}>
            <View style={styles.statChipContent}>
              <ThemedText style={styles.statChipNumber}>{stats.ecoFriendly}</ThemedText>
              <ThemedText style={styles.statChipLabel}>Eco-Friendly</ThemedText>
            </View>
            <View style={styles.statChipIcon}>
              <IconComponent name="leaf" size={22} color={colors.COLOR_BLACK} />
            </View>
          </View>
        </TouchableOpacity>

        <TouchableOpacity style={styles.statChip} activeOpacity={0.8}>
          <View style={styles.statChipGradient}>
            <View style={styles.statChipContent}>
              <ThemedText style={styles.statChipNumber}>{topCitiesCount}</ThemedText>
              <ThemedText style={styles.statChipLabel}>Cities Covered</ThemedText>
            </View>
            <View style={styles.statChipIcon}>
              <IconComponent name="star" size={22} color={colors.COLOR_BLACK} />
            </View>
          </View>
        </TouchableOpacity>
      </View>
    </View>
  );
});

// Tip card styles at module level (was created inside component on every render)
const tipCardStyles = StyleSheet.create({
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 12,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: colors.COLOR_BLACK_LIGHT_6,
    overflow: 'hidden',
    flex: 1,
  },
  imageContainer: {
    height: 160,
    position: 'relative',
  },
  image: {
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  badge: {
    position: 'absolute',
    top: 10,
    left: 10,
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    borderRadius: 35,
    paddingHorizontal: 8,
    paddingVertical: 1,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: '500' as any,
    color: colors.COLOR_BLACK,
    textTransform: 'uppercase' as const,
    letterSpacing: 0.3,
    fontFamily: phuduFontWeights.medium,
  },
  content: {
    padding: 12,
  },
  title: {
    fontSize: 15,
    fontWeight: '600' as any,
    color: colors.COLOR_BLACK,
    marginBottom: 6,
    fontFamily: phuduFontWeights.medium,
    lineHeight: 20,
  },
  description: {
    fontSize: 13,
    color: colors.COLOR_BLACK_LIGHT_3,
    lineHeight: 18,
    marginBottom: 10,
  },
  meta: {
    flexDirection: 'row' as const,
    justifyContent: 'space-between' as const,
    alignItems: 'center' as const,
  },
  metaItem: {
    flexDirection: 'row' as const,
    alignItems: 'center' as const,
  },
  metaText: {
    fontSize: 12,
    color: colors.COLOR_BLACK_LIGHT_4,
    marginLeft: 4,
  },
});

const createStyles = (isScreenNotMobile: boolean, windowHeight: number) => StyleSheet.create({
  container: {
    flex: 1,
  },
  heroSection: {
    flex: 1,
    maxWidth: '100%',
    ...(isScreenNotMobile ? {
      borderRadius: 200,
      height: 400,
      marginTop: Math.max(0, (windowHeight - 400) / 2), // Center vertically by calculating (window height - hero height) / 2
      marginHorizontal: 20,
      marginBottom: 20,
      paddingHorizontal: 120,
    } : {
      paddingHorizontal: 16,
      minHeight: 550,
      marginTop: 0,
    }),
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 20,
    position: 'relative',
    zIndex: 1000,
    overflow: 'hidden',
  },
  heroOverlay: {
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
  },
  heroContent: {
    width: '100%',
    maxWidth: 800,
    alignItems: 'center',
  },
  heroTitle: {
    fontSize: 28,
    color: 'white',
    textAlign: 'center',
    marginBottom: 10,
    fontFamily: phuduFontWeights.bold,
    fontWeight: 'bold',
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
    padding: 8,
    paddingLeft: 20,
    height: 52,
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 3,
  },
  searchInput: {
    flex: 1,
    marginLeft: 10,
    fontSize: 16,
    height: 52,
    justifyContent: 'center',
    overflow: 'hidden',
  },
  searchPlaceholderText: {
    fontSize: 16,
    color: '#999',
    textAlign: 'left',
    paddingVertical: 8,
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
    fontFamily: phuduFontWeights.bold,
    fontWeight: 'bold',
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
    marginBottom: 4,
    textAlign: 'center',
    fontFamily: phuduFontWeights.bold,
    fontWeight: 'bold',
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
    width: '100%',
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
    marginTop: 16,
    justifyContent: 'flex-start',
  },
  propertyChip: {
    borderRadius: 35,
    overflow: 'hidden',
    flexGrow: 1,
    flexBasis: '30%',
    minWidth: 140,
    backgroundColor: '#ffffff',
    flexDirection: 'row',
    alignItems: 'center',
    padding: 8,
    paddingHorizontal: 12,
    justifyContent: 'space-between',
  },
  propertyChipName: {
    fontSize: 13,
    color: colors.COLOR_BLACK,
    fontWeight: '500',
    flex: 1,
    marginLeft: 6,
  },
  propertyChipCountBadge: {
    backgroundColor: colors.COLOR_BLACK,
    borderRadius: 35,
    paddingHorizontal: 6,
    paddingVertical: 2,
    minWidth: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  propertyChipCountText: {
    fontSize: 11,
    fontWeight: '500',
    color: '#ffffff',
  },
  statsSection: {
    paddingVertical: 8,
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
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.COLOR_BLACK_LIGHT_6,
    backgroundColor: colors.COLOR_BLACK_LIGHT_7,
  },
  statChipGradient: {
    position: 'relative',
    padding: 10,
  },
  statChipContent: {
    alignItems: 'flex-start',
  },
  statChipIcon: {
    position: 'absolute',
    top: 16,
    right: 16,
  },
  statChipNumber: {
    fontFamily: 'Phudu',
    fontSize: 28,
    color: colors.COLOR_BLACK,
    marginBottom: 8,
    fontWeight: 'bold',
  },
  statChipLabel: {
    fontSize: 14,
    color: colors.COLOR_BLACK_LIGHT_3,
    fontWeight: '500',
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
    backgroundColor: colors.COLOR_BLACK_LIGHT_7,
    borderRadius: 8,
    marginBottom: 1,
    overflow: 'hidden',
  },
  faqItemFirst: {
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
  },
  faqItemLast: {
    borderBottomLeftRadius: 16,
    borderBottomRightRadius: 16,
    marginBottom: 0,
  },
  faqQuestion: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 12,
    backgroundColor: colors.COLOR_BLACK_LIGHT_7,
  },
  faqQuestionText: {
    fontSize: 16,
    color: colors.COLOR_BLACK,
    flex: 1,
    marginRight: 12,
    fontFamily: phuduFontWeights.medium,
  },
  faqAnswer: {
    paddingHorizontal: 12,
    paddingBottom: 12,
    backgroundColor: colors.COLOR_BLACK_LIGHT_8,
  },
  faqAnswerText: {
    fontSize: 14,
    color: colors.COLOR_BLACK_LIGHT_3,
    lineHeight: 20,
  },
});
