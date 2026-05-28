/**
 * Homiio home — Airbnb-2026 brand surface. Treats the page as a stack of
 * strongly-spaced, image-heavy merchandising beats:
 *
 *   1. Hero canvas (Barcelona-flavored full-bleed photo, gradient
 *      overlay, hero pill SearchBar floats centered on web / sits below
 *      on mobile).
 *   2. Sticky category strip (web only) with primary-colored active
 *      state.
 *   3. Property carousel — recommended for you.
 *   4. City showcase — large image cards of Spanish cities.
 *   5. Featured grid — mode-aware ("Studios in Barcelona" / "Beach
 *      apartments") in a 4-column web / 1-column mobile grid.
 *   6. Continue browsing (recently viewed) — only if items exist.
 *   7. Saved properties carousel — only if items exist.
 *   8. Nearby cities carousels — only if user shares location and
 *      properties exist.
 *   9. Host CTA banner.
 *  10. Footer trust strip (small print).
 *
 * Rhythm is 96px on web / 56px on mobile between sections. Long-form
 * copy (FAQ accordion, stats banner with big H2 numbers, "Verified
 * Listings / Fair Agreements / Trust Score" 3-up grid) does NOT live on
 * the home page — it belongs on /about and footer respectively.
 */
import React, { useState, useMemo, useCallback, useEffect } from 'react';
import {
  View,
  StyleSheet,
  RefreshControl,
  Image,
  Animated,
  ScrollView,
  useWindowDimensions,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import * as Location from 'expo-location';

import { H1, P } from '@oxyhq/bloom/typography';

import type { Property } from '@homiio/shared-types';

// Real data hooks
import { useProperties } from '@/hooks';
import { cityService } from '@/services/cityService';
import { useRecentlyViewed } from '@/hooks/useRecentlyViewed';
import { useSavedPropertiesContext } from '@/context/SavedPropertiesContext';
import { useRentalMode } from '@/context/RentalModeContext';

// Components
import { PropertyCard } from '@/components/PropertyCard';
import { HomeCarouselSection } from '@/components/HomeCarouselSection';
import { HomeCategoryStrip } from '@/components/HomeCategoryStrip';
import { SearchBar } from '@/components/SearchBar';
import {
  CityShowcaseSection,
  type CityShowcaseItem,
} from '@/components/CityShowcaseSection';
import { FeaturedGridSection } from '@/components/FeaturedGridSection';
import { HostCtaBanner } from '@/components/HostCtaBanner';
import { HomeFooterStrip } from '@/components/HomeFooterStrip';
import { useMediaQuery } from 'react-responsive';
import { useLayoutScroll } from '@/context/LayoutScrollContext';
import {
  resolveSectionSpacing,
  spacing,
  tracker,
} from '@/constants/styles';

interface NearbyCity {
  _id?: string;
  id?: string;
  name: string;
  latitude?: number;
  longitude?: number;
  distance?: number;
}

interface CityListResponseItem extends NearbyCity {
  propertiesCount?: number;
  state?: string;
  country?: string;
}

/**
 * Hand-curated visual showcase of Spain's flagship rental markets. The
 * images come from Unsplash's open library (no API key needed) and are
 * cached aggressively by `expo-image`. When backend cities API surfaces
 * a matching record, we merge in the live property count.
 */
const CITY_SHOWCASE: readonly CityShowcaseItem[] = [
  {
    id: 'barcelona',
    name: 'Barcelona',
    subtitle: 'Mediterranean charm, all-year sun',
    imageUrl:
      'https://images.unsplash.com/photo-1583422409516-2895a77efded?auto=format&fit=crop&w=1280&q=80',
  },
  {
    id: 'madrid',
    name: 'Madrid',
    subtitle: 'Capital culture, fast pace',
    imageUrl:
      'https://images.unsplash.com/photo-1543783207-ec64e4d95325?auto=format&fit=crop&w=1280&q=80',
  },
  {
    id: 'valencia',
    name: 'València',
    subtitle: 'Beachside light, paella streets',
    imageUrl:
      'https://images.unsplash.com/photo-1599282103940-9ba0e7b9f43e?auto=format&fit=crop&w=1280&q=80',
  },
  {
    id: 'sevilla',
    name: 'Sevilla',
    subtitle: 'Andalusian rhythm, orange trees',
    imageUrl:
      'https://images.unsplash.com/photo-1559842139-2e1f7d62e98f?auto=format&fit=crop&w=1280&q=80',
  },
  {
    id: 'malaga',
    name: 'Málaga',
    subtitle: 'Costa del Sol, art and beaches',
    imageUrl:
      'https://images.unsplash.com/photo-1601158935942-52255782d322?auto=format&fit=crop&w=1280&q=80',
  },
  {
    id: 'bilbao',
    name: 'Bilbao',
    subtitle: 'Basque grit, design and pintxos',
    imageUrl:
      'https://images.unsplash.com/photo-1572889464195-26cf26be8ae5?auto=format&fit=crop&w=1280&q=80',
  },
] as const;

/**
 * Hero photo used at the bottom of the home page Host CTA. Reuses a
 * tasteful Unsplash apartment interior so the banner reads as
 * aspirational without being stocky.
 */
const HOST_CTA_IMAGE =
  'https://images.unsplash.com/photo-1505691938895-1758d7feb511?auto=format&fit=crop&w=1600&q=80';

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
  const { mode } = useRentalMode();
  const [refreshing, setRefreshing] = useState(false);
  const [cities, setCities] = useState<CityListResponseItem[]>([]);
  const [userLocation, setUserLocation] = useState<{
    latitude: number;
    longitude: number;
  } | null>(null);
  const [nearbyProperties, setNearbyProperties] = useState<Record<string, Property[]>>({});
  const isWide = useMediaQuery({ minWidth: 768 });
  const isXL = useMediaQuery({ minWidth: 1024 });

  // Get user location on mount. Foreground permissions are an explicit
  // side effect — `useEffect` is the correct primitive.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted' || cancelled) return;
        const location = await Location.getCurrentPositionAsync({});
        if (cancelled) return;
        setUserLocation({
          latitude: location.coords.latitude,
          longitude: location.coords.longitude,
        });
      } catch {
        // Permission denied or geolocation unavailable — feed degrades gracefully.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Derive nearby cities from user location + cities list (no extra effect).
  const nearbyCities = useMemo<NearbyCity[]>(() => {
    if (!userLocation || cities.length === 0) return [];
    const withDistance = cities
      .filter((city) => typeof city.latitude === 'number' && typeof city.longitude === 'number')
      .map((city) => ({
        ...city,
        distance: getDistance(
          userLocation.latitude,
          userLocation.longitude,
          city.latitude ?? 0,
          city.longitude ?? 0,
        ),
      }));
    return withDistance
      .sort((a, b) => (a.distance ?? 0) - (b.distance ?? 0))
      .slice(0, 2);
  }, [userLocation, cities]);

  // Fetch properties for the two closest cities. The nearbyCities array
  // changes only when location or cities change, so this is the
  // intrinsic place to load by-city data.
  useEffect(() => {
    if (nearbyCities.length === 0) return;
    let cancelled = false;
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
      if (cancelled) return;
      const map: Record<string, Property[]> = {};
      results.forEach((r) => {
        map[r.cityId] = r.properties;
      });
      setNearbyProperties(map);
    });
    return () => {
      cancelled = true;
    };
  }, [nearbyCities]);

  // Properties + cities loaded together on mount.
  const { properties, loading: propertiesLoading, loadProperties } = useProperties();
  const { properties: recentlyViewedProperties } = useRecentlyViewed();
  const { savedProperties, isLoading: savedLoading } = useSavedPropertiesContext();

  useEffect(() => {
    Promise.all([
      loadProperties({ limit: 12, status: 'published' }),
      cityService
        .getPopularCities(8)
        .then((r) => (r.data || []) as CityListResponseItem[])
        .catch(() => [] as CityListResponseItem[]),
    ]).then(([, citiesData]) => {
      setCities(citiesData);
    });
  }, [loadProperties]);

  const featuredProperties = useMemo<Property[]>(() => {
    if (!properties) return [];
    return properties.slice(0, 8) as Property[];
  }, [properties]);

  const gridProperties = useMemo<Property[]>(() => {
    if (!properties) return [];
    return properties.slice(0, 8) as Property[];
  }, [properties]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await loadProperties({ limit: 12, status: 'published' });
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

  /**
   * Featured grid title leans on the current rental mode: long-term
   * users see "Studios in Barcelona", vacation users see "Beach
   * apartments". Both fall back to a neutral, short, brand-tone copy
   * if no translation is set.
   */
  const featuredGridTitle = useMemo(() => {
    if (mode === 'vacation') {
      return t('home.featured.gridVacation', 'Beach apartments in València');
    }
    return t('home.featured.gridLongTerm', 'Studios in Barcelona');
  }, [mode, t]);

  const handleNavigateToCity = useCallback(
    (item: CityShowcaseItem) => {
      router.push(`/search?city=${encodeURIComponent(item.id)}`);
    },
    [router],
  );

  const handleBecomeHost = useCallback(() => {
    router.push('/properties/create');
  }, [router]);

  const footerChunks = useMemo(
    () => [
      t('home.footerStrip.verified', 'Verified listings'),
      t('home.footerStrip.fair', 'Fair agreements'),
      t('home.footerStrip.support', 'Real support, real people'),
    ],
    [t],
  );

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

            {isWide ? (
              <View style={styles.searchPillSlotWeb}>
                <SearchBar />
              </View>
            ) : null}
          </View>
        </View>

        {/* Mobile-only search pill */}
        {!isWide ? (
          <View style={styles.searchPillSlotMobile}>
            <SearchBar />
          </View>
        ) : null}

        {/* === Category strip (sticky on web) === */}
        <View style={[styles.categoryStripWrap, { marginTop: isWide ? spacing['3xl'] : spacing.lg }]}>
          <HomeCategoryStrip sticky />
        </View>

        {/* === Featured Properties carousel === */}
        {featuredProperties.length > 0 ? (
          <View style={{ marginTop: sectionGap }}>
            <HomeCarouselSection
              title={t('home.featured.title', 'Top picks for you')}
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

        {/* === City Showcase === */}
        <View style={{ marginTop: sectionGap }}>
          <CityShowcaseSection
            title={t('home.cityShowcase.title', 'Explore Spain')}
            items={CITY_SHOWCASE}
            onPressCity={handleNavigateToCity}
          />
        </View>

        {/* === Featured Grid (mode-aware) === */}
        {gridProperties.length > 0 ? (
          <View style={{ marginTop: sectionGap }}>
            <FeaturedGridSection
              title={featuredGridTitle}
              items={gridProperties}
              renderItem={(property) => (
                <PropertyCard
                  property={property}
                  variant="grid"
                  onPress={() => router.push(`/properties/${property._id || property.id}`)}
                />
              )}
            />
          </View>
        ) : null}

        {/* === Continue browsing (Recently Viewed) === */}
        {recentlyViewedProperties && recentlyViewedProperties.length > 0 ? (
          <View style={{ marginTop: sectionGap }}>
            <HomeCarouselSection
              title={t('home.recentlyViewed.continue', 'Continue browsing')}
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

        {/* === Nearby city carousels (only when location + properties available) === */}
        {nearbyCities.map((city) => {
          const cityId = city._id || city.id || '';
          const cityProperties = nearbyProperties[cityId];
          if (!cityProperties || cityProperties.length === 0) return null;
          return (
            <View key={cityId} style={{ marginTop: sectionGap }}>
              <HomeCarouselSection
                title={t('home.nearby.title', { city: city.name }) || `Homes in ${city.name}`}
                items={cityProperties}
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
          );
        })}

        {/* === Host CTA banner === */}
        <View style={{ marginTop: sectionGap }}>
          <HostCtaBanner
            title={t('home.hostCta.title', 'List your space, find a great tenant')}
            subtitle={t(
              'home.hostCta.subtitle',
              'Reach verified renters across Spain — free to list, fair fees, real human support.',
            )}
            ctaLabel={t('home.hostCta.cta', 'Become a host')}
            imageUrl={HOST_CTA_IMAGE}
            onPress={handleBecomeHost}
          />
        </View>

        {/* === Footer trust strip === */}
        <View style={{ marginTop: spacing['3xl'] }}>
          <HomeFooterStrip chunks={footerChunks} />
        </View>
      </ScrollView>
    </View>
  );
}

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
  });
};
