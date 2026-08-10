/**
 * Homiio home — an explicitly LOCAL, finite, explainable surface (#353).
 *
 * ## What it was, and why none of that survived
 *
 * A merchandising stack: hero, category strip, recommended carousel, city
 * showcase, featured grid, nearby-city carousels, and an endless feed that never
 * ended. Its geographic lens was one chip out of eighteen — `near_you` — and the
 * default category was `null`, whose filter set is literally `{}`. So opening
 * Homiio ran a WORLDWIDE search under a heading naming a region derived from the
 * nearest city, and nothing in the UI said so. That is ADR 0002's principle 2
 * ("location is never implicit") violated by construction, not by a bug.
 *
 * ## The shape now
 *
 *  1. **The scope bar, ABOVE the hero.** Position is the requirement: "el hero no
 *     debe ocultar la ubicación o consumir la mayor parte de una pantalla
 *     pequeña". Putting the bar first means the area is on screen at first paint
 *     on the narrowest device, before any image has decoded.
 *  2. **A shorter hero.** It is a brand moment and a search entry point, not the
 *     page.
 *  3. **Finite sections**, each stating its rule and its data source, all
 *     computed under ONE scope by one request.
 *  4. **Your own things** — continue browsing, saved — which are yours wherever
 *     you are and are therefore not scoped.
 *  5. **"Explore more" as a CTA to `/explore`**, which is where an unbounded list
 *     belongs. Home no longer paginates.
 *
 * ## Nothing renders until the scope resolves
 *
 * `scope.canQuery` gates the sections query. There is no arm of this component
 * that fetches listings without a scope — the global feed is reachable only
 * through `exploreGlobal`, which is a button somebody has to press.
 */
