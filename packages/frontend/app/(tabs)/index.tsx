/**
 * Homiio home — an explicitly LOCAL, finite, explainable surface, with NO step
 * in front of it (#353, amended by #518 and #519).
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
 *  2. **Destinations when there is no area** — a board of real cities with
 *     inventory, each stating its own scope, never a global list and never a
 *     step the user has to complete first. The "One step first / Where are you
 *     looking for a home?" block this replaced is GONE: see the note below.
 *  3. **Finite sections**, each stating its rule and its data source, all
 *     computed under ONE scope by one request.
 *  4. **Your own things** — continue browsing, saved — which are yours wherever
 *     you are and are therefore not scoped.
 *  5. **"Explore more" as a CTA to `/explore`**, which is where an unbounded list
 *     belongs. Home no longer paginates.
 *
 * ## Nothing is GATED on the scope; only the local sections depend on it
 *
 * `scope.canQuery` gates the sections QUERY, and nothing else. There is still
 * no arm of this component that fetches listings without a scope — the global
 * feed is reachable only through `exploreGlobal`, which is a button somebody
 * has to press — but an unresolved area no longer blanks the page. The hero,
 * the search bar, the mode tabs, the saved and recently-viewed rows, the
 * destinations board and every CTA render regardless.
 *
 * ## The area, when we guessed it, says so
 *
 * `scope.isApproximate` is true when the area came from the device or from the
 * visitor's network rather than from a choice. The search bar's own statement
 * carries the disclosure (`components/location/scopeWhere.ts`), and Home adds
 * a line naming the provenance with a one-tap way to change it. Neither ever
 * claims "your home" or "you are here": an inferred city is a framing device.
 */
import { useCallback, useMemo, useState } from 'react';
import { View } from 'react-native';
import { Image } from 'expo-image';
import { useTranslation } from 'react-i18next';
import { useRouter } from 'expo-router';

import { AppShellMenuButton } from '@oxy.so/bloom/app-shell';
import { EmptyState } from '@oxy.so/bloom/empty-state';
import { SurfaceFade } from '@oxy.so/bloom/fill';
import { Shelf, ShelfSkeleton } from '@oxy.so/bloom/media-shelf';
import { PageHeader } from '@oxy.so/bloom/page-header';
import { H1, P } from '@oxy.so/bloom/typography';

import { formatRelativeDate, serializeLocationToken, type Property } from '@homiio/shared-types';

import { useLocationScope } from '@/hooks/useLocationScope';
import { useCity } from '@/hooks/useCityQueries';
import { getCityImageSource } from '@/utils/cityDisplay';
import { homeSurfaceState, useHomeSections } from '@/hooks/useHomeSections';
import { HomeDiscoveryBoard } from '@/components/home/HomeDiscoveryBoard';
import { ApproximateAreaNotice } from '@/components/home/ApproximateAreaNotice';
import { useRecentlyViewed } from '@/hooks/useRecentlyViewed';
import { useSavedPropertiesContext } from '@/context/SavedPropertiesContext';
import { useRentalMode } from '@/context/RentalModeContext';
import { useSearchQueryStore } from '@/store/searchQueryStore';
import { useFormatting } from '@/utils/format';

import { PropertyCard } from '@/components/PropertyCard';
import { HomeSearch } from '@/components/search/HomeSearch';
import type { SearchQuery, SearchStep } from '@/components/search/types';
import { CtaBanner } from '@/components/CtaBanner';
import { exploreHref } from '@/utils/searchUrl';

const HERO_PHOTO = require('@/assets/images/hero.jpg');

/** Photos for the two closing calls to action. */
const HOST_CTA_IMAGE = require('@/assets/images/cta-host.jpg');
const AGENT_CTA_IMAGE = require('@/assets/images/cta-agent.jpg');

/** The width every card in a row is laid out at. */
const CARD_WIDTH = 240;
/** The page gutter; rows bleed through it to the panel's edges. */
const GUTTER = 16;

