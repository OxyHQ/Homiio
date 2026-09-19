/**
 * SearchResultsView — the responsive results surface mounted by the results
 * route. Single component, breakpoint-driven from `useIsScreenNotMobile()`:
 *
 *  - Wide: a scrollable list of property cards on the left + a sticky map on
 *    the right. Selecting a pin highlights the matching card; selecting a card
 *    highlights its pin (via `Map`'s `highlightMarker` API + the shared
 *    `highlightedId` state).
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
import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Platform, ScrollView, StyleSheet, View, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { Button } from '@oxy.so/bloom/button';
import {
  RiBookmarkFill,
  RiBookmarkLine,
  RiHomeLine,
  RiRefreshLine,
  RiSearchLine,
} from '@oxy.so/bloom/icons';
import { FilterTriggerButton } from '@oxy.so/bloom/stay-filters';
import { Text as BloomText } from '@oxy.so/bloom/typography';

import { useSavedSearches } from '@/hooks/useSavedSearches';
import { useInfiniteScroll } from '@/hooks/useInfiniteScroll';
import { LoadMoreSentinel } from '@/components/common/LoadMoreSentinel';
import MapView, { type MapApi } from '@/components/Map';
import { PropertyResultsGrid } from '@/components/ui/PropertyResultsGrid';
import { PropertyResultsGridSkeleton } from '@/components/ui/PropertyResultsGridSkeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { MapFab } from '@/components/ui/MapFab';
import { MapMarkerPopover } from '@/components/ui/MapMarkerPopover';
import { SaveSearchBottomSheet } from '@/components/SaveSearchBottomSheet';

import { BottomSheetContext } from '@/context/BottomSheetContext';
import { useRentalMode } from '@/context/RentalModeContext';
import { useIsScreenNotMobile } from '@/hooks/useOptimizedMediaQuery';
import { usePropertySearch } from '@/hooks/usePropertySearch';
import { useColors } from '@/hooks/useThemeColor';
import { colors } from '@/styles/colors';
import { cardShadow, hairline, radius, spacing } from '@/constants/styles';
import { boundsCenter, OfferingType } from '@homiio/shared-types';
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
import {
  mapBoundsSelection,
  useSearchQueryStore,
  type SearchFilterPatch,
} from '@/store/searchQueryStore';
import { useExploreViewStore } from '@/store/exploreViewStore';

/** Default zoom applied when no location bbox is known. */
const DEFAULT_MAP_ZOOM = 12;
/** Number of skeleton cards shown during the first load. */
const SKELETON_COUNT = 6;
/**
 * Skeleton cards appended while paginating (the next-page shimmer). Fewer than
 * the first-load count since it's just a hint that more rows are arriving.
 */
const NEXT_PAGE_SKELETON_COUNT = 2;

/**
 * The centre of a declared box, as the map's `[lng, lat]` pair.
 *
 * Delegates to the shared wrap-aware `boundsCenter` rather than averaging the
 * corners: for a box crossing the antimeridian the naive average is 13,000 km
 * away, and the symptom is a map framed on the wrong ocean beside a list of
 * perfectly correct results.
 */
