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
 * Top bar: an editable `SearchSummaryBar` (tap → reopens the panel) whose
 * trailing bookmark saves the search (reuses `SaveSearchBottomSheet`), plus a
 * Filters button (reuses `SearchFiltersBottomSheet`) and a Sort control
 * (`SortControl`). A "Search this area" button over the map re-queries using
 * the current map bounds.
 *
 * Data comes from `usePropertySearch` keyed by the active query; this component
 * owns no fetching logic beyond reading that hook and forwarding map bounds.
 */
import React, { useCallback, useContext, useMemo, useRef, useState } from 'react';
import { Platform, ScrollView, StyleSheet, View, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';

import { Button } from '@oxyhq/bloom/button';
import { Text as BloomText } from '@oxyhq/bloom/typography';

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
import {
  SearchFiltersBottomSheet,
  type SearchFilters,
} from '@/components/SearchFiltersBottomSheet';
import { SaveSearchBottomSheet } from '@/components/SaveSearchBottomSheet';
import type { FilterValue } from '@/components/FiltersBar/FiltersBottomSheet';

import { BottomSheetContext } from '@/context/BottomSheetContext';
import { useIsScreenNotMobile } from '@/hooks/useOptimizedMediaQuery';
import { usePropertySearch } from '@/hooks/usePropertySearch';
import { colors } from '@/styles/colors';
import { cardShadow, hairline, radius, spacing } from '@/constants/styles';
import { OfferingType, PropertyType, formatMoney } from '@homiio/shared-types';
import type { GeoBounds, LocationSelection, Property } from '@homiio/shared-types';
import { resolvePrimaryOffering, toPriceDescriptor } from '@/utils/propertyUtils';
import { useFormatting, type Formatting } from '@/utils/format';
import { browseModeFromOffering, savedSearchName } from './types';

import { SearchActionPill } from './SearchActionPill';
import { SearchSummaryBar } from './SearchSummaryBar';
import { resolveSortLabel, SortControl } from './SortControl';
import type { SearchQuery, SearchSortBy, SearchSortOrder } from './types';
import { mapBoundsSelection, type SearchFilterPatch } from '@/store/searchQueryStore';

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
 * Build map markers ([lng, lat] pins) from a property list.
 *
 * The pin label used to be `€${Math.round(amount).toLocaleString()}` — a euro
 * sign on every marker in the catalogue, whatever the listing was priced in, and
 * grouped in the DEVICE's locale rather than the reader's. It now goes through
 * the shared formatter, so a Polish listing shows złoty and a Romanian one lei.
 *
 * Markers stay whole-unit (`maximumFractionDigits: 0`): a pin is a few
 * characters wide and `1.234,56 €` does not fit in one.
 */
function toMarkers(
  properties: readonly Property[],
  offering: OfferingType,
  formatting: Formatting,
): { id: string; coordinates: [number, number]; priceLabel: string }[] {
  const browseMode = browseModeFromOffering(offering);
  return properties
    .map((p) => {
      const coords = p.address?.coordinates?.coordinates ?? p.location?.coordinates;
      if (
        !coords ||
        coords.length !== 2 ||
        typeof coords[0] !== 'number' ||
        typeof coords[1] !== 'number'
      ) {
        return null;
      }
      // Price the pin off the ACTIVE offering's block (monthly / nightly / sale).
      const primary = resolvePrimaryOffering(p, browseMode);
      const price = toPriceDescriptor(primary);
      const priceLabel = price
        ? formatMoney(price.amount, price.currency, formatting.locale, {
            maximumFractionDigits: 0,
          })
        : primary.label;
      return {
        id: p.id,
        coordinates: [coords[0], coords[1]] as [number, number],
        priceLabel,
      };
    })
    .filter(
      (m): m is { id: string; coordinates: [number, number]; priceLabel: string } =>
        m !== null,
    );
}

/** The centre of a declared box — a real derived framing point, not an invented one. */
function boundsCenter(bounds: GeoBounds): [number, number] {
  return [(bounds.west + bounds.east) / 2, (bounds.south + bounds.north) / 2];
}

/**
 * Derive the {@link SearchFilters} shape (used by the reused filters sheet)
 * from the active {@link SearchQuery}. The sheet edits a flatter model, so we
 * translate both ways.
 */
function toSheetFilters(query: SearchQuery): SearchFilters {
  return {
    minPrice: query.priceMin ?? 0,
    maxPrice: query.priceMax ?? 0,
    bedrooms: query.bedrooms ?? 1,
    bathrooms: query.bathrooms ?? 1,
    type: query.propertyTypes[0],
    amenities: query.amenities,
    guests: query.guests,
    checkIn: query.dates?.start,
    checkOut: query.dates?.end,
    fairPrice: query.fairPrice,
  };
}

/**
 * Count the *applied* refinements in a query for the Filters pill badge. The
 * location, sort, map bounds, and the active offering (the browse toggle) are
 * surfaced elsewhere, so they don't count here — only the controls the filters
 * sheet edits: property type(s), price, bedrooms, bathrooms, and each amenity.
 */
function countActiveFilters(query: SearchQuery): number {
  let count = 0;
  count += query.propertyTypes.length;
  if (query.priceMin !== undefined || query.priceMax !== undefined) count += 1;
  if (query.bedrooms !== undefined) count += 1;
  if (query.bathrooms !== undefined) count += 1;
  count += query.amenities.length;
  if (query.fairPrice === true) count += 1;
  return count;
}

interface SearchResultsViewProps {
  /** The active search query (source of truth for the data + map + summary). */
  query: SearchQuery;
  /** Reopen the expanding panel (editable summary / "edit search"). */
  onEditSearch: () => void;
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
  onEditSearch,
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

  const mapRef = useRef<MapApi>(null);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const [pendingBounds, setPendingBounds] = useState<GeoBounds | null>(null);
  const [showMobileMap, setShowMobileMap] = useState(false);

  const search = usePropertySearch(query);
  const { properties, total, isLoading, isError, error, fetchNextPage, hasNextPage, isFetchingNextPage, refetch } =
    search;

  const { searchExists } = useSavedSearches();

  const markers = useMemo(
    () => toMarkers(properties, query.offering, formatting),
    [properties, query.offering, formatting],
  );

  // --- Top-bar control state (drives the action pills' active/badge UI) ---
  const activeFilterCount = useMemo(() => countActiveFilters(query), [query]);

  const sort = useMemo(
    () => resolveSortLabel(query.sortBy, query.sortOrder, t),
    [query.sortBy, query.sortOrder, t],
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
   * Framing that also picked a sensible ZOOM from the box — so a city and a
   * neighbourhood do not open identically — needs a `fitBounds` on `MapApi`,
   * which this component cannot express today (#395).
   */
  const initialCoordinates = useMemo<[number, number] | undefined>(() => {
    const selection = query.location;
    if (!selection || selection.kind === 'multi_area') return undefined;

    if (selection.kind === 'polygon' || selection.kind === 'map_bounds') {
      return boundsCenter(selection.bounds);
    }
    if (selection.kind === 'current_location') {
      return [selection.center.longitude, selection.center.latitude];
    }
    if (selection.bounds) return boundsCenter(selection.bounds);
    return selection.center
      ? [selection.center.longitude, selection.center.latitude]
      : undefined;
  }, [query.location]);

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

  const handleRegionChange = useCallback(
    ({ bounds, isFinal }: { bounds: GeoBounds; isFinal?: boolean }) => {
      if (!bounds || !isFinal) return;
      setPendingBounds(bounds);
    },
    [],
  );

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
    if (!pendingBounds) return;
    onCommitLocation(mapBoundsSelection(pendingBounds));
    setPendingBounds(null);
  }, [pendingBounds, onCommitLocation]);

  const handleSortPress = useCallback(() => {
    bottomSheet.openBottomSheet(
      <SortControl
        sortBy={query.sortBy}
        sortOrder={query.sortOrder}
        onChange={(sortBy: SearchSortBy, sortOrder: SearchSortOrder) =>
          onQueryChange({ sortBy, sortOrder })
        }
        onClose={() => bottomSheet.closeBottomSheet()}
      />,
    );
  }, [bottomSheet, query.sortBy, query.sortOrder, onQueryChange]);

  const handleSheetFilterChange = useCallback(
    (sectionId: string, value: FilterValue) => {
      switch (sectionId) {
        case 'type':
          onQueryChange({
            propertyTypes:
              typeof value === 'string' ? [value as PropertyType] : [],
          });
          return;
        case 'price':
          if (Array.isArray(value)) {
            const [min, max] = value;
            onQueryChange({
              priceMin: typeof min === 'number' && min > 0 ? min : undefined,
              priceMax: typeof max === 'number' && max > 0 ? max : undefined,
            });
          }
          return;
        case 'bedrooms':
          onQueryChange({
            bedrooms:
              typeof value === 'string' || typeof value === 'number'
                ? Number(value)
                : undefined,
          });
          return;
        case 'bathrooms':
          onQueryChange({
            bathrooms:
              typeof value === 'string' || typeof value === 'number'
                ? Number(value)
                : undefined,
          });
          return;
        case 'amenities': {
          if (typeof value !== 'string') return;
          const current = query.amenities;
          const next = current.includes(value)
            ? current.filter((a) => a !== value)
            : [...current, value];
          onQueryChange({ amenities: next });
          return;
        }
        case 'guests':
          onQueryChange({ guests: typeof value === 'number' ? value : undefined });
          return;
        case 'fairPrice':
          onQueryChange({ fairPrice: value === true ? true : undefined });
          return;
        default:
          return;
      }
    },
    [onQueryChange, query.amenities],
  );

  const handleFiltersPress = useCallback(() => {
    bottomSheet.openBottomSheet(
      <SearchFiltersBottomSheet
        filters={toSheetFilters(query)}
        onFilterChange={handleSheetFilterChange}
        onApply={() => bottomSheet.closeBottomSheet()}
        onClear={() => {
          onQueryChange({
            propertyTypes: [],
            priceMin: undefined,
            priceMax: undefined,
            bedrooms: undefined,
            bathrooms: undefined,
            amenities: [],
            fairPrice: undefined,
          });
          bottomSheet.closeBottomSheet();
        }}
      />,
    );
  }, [bottomSheet, query, handleSheetFilterChange, onQueryChange]);

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

  const resultsHeading = useMemo(() => {
    if (isLoading) {
      return t('search.header.loading', 'Searching properties...') || 'Searching properties...';
    }
    if (total === 0) {
      return t('search.header.noResults', 'No properties match this search') ||
        'No properties match this search';
    }
    // Pass `count` as interpolation options so i18next selects the pluralized
    // `search.header.count_one`/`_other` variant and fills `{{count}}`.
    return t('search.header.count', { count: total }) || `${total} properties`;
  }, [t, isLoading, total]);

  // --- shared sub-renders ---
  // The route wraps this screen in a plain View (no SafeAreaView) and the
  // top bar is the first element, so it must clear the status bar itself.
  // The bar's surfaceElevated background fills the inset region; on web
  // `insets.top` is 0 so the `position: sticky; top: 0` placement is
  // unchanged.
  const topBar = (
    <View style={[styles.topBar, { paddingTop: insets.top }]}>
      <View style={styles.topBarContent}>
        <View style={styles.summaryWrap}>
          <SearchSummaryBar
            query={query}
            onPress={onEditSearch}
            compact
            onSavePress={handleSaveSearch}
            isSaved={isSearchSaved}
            saveAccessibilityLabel={
              isSearchSaved
                ? t('search.actions.saved', 'Saved') || 'Saved'
                : t('search.actions.save', 'Save') || 'Save'
            }
          />
        </View>
        {/* Horizontally-scrollable so the action pills never wrap onto a second
            line or get clipped on a narrow phone; on wide screens the content
            simply fits and the scroll never engages. The Save affordance now
            lives in the summary pill itself (its trailing bookmark). */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.topBarActionsScroll}
          contentContainerStyle={styles.topBarActions}
        >
          <SearchActionPill
            label={t('search.actions.filters', 'Filters') || 'Filters'}
            icon="options-outline"
            active={activeFilterCount > 0}
            count={activeFilterCount}
            onPress={handleFiltersPress}
            accessibilityLabel={
              activeFilterCount > 0
                ? `${t('search.actions.filters', 'Filters') || 'Filters'}, ${activeFilterCount}`
                : t('search.actions.filters', 'Filters') || 'Filters'
            }
          />
          <SearchActionPill
            label={
              sort.isDefault
                ? t('search.actions.sort', 'Sort') || 'Sort'
                : sort.label
            }
            icon="swap-vertical"
            active={!sort.isDefault}
            onPress={handleSortPress}
            accessibilityLabel={`${t('search.actions.sort', 'Sort') || 'Sort'}: ${sort.label}`}
          />
        </ScrollView>
      </View>
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
          icon="home-outline"
          title={
            t('search.empty.title', 'No properties match this search') ||
            'No properties match this search'
          }
          description={
            t('search.empty.description', 'Try widening your area or relaxing your filters.') ||
            'Try widening your area or relaxing your filters.'
          }
          actionText={t('search.empty.action', 'Edit search') || 'Edit search'}
          actionIcon="search"
          onAction={onEditSearch}
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
      style={styles.listScroll}
      contentContainerStyle={styles.listScrollContent}
      onScroll={handleListScroll}
      scrollEventThrottle={16}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.resultsHeader}>
        <BloomText style={styles.resultsTitle}>{resultsHeading}</BloomText>
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
    <View style={styles.mapPanel}>
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
      {pendingBounds ? (
        <View style={styles.searchAreaWrap}>
          <View style={[styles.searchAreaButton, cardShadow.md]}>
            <Button
              onPress={handleSearchThisArea}
              variant="primary"
              size="small"
              icon={<Ionicons name="refresh" size={16} color={colors.primaryForeground} />}
              iconPosition="left"
              accessibilityLabel={
                t('search.actions.searchArea', 'Search this area') || 'Search this area'
              }
            >
              {t('search.actions.searchArea', 'Search this area') || 'Search this area'}
            </Button>
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
        onPress={() => setShowMobileMap((prev) => !prev)}
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
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    maxWidth: 1440,
    width: '100%',
    alignSelf: 'center',
  },
  summaryWrap: {
    flex: 1,
    minWidth: 0,
    maxWidth: 520,
  },
  // The pill row is its own horizontal scroller; cap its flex so the summary
  // pill keeps a usable width, and let the pills scroll if all three can't fit.
  topBarActionsScroll: {
    flexGrow: 0,
    flexShrink: 1,
  },
  topBarActions: {
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
  },
  searchAreaButton: {
    backgroundColor: colors.surfaceElevated,
    borderRadius: radius.pill,
    overflow: 'hidden',
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
