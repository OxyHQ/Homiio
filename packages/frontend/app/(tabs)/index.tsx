/**
 * Homiio home — Airbnb-2026 brand surface. Treats the page as a stack of
 * strongly-spaced, image-heavy merchandising beats:
 *
 *   1. Hero canvas (Barcelona-flavored full-bleed photo, gradient
 *      overlay, collapsed SearchSummaryBar pill floats centered ON the
 *      image at every width and opens the expanding SearchPanel).
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

import { OfferingType, type City, type Property, type PropertyFilters } from '@homiio/shared-types';

// Real data hooks
import { useProperties } from '@/hooks';
import { cityService } from '@/services/cityService';
import { usePopularCities } from '@/hooks/useCityQueries';
import { cityCountryName, cityRegionName } from '@/utils/cityDisplay';
import { useRecentlyViewed } from '@/hooks/useRecentlyViewed';
import { useSavedPropertiesContext } from '@/context/SavedPropertiesContext';
import { useRentalMode } from '@/context/RentalModeContext';

// Components
import { PropertyCard } from '@/components/PropertyCard';
import { HomeCarouselSection } from '@/components/HomeCarouselSection';
import { HomeCategoryStrip } from '@/components/HomeCategoryStrip';
import { SearchSummaryBar } from '@/components/search/SearchSummaryBar';
import { SearchPanel } from '@/components/search/SearchPanel';
import type { SearchQuery, SearchStep } from '@/components/search/types';
import { useSearchQueryStore } from '@/store/searchQueryStore';
import { CityShowcaseSection } from '@/components/CityShowcaseSection';
import { FeaturedGridSection } from '@/components/FeaturedGridSection';
import { HostCtaBanner } from '@/components/HostCtaBanner';
import { AgentCtaBanner } from '@/components/agent/AgentCtaBanner';
import { HomeFooterStrip } from '@/components/HomeFooterStrip';
import { useMediaQuery } from 'react-responsive';
import { useLayoutScroll } from '@/context/LayoutScrollContext';
import { useIsScreenNotMobile } from '@/hooks/useOptimizedMediaQuery';
import { useUIStore } from '@/store/uiStore';
import { colors } from '@/styles/colors';
import {
  resolvePagePadding,
  resolveSectionSpacing,
  spacing,
  tracker,
} from '@/constants/styles';

/**
 * Hero photo used at the bottom of the home page Host CTA. Reuses a
 * tasteful Unsplash apartment interior so the banner reads as
 * aspirational without being stocky.
 */
const HOST_CTA_IMAGE =
  'https://images.unsplash.com/photo-1505691938895-1758d7feb511?auto=format&fit=crop&w=1600&q=80';

/** How many DB cities to surface in the home Explore showcase. */
const EXPLORE_CITY_LIMIT = 8;

/**
 * Distance (km) within which the user is treated as "clearly inside" the nearest
 * city's region, so the Explore title scopes to the REGION/province (e.g.
 * "Explore Catalonia"). Beyond it, the title falls back to the COUNTRY.
 */
const WITHIN_REGION_KM = 120;

