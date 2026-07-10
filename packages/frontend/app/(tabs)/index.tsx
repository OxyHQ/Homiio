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
 *
 * Rhythm is 32px on web / 24px on mobile between post-hero sections
 * (NativeWind `gap-6 md:gap-8`). The hero sits outside that gap container
 * so it does not participate. Long-form marketing copy (FAQ, stats, trust
 * grids) does NOT live on the home page — it belongs on /about.
 */
import React, { useState, useMemo, useCallback, useEffect } from 'react';
import {
  View,
  RefreshControl,
  Image,
  Pressable,
  useWindowDimensions,
} from 'react-native';
import { Menu } from 'lucide-react-native';
import Animated, {
  interpolate,
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
import { useHomeCategoryStore } from '@/store/homeCategoryStore';
import { getCategoryFilters } from '@/store/getCategoryFilters';

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
import { PageScrollView } from '@/components/PageScrollView';
import { useMediaQuery } from 'react-responsive';
import { useIsScreenNotMobile } from '@/hooks/useOptimizedMediaQuery';
import { useUIStore } from '@/store/uiStore';
import { colors } from '@/styles/colors';
import { spacing, tracker } from '@/constants/styles';

/**
 * Hero photo used at the bottom of the home page Host CTA. Reuses a
 * tasteful Unsplash apartment interior so the banner reads as
 * aspirational without being stocky.
 */
const HOST_CTA_IMAGE =
  'https://images.unsplash.com/photo-1505691938895-1758d7feb511?auto=format&fit=crop&w=1600&q=80';

/** How many listings the home feed loads (carousel 0–8 + grid 8–16). */
const HOME_FEED_LIMIT = 16;

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
  const { offering: browseOffering, browseMode } = useRentalMode();
  const selectedCategory = useHomeCategoryStore((s) => s.category);
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
    return fallbackCountry ?? t('home.cityShowcase.defaultPlace');
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

  // Scope the home feed to the active offering and optional category lens.
  const categoryFilters = useMemo(
    () => getCategoryFilters(selectedCategory, { userLocation }),
    [selectedCategory, userLocation],
  );

  const feedFilters = useMemo<PropertyFilters>(
    () => ({
      limit: HOME_FEED_LIMIT,
      status: 'published',
      offering: browseOffering,
      ...categoryFilters,
    }),
    [browseOffering, categoryFilters],
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
    return properties.slice(8, HOME_FEED_LIMIT) as Property[];
  }, [properties]);

  const showCategoryStrip = browseMode === 'long_term' || browseMode === 'vacation';

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await loadProperties(feedFilters);
    } finally {
      setRefreshing(false);
    }
  }, [loadProperties, feedFilters]);

  // Sole scroll owner: the document on web (mirrored into `scrollY` by
  // `PageScrollView`), the screen's own `Animated.ScrollView` on native. Drives
  // the hero parallax on both platforms — no dual writers.
  const scrollY = useSharedValue(0);
  const { height: windowHeight } = useWindowDimensions();
  // Hero height is window-derived — keep as style=, not className.
  const heroHeight = isXL ? Math.min(640, windowHeight * 0.72) : isWide ? 520 : 560;

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

  /**
   * Featured grid title leans on the current browse mode: buy users see homes
   * for sale, exchange users see home swaps, vacation users see beach stays,
   * and long-term users see the default city studios. Each falls back to a
   * neutral, short, brand-tone copy if no translation is set.
   */
  const featuredGridTitle = useMemo(() => {
    if (browseOffering === OfferingType.SALE) {
      return t('home.featured.gridBuy');
    }
    if (browseOffering === OfferingType.EXCHANGE) {
      return t('home.featured.gridExchange');
    }
    if (browseOffering === OfferingType.SHORT_TERM_RENT) {
      return t('home.featured.gridVacation');
    }
    return t('home.featured.gridLongTerm');
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

  return (
    <View className="flex-1">
      <PageScrollView
        scrollY={scrollY}
        className="flex-1"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        showsVerticalScrollIndicator={false}
      >
        {/* === Hero canvas ===
            Outside the gap container — full-bleed hero should sit flush
            against the first post-hero section, not participate in rhythm. */}
        <View
          className="relative w-full justify-end overflow-hidden"
          style={{
            height: heroHeight,
            paddingTop: insets.top + (isWide ? spacing['3xl'] : spacing['5xl']),
          }}
        >
          <Animated.View
            className="absolute inset-x-0"
            style={[{ top: -120, bottom: -120 }, heroParallaxStyle]}
          >
            <Image
              source={require('@/assets/images/hero.jpg')}
              className="h-full w-full"
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
            className="absolute inset-0"
            style={{ pointerEvents: 'none' }}
          />

          {/* Drawer toggle — small screens only. Opens the overlay sidebar
              (the persistent sidebar is hidden below the 500px breakpoint). */}
          {!isScreenNotMobile ? (
            <Pressable
              onPress={openMobileDrawer}
              accessibilityRole="button"
              accessibilityLabel={t('sidebar.open')}
              hitSlop={spacing.sm}
              className="absolute left-4 z-10 h-10 w-10 items-center justify-center rounded-full"
              style={{
                top: insets.top + spacing.sm,
                backgroundColor: 'rgba(0,0,0,0.35)',
              }}
            >
              <Menu size={22} color={colors.primaryLight} />
            </Pressable>
          ) : null}

          <View
            className={
              isWide
                ? 'w-full max-w-[1200px] self-center items-center px-10 pb-6'
                : 'w-full max-w-[1200px] self-center items-start px-5 pb-5'
            }
          >
            <H1
              className={
                isXL
                  ? 'mb-3 max-w-[720px] text-center text-[56px] font-bold leading-[60px] text-white'
                  : isWide
                    ? 'mb-3 max-w-[720px] text-center text-[44px] font-bold leading-[48px] text-white'
                    : 'mb-3 max-w-[720px] text-left text-[34px] font-bold leading-[38px] text-white'
              }
              style={{ letterSpacing: tracker.tight }}
            >
              {t('home.hero.title')}
            </H1>
            <P
              className={
                isWide
                  ? 'mb-6 max-w-[520px] text-center text-lg leading-[26px] text-white opacity-90'
                  : 'mb-6 max-w-[520px] text-left text-base leading-[22px] text-white opacity-90'
              }
            >
              {t('home.hero.subtitle')}
            </P>

            {/* Collapsed search pill — centered ON the hero image at every
                width. Tapping a column opens the expanding SearchPanel
                (breakpoint-driven inside SearchPanel: a centered compact dialog
                on wide, a full-screen sheet on narrow); the circular Search
                button runs the search with the live query. Both presentations
                own their own positioning via a Modal, so the pill needs no
                anchor wrapper. */}
            <View
              className={
                isWide
                  ? 'z-20 mt-4 w-full max-w-[880px] self-center'
                  : 'z-20 mt-4 w-full max-w-[520px] self-center'
              }
            >
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

        {/* Section rhythm is owned here by NativeWind `gap` — post-hero
            sections only, evenly spaced (24px mobile / 32px web) with no
            per-section `marginTop`. `pb-14` is bottom scroll padding;
            gap never adds space after the last child. */}
        <View className="gap-6 md:gap-8 pb-14">
        {/* === Category strip (sticky on web) — rent modes only === */}
        {showCategoryStrip ? <HomeCategoryStrip sticky /> : null}

        {/* === Featured Properties carousel === */}
        <HomeCarouselSection
          title={t('home.featured.title')}
          items={featuredProperties}
          loading={propertiesLoading}
          emptyText={t('home.featured.empty')}
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

        {/* === City Showcase (DB cities, adaptive region/country title) === */}
        {cities.length > 0 ? (
          <CityShowcaseSection
            title={t('home.cityShowcase.title', { place: explorePlace })}
            items={cities}
            onPressCity={handleNavigateToCity}
          />
        ) : null}

        {/* === Featured Grid (mode-aware) === */}
        {gridProperties.length > 0 ? (
          <FeaturedGridSection
            title={featuredGridTitle}
            items={gridProperties}
            onPropertyPress={(property) =>
              router.push(`/properties/${property._id || property.id}`)
            }
          />
        ) : null}

        {/* === Continue browsing (Recently Viewed) === */}
        {recentlyViewedProperties && recentlyViewedProperties.length > 0 ? (
          <HomeCarouselSection
            title={t('home.recentlyViewed.continue')}
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
        ) : null}

        {/* === Saved Properties === */}
        {savedProperties && savedProperties.length > 0 ? (
          <HomeCarouselSection<Property>
            title={t('home.saved.title')}
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
        ) : null}

        {/* === Nearby city carousels (only when location + properties available) === */}
        {nearbyCities.map((city) => {
          const cityId = city._id;
          const cityProperties = nearbyProperties[cityId];
          if (!cityProperties || cityProperties.length === 0) return null;
          return (
            <HomeCarouselSection
              key={cityId}
              title={t('home.nearby.title', { city: city.name })}
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
          );
        })}

        {/* === Closing CTA banners ===
            Responsive 50/50 grid: side-by-side equal-height columns on wide
            screens, stacked full-width on narrow / native (always narrow). On
            wide the row owns the outer page padding and its inter-column gutter
            comes from NativeWind `gap-6 md:gap-8`; in grid mode each banner
            runs in `fill` mode (no intrinsic aspectRatio, no own page padding)
            so `alignItems: 'stretch'` equalises height. On narrow the two
            banners are plain scroll siblings and the page `gap` spaces them. */}
        {isWide ? (
          <View className="flex-row items-stretch gap-6 px-8 md:gap-8">
            <HostCtaBanner
              fill
              title={t('home.hostCta.title')}
              subtitle={t('home.hostCta.subtitle')}
              ctaLabel={t('home.hostCta.cta')}
              imageUrl={HOST_CTA_IMAGE}
              onPress={handleBecomeHost}
            />
            <AgentCtaBanner
              fill
              title={t('agent.banner.title')}
              subtitle={t('agent.banner.subtitle')}
              ctaLabel={t('agent.banner.cta')}
              trustLine={t('agent.banner.trust')}
              onPress={handleBecomeAgent}
            />
          </View>
        ) : (
          <>
            <HostCtaBanner
              title={t('home.hostCta.title')}
              subtitle={t('home.hostCta.subtitle')}
              ctaLabel={t('home.hostCta.cta')}
              imageUrl={HOST_CTA_IMAGE}
              onPress={handleBecomeHost}
            />
            <AgentCtaBanner
              title={t('agent.banner.title')}
              subtitle={t('agent.banner.subtitle')}
              ctaLabel={t('agent.banner.cta')}
              trustLine={t('agent.banner.trust')}
              onPress={handleBecomeAgent}
            />
          </>
        )}

        </View>
      </PageScrollView>
    </View>
  );
}
