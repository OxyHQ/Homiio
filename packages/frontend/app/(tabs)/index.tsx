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
 *   5. Featured grid — mode-aware, location-scoped titles in a 4-column
 *      web / 1-column mobile grid.
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
import React, { useCallback, useMemo, useState } from 'react';
import { View, RefreshControl, Pressable } from 'react-native';
import { Image } from 'expo-image';
import { useQueryClient } from '@tanstack/react-query';
import { Menu } from 'lucide-react-native';
import Animated, {
  FadeInDown,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
} from 'react-native-reanimated';
import { useTranslation } from 'react-i18next';
import { useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';

import { H1, P } from '@oxyhq/bloom/typography';

import { OfferingType, PropertyType, type City, type Property } from '@homiio/shared-types';

import {
  HOME_FEED_LIMIT,
  isNearYouBlocked,
  useHomeFeedProperties,
  useUserCoordinates,
  type UserCoordinates,
} from '@/hooks/useHomeFeed';
import { usePropertySearch } from '@/hooks/usePropertySearch';
import { getCategoryFilters } from '@/store/getCategoryFilters';
import type { HomeCategory } from '@/store/homeCategoryStore';
import { DEFAULT_SEARCH_QUERY } from '@/store/searchQueryStore';
import { PropertyResultsGrid } from '@/components/ui/PropertyResultsGrid';
import { PropertyResultsGridSkeleton } from '@/components/ui/PropertyResultsGridSkeleton';
import { LoadMoreSentinel } from '@/components/common/LoadMoreSentinel';
import { SectionEyebrow } from '@/components/ui/SectionEyebrow';
import { cityQueryKeys, usePopularCities } from '@/hooks/useCityQueries';
import { cityCountryName, cityRegionName } from '@/utils/cityDisplay';
import { useRecentlyViewed } from '@/hooks/useRecentlyViewed';
import { useSavedPropertiesContext } from '@/context/SavedPropertiesContext';
import { useRentalMode } from '@/context/RentalModeContext';
import { useHomeCategoryStore } from '@/store/homeCategoryStore';
import { resolveHomeCategory } from '@/store/homeCategories';

import { PropertyCard } from '@/components/PropertyCard';
import { HomeCarouselSection } from '@/components/HomeCarouselSection';
import { HomeCategoryStrip } from '@/components/HomeCategoryStrip';
import { NearbyCityCarousel } from '@/components/NearbyCityCarousel';
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
import { spacing, tracker, PAGE_GUTTER_CLASS } from '@/constants/styles';

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
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function resolveExplorePlace(
  userLocation: { latitude: number; longitude: number } | null | undefined,
  cities: City[],
  citiesByDistance: Array<{ city: City; distance: number }>,
  queryPlace: string | undefined,
  defaultPlace: string,
): string {
  const nearest = citiesByDistance[0];
  if (userLocation && nearest && nearest.distance <= WITHIN_REGION_KM) {
    const region = cityRegionName(nearest.city);
    if (region) return region;
  }
  if (userLocation && nearest) {
    const country = cityCountryName(nearest.city);
    if (country) return country;
  }
  if (queryPlace) return queryPlace;
  const fallbackCountry = cities.map((c) => cityCountryName(c)).find(Boolean);
  return fallbackCountry ?? defaultPlace;
}

/**
 * Seed the endless "Explore more homes" feed from the live home state (browse
 * offering + selected category + device location). Reuses `getCategoryFilters` —
 * the single source of truth for what each home category means — and translates
 * its `PropertyFilters` output into the `SearchQuery` shape `usePropertySearch`
 * consumes. Because every dimension folds into `searchQueryKey`, tapping a
 * category chip re-keys the feed and refilters it in place.
 */
function buildExploreFeedQuery(
  offering: OfferingType,
  category: HomeCategory | null,
  userLocation: UserCoordinates | null | undefined,
): SearchQuery {
  const filters = getCategoryFilters(category, {
    userLocation: userLocation ?? null,
    offering,
  });

  // `near_you` resolves to a lat/lng + a 25km radius, which equals the search
  // endpoint's default radius when only a center is sent — so we seed the
  // location with the coordinates and an EMPTY label. An empty label makes
  // `buildSearchParams` emit lat/lng WITHOUT a free-text `q` (a non-empty label
  // is text-matched, which a pure geo lens must not do).
  const location =
    typeof filters.lat === 'number' && typeof filters.lng === 'number'
      ? {
          label: '',
          shortLabel: '',
          center: [filters.lng, filters.lat] as [number, number],
        }
      : undefined;

  return {
    ...DEFAULT_SEARCH_QUERY,
    offering,
    // Newest-first (the backend already ranks image-bearing listings first) so
    // freshly added homes surface on top each visit (freshness, Part 4).
    sortBy: 'createdAt',
    sortOrder: 'desc',
    propertyTypes: filters.type ? [filters.type as PropertyType] : [],
    amenities: filters.amenities ?? [],
    // "Luxury" maps to a monthly-rent floor (or a sale-price floor when buying).
    // `buildSearchParams` routes `priceMin` to the sale-price param for a SALE
    // offering, so one `priceMin` seed covers both the rent and sale buckets.
    priceMin: filters.minRent ?? filters.minSalePrice,
    instantBook: filters.instantBook,
    petFriendly: filters.petFriendly,
    exchangeMode: filters.exchangeMode,
    location,
  };
}

export default function HomePage() {
  const { t } = useTranslation();
  const router = useRouter();
  const { offering: browseOffering, browseMode, mode } = useRentalMode();
  const selectedCategory = useHomeCategoryStore((s) => s.category);
  const queryClient = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  const { data: cities = [], refetch: refetchCities } = usePopularCities(EXPLORE_CITY_LIMIT);
  const { data: userLocation, isLoading: coordsLoading, refetch: refetchCoords } =
    useUserCoordinates();
  const isWide = useMediaQuery({ minWidth: 768 });
  const isXL = useMediaQuery({ minWidth: 1024 });
  const isScreenNotMobile = useIsScreenNotMobile();
  const openMobileDrawer = useUIStore((s) => s.openMobileDrawer);

  const activeQuery = useSearchQueryStore((s) => s.query);
  const [searchPanelOpen, setSearchPanelOpen] = useState(false);
  const [searchPanelStep, setSearchPanelStep] = useState<SearchStep>('where');

  const heroSearchSeed: SearchQuery = {
    ...activeQuery,
    offering: browseOffering,
  };

  const activeCategory = resolveHomeCategory(selectedCategory, browseMode, mode);
  const nearYouBlocked = isNearYouBlocked(activeCategory, userLocation, coordsLoading);

  const {
    data: feedData,
    isLoading: feedLoading,
    refetch: refetchFeed,
  } = useHomeFeedProperties(browseOffering, activeCategory, userLocation, coordsLoading);

  const { properties: recentlyViewedProperties, refetch: refetchRecentlyViewed } =
    useRecentlyViewed();
  const { savedProperties, isLoading: savedLoading, loadSavedProperties } =
    useSavedPropertiesContext();

  // Endless "Explore more homes" feed — the terminal, never-ending band below the
  // curated sections. Seeded live from the browse offering + active category +
  // location so a category chip tap re-keys it (React Query refetches page 1) and
  // it refilters instantly. Same `usePropertySearch` engine + image-first,
  // newest-first order as the search/browse screens.
  const exploreQuery = useMemo(
    () => buildExploreFeedQuery(browseOffering, activeCategory, userLocation),
    [browseOffering, activeCategory, userLocation],
  );
  const exploreFeed = usePropertySearch(exploreQuery, { enabled: !nearYouBlocked });
  const exploreProperties = exploreFeed.properties;
  const exploreInitialLoading = exploreFeed.isLoading && exploreProperties.length === 0;
  // Guarded loader (matches Mention's `handleLoadMore`): native fires it via
  // `PageScrollView onEndReached`, web via the `LoadMoreSentinel` at the feed end.
  const loadMoreExplore = useCallback(() => {
    if (exploreFeed.hasNextPage && !exploreFeed.isFetchingNextPage) {
      void exploreFeed.fetchNextPage();
    }
  }, [exploreFeed.hasNextPage, exploreFeed.isFetchingNextPage, exploreFeed.fetchNextPage]);

  const properties = feedData?.properties;
  const propertiesLoading = feedLoading;
  const featuredProperties = properties ? (properties.slice(0, 8) as Property[]) : [];
  const gridProperties = properties ? (properties.slice(8, HOME_FEED_LIMIT) as Property[]) : [];

  const locatedCities = cities.filter(
    (city): city is City & { coordinates: { lat: number; lng: number } } =>
      typeof city.coordinates?.lat === 'number' && typeof city.coordinates?.lng === 'number',
  );

  const citiesByDistance = userLocation
    ? locatedCities
        .map((city) => ({
          city,
          distance: getDistance(
            userLocation.latitude,
            userLocation.longitude,
            city.coordinates.lat,
            city.coordinates.lng,
          ),
        }))
        .sort((a, b) => a.distance - b.distance)
    : locatedCities.map((city) => ({ city, distance: Number.POSITIVE_INFINITY }));

  const nearbyCities = userLocation ? citiesByDistance.slice(0, 2).map((entry) => entry.city) : [];

  const explorePlace = resolveExplorePlace(
    userLocation,
    cities,
    citiesByDistance,
    activeQuery.location?.shortLabel || activeQuery.location?.label,
    t('home.cityShowcase.defaultPlace'),
  );

  const featuredGridTitle =
    browseOffering === OfferingType.SALE
      ? t('home.featured.gridBuy', { place: explorePlace })
      : browseOffering === OfferingType.EXCHANGE
        ? t('home.featured.gridExchange', { place: explorePlace })
        : browseOffering === OfferingType.SHORT_TERM_RENT
          ? t('home.featured.gridVacation', { place: explorePlace })
          : t('home.featured.gridLongTerm', { place: explorePlace });

  const feedEmptyText = nearYouBlocked ? t('home.category.nearYouUnavailable') : t('home.featured.empty');

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      await Promise.all([
        refetchCoords(),
        refetchFeed(),
        refetchCities(),
        ...nearbyCities.map((city) =>
          queryClient.invalidateQueries({
            queryKey: cityQueryKeys.properties(city._id, 8),
          }),
        ),
        loadSavedProperties(),
        refetchRecentlyViewed(),
        exploreFeed.refetch(),
      ]);
    } finally {
      setRefreshing(false);
    }
  };

  const scrollY = useSharedValue(0);

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

  return (
    <View className="flex-1">
      <PageScrollView
        scrollY={scrollY}
        className="flex-1"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        showsVerticalScrollIndicator={false}
        onEndReached={loadMoreExplore}
      >
        <View className="relative h-[400px] w-full justify-end overflow-hidden pt-[max(0.5rem,env(safe-area-inset-top))] md:h-[360px] xl:h-[min(400px,45vh)]">
          <Animated.View
            className="absolute inset-x-0"
            style={[{ top: -120, bottom: -120 }, heroParallaxStyle]}
          >
            <Image
              source={require('@/assets/images/hero.jpg')}
              className="h-full w-full object-cover object-center"
              contentFit="cover"
              contentPosition="center"
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

          {!isScreenNotMobile ? (
            <Pressable
              onPress={openMobileDrawer}
              accessibilityRole="button"
              accessibilityLabel={t('sidebar.open')}
              hitSlop={spacing.sm}
              className="absolute left-4 top-[max(0.5rem,env(safe-area-inset-top))] z-10 h-10 w-10 items-center justify-center rounded-full bg-black/35"
            >
              <Menu size={22} color={colors.primaryLight} />
            </Pressable>
          ) : null}

          <View
            className={
              isWide
                ? 'w-full max-w-[1200px] self-center items-center px-10 pb-4'
                : 'w-full max-w-[1200px] self-center items-start px-5 pb-4'
            }
          >
            <H1
              className={
                isXL
                  ? 'mb-2 max-w-[720px] text-center text-[56px] font-bold leading-[60px] text-white'
                  : isWide
                    ? 'mb-2 max-w-[720px] text-center text-[44px] font-bold leading-[48px] text-white'
                    : 'mb-2 max-w-[720px] text-left text-[34px] font-bold leading-[38px] text-white'
              }
              style={{ letterSpacing: tracker.tight }}
            >
              {t('home.hero.title')}
            </H1>
            <P
              className={
                isWide
                  ? 'mb-4 max-w-[520px] text-center text-lg leading-[26px] text-white opacity-90'
                  : 'mb-4 max-w-[520px] text-left text-base leading-[22px] text-white opacity-90'
              }
            >
              {t('home.hero.subtitle')}
            </P>

            <View
              className={
                isWide
                  ? 'z-20 mt-2 w-full max-w-[880px] self-center'
                  : 'z-20 mt-2 w-full max-w-[520px] self-center'
              }
            >
              <SearchSummaryBar
                query={activeQuery}
                onPress={() => router.push('/explore')}
                onPressColumn={(step) => {
                  setSearchPanelStep(step);
                  setSearchPanelOpen(true);
                }}
              />
            </View>
            {searchPanelOpen ? (
              <SearchPanel
                open={searchPanelOpen}
                onClose={() => setSearchPanelOpen(false)}
                initialQuery={heroSearchSeed}
                initialStep={searchPanelStep}
                onSubmit={(query) => {
                  useSearchQueryStore.getState().setQuery(query);
                  setSearchPanelOpen(false);
                  router.push('/explore');
                }}
                onApply={(query) => {
                  useSearchQueryStore.getState().setQuery(query);
                  setSearchPanelOpen(false);
                }}
              />
            ) : null}
          </View>
        </View>

        <View className="gap-6 md:gap-8 pb-14">
          <HomeCategoryStrip sticky />

          <HomeCarouselSection
            eyebrow={t('home.recommended.eyebrow')}
            title={t('home.featured.title')}
            items={featuredProperties}
            loading={propertiesLoading}
            emptyText={feedEmptyText}
            viewAllText={t('home.viewAll')}
            onViewAll={() => router.push('/explore')}
            renderItem={(property) => (
              <PropertyCard
                property={property}
                variant="featured"
                enableImageCarousel={false}
                onPress={() => router.push(`/properties/${property._id || property.id}`)}
              />
            )}
          />

          {cities.length > 0 ? (
            <Animated.View entering={FadeInDown.duration(420)}>
              <CityShowcaseSection
                title={t('home.cityShowcase.title', { place: explorePlace })}
                items={cities}
                onPressCity={(city) => router.push(`/properties/city/${city._id}`)}
              />
            </Animated.View>
          ) : null}

          {gridProperties.length > 0 ? (
            <Animated.View entering={FadeInDown.duration(420)}>
              <FeaturedGridSection
                title={featuredGridTitle}
                items={gridProperties}
                onPropertyPress={(property) =>
                  router.push(`/properties/${property._id || property.id}`)
                }
              />
            </Animated.View>
          ) : null}

          {recentlyViewedProperties && recentlyViewedProperties.length > 0 ? (
            <HomeCarouselSection
              title={t('home.recentlyViewed.continue')}
              items={recentlyViewedProperties}
              loading={false}
              renderItem={(property) => (
                <PropertyCard
                  property={property}
                  variant="featured"
                  enableImageCarousel={false}
                  onPress={() => router.push(`/properties/${property._id || property.id}`)}
                />
              )}
            />
          ) : null}

          {savedProperties && savedProperties.length > 0 ? (
            <HomeCarouselSection<Property>
              title={t('home.saved.title')}
              items={savedProperties as Property[]}
              loading={savedLoading}
              renderItem={(property) => (
                <PropertyCard
                  property={property}
                  variant="featured"
                  enableImageCarousel={false}
                  onPress={() => router.push(`/properties/${property._id || property.id}`)}
                />
              )}
            />
          ) : null}

          {nearbyCities.map((city) => (
            <NearbyCityCarousel key={city._id} city={city} />
          ))}

          {isWide ? (
            <View className={`flex-row items-stretch gap-6 md:gap-8 ${PAGE_GUTTER_CLASS}`}>
              <HostCtaBanner
                fill
                title={t('home.hostCta.title')}
                subtitle={t('home.hostCta.subtitle')}
                ctaLabel={t('home.hostCta.cta')}
                imageUrl={HOST_CTA_IMAGE}
                onPress={() => router.push('/properties/create')}
              />
              <AgentCtaBanner
                fill
                title={t('agent.banner.title')}
                subtitle={t('agent.banner.subtitle')}
                ctaLabel={t('agent.banner.cta')}
                trustLine={t('agent.banner.trust')}
                onPress={() => router.push('/agent')}
              />
            </View>
          ) : (
            <>
              <HostCtaBanner
                title={t('home.hostCta.title')}
                subtitle={t('home.hostCta.subtitle')}
                ctaLabel={t('home.hostCta.cta')}
                imageUrl={HOST_CTA_IMAGE}
                onPress={() => router.push('/properties/create')}
              />
              <AgentCtaBanner
                title={t('agent.banner.title')}
                subtitle={t('agent.banner.subtitle')}
                ctaLabel={t('agent.banner.cta')}
                trustLine={t('agent.banner.trust')}
                onPress={() => router.push('/agent')}
              />
            </>
          )}

          {/* Explore more homes — the terminal, endless band. Curated sections
              above give way to an image-first, category-driven feed that keeps
              appending pages (web: the sentinel; native: PageScrollView
              onEndReached). It reacts live to the category strip via its query
              key. Rendered with the shared PropertyResultsGrid so it behaves
              exactly like the search/browse grids. */}
          <Animated.View entering={FadeInDown.duration(420)} className="gap-4">
            <View className={PAGE_GUTTER_CLASS}>
              <SectionEyebrow>{t('home.explore.eyebrow')}</SectionEyebrow>
              <H1 className="text-[26px] font-bold leading-8 tracking-tight text-foreground">
                {t('home.explore.title')}
              </H1>
            </View>

            {exploreInitialLoading ? (
              <View className={PAGE_GUTTER_CLASS}>
                <PropertyResultsGridSkeleton count={8} />
              </View>
            ) : exploreProperties.length === 0 ? (
              <View className={`py-2 ${PAGE_GUTTER_CLASS}`}>
                <P className="text-sm text-muted-foreground">{feedEmptyText}</P>
              </View>
            ) : (
              <View className={PAGE_GUTTER_CLASS}>
                <PropertyResultsGrid
                  properties={exploreProperties}
                  onPropertyPress={(property) =>
                    router.push(`/properties/${property._id || property.id}`)
                  }
                />
                {exploreFeed.isFetchingNextPage ? (
                  <View className="pt-6">
                    <PropertyResultsGridSkeleton count={4} />
                  </View>
                ) : null}
                {/* Web-only pagination trigger; native paginates via
                    PageScrollView onEndReached. Inert on native. */}
                <LoadMoreSentinel
                  enabled={exploreFeed.hasNextPage}
                  onLoadMore={loadMoreExplore}
                />
              </View>
            )}
          </Animated.View>
        </View>
      </PageScrollView>
    </View>
  );
}