export default function HomePage() {
  const { t } = useTranslation();
  const router = useRouter();
  const { browseMode, offering: browseOffering, setBrowseMode } = useRentalMode();

  const activeQuery = useSearchQueryStore((s) => s.query);
  const [searchStep, setSearchStep] = useState<SearchStep | null>(null);

  const scope = useLocationScope();
  // The hero shows the chosen city's own photo, when the area is one of
  // Homiio's cities; otherwise the default street.
  const selection = scope.selection;
  const selectedCityId =
    selection?.kind === 'place' &&
    selection.source.kind === 'homiio' &&
    selection.source.entity === 'city'
      ? selection.source.id
      : undefined;
  const { data: selectedCity } = useCity(selectedCityId);
  const heroPhoto = getCityImageSource(selectedCity ?? undefined, 'large') ?? HERO_PHOTO;
  const { locale } = useFormatting();
  const home = useHomeSections(scope.selection, browseOffering, { enabled: scope.canQuery });
  const { properties: recentlyViewedProperties } = useRecentlyViewed();
  const { savedProperties } = useSavedPropertiesContext();
  const { sections } = home;
  const savedHomes = savedProperties as Property[] | undefined;

  // ONE exclusive answer, so "we could not load this" can never be rendered as
  // "there is nothing here" — see `homeSurfaceState`.
  const surface = homeSurfaceState({
    discovery: scope.discovery,
    canQuery: scope.canQuery,
    isLoading: home.isLoading,
    hasError: home.error !== null,
    sectionCount: home.sections.length,
  });

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
    if (!scope.selection)
      return exploreHref({ ...activeQuery, offering: browseOffering, location: null });
    const token = serializeLocationToken(scope.selection);
    if (!token.ok) return null;
    return exploreHref({ ...activeQuery, offering: browseOffering, location: scope.selection });
  }, [scope.selection, activeQuery, browseOffering]);

  const openExplore = useCallback(() => {
    if (exploreScopedHref) router.push(exploreScopedHref);
  }, [exploreScopedHref, router]);

  const openProperty = useCallback(
    (property: Property) => router.push(`/properties/${property.id}`),
    [router],
  );

  const propertyCards = (properties: readonly Property[]) =>
    properties.map((property) => (
      <PropertyCard
        key={property.id}
        property={property}
        enableImageCarousel={false}
        onPress={() => openProperty(property)}
      />
    ));

  return (
    <>
      {/* Over the hero: the photo runs behind it (and behind the notch). */}
      <PageHeader
        placement="overlap"
        leading={<AppShellMenuButton accessibilityLabel={t('sidebar.open')} />}
      />

      {/* The hero does NOT clip: the wide search bar's panel drops below it,
          over the sections. The photo clips in its own layer instead, and the
          hero lifts above the sections while a panel is open (RN-Web gives
          every View `z-index: 0`, so a later sibling would paint over it). */}
      <View
        className="relative h-[320px] w-full justify-end md:h-[360px] xl:h-[400px]"
        style={{ zIndex: searchStep !== null ? 10 : 0 }}
      >
        <View className="absolute inset-0 overflow-hidden" style={{ pointerEvents: 'none' }}>
          <Image
            source={heroPhoto}
            className="absolute inset-0"
            contentFit="cover"
            transition={300}
          />
          {/* The photo ends in the panel's own colour, not a black scrim. */}
          <SurfaceFade edge="bottom" size={0.6} />
        </View>

        <View className="w-full items-start gap-3 px-4 pb-4 md:items-center md:px-8">
          <H1 className="text-display-4-bold text-foreground md:text-center lg:text-display-3-bold">
            {t(`home.hero.title.${browseMode}`)}
          </H1>
          <View className="z-20 w-full max-w-[880px] self-center">
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
                if (!href) return;
                useSearchQueryStore.getState().replaceSearch(query);
                router.push(href);
              }}
              // Closing the bar keeps what it shows: the edited query becomes
              // the live one without navigating.
              onApply={(query) => useSearchQueryStore.getState().replaceSearch(query)}
            />
          </View>
        </View>
      </View>

      <View className="gap-10 pb-14 pt-6" style={{ paddingHorizontal: GUTTER }}>
        {/* Where an area came from, when Homiio inferred it rather than being
            told. Above the sections it describes, said once, with the one-tap
            way to change it. */}
        <ApproximateAreaNotice scope={scope} onChangeArea={() => setSearchStep('where')} />

        {/* NO mandatory picker: with no area, Home offers real destinations. */}
        {surface === 'discovery' ? (
          <HomeDiscoveryBoard onChoose={scope.choose} contentInset={GUTTER} />
        ) : null}

        {/* Served from the offline snapshot: said once, above what it describes. */}
        {home.staleAt && surface === 'sections' ? (
          <P className="text-sm text-muted-foreground">
            {t('location.scope.showingCached', { when: formatRelativeDate(home.staleAt, locale) })}
          </P>
        ) : null}

        {surface === 'loading' ? (
          <>
            <ShelfSkeleton itemWidth={CARD_WIDTH} count={4} />
            <ShelfSkeleton itemWidth={CARD_WIDTH} count={4} />
          </>
        ) : null}

        {surface === 'failed' ? (
          <EmptyState
            title={t('home.sections.error')}
            action={{ label: t('common.retry'), onPress: home.refresh }}
          />
        ) : null}

        {sections.map((section) => (
          <Shelf
            key={section.id}
            title={t(`home.sections.${section.id}.title`)}
            itemWidth={CARD_WIDTH}
            contentInset={GUTTER}
            onTitlePress={exploreScopedHref ? openExplore : undefined}
          >
            {propertyCards(section.items)}
          </Shelf>
        ))}

        {surface === 'empty' ? (
          <EmptyState
            title={t('home.empty.title')}
            description={t('home.empty.body')}
            action={{ label: t('home.empty.changeFilters'), onPress: openExplore }}
            secondaryAction={
              scope.isGlobal
                ? undefined
                : { label: t('location.scope.exploreGlobal'), onPress: scope.exploreGlobal }
            }
          />
        ) : null}

        {/* Your own things. Deliberately NOT scoped: a home you were looking at
            last week is yours wherever you are standing today. */}
        {recentlyViewedProperties && recentlyViewedProperties.length > 0 ? (
          <Shelf
            title={t('home.recentlyViewed.continue')}
            itemWidth={CARD_WIDTH}
            contentInset={GUTTER}
          >
            {propertyCards(recentlyViewedProperties)}
          </Shelf>
        ) : null}

        {savedHomes && savedHomes.length > 0 ? (
          <Shelf title={t('home.saved.title')} itemWidth={CARD_WIDTH} contentInset={GUTTER}>
            {propertyCards(savedHomes)}
          </Shelf>
        ) : null}

        <View className="gap-6 md:flex-row md:gap-8">
          <CtaBanner
            title={t(`home.hostCta.${browseMode}.title`)}
            subtitle={t(`home.hostCta.${browseMode}.subtitle`)}
            ctaLabel={t(`home.hostCta.${browseMode}.cta`)}
            image={HOST_CTA_IMAGE}
            onPress={() => router.push('/properties/create')}
          />
          <CtaBanner
            title={t('agent.banner.title')}
            subtitle={t('agent.banner.subtitle')}
            ctaLabel={t('agent.banner.cta')}
            image={AGENT_CTA_IMAGE}
            trustLine={t('agent.banner.trust')}
            onPress={() => router.push('/agent')}
          />
        </View>
      </View>
    </>
  );
}