import React, { useCallback, useMemo, useState } from 'react';
import { View, RefreshControl, Pressable } from 'react-native';
import { Image } from 'expo-image';
import { Menu } from 'lucide-react-native';
import Animated, { FadeInDown, interpolate, useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { useTranslation } from 'react-i18next';
import { useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';

import { Button } from '@oxyhq/bloom/button';
import { H1, P } from '@oxyhq/bloom/typography';

import { serializeLocationToken, type LocationSelection, type Property } from '@homiio/shared-types';

import { useLocationScope } from '@/hooks/useLocationScope';
import { homeSurfaceState, useHomeSections } from '@/hooks/useHomeSections';
import { LocationScopeBar } from '@/components/location/LocationScopeBar';
import { HomeSectionBand } from '@/components/home/HomeSectionBand';
import { PropertyResultsGridSkeleton } from '@/components/ui/PropertyResultsGridSkeleton';
import { useRecentlyViewed } from '@/hooks/useRecentlyViewed';
import { useSavedPropertiesContext } from '@/context/SavedPropertiesContext';
import { useRentalMode } from '@/context/RentalModeContext';
import { useSearchQueryStore } from '@/store/searchQueryStore';

import { PropertyCard } from '@/components/PropertyCard';
import { HomeCarouselSection } from '@/components/HomeCarouselSection';
import { SearchSummaryBar } from '@/components/search/SearchSummaryBar';
import { SearchPanel } from '@/components/search/SearchPanel';
import type { SearchQuery, SearchStep } from '@/components/search/types';
import { HostCtaBanner } from '@/components/HostCtaBanner';
import { AgentCtaBanner } from '@/components/agent/AgentCtaBanner';
import { PageScrollView } from '@/components/PageScrollView';
import { SectionEyebrow } from '@/components/ui/SectionEyebrow';
import { exploreHref } from '@/utils/searchUrl';
import { useMediaQuery } from 'react-responsive';
import { useIsScreenNotMobile } from '@/hooks/useOptimizedMediaQuery';
import { useUIStore } from '@/store/uiStore';
import { colors } from '@/styles/colors';
import { spacing, tracker, PAGE_GUTTER_CLASS } from '@/constants/styles';

/** Hero photo for the Host CTA at the foot of the page. */
const HOST_CTA_IMAGE =
  'https://images.unsplash.com/photo-1505691938895-1758d7feb511?auto=format&fit=crop&w=1600&q=80';

/** How many skeleton cards stand in for a section while the surface loads. */
const SKELETON_CARDS = 4;

export default function HomePage() {
  const { t } = useTranslation();
  const router = useRouter();
  const { offering: browseOffering } = useRentalMode();
  const [refreshing, setRefreshing] = useState(false);
  const isWide = useMediaQuery({ minWidth: 768 });
  const isXL = useMediaQuery({ minWidth: 1024 });
  const isScreenNotMobile = useIsScreenNotMobile();
  const openMobileDrawer = useUIStore((s) => s.openMobileDrawer);

  const activeQuery = useSearchQueryStore((s) => s.query);
  const [searchPanelOpen, setSearchPanelOpen] = useState(false);
  const [searchPanelStep, setSearchPanelStep] = useState<SearchStep>('where');

  const scope = useLocationScope();
  const home = useHomeSections(scope.selection, browseOffering, { enabled: scope.canQuery });

  // ONE exclusive answer, so "we could not load this" can never be rendered as
  // "there is nothing here" — see `homeSurfaceState`.
  const surface = homeSurfaceState({
    needsPlace: scope.needsPlace,
    canQuery: scope.canQuery,
    isLoading: home.isLoading,
    hasError: home.error !== null,
    sectionCount: home.sections.length,
  });

  const { properties: recentlyViewedProperties, refetch: refetchRecentlyViewed } = useRecentlyViewed();
  const { savedProperties, isLoading: savedLoading, loadSavedProperties } = useSavedPropertiesContext();

  const heroSearchSeed: SearchQuery = { ...activeQuery, offering: browseOffering };

  /**
   * "See all" for a section, and for the page's closing CTA.
   *
   * The scope travels as its `loc` token, so the search opens on the SAME area
   * the section was computed for. A selection the grammar cannot express yields
   * no link rather than one that silently drops the scope — the same rule
   * `exploreHref` applies, for the same reason.
   */
  const exploreScopedHref = useMemo((): string | null => {
    if (!scope.selection) return exploreHref({ ...activeQuery, offering: browseOffering, location: null });
    const token = serializeLocationToken(scope.selection);
    if (!token.ok) return null;
    return exploreHref({ ...activeQuery, offering: browseOffering, location: scope.selection });
  }, [scope.selection, activeQuery, browseOffering]);

  const openExplore = useCallback(() => {
    if (exploreScopedHref) router.push(exploreScopedHref);
  }, [exploreScopedHref, router]);

  /**
   * Pull-to-refresh.
   *
   * It refetches the SAME scope and never re-runs the location ladder, which is
   * the acceptance criterion "pull-to-refresh mantiene exactamente la misma
   * ubicación" — met by not touching the scope rather than by restoring it
   * afterwards. Your own lists refresh alongside, because they are not scoped and
   * cannot move you anywhere.
   */
  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([home.refresh(), loadSavedProperties(), refetchRecentlyViewed()]);
    } finally {
      setRefreshing(false);
    }
  }, [home, loadSavedProperties, refetchRecentlyViewed]);

  const onScopeChange = useCallback(
    (selection: LocationSelection | null) => {
      if (selection) scope.choose(selection);
    },
    [scope],
  );

  const scrollY = useSharedValue(0);
  const heroParallaxStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: interpolate(scrollY.value, [-300, 0, 800], [-80, 0, 160], 'clamp') }],
  }));

  return (
    <View className="flex-1">
      <PageScrollView
        scrollY={scrollY}
        className="flex-1"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        showsVerticalScrollIndicator={false}
      >
        {/* The scope, FIRST. See the header: on the narrowest device the area
            must be readable before the hero image has decoded. */}
        <View className={`${PAGE_GUTTER_CLASS} pt-[max(0.5rem,env(safe-area-inset-top))]`}>
          <View className="w-full max-w-[1200px] self-center">
            <LocationScopeBar
              selection={scope.selection}
              resolution={scope.resolution}
              onChange={onScopeChange}
              onExploreGlobal={scope.isGlobal ? undefined : scope.exploreGlobal}
              isGlobal={scope.isGlobal}
              nearbyPlace={scope.nearbyPlace}
              deviceUnavailable={scope.deviceIssue !== null}
              {...(home.staleAt ? { staleAt: home.staleAt } : {})}
              {...(scope.source === 'device' ? {} : { onUseCurrentLocation: scope.useCurrentLocation })}
            />
          </View>
        </View>

        <View className="relative h-[260px] w-full justify-end overflow-hidden md:h-[300px] xl:h-[min(340px,38vh)]">
          <Animated.View className="absolute inset-x-0" style={[{ top: -80, bottom: -80 }, heroParallaxStyle]}>
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
              'rgba(0,0,0,0.20)',
              'rgba(0,0,0,0.35)',
              'rgba(0,0,0,0.55)',
              'rgba(0,0,0,0.72)',
            ]}
            locations={[0, 0.35, 0.6, 0.85, 1]}
            className="absolute inset-0"
            style={{ pointerEvents: 'none' }}
          />

          {!isScreenNotMobile ? (
            <Pressable
              onPress={openMobileDrawer}
              accessibilityRole="button"
              accessibilityLabel={t('sidebar.open')}
              hitSlop={spacing.sm}
              className="absolute left-4 top-3 z-10 h-10 w-10 items-center justify-center rounded-full bg-black/35"
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
                  ? 'mb-2 max-w-[720px] text-center text-[40px] font-bold leading-[44px] text-white'
                  : isWide
                    ? 'mb-2 max-w-[720px] text-center text-[32px] font-bold leading-[36px] text-white'
                    : 'mb-2 max-w-[720px] text-left text-[26px] font-bold leading-[30px] text-white'
              }
              style={{ letterSpacing: tracker.tight }}
            >
              {t('home.hero.title')}
            </H1>

            <View
              className={
                isWide ? 'z-20 mt-1 w-full max-w-[880px] self-center' : 'z-20 mt-1 w-full max-w-[520px] self-center'
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
                  setSearchPanelOpen(false);
                  const href = exploreHref(query);
                  if (href) router.push(href);
                }}
                onApply={(query) => {
                  useSearchQueryStore.getState().replaceSearch(query);
                  setSearchPanelOpen(false);
                }}
              />
            ) : null}
          </View>
        </View>

        <View className="gap-6 md:gap-8 pb-14 pt-6">
          {/* The mandatory picker. NOT a global list: when nothing has been
              chosen and the device cannot answer, Home asks rather than guesses. */}
          {surface === 'needs_place' ? (
            <View className={`gap-2 ${PAGE_GUTTER_CLASS}`}>
              <SectionEyebrow>{t('home.scopePrompt.eyebrow')}</SectionEyebrow>
              <H1 className="text-[24px] font-bold leading-7 tracking-tight text-foreground">
                {t('home.scopePrompt.title')}
              </H1>
              <P className="text-sm text-muted-foreground">{t('home.scopePrompt.body')}</P>
            </View>
          ) : null}

          {/* Skeletons that PRESERVE the layout, so nothing jumps when the
              sections land. */}
          {surface === 'loading' ? (
            <View className={`gap-6 ${PAGE_GUTTER_CLASS}`}>
              <PropertyResultsGridSkeleton count={SKELETON_CARDS} />
              <PropertyResultsGridSkeleton count={SKELETON_CARDS} />
            </View>
          ) : null}

          {surface === 'failed' ? (
            <View className={`gap-2 ${PAGE_GUTTER_CLASS}`}>
              <P className="text-sm text-muted-foreground">{t('home.sections.error')}</P>
              <Button variant="secondary" size="medium" onPress={onRefresh} accessibilityLabel={t('common.retry')}>
                {t('common.retry')}
              </Button>
            </View>
          ) : null}

          {home.sections.map((section) => (
            <Animated.View key={section.id} entering={FadeInDown.duration(420)}>
              <HomeSectionBand section={section} {...(exploreScopedHref ? { onSeeAll: openExplore } : {})} />
            </Animated.View>
          ))}

          {/* A USEFUL empty state: what to do, not an apology. Only shown once the
              surface has actually answered, so it never flashes during a load. */}
          {surface === 'empty' ? (
            <View className={`gap-3 ${PAGE_GUTTER_CLASS}`}>
              <H1 className="text-[22px] font-bold leading-7 tracking-tight text-foreground">
                {t('home.empty.title')}
              </H1>
              <P className="text-sm text-muted-foreground">{t('home.empty.body')}</P>
              <View className="flex-row flex-wrap gap-3">
                <Button
                  variant="secondary"
                  size="medium"
                  onPress={openExplore}
                  accessibilityLabel={t('home.empty.changeFiltersAccessible')}
                >
                  {t('home.empty.changeFilters')}
                </Button>
                {scope.isGlobal ? null : (
                  <Button
                    variant="secondary"
                    size="medium"
                    onPress={scope.exploreGlobal}
                    accessibilityLabel={t('location.scope.exploreGlobalAccessible')}
                  >
                    {t('location.scope.exploreGlobal')}
                  </Button>
                )}
              </View>
            </View>
          ) : null}

          {/* Your own things. Deliberately NOT scoped: a home you were looking at
              last week is yours wherever you are standing today. */}
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
                  onPress={() => router.push(`/properties/${property.id}`)}
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
                  onPress={() => router.push(`/properties/${property.id}`)}
                />
              )}
            />
          ) : null}

          {/* The page ENDS. "Explore more" is a link to the surface that owns an
              unbounded list; Home does not paginate any more. */}
          <View className={`gap-3 ${PAGE_GUTTER_CLASS}`}>
            <SectionEyebrow>{t('home.explore.eyebrow')}</SectionEyebrow>
            <H1 className="text-[24px] font-bold leading-7 tracking-tight text-foreground">
              {t('home.explore.title')}
            </H1>
            <View className="flex-row">
              <Button
                variant="primary"
                size="medium"
                onPress={openExplore}
                disabled={exploreScopedHref === null}
                accessibilityLabel={t('home.explore.ctaAccessible')}
              >
                {t('home.explore.cta')}
              </Button>
            </View>
          </View>

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
        </View>
      </PageScrollView>
    </View>
  );
}
