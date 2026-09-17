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
 *  1. **A shorter hero whose search bar STATES THE AREA.** The mode tabs (rent,
 *     stays, buy, swap) over the search composer, bound to the app-wide scope
 *     (`where="scope"`): its first segment — the compact trigger's title on a
 *     phone — reads "Near Madrid · 25 km", "Everywhere", "Finding where you
 *     are…" or "Choose an area", and its panel is where the area changes: use
 *     my location (disabled with the reason when it is off), the last area,
 *     explore everywhere, typed places. It is drawn in the hero's first paint,
 *     not behind its photo, so the area is readable before any image decodes
 *     ("el hero no debe ocultar la ubicación").
 *  2. **The prompt when there is no area** — an explanation and a button that
 *     opens the Where step, never a global list.
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
import { View, RefreshControl } from 'react-native';
import { Image } from 'expo-image';
import Animated, { FadeInDown, interpolate, useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { useTranslation } from 'react-i18next';
import { useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';

import { Button } from '@oxy.so/bloom/button';
import { FrostedIconButton } from '@oxy.so/bloom/frosted-icon-button';
import { RiMapPinLine, RiMenuLine } from '@oxy.so/bloom/icons';
import { H1, P } from '@oxy.so/bloom/typography';

import { formatRelativeDate, serializeLocationToken, type Property } from '@homiio/shared-types';

import { useLocationScope } from '@/hooks/useLocationScope';
import { homeSurfaceState, useHomeSections } from '@/hooks/useHomeSections';
import { HomeSectionBand } from '@/components/home/HomeSectionBand';
import { PropertyResultsGridSkeleton } from '@/components/ui/PropertyResultsGridSkeleton';
import { useRecentlyViewed } from '@/hooks/useRecentlyViewed';
import { useSavedPropertiesContext } from '@/context/SavedPropertiesContext';
import { useRentalMode } from '@/context/RentalModeContext';
import { useSearchQueryStore } from '@/store/searchQueryStore';
import { useFormatting } from '@/utils/format';

import { PropertyCard } from '@/components/PropertyCard';
import { HomeCarouselSection } from '@/components/HomeCarouselSection';
import { HomeSearch } from '@/components/search/HomeSearch';
import type { SearchQuery, SearchStep } from '@/components/search/types';
import { HostCtaBanner } from '@/components/HostCtaBanner';
import { AgentCtaBanner } from '@/components/agent/AgentCtaBanner';
import { PageScrollView } from '@/components/PageScrollView';
import { SectionEyebrow } from '@/components/ui/SectionEyebrow';
import { exploreHref } from '@/utils/searchUrl';
import { useMediaQuery } from 'react-responsive';
import { useIsScreenNotMobile } from '@/hooks/useOptimizedMediaQuery';
import { useUIStore } from '@/store/uiStore';
import { spacing, tracker, PAGE_GUTTER_CLASS } from '@/constants/styles';

/** Hero photo for the Host CTA at the foot of the page. */
const HOST_CTA_IMAGE =
  'https://images.unsplash.com/photo-1505691938895-1758d7feb511?auto=format&fit=crop&w=1600&q=80';

/** How many skeleton cards stand in for a section while the surface loads. */
const SKELETON_CARDS = 4;

export default function HomePage() {
  const { t } = useTranslation();
  const router = useRouter();
  const { offering: browseOffering, setBrowseMode } = useRentalMode();
  const [refreshing, setRefreshing] = useState(false);
  const isWide = useMediaQuery({ minWidth: 768 });
  const isXL = useMediaQuery({ minWidth: 1024 });
  const isScreenNotMobile = useIsScreenNotMobile();
  const openMobileDrawer = useUIStore((s) => s.openMobileDrawer);

  const activeQuery = useSearchQueryStore((s) => s.query);
  const [searchStep, setSearchStep] = useState<SearchStep | null>(null);

  const scope = useLocationScope();
  const { locale } = useFormatting();
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

  const chooseArea = useCallback(() => setSearchStep('where'), []);

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
        {/* The hero does NOT clip: the wide search bar's panel drops below it,
            over the sections. The photo clips in its own layer instead, and the
            hero lifts above the sections while a panel is open (RN-Web gives
            every View `z-index: 0`, so a later sibling would paint over it). */}
        <View
          className="relative h-[320px] w-full justify-end md:h-[356px] xl:h-[min(400px,44vh)]"
          style={{ zIndex: searchStep !== null ? 10 : 0 }}
        >
          <View className="absolute inset-0 overflow-hidden" style={{ pointerEvents: 'none' }}>
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
            />
          </View>

          {!isScreenNotMobile ? (
            <View className="absolute left-4 top-[max(0.75rem,env(safe-area-inset-top))] z-10">
              <FrostedIconButton
                onPress={openMobileDrawer}
                icon={<RiMenuLine width={22} height={22} />}
                accessibilityLabel={t('sidebar.open')}
                hitSlop={{ top: spacing.sm, bottom: spacing.sm, left: spacing.sm, right: spacing.sm }}
              />
            </View>
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
              <HomeSearch
                query={heroSearchSeed}
                openStep={searchStep}
                onOpenStepChange={setSearchStep}
                // Explore by mode: the tabs switch the offering Home browses — the
                // same selection as the sidebar — and the scoped sections follow.
                modeTabs="segmented"
                onModeChange={setBrowseMode}
                // The first segment IS the scope statement (see the header).
                where="scope"
                onSubmit={(query) => {
                  const href = exploreHref(query);
                  if (href) router.push(href);
                }}
                // Closing the bar keeps what it shows: the edited query becomes
                // the live one without navigating.
                onApply={(query) => useSearchQueryStore.getState().replaceSearch(query)}
              />
            </View>
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
              <View className="flex-row pt-1">
                <Button
                  variant="primary"
                  size="medium"
                  leadingIcon={RiMapPinLine}
                  onPress={chooseArea}
                  accessibilityLabel={t('location.scope.changeAccessible')}
                >
                  {t('location.scope.chooseArea')}
                </Button>
              </View>
            </View>
          ) : null}

          {/* Served from the offline snapshot: said once, above what it describes. */}
          {home.staleAt && surface === 'sections' ? (
            <P className={`text-[13px] text-muted-foreground ${PAGE_GUTTER_CLASS}`}>
              {t('location.scope.showingCached', { when: formatRelativeDate(home.staleAt, locale) })}
            </P>
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
