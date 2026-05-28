/**
 * Homiio home — the brand-defining surface. Treats the page as a series
 * of strongly-spaced Airbnb-2026 sections:
 *
 *   1. Hero canvas (Barcelona-flavored full-bleed photo, gradient overlay,
 *      hero pill SearchBar floats centered on web / sits below on mobile).
 *   2. Category strip with primary-colored active state.
 *   3. Property carousels (featured, recently viewed, saved, nearby).
 *   4. Top cities (carousel).
 *   5. Stats banner (Typography.H2 numbers, generous whitespace).
 *   6. Tips (carousel).
 *   7. Trust 3-up grid (single icon + sentence-case title + description).
 *   8. FAQ accordion.
 *
 * Rhythm is 96px on web / 56px on mobile between sections.
 */
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
  useWindowDimensions,
  Pressable,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import * as Location from 'expo-location';

import { H1, H2, P, Text as BloomText } from '@oxyhq/bloom/typography';

import { colors } from '@/styles/colors';
import type { Property } from '@homiio/shared-types';

// Import real data hooks
import { useProperties } from '@/hooks';
import { cityService } from '@/services/cityService';
import { tipsService, TipArticle } from '@/services/tipsService';
import { useRecentlyViewed } from '@/hooks/useRecentlyViewed';
import { useSavedPropertiesContext } from '@/context/SavedPropertiesContext';

// Import components
import { PropertyCard } from '@/components/PropertyCard';
import { HomeCarouselSection } from '@/components/HomeCarouselSection';
import { HomeCategoryStrip } from '@/components/HomeCategoryStrip';
import { SearchBar } from '@/components/SearchBar';
import { SectionEyebrow } from '@/components/ui/SectionEyebrow';
import { useMediaQuery } from 'react-responsive';
import { useLayoutScroll } from '@/context/LayoutScrollContext';
import {
  resolveSectionSpacing,
  spacing,
  tracker,
  withShadow,
} from '@/constants/styles';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

interface TrustFeature {
  icon: IoniconName;
  titleKey: string;
  titleFallback: string;
  descKey: string;
  descFallback: string;
}

const TRUST_FEATURES: TrustFeature[] = [
  {
    icon: 'shield-checkmark-outline',
    titleKey: 'home.trust.verifiedListings.title',
    titleFallback: 'Verified listings',
    descKey: 'home.trust.verifiedListings.description',
    descFallback: 'Every host and address is checked before going live.',
  },
  {
    icon: 'document-text-outline',
    titleKey: 'home.trust.fairAgreements.title',
    titleFallback: 'Fair agreements',
    descKey: 'home.trust.fairAgreements.description',
    descFallback: 'Standardized contracts and transparent fees, no surprises.',
  },
  {
    icon: 'star-outline',
    titleKey: 'home.trust.trustScore.title',
    titleFallback: 'Trust score',
    descKey: 'home.trust.trustScore.description',
    descFallback: 'Community-driven reputation for hosts and tenants alike.',
  },
];

interface FaqItem {
  id: string;
  questionKey: string;
  questionFallback: string;
  answerKey: string;
  answerFallback: string;
}

const FAQ_ITEMS: FaqItem[] = [
  {
    id: 'faq1',
    questionKey: 'home.faq.scheduleViewing.question',
    questionFallback: 'How do I schedule a viewing?',
    answerKey: 'home.faq.scheduleViewing.answer',
    answerFallback: 'Open any listing and tap "Request a viewing".',
  },
  {
    id: 'faq2',
    questionKey: 'home.faq.verifiedProperty.question',
    questionFallback: 'What is a verified property?',
    answerKey: 'home.faq.verifiedProperty.answer',
    answerFallback: 'A listing whose address, owner, and photos have been checked.',
  },
  {
    id: 'faq3',
    questionKey: 'home.faq.reportSuspicious.question',
    questionFallback: 'How do I report a suspicious listing?',
    answerKey: 'home.faq.reportSuspicious.answer',
    answerFallback: 'Use the "Report this listing" link on any property page.',
  },
  {
    id: 'faq4',
    questionKey: 'home.faq.applicationRequirements.question',
    questionFallback: 'What do I need to apply?',
    answerKey: 'home.faq.applicationRequirements.answer',
    answerFallback: 'ID, proof of income, and a short note about yourself.',
  },
];

