/**
 * SearchResultsView — the responsive results surface mounted by the results
 * route. Single tree, laid out by NativeWind breakpoint classes (`sm:`):
 *
 *  - Wide: a scrollable list of property cards on the left + a sticky map on
 *    the right. Selecting a pin highlights the matching card; selecting or
 *    hovering a card draws its pin active (`ResultsMap`'s `selectedId`).
 *  - Narrow: the list with a floating "Map" toggle → full-screen map, and a
 *    "List" toggle back.
 *
 * Top bar: the `HomeSearch` composer (the mode tabs over Bloom's wide bar, or
 * the compact trigger and its sheet on a phone) with a save-search button
 * beside it, over a
 * `PropertyTypeCategoryBar` whose pinned end holds Bloom's `FilterTriggerButton`
 * (opening `SearchFiltersDialog`) and the `SortMenu`. A "Search this area"
 * button over the map re-queries using the current map bounds.
 *
 * Data comes from `usePropertySearch` keyed by the active query; this component
 * owns no fetching logic beyond reading that hook and forwarding map bounds.
 */
import type React from 'react';
import { useCallback, useContext, useMemo, useRef, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { AppShellPanel, AppShellPanels, useAppShellPanel } from '@oxy.so/bloom/app-shell';
import { Button } from '@oxy.so/bloom/button';
import { useBottomEdgeInset } from '@oxy.so/bloom/layout';
import { RiBookmarkFill } from '@oxy.so/bloom/icons/RiBookmarkFill';
import { RiBookmarkLine } from '@oxy.so/bloom/icons/RiBookmarkLine';
import { RiHomeLine } from '@oxy.so/bloom/icons/RiHomeLine';
import { RiRefreshLine } from '@oxy.so/bloom/icons/RiRefreshLine';
import { RiSearchLine } from '@oxy.so/bloom/icons/RiSearchLine';
import { FilterTriggerButton } from '@oxy.so/bloom/stay-filters';
import { useTheme } from '@oxy.so/bloom/theme';
import { Text as BloomText } from '@oxy.so/bloom/typography';

import { useSavedSearches } from '@/hooks/useSavedSearches';
import { useInfiniteScroll } from '@/hooks/useInfiniteScroll';
import type { MapCameraTarget, MapMarkerData, MapViewRef } from '@goway.to/maps';

import { DEVICE_ZOOM, HOMIIO_OPENING_VIEW } from '@/components/map/mapDefaults';
import { useOpeningFix } from '@/components/map/useOpeningFix';
import { PropertyResultsGrid } from '@/components/ui/PropertyResultsGrid';
import { PropertyResultsGridSkeleton } from '@/components/ui/PropertyResultsGridSkeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { MapFab } from '@/components/ui/MapFab';
import { MapMarkerPopover } from '@/components/ui/MapMarkerPopover';
import { SaveSearchBottomSheet } from '@/components/SaveSearchBottomSheet';

import { BottomSheetContext } from '@/context/BottomSheetContext';
import { useRentalMode } from '@/context/RentalModeContext';
import { usePropertySearch } from '@/hooks/usePropertySearch';
import { OfferingType } from '@homiio/shared-types/common';
import type { GeoBounds, LocationSelection, Property, PropertyType } from '@homiio/shared-types';
import { useFormatting } from '@/utils/format';
import {
  BROWSE_MODE_OFFERING,
  locationDisplayLabel,
  savedSearchName,
  type BrowseMode,
  type SearchQuery,
  type SearchSortBy,
  type SearchSortOrder,
  type SearchStep,
} from './types';

import { PropertyTypeCategoryBar } from './PropertyTypeCategoryBar';
import { SearchFiltersDialog, countActiveFilters } from './SearchFiltersDialog';
import { SortMenu } from './SortMenu';
import { HomeSearch } from './HomeSearch';
import { committedScopeBounds, reduceMapMovement, type MapMovement } from './searchArea';
import { toMarkers } from './searchMarkers';
import { ResultsMap } from './ResultsMap';
import {
  mapBoundsSelection,
  useSearchQueryStore,
  type SearchFilterPatch,
} from '@/store/searchQueryStore';
import { useExploreViewStore } from '@/store/exploreViewStore';

/** The zoom a selection's centre is framed at when it declares no extent. */
const DEFAULT_MAP_ZOOM = 12;
/** Number of skeleton cards shown during the first load. */
const SKELETON_COUNT = 6;
/**
 * Skeleton cards appended while paginating (the next-page shimmer). Fewer than
 * the first-load count since it's just a hint that more rows are arriving.
 */
const NEXT_PAGE_SKELETON_COUNT = 2;

/**
 * The results / map split. Two panes from 900 of their own width: the list
 * rests at 900, never narrower than 520 (two cards of the results grid), and
 * gives way so the map keeps 380; a drag reaches 1200.
 */
const SPLIT_FROM = 900;
const LIST_WIDTH = 900;
const LIST_MIN_WIDTH = 520;
const LIST_MAX_WIDTH = 1200;
const MAP_MIN_WIDTH = 380;

/** The gutter the results grid and its heading share, as every grid screen. */
const GRID_GUTTER = 'px-4 pb-4';
/** Room after the last row, before the bottom bar's own clearance. */
const LIST_END = 40;
/**
 * The composer takes the row; on a wide panel it stops at a readable bar width
 * and sits centred with the save button beside it. A style, because the
 * composer is a component that takes `style`, not `className`.
 */
const COMPOSER = { flexGrow: 1, flexShrink: 1, minWidth: 0, maxWidth: 850 } as const;

interface SearchResultsViewProps {
  /** The active search query (source of truth for the data + map + summary). */
  query: SearchQuery;
  /** The composer's open step, owned by the route so its error states can open it too. */
  openStep: SearchStep | null;
  onOpenStepChange: (step: SearchStep | null) => void;
  /** Run a composed search. */
  onSubmitSearch: (query: SearchQuery) => void;
  /** Open a property's detail screen. */
  onPropertyPress: (property: Property) => void;
  /**
   * Patch the NON-geographic filters. Cannot reach `location` or `queryText`:
   * a shallow patch over the geographic dimension is precisely how half a
   * location used to survive a change.
   */
  onQueryChange: (patch: SearchFilterPatch) => void;
  /** Commit a geographic scope, replacing any previous one whole. */
  onCommitLocation: (selection: LocationSelection) => void;
  /** Whether the user can save searches (gates the Save action). */
  canSaveSearch?: boolean;
  /** Fired when the user wants to save but isn't authenticated. */
  onRequireAuth?: () => void;
}

export const SearchResultsView: React.FC<SearchResultsViewProps> = ({
  query,
  openStep,
  onOpenStepChange,
  onSubmitSearch,
  onPropertyPress,
  onQueryChange,
  onCommitLocation,
  canSaveSearch = true,
  onRequireAuth,
}) => {
  const { t } = useTranslation();
  const formatting = useFormatting();
  const bottomSheet = useContext(BottomSheetContext);
  const { colors } = useTheme();
  const { setBrowseMode } = useRentalMode();
  const [filtersOpen, setFiltersOpen] = useState(false);
  const handleEditSearch = useCallback(() => onOpenStepChange('where'), [onOpenStepChange]);

  const mapRef = useRef<MapViewRef>(null);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  /**
   * The narrow layout's list/map switch, in a STORE rather than in this
   * component.
   *
   * It moved out so Sindi's `set_results_view` action can reach it from the
   * chat panel ("enséñamelo en el mapa", #519 §8.1) without a prop threaded
   * through five layers or a ref exposed upward. It is presentation only and
   * deliberately not part of the query — see `store/exploreViewStore.ts`.
   */
  const showMobileMap = useExploreViewStore((s) => s.resultsView === 'map');
  const toggleResultsView = useExploreViewStore((s) => s.toggleResultsView);

  /**
   * The pending viewport lives in the STORE, not in this component.
   *
   * That is what makes "a box over a map the user has since navigated away
   * from can never be committed" structural: every action that changes the
   * committed selection — a place picked in the panel, a saved search applied,
   * a URL arriving with a different `loc` — clears it in the same `set` call.
   * Held here instead, it would survive all three and could be confirmed
   * afterwards, applying a viewport from a search the user has left.
   *
   * Committing still goes through {@link SearchResultsViewProps.onCommitLocation}
   * rather than the store's own `commitPendingViewport`, because the URL is the
   * authority and only the route screen writes it (ADR 0002 §6.1).
   */
  const pendingViewport = useSearchQueryStore((s) => s.pendingViewport);
  /**
   * The viewport the app itself last framed.
   *
   * STATE rather than a ref, and the difference is not stylistic: the "back to
   * the searched area" action is only offered when there is somewhere to go
   * back TO, so the answer is read during render, and a ref read during render
   * does not re-render when it changes — the action would appear one render
   * late, or not at all.
   *
   * It changes only on a finished PROGRAMMATIC movement (an opening frame, a
   * return, a re-frame after a new area is confirmed), so the re-render is
   * rare. It also cannot move the map: the map follows `camera` by value, and a
   * re-render with an equal target is not a new one.
   */
  const [anchor, setAnchor] = useState<GeoBounds | null>(null);

  const search = usePropertySearch(query);
  const {
    properties,
    total,
    isLoading,
    isError,
    error,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    refetch,
    queryId,
    appliedLocation,
  } = search;

  const { searchExists } = useSavedSearches();

  const markers = useMemo(
    () => toMarkers(properties, query.offering, formatting),
    [properties, query.offering, formatting],
  );

  // --- Top-bar control state (drives the action pills' active/badge UI) ---
  // The category bar states the type, so the Filters badge does not count it.
  const activeFilterCount = useMemo(
    () => countActiveFilters(query, { includeTypes: false }),
    [query],
  );

  // A search is "saved" when one already exists for this exact selection.
  //
  // Keyed by `locationKey`, not by the label. Two different cities called
  // Barcelona have the same label and different ids, so a label comparison
  // reported the Venezuelan one as already saved the moment the Spanish one
  // was — and offered to overwrite it.
  const savedName = useMemo(() => savedSearchName(query.location), [query.location]);
  const isSearchSaved = useMemo(
    () => (savedName ? searchExists(savedName, savedName) : false),
    [savedName, searchExists],
  );

  /**
   * Where the map should be, as a VALUE: `@goway.to/maps` frames it whenever its
   * numbers change — a place picked, a saved search applied, back/forward, a
   * deep link — and never on a re-render with an equal target, so a reader who
   * has panned is not pulled back.
   *
   * The selection's EXTENT first, because a centre says where and an extent
   * says how much: without it a city and a neighbourhood opened at an identical
   * zoom (#395). Then its centre, at city zoom. A place may legitimately have
   * neither — an `area` carries an extent and no representative point, and a
   * city Homiio knows only by id needs no geometry to scope a search — and the
   * honest answer then is to frame nothing rather than INVENT a point: the
   * invented value would be `(0, 0)`, which is how "Spain" ended up over the
   * Gulf of Guinea. The LIST is correctly scoped either way.
   *
   * With nothing selected to frame, the map opens on the device — only a
   * position the reader already granted (`useOpeningFix`) — else on Homiio's
   * default.
   */
  const openingFix = useOpeningFix();
  const selectionCamera = useMemo<MapCameraTarget | undefined>(() => {
    const selection = query.location;
    if (!selection || selection.kind === 'multi_area') return undefined;
    if (selection.kind === 'current_location') {
      return { center: selection.center, zoom: DEFAULT_MAP_ZOOM };
    }
    if (selection.kind === 'polygon' || selection.kind === 'map_bounds') {
      return { bounds: selection.bounds };
    }
    if (selection.bounds) return { bounds: selection.bounds };
    return selection.center ? { center: selection.center, zoom: DEFAULT_MAP_ZOOM } : undefined;
  }, [query.location]);
  const camera: MapCameraTarget | undefined =
    selectionCamera ?? (openingFix ? { center: openingFix, zoom: DEVICE_ZOOM } : undefined);

  const selectedProperty = useMemo(
    () => (highlightedId ? (properties.find((p) => p.id === highlightedId) ?? null) : null),
    [highlightedId, properties],
  );

  const handleMarkerPress = useCallback(({ id }: MapMarkerData) => setHighlightedId(id), []);

  // Card → pin (web only, wired in PropertyResultsGrid). Hovering a result card
  // draws its pin active — the look a pin press gives — without touching the
  // sticky `highlightedId` selection; leaving the card hands the pin back to it.
  const setHoveredResultId = useExploreViewStore((s) => s.setHoveredResultId);
  const handleCardHoverIn = useCallback(
    (id: string) => setHoveredResultId(id),
    [setHoveredResultId],
  );
  const handleCardHoverOut = useCallback(() => setHoveredResultId(null), [setHoveredResultId]);

  /**
   * Fold a map movement into the camera state.
   *
   * The decision itself is in `searchArea.reduceMapMovement`, which is pure.
   * This callback only routes the two halves of the result to where each
   * belongs. The pending viewport is read through `getState()` rather than
   * from the subscribed value, so this callback's identity does not change on
   * every pan.
   */
  const handleRegionChange = useCallback(
    (movement: MapMovement) => {
      const previous = { anchor, pending: useSearchQueryStore.getState().pendingViewport };
      const next = reduceMapMovement(previous, movement);
      if (next === previous) return;
      setAnchor(next.anchor);
      if (next.pending !== previous.pending) {
        useSearchQueryStore.getState().setPendingViewport(next.pending);
      }
    },
    [anchor],
  );

  /**
   * The map's handle — and, when the map goes, the end of its pending viewport.
   *
   * A pending viewport is a box over THIS map, and the map lives exactly as
   * long as this view (the narrow layout hides it, never unmounts it), so its
   * detach is leaving the screen. The store outlives both, so without this a
   * box the user drifted to, walked away from and never confirmed is still
   * pending when they come back — and "Search this area" is offered on arrival,
   * over an area they have no memory of choosing. #354 lists abandoning the
   * screen as a discard trigger for exactly that reason.
   *
   * Stable (`[]`), so React attaches it once; the cleanup reads the store
   * through `getState()` rather than closing over it.
   */
  const attachMap = useCallback((api: MapViewRef | null) => {
    mapRef.current = api;
    return () => {
      mapRef.current = null;
      useSearchQueryStore.getState().setPendingViewport(null);
      // A card hovered as the view went is not hovered on the next one.
      useExploreViewStore.getState().setHoveredResultId(null);
    };
  }, []);

  /**
   * Take the map back to the area the results actually describe.
   *
   * The anchor is preferred over the selection's own box because it is the
   * viewport the app really framed — padding and zoom snapping included — so
   * returning to it lands exactly where the search opened. On a cold load
   * nothing has been framed yet and the selection's declared extent is the
   * honest fallback. The resulting camera move is programmatic, so the reducer
   * clears the pending viewport when it arrives; clearing it here as well would
   * make the button flicker back if the frame is refused.
   */
  const returnBounds = anchor ?? committedScopeBounds(query.location);
  const handleReturnToSearchedArea = useCallback(() => {
    if (!returnBounds) return;
    mapRef.current?.fitBounds(returnBounds);
  }, [returnBounds]);

  /**
   * "Search this area" — ONE state transition, replacing the geographic scope
   * entirely.
   *
   * Everything about the previous selection is discarded: its id, its label, its
   * centre, its bounds, its provider, its country. It used to re-use
   * `query.location.label`, `shortLabel` and `center` whenever they existed, so
   * panning from Barcelona to Madrid and pressing this produced "Barcelona,
   * centred on Barcelona, bounded by Madrid" — and then sent the stale label out
   * as free text alongside the new box, asking for Barcelona-matching listings
   * physically inside Madrid. The answer is zero, and zero renders as "this area
   * is empty".
   *
   * The merge is not possible any more: `onCommitLocation` takes a whole
   * {@link LocationSelection} and there is no action that takes less.
   * `queryText` is untouched — a different dimension, and the user did not
   * retract what they typed.
   */
  const handleSearchThisArea = useCallback(() => {
    if (!pendingViewport) return;
    onCommitLocation(mapBoundsSelection(pendingViewport));
  }, [pendingViewport, onCommitLocation]);

  const handleSortChange = useCallback(
    (sortBy: SearchSortBy, sortOrder: SearchSortOrder) => onQueryChange({ sortBy, sortOrder }),
    [onQueryChange],
  );

  const handleTypesChange = useCallback(
    (propertyTypes: PropertyType[]) => onQueryChange({ propertyTypes }),
    [onQueryChange],
  );

  /**
   * A mode tab runs the search in that offering at once — the results ARE the
   * mode — keeping the place and the free text. The price range is quoted per
   * offering (monthly, nightly, sale) and dates and guests exist only for a
   * stay, so those clear, exactly as the sheet's own switch clears them. The
   * sidebar's mode follows, so the two switches never disagree.
   */
  const handleModeChange = useCallback(
    (mode: BrowseMode) => {
      const offering = BROWSE_MODE_OFFERING[mode];
      if (offering === query.offering) return;
      setBrowseMode(mode);
      onSubmitSearch({
        ...query,
        offering,
        priceMin: undefined,
        priceMax: undefined,
        // The unit was resolved against the OLD offering's price column, so it
        // goes with the range it described.
        priceCurrency: undefined,
        ...(offering === OfferingType.SHORT_TERM_RENT
          ? {}
          : { dates: undefined, guests: undefined }),
      });
    },
    [onSubmitSearch, query, setBrowseMode],
  );

  const handleFiltersPress = useCallback(() => setFiltersOpen(true), []);
  const handleFiltersClose = useCallback(() => setFiltersOpen(false), []);

  const handleSaveSearch = useCallback(() => {
    if (!canSaveSearch) {
      onRequireAuth?.();
      return;
    }
    bottomSheet.openBottomSheet(
      <SaveSearchBottomSheet
        defaultName={savedName ?? t('search.actions.save', 'My Search') ?? 'My Search'}
        // `query` is the free-text dimension, NOT the place. Sending the label
        // here is what made a saved search re-geocode its own name on reopen and
        // land in a different country.
        query={query.queryText ?? ''}
        location={query.location}
        filters={{
          offering: query.offering,
          propertyTypes: query.propertyTypes,
          priceMin: query.priceMin,
          // Saved WITH its unit. An alert that re-ran a bound of 1,200 with no
          // currency would take whatever the area happened to be priced in
          // mostly at the time it fired, which is not the search anybody saved.
          priceCurrency: query.priceCurrency,
          priceMax: query.priceMax,
          bedrooms: query.bedrooms,
          bathrooms: query.bathrooms,
          amenities: query.amenities,
          dates: query.dates,
          guests: query.guests,
        }}
        onClose={() => bottomSheet.closeBottomSheet()}
        onSaved={() => bottomSheet.closeBottomSheet()}
      />,
    );
  }, [bottomSheet, canSaveSearch, onRequireAuth, query, savedName, t]);

  // The list is its own scroller on every platform (the map beside it is
  // pinned), so its own end detection pages it — on web as on native.
  const handleEndReached = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) {
      void fetchNextPage();
    }
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);
  const bottomEdge = useBottomEdgeInset();
  const listEnd = useInfiniteScroll({
    onEndReached: handleEndReached,
    enabled: hasNextPage,
  });

  /**
   * The heading describes the COMMITTED query, never the pending viewport.
   *
   * It reads `total`, which comes from the same page as `properties` and the
   * markers, so the count cannot belong to a different search than the rows
   * beneath it — and a page stamped with another query's id never arrives at
   * all (`StaleSearchResponseError`).
   *
   * The `unresolved` branch is the one that costs nothing and matters most:
   * "we could not find that place" and "there are no homes here" are the same
   * empty list on the wire, and only the server's echo separates them.
   */
  const resultsHeading = useMemo(() => {
    if (isLoading) {
      return t('search.header.loading', 'Searching properties...') || 'Searching properties...';
    }
    if (appliedLocation?.status === 'unresolved') {
      return (
        t('search.header.unresolvedLocation', 'We could not find that place') ||
        'We could not find that place'
      );
    }
    if (total === 0) {
      return (
        t('search.header.noResults', 'No properties match this search') ||
        'No properties match this search'
      );
    }
    // Pass `count` as interpolation options so i18next selects the pluralized
    // `search.header.count_one`/`_other` variant and fills `{{count}}`.
    return t('search.header.count', { count: total }) || `${total} properties`;
  }, [t, isLoading, total, appliedLocation?.status]);

  /**
   * What the map is showing that the results are not.
   *
   * Shown only while a viewport is pending, and it names the scope the results
   * DO describe — "Still showing results for Barcelona" as the user drifts over
   * Madrid. Without it the two disagree in silence, which is the whole defect
   * this screen exists to close.
   */
  const stillShowingLabel = useMemo(
    () =>
      t('search.area.stillShowing', {
        place: locationDisplayLabel(query.location, t),
        defaultValue: 'Still showing results for {{place}}',
      }) || 'Still showing these results',
    [t, query.location],
  );

  /**
   * How many loaded results the map cannot draw.
   *
   * Said out loud rather than left as a discrepancy. Without it the map shows
   * fewer homes than the heading counts and the gap reads as a map that has not
   * finished loading — the same "looks like it is still working" failure as a
   * place with no geometry framing nothing.
   */
  const unmappableCount = properties.length - markers.length;

  // --- shared sub-renders ---
  const saveLabel = isSearchSaved ? t('search.actions.saved') : t('search.actions.save');
  const topBar = (
    // `z-10`: the composer's panels open downward over the results list, which
    // RN-Web would otherwise paint above them (it comes later, at the same z).
    <View className="z-10 border-b border-border bg-card">
      {/* With the mode tabs above the bar (wide), the row aligns on the bar (the
          bottom of the composer) rather than on the tabs-plus-bar column. */}
      {/* `z-[2]`: above the category row, which RN-Web gives the same z-index
          and paints later — the composer's open panel would sit under it. */}
      <View className="z-[2] flex-row items-center justify-center gap-2 px-4 pb-2 pt-3 sm:items-end">
        <HomeSearch
          query={query}
          openStep={openStep}
          onOpenStepChange={onOpenStepChange}
          onSubmit={onSubmitSearch}
          modeTabs="tabs"
          onModeChange={handleModeChange}
          style={COMPOSER}
        />
        {/* A sibling of the composer, never inside it: its own named control. */}
        {/* `sm:mb-[11px]` centres the 44-tall save button on the 66-tall bar. */}
        <Button
          size="lg"
          className="sm:mb-[11px]"
          iconOnly
          icon={
            isSearchSaved ? (
              <RiBookmarkFill width={20} height={20} fill={colors.primarySubtleForeground} />
            ) : (
              <RiBookmarkLine width={20} height={20} fill={colors.text} />
            )
          }
          onPress={handleSaveSearch}
          accessibilityLabel={saveLabel}
          tone="neutral"
          appearance="outline"
        />
      </View>
      <View className="px-4 pb-1">
        <PropertyTypeCategoryBar
          offering={query.offering}
          selected={query.propertyTypes}
          onChange={handleTypesChange}
          fadeColor={colors.card}
          trailing={
            <View className="flex-row items-center gap-2">
              <FilterTriggerButton
                count={activeFilterCount}
                onPress={handleFiltersPress}
                label={t('search.actions.filters')}
                accessibilityLabel={
                  activeFilterCount > 0
                    ? `${t('search.actions.filters')}, ${activeFilterCount}`
                    : t('search.actions.filters')
                }
              />
              <View className="sm:hidden">
                <SortMenu
                  sortBy={query.sortBy}
                  sortOrder={query.sortOrder}
                  onChange={handleSortChange}
                  iconOnly
                />
              </View>
              <View className="hidden sm:flex">
                <SortMenu
                  sortBy={query.sortBy}
                  sortOrder={query.sortOrder}
                  onChange={handleSortChange}
                />
              </View>
            </View>
          }
        />
      </View>
      <SearchFiltersDialog
        open={filtersOpen}
        onClose={handleFiltersClose}
        query={query}
        onApply={onQueryChange}
        showTypes={false}
      />
    </View>
  );

  // The results grid counts its OWN width (Bloom's `ListingCardGrid`), so the
  // list pane beside the map gets the columns its room fits — two from 500,
  // which `LIST_MIN_WIDTH` always leaves it.
  const listBody = () => {
    if (isLoading && properties.length === 0) {
      return <PropertyResultsGridSkeleton count={SKELETON_COUNT} className={GRID_GUTTER} />;
    }
    if (isError) {
      return (
        <ErrorState
          title={
            t('search.error.title', 'Could not load properties') || 'Could not load properties'
          }
          description={error?.message}
          retryLabel={t('common.tryAgain', 'Try again') || 'Try again'}
          onRetry={() => void refetch()}
        />
      );
    }
    if (properties.length === 0) {
      return (
        <EmptyState
          icon={RiHomeLine}
          title={
            t('search.empty.title', 'No properties match this search') ||
            'No properties match this search'
          }
          description={
            t('search.empty.description', 'Try widening your area or relaxing your filters.') ||
            'Try widening your area or relaxing your filters.'
          }
          actionText={t('search.empty.action', 'Edit search') || 'Edit search'}
          actionIcon={RiSearchLine}
          onAction={handleEditSearch}
        />
      );
    }
    return (
      <PropertyResultsGrid
        properties={properties}
        onPropertyPress={onPropertyPress}
        highlightedPropertyId={highlightedId}
        onPropertyHoverIn={handleCardHoverIn}
        onPropertyHoverOut={handleCardHoverOut}
        className={GRID_GUTTER}
      />
    );
  };

  const listScroll = (
    <ScrollView
      // The list and the map below carry the SAME query id, which is what makes
      // "these two surfaces are showing one search" observable in the rendered
      // tree rather than merely asserted in a comment. Both come from one
      // `usePropertySearch` call, so they cannot drift — the ids are how a
      // browser-level check, or a person with the inspector open, can see that.
      nativeID={`search-list-${queryId}`}
      className="flex-1"
      // The bounded panel leaves the bottom bar's clearance to this list: the
      // bar's measured height, published by Bloom, on top of the list's own end.
      contentContainerStyle={{ paddingBottom: LIST_END + bottomEdge }}
      onScroll={listEnd.onScroll}
      onLayout={listEnd.onLayout}
      onContentSizeChange={listEnd.onContentSizeChange}
      scrollEventThrottle={16}
      showsVerticalScrollIndicator={false}
    >
      {/* `accessibilityLiveRegion` is what announces a result set changing
          under a screen reader: committing a new area replaces the heading and
          the count in place, with no navigation and nothing focused, so
          without it the change is silent. RN-Web maps it to `aria-live`. */}
      <View className="px-4 pb-3 pt-4" accessibilityLiveRegion="polite" accessibilityRole="header">
        <BloomText className="text-xl font-bold text-foreground">{resultsHeading}</BloomText>
        {unmappableCount > 0 ? (
          <BloomText className="mt-1 text-[13px] text-muted-foreground">
            {t('search.header.withoutMapLocation', { count: unmappableCount })}
          </BloomText>
        ) : null}
      </View>
      {listBody()}
      {isFetchingNextPage ? (
        <PropertyResultsGridSkeleton count={NEXT_PAGE_SKELETON_COUNT} className={GRID_GUTTER} />
      ) : null}
    </ScrollView>
  );

  const mapPanel = (
    <View className="relative flex-1" nativeID={`search-map-${queryId}`}>
      <View className="absolute inset-0">
        <ResultsMap
          ref={attachMap}
          markers={markers}
          selectedId={highlightedId}
          initialViewState={camera ? undefined : HOMIIO_OPENING_VIEW}
          camera={camera}
          onCameraChanged={handleRegionChange}
          onMarkerPress={handleMarkerPress}
        />
      </View>
      {pendingViewport ? (
        // `pointer-events-none` on the strip and `-auto` on each control is the
        // sanctioned split: `box-none` in a STYLE is silently dropped by RN-Web,
        // leaving a transparent full-width overlay that swallows every drag and
        // hover on the map beneath it.
        <View className="pointer-events-none absolute inset-x-0 top-4 items-center gap-2">
          <View className="pointer-events-auto overflow-hidden rounded-full bg-card shadow-m">
            <Button
              onPress={handleSearchThisArea}
              size="sm"
              leadingIcon={RiRefreshLine}
              accessibilityLabel={
                t('search.actions.searchArea', 'Search this area') || 'Search this area'
              }
              tone="accent"
              appearance="solid"
            >
              {t('search.actions.searchArea', 'Search this area') || 'Search this area'}
            </Button>
          </View>
          <View
            className="pointer-events-auto max-w-[420px] flex-row items-center gap-2 rounded-full bg-card px-3 py-2 shadow-m"
            accessibilityLiveRegion="polite"
          >
            <BloomText className="shrink text-[13px] text-foreground">
              {stillShowingLabel}
            </BloomText>
            {returnBounds ? (
              <Button
                onPress={handleReturnToSearchedArea}
                size="sm"
                accessibilityLabel={
                  t('search.actions.backToSearchedArea', 'Back to searched area') ||
                  'Back to searched area'
                }
                tone="neutral"
                appearance="outline"
              >
                {t('search.actions.backToSearchedArea', 'Back to searched area') ||
                  'Back to searched area'}
              </Button>
            ) : null}
          </View>
        </View>
      ) : null}
      {selectedProperty ? (
        // Narrow: the popover floats over the full-screen map, level with the
        // MapFab toggle; wide: a centred card of reading width.
        <View className="absolute inset-x-0 bottom-6 sm:max-w-[420px] sm:self-center">
          <MapMarkerPopover
            property={selectedProperty}
            onPress={() => onPropertyPress(selectedProperty)}
            onDismiss={() => setHighlightedId(null)}
          />
        </View>
      ) : null}
    </View>
  );

  // Two panels, results and map, laid out by Bloom's `AppShellPanels`: each its
  // own surface with the shell's gutter between them and a divider that drags
  // the results' width, once the group's own box fits both (`SPLIT_FROM`, the
  // sidebar beside it counted). Below that ONE panel at a time, switched by the
  // Map / List toggle each panel shows while it is alone; the map panel then
  // carries the search bar itself.
  const toList = t('search.fab.list', 'List') || 'List';
  const toMap = t('search.fab.map', 'Map') || 'Map';
  return (
    <AppShellPanels collapseBelow={SPLIT_FROM} show={showMobileMap ? 'map' : 'results'}>
      <AppShellPanel
        id="results"
        width={LIST_WIDTH}
        minWidth={LIST_MIN_WIDTH}
        maxWidth={LIST_MAX_WIDTH}
        resizable
      >
        {topBar}
        {listScroll}
        <PaneToggle label={toMap} icon="map" onPress={toggleResultsView} />
      </AppShellPanel>
      <AppShellPanel id="map" minWidth={MAP_MIN_WIDTH}>
        <WhenAlone>{topBar}</WhenAlone>
        {mapPanel}
        <PaneToggle label={toList} icon="list" onPress={toggleResultsView} />
      </AppShellPanel>
    </AppShellPanels>
  );
};

/** Renders its children only in a panel drawn alone. */
function WhenAlone({ children }: { children: React.ReactNode }) {
  return useAppShellPanel().alone ? <>{children}</> : null;
}

/** The Map / List toggle, shown only while its panel is drawn alone. */
function PaneToggle({
  label,
  icon,
  onPress,
}: {
  label: string;
  icon: 'map' | 'list';
  onPress: () => void;
}) {
  const { alone } = useAppShellPanel();
  const bottomEdge = useBottomEdgeInset();
  if (!alone) return null;
  return (
    // Zero-height strip on the bottom bar's top edge: the FAB anchors above it.
    <View className="absolute inset-x-0" style={{ bottom: bottomEdge }}>
      <MapFab onPress={onPress} label={label} icon={icon} />
    </View>
  );
}
