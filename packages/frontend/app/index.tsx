/**
 * Homiio home — Airbnb-2026 brand surface. Treats the page as a stack of
 * strongly-spaced, image-heavy merchandising beats:
 *
 *   1. Hero canvas (Barcelona-flavored full-bleed photo, gradient
 *      overlay, collapsed SearchSummaryBar pill floats centered on web /
 *      sits below on mobile and opens the expanding SearchPanel).
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
  Pressable,
  useWindowDimensions,
} from 'react-native';
import { Menu } from 'lucide-react-native';
import Animated, {
  interpolate,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
} from 'react-native-reanimated';
import { useTranslation } from 'react-i18next';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import * as Location from 'expo-location';

import { H1, P } from '@oxyhq/bloom/typography';

import { RentMode, type Property } from '@homiio/shared-types';

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
import { SearchSummaryBar } from '@/components/search/SearchSummaryBar';
import { SearchPanel } from '@/components/search/SearchPanel';
import type { SearchQuery } from '@/components/search/types';
import { useSearchQueryStore } from '@/store/searchQueryStore';
import {
  CityShowcaseSection,
  type CityShowcaseItem,
} from '@/components/CityShowcaseSection';
import { FeaturedGridSection } from '@/components/FeaturedGridSection';
import { HostCtaBanner } from '@/components/HostCtaBanner';
import { HomeFooterStrip } from '@/components/HomeFooterStrip';
import { useMediaQuery } from 'react-responsive';
import { useLayoutScroll } from '@/context/LayoutScrollContext';
import { useIsScreenNotMobile } from '@/hooks/useOptimizedMediaQuery';
import { useUIStore } from '@/store/uiStore';
import { colors } from '@/styles/colors';
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
  // Matches the breakpoint that hides the persistent sidebar in _layout.tsx
  // (useIsScreenNotMobile === minWidth 500). Below it, the sidebar is an
  // on-demand overlay drawer, so the hero needs a way to open it.
  const isScreenNotMobile = useIsScreenNotMobile();
  const openMobileDrawer = useUIStore((s) => s.openMobileDrawer);

  // Active search query (source of truth shared with the results route). The
  // hero pill renders this collapsed; the expanding panel edits a draft of it.
  const activeQuery = useSearchQueryStore((s) => s.query);
  const [searchPanelOpen, setSearchPanelOpen] = useState(false);

  // Seed the panel from the active query, overriding the rental mode with the
  // user's current selection so opening the hero search respects the
  // Long-term/Vacation toggle they last picked.
  const heroSearchSeed = useMemo<SearchQuery>(
    () => ({
      ...activeQuery,
      rentMode: mode === 'vacation' ? RentMode.VACATION : RentMode.LONG_TERM,
    }),
    [activeQuery, mode],
  );

  const handleOpenSearchPanel = useCallback(() => setSearchPanelOpen(true), []);
  const handleCloseSearchPanel = useCallback(() => setSearchPanelOpen(false), []);

  const handleSubmitSearch = useCallback(
    (query: SearchQuery) => {
      useSearchQueryStore.getState().setQuery(query);
      setSearchPanelOpen(false);
      router.push('/search');
    },
    [router],
  );

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
  const localScrollY = useSharedValue(0);
  const scrollY = layoutScroll?.scrollY ?? localScrollY;
  const { height: windowHeight } = useWindowDimensions();
  const styles = useMemo(
    () => createStyles(isWide, isXL, windowHeight),
    [isWide, isXL, windowHeight],
  );

  const scrollHandler = useAnimatedScrollHandler({
    onScroll: (event) => {
      scrollY.value = event.contentOffset.y;
    },
  });

  const heroParallaxStyle = useAnimatedStyle(() => ({
    transform: [
      {
        translateY: interpolate(
          scrollY.value,
          [-300, 0, 800],
          [-120, 0, 240],
          'clamp',
        ),
      },
    ],
  }));

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
      <Animated.ScrollView
        style={styles.container}
        contentContainerStyle={{ paddingBottom: spacing['5xl'] }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        showsVerticalScrollIndicator={false}
        onScroll={scrollHandler}
        scrollEventThrottle={16}
      >
        {/* === Hero canvas === */}
        <View style={[styles.heroSection, { paddingTop: insets.top + (isWide ? spacing['3xl'] : spacing['5xl']) }]}>
          <Animated.View style={[styles.heroImageWrap, heroParallaxStyle]}>
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

          {/* Drawer toggle — small screens only. Opens the overlay sidebar
              (the persistent sidebar is hidden below the 500px breakpoint). */}
          {!isScreenNotMobile ? (
            <Pressable
              onPress={openMobileDrawer}
              accessibilityRole="button"
              accessibilityLabel={t('sidebar.open', { defaultValue: 'Open menu' })}
              hitSlop={spacing.sm}
              style={[styles.heroMenuButton, { top: insets.top + spacing.sm }]}
            >
              <Menu size={22} color={colors.primaryLight} />
            </Pressable>
          ) : null}

          <View style={styles.heroContent}>
            <H1 style={styles.heroTitle}>{t('home.hero.title')}</H1>
            <P style={styles.heroSubtitle}>{t('home.hero.subtitle')}</P>

            {isWide ? (
              <View style={styles.searchPillSlotWeb}>
                <SearchSummaryBar
                  query={activeQuery}
                  onPress={handleOpenSearchPanel}
                />
                {searchPanelOpen ? (
                  <View style={styles.searchPanelAnchor}>
                    <SearchPanel
                      open={searchPanelOpen}
                      onClose={handleCloseSearchPanel}
                      initialQuery={heroSearchSeed}
                      onSubmit={handleSubmitSearch}
                    />
                  </View>
                ) : null}
              </View>
            ) : null}
          </View>
        </View>

        {/* Mobile-only search pill. The panel itself renders as a full-screen
            modal on narrow screens (breakpoint-driven inside SearchPanel), so a
            single mount here covers the whole mobile flow. */}
        {!isWide ? (
          <View style={styles.searchPillSlotMobile}>
            <SearchSummaryBar
              query={activeQuery}
              onPress={handleOpenSearchPanel}
            />
            <SearchPanel
              open={searchPanelOpen}
              onClose={handleCloseSearchPanel}
              initialQuery={heroSearchSeed}
              onSubmit={handleSubmitSearch}
            />
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
      </Animated.ScrollView>
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
    heroMenuButton: {
      position: 'absolute',
      left: spacing.lg,
      zIndex: 10,
      width: 40,
      height: 40,
      borderRadius: 999,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: 'rgba(0,0,0,0.35)',
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
      color: colors.white,
      fontWeight: '700',
      letterSpacing: tracker.tight,
      textAlign: isWide ? 'center' : 'left',
      marginBottom: spacing.md,
      maxWidth: 720,
    },
    heroSubtitle: {
      fontSize: isWide ? 18 : 16,
      lineHeight: isWide ? 26 : 22,
      color: colors.white,
      opacity: 0.92,
      textAlign: isWide ? 'center' : 'left',
      marginBottom: spacing['2xl'],
      maxWidth: 520,
    },
    searchPillSlotWeb: {
      width: '100%',
      maxWidth: 880,
      marginTop: spacing.lg,
      position: 'relative',
      zIndex: 20,
    },
    searchPanelAnchor: {
      position: 'absolute',
      top: '100%',
      left: 0,
      right: 0,
      marginTop: spacing.md,
      zIndex: 30,
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