interface NearbyCity {
  _id?: string;
  id?: string;
  name: string;
  latitude?: number;
  longitude?: number;
  distance?: number;
}

interface TopCity {
  id: string;
  name: string;
  count: number;
  state?: string;
  country?: string;
}

function getDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
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

export default function HomePage() {
  const { t } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [refreshing, setRefreshing] = useState(false);
  const [cities, setCities] = useState<NearbyCity[]>([]);
  const [citiesLoading, setCitiesLoading] = useState(false);
  const [expandedFaq, setExpandedFaq] = useState<string | null>(null);
  const [tips, setTips] = useState<TipArticle[]>([]);
  const [tipsLoading, setTipsLoading] = useState(false);

  // Nearby cities state
  const [userLocation, setUserLocation] = useState<{ latitude: number; longitude: number } | null>(
    null,
  );
  const [nearbyCities, setNearbyCities] = useState<NearbyCity[]>([]);
  const [nearbyProperties, setNearbyProperties] = useState<Record<string, Property[]>>({});
  const [nearbyLoading, setNearbyLoading] = useState(false);
  const isWide = useMediaQuery({ minWidth: 768 });
  const isXL = useMediaQuery({ minWidth: 1024 });

  // Get user location on mount
  useEffect(() => {
    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') return;
        const location = await Location.getCurrentPositionAsync({});
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
    const withDistance = cities
      .filter((city) => city.latitude && city.longitude)
      .map((city) => ({
        ...city,
        distance: getDistance(
          userLocation.latitude,
          userLocation.longitude,
          city.latitude ?? 0,
          city.longitude ?? 0,
        ),
      }));
    const sorted = withDistance.sort((a, b) => (a.distance ?? 0) - (b.distance ?? 0));
    setNearbyCities(sorted.slice(0, 2));
  }, [userLocation, cities]);

  // Fetch properties for nearby cities
  useEffect(() => {
    if (!nearbyCities || nearbyCities.length === 0) return;
    setNearbyLoading(true);
    Promise.all(
      nearbyCities.map(async (city) => {
        const cityId = city._id || city.id || '';
        try {
          const res = await cityService.getPropertiesByCity(cityId, { limit: 8 });
          return { cityId, properties: (res.properties as Property[]) || [] };
        } catch {
          return { cityId, properties: [] as Property[] };
        }
      }),
    ).then((results) => {
      const map: Record<string, Property[]> = {};
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
  const { savedProperties, isLoading: savedLoading } = useSavedPropertiesContext();

  // Load properties, cities and tips in parallel on mount
  useEffect(() => {
    setCitiesLoading(true);
    setTipsLoading(true);

    Promise.all([
      loadProperties({ limit: 8, status: 'published' }),
      cityService.getPopularCities(8).then((r) => r.data || []).catch(() => []),
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
  const featuredProperties = useMemo<Property[]>(() => {
    if (!properties) return [];
    return properties.slice(0, 8) as Property[];
  }, [properties]);

  // Get top cities from API
  const topCities = useMemo<TopCity[]>(() => {
    if (!cities || cities.length === 0) return [];

    const withCount = cities as Array<
      NearbyCity & { propertiesCount?: number; state?: string; country?: string }
    >;
    return withCount
      .slice()
      .sort((a, b) => (b.propertiesCount ?? 0) - (a.propertiesCount ?? 0))
      .slice(0, 6)
      .map((city) => ({
        id: String(city._id || city.id || ''),
        name: city.name,
        count: city.propertiesCount ?? 0,
        state: city.state,
        country: city.country,
      }));
  }, [cities]);

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

  const layoutScroll = useLayoutScroll();
  const scrollY = layoutScroll?.scrollY || new Animated.Value(0);
  const { height: windowHeight } = useWindowDimensions();
  const styles = useMemo(
    () => createStyles(isWide, isXL, windowHeight),
    [isWide, isXL, windowHeight],
  );

  const heroParallax = scrollY.interpolate({
    inputRange: [-300, 0, 800],
    outputRange: [-120, 0, 240],
    extrapolate: 'clamp',
  });

  const sectionGap = resolveSectionSpacing(isWide);

  return (
    <View style={styles.root}>
      <ScrollView
        style={styles.container}
        contentContainerStyle={{ paddingBottom: spacing['5xl'] }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        showsVerticalScrollIndicator={false}
        onScroll={Animated.event(
          [{ nativeEvent: { contentOffset: { y: scrollY } } }],
          { useNativeDriver: false },
        )}
        scrollEventThrottle={16}
      >
        {/* === Hero canvas === */}
        <View style={[styles.heroSection, { paddingTop: insets.top + (isWide ? 32 : 56) }]}>
          <Animated.View style={[styles.heroImageWrap, { transform: [{ translateY: heroParallax }] }]}>
            <Image
              source={require('@/assets/images/hero.jpg')}
              style={styles.heroImage}
              resizeMode="cover"
            />
          </Animated.View>

          {/* 6-stop dark→transparent gradient for legibility */}
          <LinearGradient
            colors={[
              'rgba(0,0,0,0.10)',
              'rgba(0,0,0,0.15)',
              'rgba(0,0,0,0.25)',
              'rgba(0,0,0,0.40)',
              'rgba(0,0,0,0.55)',
              'rgba(0,0,0,0.72)',
            ]}
            locations={[0, 0.35, 0.55, 0.7, 0.85, 1]}
            style={styles.heroGradient}
            pointerEvents="none"
          />

          <View style={styles.heroContent}>
            <H1 style={styles.heroTitle}>{t('home.hero.title')}</H1>
            <P style={styles.heroSubtitle}>{t('home.hero.subtitle')}</P>

            {/* On wide breakpoints the pill anchors at hero bottom-center.
                On mobile it sits below the hero via a separate slot. */}
            {isWide ? (
              <View style={styles.searchPillSlotWeb}>
                <SearchBar />
              </View>
            ) : null}
          </View>
        </View>

        {/* Mobile: search pill outside the hero, pinned to top of scroll body */}
        {!isWide ? (
          <View style={styles.searchPillSlotMobile}>
            <SearchBar />
          </View>
        ) : null}

        {/* === Category strip === */}
        <View style={[styles.categoryStripWrap, { marginTop: isWide ? spacing['3xl'] : spacing.lg }]}>
          <HomeCategoryStrip />
        </View>

        {/* === Featured Properties === */}
        {featuredProperties.length > 0 ? (
          <View style={{ marginTop: sectionGap }}>
            <HomeCarouselSection
              eyebrow={t('home.featured.eyebrow', 'Recommended for you')}
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
          </View>
        ) : null}

        {/* === Recently Viewed === */}
        {recentlyViewedProperties && recentlyViewedProperties.length > 0 ? (
          <View style={{ marginTop: sectionGap }}>
            <HomeCarouselSection
              eyebrow={t('home.recentlyViewed.eyebrow', 'Pick up where you left off')}
              title={t('home.recentlyViewed.title') || 'Recently viewed'}
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
          </View>
        ) : null}

        {/* === Saved Properties === */}
        {savedProperties && savedProperties.length > 0 ? (
          <View style={{ marginTop: sectionGap }}>
            <HomeCarouselSection<Property>
              eyebrow={t('home.saved.eyebrow', 'From your shortlist')}
              title={t('home.saved.title') || 'Saved properties'}
              items={savedProperties as Property[]}
              loading={savedLoading}
              renderItem={(property) => (
                <PropertyCard
                  property={property}
                  variant="featured"
                  onPress={() => router.push(`/properties/${property._id || property.id}`)}
                />
              )}
            />
          </View>
        ) : null}

        {/* === Nearby Cities Sections === */}
        {nearbyCities.map((city) => {
          const cityId = city._id || city.id || '';
          const cityProperties = nearbyProperties[cityId] as Property[] | undefined;
          if (!cityProperties || cityProperties.length === 0) return null;

          return (
            <View key={cityId} style={{ marginTop: sectionGap }}>
              <HomeCarouselSection
                eyebrow={t('home.nearby.eyebrow', 'Close to you')}
                title={t('home.nearby.title', { city: city.name }) || `Homes in ${city.name}`}
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
            </View>
          );
        })}

        {/* === Top Cities === */}
        {topCities.length > 0 ? (
          <View style={{ marginTop: sectionGap }}>
            <HomeCarouselSection
              eyebrow={t('home.cities.eyebrow', 'Explore Spain')}
              title={t('home.cities.title')}
              items={topCities}
              loading={citiesLoading}
              minItemsToShow={1}
              maxCardWidth={260}
              renderItem={(city) => (
                <CityTile
                  city={city}
                  onPress={() => router.push(`/properties/city/${city.id}`)}
                />
              )}
            />
          </View>
        ) : null}

        {/* === Stats banner === */}
        <View style={{ marginTop: sectionGap }}>
          <StatsSection
            properties={properties}
            topCitiesCount={topCities.length}
            t={t}
            styles={styles}
          />
        </View>

        {/* === Tips === */}
        <View style={{ marginTop: sectionGap }}>
          <HomeCarouselSection
            eyebrow={t('home.tips.eyebrow', 'Renting smarter')}
            title={t('home.tips.title')}
            items={tips}
            loading={tipsLoading}
            onViewAll={() => router.push('/tips')}
            viewAllText={t('home.viewAll')}
            minItemsToShow={1}
            maxCardWidth={420}
            renderItem={(tip) => (
              <TipTile tip={tip} onPress={() => router.push(`/tips/${tip.id}`)} />
            )}
          />
        </View>

        {/* === Trust grid === */}
        <View style={[styles.trustSection, { marginTop: sectionGap }]}>
          <View style={styles.sectionHeaderCenter}>
            <SectionEyebrow style={styles.eyebrowCenter}>
              {t('home.trust.eyebrow', 'Why Homiio')}
            </SectionEyebrow>
            <H1 style={styles.bigSectionTitle}>{t('home.trust.title', 'Housing you can trust')}</H1>
          </View>
          <View style={styles.trustGrid}>
            {TRUST_FEATURES.map((feature) => (
              <View key={feature.titleKey} style={styles.trustCard}>
                <View style={styles.trustIconCircle}>
                  <Ionicons name={feature.icon} size={26} color={colors.primaryColor} />
                </View>
                <H2 style={styles.trustTitle}>{t(feature.titleKey, feature.titleFallback)}</H2>
                <BloomText style={styles.trustDescription}>
                  {t(feature.descKey, feature.descFallback)}
                </BloomText>
              </View>
            ))}
          </View>
        </View>

        {/* === FAQ === */}
        <View style={[styles.faqSection, { marginTop: sectionGap }]}>
          <View style={styles.sectionHeaderLeft}>
            <SectionEyebrow>{t('home.faq.eyebrow', 'Questions')}</SectionEyebrow>
            <H1 style={styles.bigSectionTitle}>{t('home.faq.title')}</H1>
          </View>
          <View style={styles.faqContainer}>
            {FAQ_ITEMS.map((item, idx) => {
              const isFirst = idx === 0;
              const isLast = idx === FAQ_ITEMS.length - 1;
              const isOpen = expandedFaq === item.id;
              return (
                <View
                  key={item.id}
                  style={[
                    styles.faqItem,
                    isFirst && styles.faqItemFirst,
                    isLast && styles.faqItemLast,
                  ]}
                >
                  <Pressable
                    style={styles.faqQuestion}
                    onPress={() => setExpandedFaq(isOpen ? null : item.id)}
                    accessibilityRole="button"
                    accessibilityState={{ expanded: isOpen }}
                  >
                    <BloomText style={styles.faqQuestionText}>
                      {t(item.questionKey, item.questionFallback)}
                    </BloomText>
                    <Ionicons
                      name={isOpen ? 'chevron-up' : 'chevron-down'}
                      size={20}
                      color={colors.COLOR_BLACK_LIGHT_3}
                    />
                  </Pressable>
                  {isOpen ? (
                    <View style={styles.faqAnswer}>
                      <BloomText style={styles.faqAnswerText}>
                        {t(item.answerKey, item.answerFallback)}
                      </BloomText>
                    </View>
                  ) : null}
                </View>
              );
            })}
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

// === Subcomponents ===

interface CityTileProps {
  city: TopCity;
  onPress: () => void;
}

const CityTile: React.FC<CityTileProps> = ({ city, onPress }) => {
  return (
    <TouchableOpacity
      style={cityStyles.card}
      onPress={onPress}
      activeOpacity={0.85}
      accessibilityRole="button"
      accessibilityLabel={`Explore homes in ${city.name}`}
    >
      <LinearGradient
        colors={[colors.primaryColor, colors.secondaryLight]}
        style={cityStyles.gradient}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
      >
        <View style={cityStyles.scrim} />
        <View style={cityStyles.cityInfo}>
          <BloomText style={cityStyles.cityName}>{city.name}</BloomText>
          {(city.state || city.country) ? (
            <BloomText style={cityStyles.cityLocation}>
              {[city.state, city.country].filter(Boolean).join(', ')}
            </BloomText>
          ) : null}
        </View>
      </LinearGradient>
    </TouchableOpacity>
  );
};

interface TipTileProps {
  tip: TipArticle;
  onPress: () => void;
}

const TipTile: React.FC<TipTileProps> = ({ tip, onPress }) => {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.9}
      style={tipStyles.card}
    >
      <View style={tipStyles.imageContainer}>
        <LinearGradient
          colors={tip.gradientColors as [string, string]}
          style={tipStyles.image}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
        >
          <Ionicons
            name={tip.icon as IoniconName}
            size={36}
            color="#ffffff"
          />
        </LinearGradient>
        <View style={tipStyles.badge}>
          <BloomText style={tipStyles.badgeText}>{tip.category}</BloomText>
        </View>
      </View>
      <View style={tipStyles.content}>
        <BloomText style={tipStyles.title} numberOfLines={2}>{tip.title}</BloomText>
        <BloomText style={tipStyles.description} numberOfLines={2}>{tip.description}</BloomText>
        <View style={tipStyles.meta}>
          <View style={tipStyles.metaItem}>
            <Ionicons name="time-outline" size={14} color={colors.COLOR_BLACK_LIGHT_4} />
            <BloomText style={tipStyles.metaText}>{tip.readTime}</BloomText>
          </View>
          <View style={tipStyles.metaItem}>
            <Ionicons name="calendar-outline" size={14} color={colors.COLOR_BLACK_LIGHT_4} />
            <BloomText style={tipStyles.metaText}>{tip.publishDate}</BloomText>
          </View>
        </View>
      </View>
    </TouchableOpacity>
  );
};

interface StatsSectionProps {
  properties: Property[] | null | undefined;
  topCitiesCount: number;
  t: TFunction<'translation', undefined>;
  styles: ReturnType<typeof createStyles>;
}

const StatsSection = React.memo(function StatsSection({
  properties,
  topCitiesCount,
  t,
  styles,
}: StatsSectionProps) {
  const stats = useMemo(() => {
    const list = properties ?? [];
    const total = list.length;
    const available = list.filter((p) => p.status === 'published').length;
    const ecoFriendly = list.filter((p) =>
      p.amenities?.some(
        (a) => a.includes('eco') || a.includes('green') || a.includes('solar'),
      ),
    ).length;
    return { total, available, ecoFriendly };
  }, [properties]);

  const statItems = [
    {
      number: String(stats.total),
      label: t('home.stats.totalProperties', 'Total properties'),
      icon: 'home-outline' as IoniconName,
    },
    {
      number: String(stats.available),
      label: t('home.stats.availableNow', 'Available now'),
      icon: 'flash-outline' as IoniconName,
    },
    {
      number: String(stats.ecoFriendly),
      label: t('home.stats.ecoFriendly', 'Eco friendly'),
      icon: 'leaf-outline' as IoniconName,
    },
    {
      number: String(topCitiesCount),
      label: t('home.stats.citiesCovered', 'Cities covered'),
      icon: 'compass-outline' as IoniconName,
    },
  ];

  return (
    <View style={styles.statsSection}>
      <View style={styles.sectionHeaderLeft}>
        <SectionEyebrow>{t('home.stats.eyebrow', 'By the numbers')}</SectionEyebrow>
        <H1 style={styles.bigSectionTitle}>{t('home.insights.title')}</H1>
      </View>
      <View style={styles.statsGrid}>
        {statItems.map((item) => (
          <View key={item.label} style={styles.statTile}>
            <View style={styles.statHeader}>
              <View style={styles.statIconBg}>
                <Ionicons name={item.icon} size={20} color={colors.COLOR_BLACK} />
              </View>
            </View>
            <H2 style={styles.statNumber}>{item.number}</H2>
            <BloomText style={styles.statLabel}>{item.label}</BloomText>
          </View>
        ))}
      </View>
    </View>
  );
});

// === Styles ===

const cityStyles = StyleSheet.create({
  card: {
    width: '100%',
    backgroundColor: '#ffffff',
    borderRadius: 24,
    overflow: 'hidden',
  },
  gradient: {
    width: '100%',
    height: 180,
    justifyContent: 'flex-end',
    alignItems: 'flex-start',
    padding: spacing.lg,
    borderRadius: 24,
    overflow: 'hidden',
  },
  scrim: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.18)',
    borderRadius: 24,
  },
  cityInfo: {
    width: '100%',
  },
  cityName: {
    fontSize: 22,
    fontWeight: '700',
    color: '#ffffff',
    letterSpacing: tracker.tight,
    textShadowColor: 'rgba(0, 0, 0, 0.4)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
    marginBottom: spacing.xs,
  },
  cityLocation: {
    fontSize: 13,
    color: '#ffffff',
    opacity: 0.92,
    textShadowColor: 'rgba(0, 0, 0, 0.3)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 2,
  },
});

const tipStyles = StyleSheet.create({
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    overflow: 'hidden',
    flex: 1,
    ...withShadow('sm'),
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
    top: spacing.md,
    left: spacing.md,
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    borderRadius: 999,
    paddingHorizontal: spacing.md,
    paddingVertical: 4,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: '600',
    color: colors.COLOR_BLACK,
    textTransform: 'uppercase',
    letterSpacing: tracker.eyebrow,
  },
  content: {
    padding: spacing.lg,
  },
  title: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.COLOR_BLACK,
    marginBottom: spacing.xs,
    lineHeight: 20,
  },
  description: {
    fontSize: 13,
    color: colors.COLOR_BLACK_LIGHT_3,
    lineHeight: 18,
    marginBottom: spacing.md,
  },
  meta: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  metaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  metaText: {
    fontSize: 12,
    color: colors.COLOR_BLACK_LIGHT_4,
  },
});

const createStyles = (
  isWide: boolean,
  isXL: boolean,
  windowHeight: number,
) => {
  const heroHeight = isXL ? Math.min(640, windowHeight * 0.72) : isWide ? 520 : 560;
  return StyleSheet.create({
    root: {
      flex: 1,
    },
    container: {
      flex: 1,
    },

    // Hero
    heroSection: {
      width: '100%',
      height: heroHeight,
      position: 'relative',
      overflow: 'hidden',
      justifyContent: 'flex-end',
    },
    heroImageWrap: {
      position: 'absolute',
      top: -120,
      left: 0,
      right: 0,
      bottom: -120,
    },
    heroImage: {
      width: '100%',
      height: '100%',
    },
    heroGradient: {
      position: 'absolute',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
    },
    heroContent: {
      width: '100%',
      maxWidth: 1200,
      alignSelf: 'center',
      paddingHorizontal: isWide ? spacing['4xl'] : spacing.xl,
      paddingBottom: isWide ? spacing['5xl'] : spacing['3xl'],
      alignItems: isWide ? 'center' : 'flex-start',
    },
    heroTitle: {
      fontSize: isXL ? 56 : isWide ? 44 : 34,
      lineHeight: isXL ? 60 : isWide ? 48 : 38,
      color: '#ffffff',
      fontWeight: '700',
      letterSpacing: tracker.tight,
      textAlign: isWide ? 'center' : 'left',
      marginBottom: spacing.md,
      maxWidth: 720,
    },
    heroSubtitle: {
      fontSize: isWide ? 18 : 16,
      lineHeight: isWide ? 26 : 22,
      color: '#ffffff',
      opacity: 0.92,
      textAlign: isWide ? 'center' : 'left',
      marginBottom: spacing['2xl'],
      maxWidth: 520,
    },
    searchPillSlotWeb: {
      width: '100%',
      maxWidth: 880,
      marginTop: spacing.lg,
    },
    searchPillSlotMobile: {
      width: '100%',
      paddingHorizontal: 0,
      paddingTop: spacing.lg,
      marginTop: -spacing['3xl'],
      zIndex: 5,
    },

    // Category strip
    categoryStripWrap: {
      paddingTop: spacing.sm,
      paddingBottom: spacing.sm,
    },

    // Section headers
    sectionHeaderLeft: {
      paddingHorizontal: spacing.lg,
      marginBottom: spacing.xl,
    },
    sectionHeaderCenter: {
      paddingHorizontal: spacing.lg,
      marginBottom: spacing.xl,
      alignItems: isWide ? 'center' : 'flex-start',
    },
    eyebrowCenter: {
      textAlign: isWide ? 'center' : 'left',
    },
    bigSectionTitle: {
      fontSize: isWide ? 32 : 26,
      lineHeight: isWide ? 38 : 32,
      color: colors.COLOR_BLACK,
      fontWeight: '700',
      letterSpacing: tracker.tight,
      textAlign: isWide ? 'center' : 'left',
    },

    // Trust
    trustSection: {
      paddingHorizontal: isWide ? spacing['3xl'] : 0,
    },
    trustGrid: {
      flexDirection: isWide ? 'row' : 'column',
      gap: spacing.xl,
      paddingHorizontal: isWide ? 0 : spacing.lg,
    },
    trustCard: {
      flex: isWide ? 1 : undefined,
      alignItems: isWide ? 'flex-start' : 'center',
      paddingVertical: spacing.lg,
      paddingHorizontal: spacing.md,
      gap: spacing.sm,
    },
    trustIconCircle: {
      width: 56,
      height: 56,
      borderRadius: 28,
      backgroundColor: colors.COLOR_BLACK_LIGHT_7,
      alignItems: 'center',
      justifyContent: 'center',
      marginBottom: spacing.sm,
    },
    trustTitle: {
      fontSize: 18,
      fontWeight: '700',
      color: colors.COLOR_BLACK,
      lineHeight: 24,
      textAlign: isWide ? 'left' : 'center',
    },
    trustDescription: {
      fontSize: 14,
      color: colors.COLOR_BLACK_LIGHT_3,
      lineHeight: 20,
      textAlign: isWide ? 'left' : 'center',
    },

    // Stats
    statsSection: {
      paddingHorizontal: isWide ? spacing['3xl'] : 0,
    },
    statsGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: spacing.lg,
      paddingHorizontal: isWide ? 0 : spacing.lg,
    },
    statTile: {
      flex: 1,
      minWidth: isWide ? 200 : '45%',
      padding: spacing.xl,
      backgroundColor: colors.COLOR_BLACK_LIGHT_8,
      borderRadius: 16,
      gap: spacing.sm,
    },
    statHeader: {
      flexDirection: 'row',
      justifyContent: 'flex-end',
    },
    statIconBg: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: '#ffffff',
      alignItems: 'center',
      justifyContent: 'center',
    },
    statNumber: {
      fontSize: 32,
      fontWeight: '700',
      color: colors.COLOR_BLACK,
      letterSpacing: tracker.tight,
      lineHeight: 36,
    },
    statLabel: {
      fontSize: 13,
      color: colors.COLOR_BLACK_LIGHT_3,
      fontWeight: '500',
    },

    // FAQ
    faqSection: {
      paddingHorizontal: isWide ? spacing['3xl'] : 0,
    },
    faqContainer: {
      paddingHorizontal: isWide ? 0 : spacing.lg,
    },
    faqItem: {
      backgroundColor: colors.COLOR_BLACK_LIGHT_8,
      marginBottom: 2,
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
      padding: spacing.lg,
    },
    faqQuestionText: {
      fontSize: 16,
      color: colors.COLOR_BLACK,
      flex: 1,
      marginRight: spacing.md,
      fontWeight: '600',
    },
    faqAnswer: {
      paddingHorizontal: spacing.lg,
      paddingBottom: spacing.lg,
    },
    faqAnswerText: {
      fontSize: 14,
      color: colors.COLOR_BLACK_LIGHT_3,
      lineHeight: 22,
    },
  });
};