function boundsCameraTarget(bounds: GeoBounds): [number, number] {
  const { longitude, latitude } = boundsCenter(bounds);
  return [longitude, latitude];
}

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
  const isWide = useIsScreenNotMobile();
  const insets = useSafeAreaInsets();
  const bottomSheet = useContext(BottomSheetContext);
  const themeColors = useColors();
  const { setBrowseMode } = useRentalMode();
  const [filtersOpen, setFiltersOpen] = useState(false);
  const handleEditSearch = useCallback(() => onOpenStepChange('where'), [onOpenStepChange]);

  const mapRef = useRef<MapApi>(null);
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
   * rare. It also cannot reload the map: the WebView document and the MapLibre
   * instance are both built once and fed through refs, so a re-render of this
   * component reaches neither.
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
   * The map's opening camera. Only a framing hint — once results arrive the map
   * frames from the server's `location` echo, so the two cannot disagree.
   *
   * A place may legitimately have NO centre: `PlaceGeometry` says an `area`
   * carries an extent and no representative point, and a city Homiio knows by
   * id but has no coordinates for is a real, selectable place — its search
   * scopes by `cityId` and needs no geometry at all.
   *
   * So the order is bounds → centre → nothing, and the last arm is the one that
   * matters. Deriving the centre of a declared box is a real framing point;
   * INVENTING one is not, and the invented value would be `(0, 0)` — an actual
   * location in the Atlantic, which is how "Spain" ended up over the Gulf of
   * Guinea. `undefined` lets the map keep its own default, which is honest
   * about having nothing to frame from, and the LIST is still correctly scoped
   * either way.
   *
   * This is the OPENING camera only — a point, because `initialCoordinates` is
   * all the map accepts before it has mounted. The zoom that makes a city and a
   * neighbourhood open differently comes from the effect below, which calls
   * `fitBounds` once the map exists (#395).
   */
  const initialCoordinates = useMemo<[number, number] | undefined>(() => {
    const selection = query.location;
    if (!selection || selection.kind === 'multi_area') return undefined;

    if (selection.kind === 'polygon' || selection.kind === 'map_bounds') {
      return boundsCameraTarget(selection.bounds);
    }
    if (selection.kind === 'current_location') {
      return [selection.center.longitude, selection.center.latitude];
    }
    if (selection.bounds) return boundsCameraTarget(selection.bounds);
    return selection.center
      ? [selection.center.longitude, selection.center.latitude]
      : undefined;
  }, [query.location]);

  /**
   * The extent to frame, when the selection declares one.
   *
   * Separate from `initialCoordinates` because they answer different questions:
   * a centre says WHERE, an extent says HOW MUCH. Without the second, a city
   * and a neighbourhood opened at an identical zoom — the map was told the
   * middle of each and nothing about their size.
   */
  const framedBounds = useMemo<GeoBounds | undefined>(() => {
    const selection = query.location;
    if (!selection || selection.kind === 'multi_area') return undefined;
    if (selection.kind === 'current_location') return undefined;
    return selection.bounds;
  }, [query.location]);

  /**
   * Frame the box once the map can be commanded.
   *
   * `fitBounds` is imperative and `initialCoordinates` is a mount-time prop, so
   * this cannot be expressed as a prop: the ref is null on the first render.
   * Keyed on the SERIALISED box rather than the object so a re-render with an
   * equal box does not re-animate the camera under the user.
   *
   * A selection with no bounds is deliberately not handled here — the opening
   * centre already covers it, and re-framing on every selection change would
   * fight a user who has panned.
   */
  const framedBoundsKey = framedBounds
    ? `${framedBounds.west},${framedBounds.south},${framedBounds.east},${framedBounds.north}`
    : null;
  useEffect(() => {
    if (!framedBounds) return;
    mapRef.current?.fitBounds(framedBounds);
    // `framedBoundsKey` is the dependency that matters; `framedBounds` is the
    // value it stands for.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [framedBoundsKey]);

  const selectedProperty = useMemo(
    () => (highlightedId ? properties.find((p) => p.id === highlightedId) ?? null : null),
    [highlightedId, properties],
  );

  const handleMarkerPress = useCallback(
    ({ id }: { id: string }) => {
      setHighlightedId(id);
      mapRef.current?.highlightMarker(id);
    },
    [],
  );

  // Card → chip (web only, wired in PropertyResultsGrid). Hovering a result card
  // highlights its map price chip imperatively — the same `.is-selected` look a
  // marker click gives — without touching the sticky `highlightedId` selection.
  const handleCardHoverIn = useCallback((id: string) => {
    mapRef.current?.highlightMarker(id);
  }, []);

  // Hover-out reverts the chip to the sticky marker-click selection (or clears
  // it when nothing is selected), so a transient hover never leaves the map in a
  // highlighted state that disagrees with `highlightedId`.
  const handleCardHoverOut = useCallback(() => {
    mapRef.current?.highlightMarker(highlightedId);
  }, [highlightedId]);

  /**
   * Fold a map movement into the camera state.
   *
   * The decision itself is in `searchArea.reduceMapMovement`, which is pure and
   * shared by both map adapters. This callback only routes the two halves of
   * the result to where each belongs.
   *
   * The pending viewport is read through `getState()` rather than from the
   * subscribed value, so this callback's identity does not change on every pan
   * — `onRegionChange` is compared by the map's memo, and a new function on
   * each pan would re-render it constantly.
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
   * Leaving the screen discards the pending viewport.
   *
   * The store outlives this component, so without this a box the user drifted
   * to, walked away from and never confirmed is still pending when they come
   * back — and "Search this area" is offered on arrival, over an area they have
   * no memory of choosing. #354 lists abandoning the screen as a discard
   * trigger for exactly that reason.
   *
   * An effect is right here: it updates an EXTERNAL store on unmount, which is
   * the case effects are for, and the empty dependency list is accurate — the
   * cleanup reads the store through `getState()` rather than closing over it.
   */
  useEffect(
    () => () => {
      useSearchQueryStore.getState().setPendingViewport(null);
    },
    [],
  );

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
        ...(offering === OfferingType.SHORT_TERM_RENT ? {} : { dates: undefined, guests: undefined }),
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

  // Shared infinite-scroll primitive: native fires `onScroll` end-detect, web
  // uses the `<LoadMoreSentinel>` below. Both funnel through the same guarded
  // loader, replacing the hand-rolled `ScrollView.onScroll` distance math.
  const handleEndReached = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) {
      void fetchNextPage();
    }
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);
  const { onScroll: handleListScroll } = useInfiniteScroll({
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
      return t('search.header.noResults', 'No properties match this search') ||
        'No properties match this search';
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
  // The route wraps this screen in a plain View (no SafeAreaView) and the
  // top bar is the first element, so it must clear the status bar itself.
  // The bar's surfaceElevated background fills the inset region; on web
  // `insets.top` is 0 so the `position: sticky; top: 0` placement is
  // unchanged.
  const saveLabel = isSearchSaved ? t('search.actions.saved') : t('search.actions.save');
  const topBar = (
    <View style={[styles.topBar, { paddingTop: insets.top }]}>
      <View style={[styles.topBarContent, isWide && styles.topBarContentWithTabs]}>
        <HomeSearch
          query={query}
          openStep={openStep}
          onOpenStepChange={onOpenStepChange}
          onSubmit={onSubmitSearch}
          modeTabs="tabs"
          onModeChange={handleModeChange}
          style={styles.composer}
        />
        {/* A sibling of the composer, never inside it: its own named control. */}
        <Button
          variant="outline"
          size={isWide ? 'large' : 'medium'}
          style={isWide ? styles.saveBesideBar : undefined}
          iconOnly
          icon={
            isSearchSaved ? (
              <RiBookmarkFill width={20} height={20} fill={themeColors.primary} />
            ) : (
              <RiBookmarkLine width={20} height={20} fill={themeColors.text} />
            )
          }
          onPress={handleSaveSearch}
          accessibilityLabel={saveLabel}
        />
      </View>
      <View style={styles.categoryRow}>
        <PropertyTypeCategoryBar
          offering={query.offering}
          selected={query.propertyTypes}
          onChange={handleTypesChange}
          fadeColor={colors.surfaceElevated}
          trailing={
            <View style={styles.trailing}>
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
              <SortMenu
                sortBy={query.sortBy}
                sortOrder={query.sortOrder}
                onChange={handleSortChange}
                iconOnly={!isWide}
              />
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

  // The explore list lives in a half-window column beside the map, so it stays
  // container-responsive with NO `maxColumns` cap: `PropertyResultsGrid` falls
  // back to the global `GRID_MAX_COLUMNS` and the narrow column naturally lands
  // on fewer columns than a full-width grid (≥2 via `GRID_MIN_COLUMNS`, more
  // only when an ultra-wide window genuinely gives the list column the room).
  const listBody = () => {
    if (isLoading && properties.length === 0) {
      return (
        <PropertyResultsGridSkeleton
          count={SKELETON_COUNT}
          style={styles.gridPadding}
        />
      );
    }
    if (isError) {
      return (
        <ErrorState
          title={t('search.error.title', 'Could not load properties') || 'Could not load properties'}
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
        style={styles.gridPadding}
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
      style={styles.listScroll}
      contentContainerStyle={styles.listScrollContent}
      onScroll={handleListScroll}
      scrollEventThrottle={16}
      showsVerticalScrollIndicator={false}
    >
      {/* `accessibilityLiveRegion` is what announces a result set changing
          under a screen reader: committing a new area replaces the heading and
          the count in place, with no navigation and nothing focused, so
          without it the change is silent. RN-Web maps it to `aria-live`. */}
      <View
        style={styles.resultsHeader}
        accessibilityLiveRegion="polite"
        accessibilityRole="header"
      >
        <BloomText style={styles.resultsTitle}>{resultsHeading}</BloomText>
        {unmappableCount > 0 ? (
          <BloomText style={styles.resultsNote}>
            {t('search.header.withoutMapLocation', { count: unmappableCount })}
          </BloomText>
        ) : null}
      </View>
      {listBody()}
      {isFetchingNextPage ? (
        <PropertyResultsGridSkeleton
          count={NEXT_PAGE_SKELETON_COUNT}
          style={styles.gridPadding}
        />
      ) : null}
      <LoadMoreSentinel enabled={hasNextPage} onLoadMore={handleEndReached} />
    </ScrollView>
  );

  const mapPanel = (
    <View style={styles.mapPanel} nativeID={`search-map-${queryId}`}>
      <MapView
        ref={mapRef}
        style={styles.mapFill}
        screenId="search-results"
        startFromCurrentLocation={!initialCoordinates}
        initialCoordinates={initialCoordinates}
        initialZoom={DEFAULT_MAP_ZOOM}
        markers={markers}
        onRegionChange={handleRegionChange}
        onMarkerPress={handleMarkerPress}
      />
      {pendingViewport ? (
        // `pointerEvents: 'none'` on the strip and `'auto'` on each control is
        // the sanctioned split: `box-none` in a STYLE is silently dropped by
        // RN-Web, leaving a transparent full-width overlay that swallows every
        // drag and hover on the map beneath it.
        <View style={styles.searchAreaWrap}>
          <View style={[styles.searchAreaButton, cardShadow.md, styles.interactive]}>
            <Button
              onPress={handleSearchThisArea}
              variant="primary"
              size="small"
              leadingIcon={RiRefreshLine}
              accessibilityLabel={
                t('search.actions.searchArea', 'Search this area') || 'Search this area'
              }
            >
              {t('search.actions.searchArea', 'Search this area') || 'Search this area'}
            </Button>
          </View>
          <View
            style={[styles.pendingNotice, cardShadow.md, styles.interactive]}
            accessibilityLiveRegion="polite"
          >
            <BloomText style={styles.pendingNoticeText}>{stillShowingLabel}</BloomText>
            {returnBounds ? (
              <Button
                onPress={handleReturnToSearchedArea}
                variant="secondary"
                size="small"
                accessibilityLabel={
                  t('search.actions.backToSearchedArea', 'Back to searched area') ||
                  'Back to searched area'
                }
              >
                {t('search.actions.backToSearchedArea', 'Back to searched area') ||
                  'Back to searched area'}
              </Button>
            ) : null}
          </View>
        </View>
      ) : null}
      {selectedProperty ? (
        <View
          style={[
            styles.popoverWrap,
            isWide
              ? styles.popoverWrapWide
              : // Narrow: the popover floats over the full-screen map above the
                // home indicator and the MapFab toggle.
                { bottom: spacing['2xl'] + insets.bottom },
          ]}
        >
          <MapMarkerPopover
            property={selectedProperty}
            onPress={() => onPropertyPress(selectedProperty)}
            onDismiss={() => {
              setHighlightedId(null);
              mapRef.current?.highlightMarker(null);
            }}
          />
        </View>
      ) : null}
    </View>
  );

  // Wide: list + sticky map side-by-side.
  if (isWide) {
    return (
      <View style={styles.container}>
        {topBar}
        <View style={styles.splitRow}>
          <View style={styles.splitListColumn}>{listScroll}</View>
          <View style={styles.splitMapColumn}>{mapPanel}</View>
        </View>
      </View>
    );
  }

  // Narrow: list with a floating Map toggle → full-screen map.
  return (
    <View style={styles.container}>
      {topBar}
      {showMobileMap ? (
        <View style={styles.fullColumn}>{mapPanel}</View>
      ) : (
        <View style={styles.fullColumn}>{listScroll}</View>
      )}
      <MapFab
        onPress={toggleResultsView}
        label={
          showMobileMap
            ? t('search.fab.list', 'List') || 'List'
            : t('search.fab.map', 'Map') || 'Map'
        }
        icon={showMobileMap ? 'list' : 'map'}
        // Lift the floating toggle above the home indicator (the FAB's default
        // bottom offset is measured from the screen edge).
        style={{ bottom: spacing['2xl'] + insets.bottom }}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  // The explore surface is mounted inside a fixed-viewport shell (see
  // `app/_layout.tsx`), so on web it fills that bounded height and hides its own
  // overflow — the page never scrolls; only the list column does. `height:'100%'`
  // + `overflow:'hidden'` are web-only CSS values RN's `ViewStyle` lacks, so the
  // web block is typed whole (same cast pattern as `topBar`/`listScroll` below).
  container: Platform.select<ViewStyle>({
    web: {
      flex: 1,
      height: '100%',
      overflow: 'hidden',
      backgroundColor: colors.background,
    } as unknown as ViewStyle,
    default: {
      flex: 1,
      backgroundColor: colors.background,
    },
  }) as ViewStyle,
  topBar: Platform.select<ViewStyle>({
    web: {
      position: 'sticky',
      top: 0,
      zIndex: 100,
      backgroundColor: colors.surfaceElevated,
      borderBottomWidth: hairline.width,
      borderBottomColor: hairline.color,
    } as unknown as ViewStyle,
    default: {
      backgroundColor: colors.surfaceElevated,
      borderBottomWidth: hairline.width,
      borderBottomColor: hairline.color,
    },
  }) as ViewStyle,
  topBarContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    maxWidth: 1440,
    width: '100%',
    alignSelf: 'center',
    // Above the category row: RN-Web gives every View `z-index: 0`, so the
    // composer's open panel would otherwise paint under the later sibling.
    zIndex: 2,
  },
  // With the mode tabs above the bar, the row aligns on the bar (the bottom of
  // the composer) rather than on the tabs-plus-bar column.
  topBarContentWithTabs: {
    alignItems: 'flex-end',
  },
  // Centres the 44-tall save button on the 66-tall bar.
  saveBesideBar: {
    marginBottom: 11,
  },
  // The composer takes the row; on a wide screen it stops at a readable bar
  // width and sits centred with the save button beside it.
  composer: {
    flex: 1,
    minWidth: 0,
    maxWidth: 850,
  },
  categoryRow: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.xs,
    maxWidth: 1440,
    width: '100%',
    alignSelf: 'center',
  },
  trailing: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  // The split row fills the height left under the sticky `topBar`. On web a flex
  // child defaults to `min-height:auto`, which would let the row grow to its
  // content instead of clamping to the shell — so we pin `minHeight:0` (web-only
  // CSS value) to make the inner list column the scroll boundary.
  splitRow: Platform.select<ViewStyle>({
    web: {
      flex: 1,
      minHeight: 0,
      flexDirection: 'row',
    } as unknown as ViewStyle,
    default: {
      flex: 1,
      flexDirection: 'row',
    },
  }) as ViewStyle,
  // The list column owns its own vertical scroll (`listScroll` → `overflow:auto`).
  // For that inner scroller to get a bounded height it must NOT grow with its
  // content, so on web the column hides overflow and allows itself to shrink
  // (`minHeight:0`). `splitMapColumn` next to it stays pinned full-height.
  splitListColumn: Platform.select<ViewStyle>({
    web: {
      flex: 1,
      minWidth: 0,
      minHeight: 0,
      overflow: 'hidden',
    } as unknown as ViewStyle,
    default: {
      flex: 1,
      minWidth: 0,
    },
  }) as ViewStyle,
  // Pinned, full-height map column. The map fills it absolutely and never
  // scrolls — scrolling the list (left) leaves this column fixed. Slightly wider
  // than the list on very wide screens for an edge-to-edge Airbnb-2026 map.
  splitMapColumn: Platform.select<ViewStyle>({
    web: {
      flex: 1.15,
      minWidth: 0,
      height: '100%',
      overflow: 'hidden',
      borderLeftWidth: hairline.width,
      borderLeftColor: hairline.color,
    } as unknown as ViewStyle,
    default: {
      flex: 1,
      minWidth: 0,
      borderLeftWidth: hairline.width,
      borderLeftColor: hairline.color,
    },
  }) as ViewStyle,
  fullColumn: {
    flex: 1,
  },
  listScroll: Platform.select<ViewStyle>({
    web: { flex: 1, overflow: 'auto' } as unknown as ViewStyle,
    default: { flex: 1 },
  }) as ViewStyle,
  listScrollContent: {
    paddingBottom: spacing['4xl'],
  },
  // Airbnb-2026 results header: the gutter matches the grid below it and the
  // rest of the property-grid screens (`spacing.lg`), with comfortable top
  // breathing room and a tighter gap down to the first card.
  resultsHeader: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.md,
  },
  resultsTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.COLOR_BLACK,
  },
  resultsNote: {
    marginTop: spacing.xs,
    fontSize: 13,
    color: colors.COLOR_BLACK_LIGHT_4,
  },
  // Grid gutter aligned to the header gutter and every other property-grid
  // screen (`spacing.lg`) for a clean, consistent left edge across the app.
  gridPadding: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
  },
  mapPanel: {
    flex: 1,
    position: 'relative',
  },
  mapFill: {
    ...StyleSheet.absoluteFill,
  },
  searchAreaWrap: {
    position: 'absolute',
    top: spacing.lg,
    left: 0,
    right: 0,
    alignItems: 'center',
    gap: spacing.sm,
    // Valid CSS, unlike `box-none`. The children below re-enable themselves.
    pointerEvents: 'none',
  },
  searchAreaButton: {
    backgroundColor: colors.surfaceElevated,
    borderRadius: radius.pill,
    overflow: 'hidden',
  },
  /** A child `auto` inside a parent `none` IS hittable — that is the split. */
  interactive: {
    pointerEvents: 'auto',
  },
  pendingNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    maxWidth: 420,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.surfaceElevated,
    borderRadius: radius.pill,
  },
  pendingNoticeText: {
    flexShrink: 1,
    fontSize: 13,
    color: colors.COLOR_BLACK,
  },
  popoverWrap: {
    position: 'absolute',
    bottom: spacing['2xl'],
    left: 0,
    right: 0,
  },
  popoverWrapWide: {
    maxWidth: 420,
    alignSelf: 'center',
  },
});

export default SearchResultsView;