/** Haversine distance (km) between two lat/lng points; used for nearest-city. */
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
  const { offering: browseOffering } = useRentalMode();
  const [refreshing, setRefreshing] = useState(false);
  // DB cities (with populated region/country + self-hosted cover image) power
  // both the Explore showcase and the nearby-city carousels.
  const { data: cities = [] } = usePopularCities(EXPLORE_CITY_LIMIT);
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
  // Step the panel should open on. The collapsed 3-column pill sets this to the
  // tapped column; tapping the pill as a whole defaults to 'where'.
  const [searchPanelStep, setSearchPanelStep] = useState<SearchStep>('where');

  // Seed the panel from the active query, overriding the offering with the
  // user's current global browse selection so opening the hero search respects
  // the Long-term / Vacation / Buy / Exchange mode they last picked in the
  // sidebar or hero toggle.
  const heroSearchSeed = useMemo<SearchQuery>(
    () => ({
      ...activeQuery,
      offering: browseOffering,
    }),
    [activeQuery, browseOffering],
  );

  const handleOpenSearchPanelAt = useCallback((step: SearchStep) => {
    setSearchPanelStep(step);
    setSearchPanelOpen(true);
  }, []);
  const handleCloseSearchPanel = useCallback(() => setSearchPanelOpen(false), []);

  // The pill's circular Search button runs the search with the live query
  // (which the panel's "Done" has already updated). It does not open the panel —
  // the three columns do that, seeded to the tapped step.
  const handleRunSearch = useCallback(() => {
    router.push('/explore');
  }, [router]);

  // Narrow sheet "Search": commit the composed query and navigate to results.
  const handleSubmitSearch = useCallback(
    (query: SearchQuery) => {
      useSearchQueryStore.getState().setQuery(query);
      setSearchPanelOpen(false);
      router.push('/explore');
    },
    [router],
  );

  // Wide dialog "Done": apply the composed query to the live store so the pill
  // updates, then close — without navigating. The user runs the search from the
  // pill's circular Search button.
  const handleApplySearch = useCallback((query: SearchQuery) => {
    useSearchQueryStore.getState().setQuery(query);
    setSearchPanelOpen(false);
  }, []);

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

  // Cities that carry usable coordinates, each with its distance from the user
  // (Infinity when the user's location is unknown). Drives both the adaptive
  // Explore title (nearest city) and the nearby-city carousels.
  const citiesByDistance = useMemo(() => {
    const located = cities.filter(
      (city): city is City & { coordinates: { lat: number; lng: number } } =>
        typeof city.coordinates?.lat === 'number' && typeof city.coordinates?.lng === 'number',
    );
    if (!userLocation) {
      return located.map((city) => ({ city, distance: Number.POSITIVE_INFINITY }));
    }
    return located
      .map((city) => ({
        city,
        distance: getDistance(
          userLocation.latitude,
          userLocation.longitude,
          city.coordinates.lat,
          city.coordinates.lng,
        ),
      }))
      .sort((a, b) => a.distance - b.distance);
  }, [userLocation, cities]);

  // The two closest cities (only when the user shared their location), used for
  // the nearby-city carousels lower on the page.
  const nearbyCities = useMemo<City[]>(() => {
    if (!userLocation) return [];
    return citiesByDistance.slice(0, 2).map((entry) => entry.city);
  }, [userLocation, citiesByDistance]);

  // The place the Explore showcase is scoped to, for its adaptive title.
  // Priority: the region/province the user is clearly within (nearest located
  // city inside WITHIN_REGION_KM) → that city's country → the search query's
  // chosen place → the country of the first DB city → a neutral default.
  const explorePlace = useMemo<string>(() => {
    const nearest = citiesByDistance[0];
    if (userLocation && nearest && nearest.distance <= WITHIN_REGION_KM) {
      const region = cityRegionName(nearest.city);
      if (region) return region;
    }
    if (userLocation && nearest) {
      const country = cityCountryName(nearest.city);
      if (country) return country;
    }
    const queryPlace = activeQuery.location?.shortLabel || activeQuery.location?.label;
    if (queryPlace) return queryPlace;
    const fallbackCountry = cities.map((c) => cityCountryName(c)).find(Boolean);
    return fallbackCountry ?? t('home.cityShowcase.defaultPlace', 'Spain');
  }, [userLocation, citiesByDistance, activeQuery.location, cities, t]);

  // Fetch properties for the two closest cities. The nearbyCities array
  // changes only when location or cities change, so this is the
  // intrinsic place to load by-city data.
  useEffect(() => {
    if (nearbyCities.length === 0) return;
    let cancelled = false;
    Promise.all(
      nearbyCities.map(async (city) => {
        const cityId = city._id;
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

  // Scope the home feed to the active offering so switching Long-term /
  // Vacation / Buy / Exchange reloads with the matching listings (reusing the
  // SAME `offering` axis the search endpoint filters on — no forked logic).
  const feedFilters = useMemo<PropertyFilters>(
    () => ({
      limit: 12,
      status: 'published',
      offering: browseOffering,
    }),
    [browseOffering],
  );

  useEffect(() => {
    loadProperties(feedFilters);
  }, [loadProperties, feedFilters]);

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
      await loadProperties(feedFilters);
    } finally {
      setRefreshing(false);
    }
  }, [loadProperties, feedFilters]);

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
   * Featured grid title leans on the current browse mode: buy users see homes
   * for sale, exchange users see home swaps, vacation users see beach stays,
   * and long-term users see the default city studios. Each falls back to a
   * neutral, short, brand-tone copy if no translation is set.
   */
  const featuredGridTitle = useMemo(() => {
    if (browseOffering === OfferingType.SALE) {
      return t('home.featured.gridBuy', 'Homes for sale in Barcelona');
    }
    if (browseOffering === OfferingType.EXCHANGE) {
      return t('home.featured.gridExchange', 'Home exchanges in Spain');
    }
    if (browseOffering === OfferingType.SHORT_TERM_RENT) {
      return t('home.featured.gridVacation', 'Beach apartments in València');
    }
    return t('home.featured.gridLongTerm', 'Studios in Barcelona');
  }, [browseOffering, t]);

  const handleNavigateToCity = useCallback(
    (city: City) => {
      router.push(`/properties/city/${city._id}`);
    },
    [router],
  );

  const handleBecomeHost = useCallback(() => {
    router.push('/properties/create');
  }, [router]);

  const handleBecomeAgent = useCallback(() => {
    router.push('/agent');
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
            style={[styles.heroGradient, { pointerEvents: 'none' }]}
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

            {/* Collapsed search pill — centered ON the hero image at every
                width. Tapping a column opens the expanding SearchPanel
                (breakpoint-driven inside SearchPanel: a centered compact dialog
                on wide, a full-screen sheet on narrow); the circular Search
                button runs the search with the live query. Both presentations
                own their own positioning via a Modal, so the pill needs no
                anchor wrapper. */}
            <View style={styles.searchPillSlot}>
              <SearchSummaryBar
                query={activeQuery}
                onPress={handleRunSearch}
                onPressColumn={handleOpenSearchPanelAt}
              />
            </View>
            {searchPanelOpen ? (
              <SearchPanel
                open={searchPanelOpen}
                onClose={handleCloseSearchPanel}
                initialQuery={heroSearchSeed}
                initialStep={searchPanelStep}
                onSubmit={handleSubmitSearch}
                onApply={handleApplySearch}
              />
            ) : null}
          </View>
        </View>

        {/* === Category strip (sticky on web) === */}
        <View style={[styles.categoryStripWrap, { marginTop: sectionGap }]}>
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
                  // Home rows are themselves horizontal scrollers; an in-card
                  // photo pager would fight the row swipe, so keep one photo here.
                  enableImageCarousel={false}
                  onPress={() => router.push(`/properties/${property._id || property.id}`)}
                />
              )}
            />
          </View>
        ) : null}

        {/* === City Showcase (DB cities, adaptive region/country title) === */}
        {cities.length > 0 ? (
          <View style={{ marginTop: sectionGap }}>
            <CityShowcaseSection
              title={t('home.cityShowcase.title', {
                defaultValue: 'Explore {{place}}',
                place: explorePlace,
              })}
              items={cities}
              onPressCity={handleNavigateToCity}
            />
          </View>
        ) : null}

        {/* === Featured Grid (mode-aware) === */}
        {gridProperties.length > 0 ? (
          <View style={{ marginTop: sectionGap }}>
            <FeaturedGridSection
              title={featuredGridTitle}
              items={gridProperties}
              onPropertyPress={(property) =>
                router.push(`/properties/${property._id || property.id}`)
              }
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
                  // Home rows are themselves horizontal scrollers; an in-card
                  // photo pager would fight the row swipe, so keep one photo here.
                  enableImageCarousel={false}
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
                  // Home rows are themselves horizontal scrollers; an in-card
                  // photo pager would fight the row swipe, so keep one photo here.
                  enableImageCarousel={false}
                  onPress={() => router.push(`/properties/${property._id || property.id}`)}
                />
              )}
            />
          </View>
        ) : null}

        {/* === Nearby city carousels (only when location + properties available) === */}
        {nearbyCities.map((city) => {
          const cityId = city._id;
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
                    // Home rows are themselves horizontal scrollers; an in-card
                    // photo pager would fight the row swipe, so keep one photo here.
                    enableImageCarousel={false}
                    onPress={() => router.push(`/properties/${property._id || property.id}`)}
                  />
                )}
              />
            </View>
          );
        })}

        {/* === Closing CTA banners ===
            Responsive 50/50 grid: side-by-side equal-height columns on wide
            screens, stacked full-width on narrow / native (always narrow). The
            row owns the outer page padding + a single `sectionGap` gutter; in
            grid mode each banner runs in `fill` mode (no intrinsic aspectRatio,
            no own page padding) so `alignItems: 'stretch'` equalises height. */}
        {isWide ? (
          <View style={[styles.ctaGridRow, { marginTop: sectionGap, gap: sectionGap }]}>
            <HostCtaBanner
              fill
              title={t('home.hostCta.title', 'List your space, find a great tenant')}
              subtitle={t(
                'home.hostCta.subtitle',
                'Reach verified renters across Spain — free to list, fair fees, real human support.',
              )}
              ctaLabel={t('home.hostCta.cta', 'Become a host')}
              imageUrl={HOST_CTA_IMAGE}
              onPress={handleBecomeHost}
            />
            <AgentCtaBanner
              fill
              title={t('agent.banner.title', 'Start today. No license needed.')}
              subtitle={t('agent.banner.subtitle', 'Turn the homes around you into income.')}
              ctaLabel={t('agent.banner.cta', 'Become an agent')}
              trustLine={t('agent.banner.trust', 'No license needed. Work from your phone.')}
              onPress={handleBecomeAgent}
            />
          </View>
        ) : (
          <>
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
            <View style={{ marginTop: sectionGap }}>
              <AgentCtaBanner
                title={t('agent.banner.title', 'Start today. No license needed.')}
                subtitle={t('agent.banner.subtitle', 'Turn the homes around you into income.')}
                ctaLabel={t('agent.banner.cta', 'Become an agent')}
                trustLine={t('agent.banner.trust', 'No license needed. Work from your phone.')}
                onPress={handleBecomeAgent}
              />
            </View>
          </>
        )}

        {/* === Footer trust strip === */}
        <View style={{ marginTop: sectionGap }}>
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
    // Single on-hero pill slot for every width. Centered with a sensible
    // max width so the pill never runs edge-to-edge on a phone and the
    // circular search button on the right stays fully on-screen. The expanding
    // panel renders in its own Modal (centered dialog on wide, sheet on narrow),
    // so this slot only carries the collapsed pill — no anchored dropdown.
    searchPillSlot: {
      width: '100%',
      maxWidth: isWide ? 880 : 520,
      alignSelf: 'center',
      marginTop: spacing.lg,
      zIndex: 20,
    },

    // Category strip
    categoryStripWrap: {
      paddingTop: spacing.sm,
      paddingBottom: spacing.sm,
    },

    // Closing CTA banners — wide-screen 50/50 grid. The row owns the outer page
    // padding (the `fill` banners drop their own) and lays out two equal columns
    // that stretch to the taller one for a balanced, equal-height grid. The
    // inter-column `gap` + `marginTop` are applied inline (they track the
    // runtime `sectionGap`). Only mounted when `isWide`, so the padding always
    // resolves to the wide/desktop value.
    ctaGridRow: {
      flexDirection: 'row',
      alignItems: 'stretch',
      paddingHorizontal: resolvePagePadding(isWide),
    },
  });
};
