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
import { OfferingType, PropertyType } from '@homiio/shared-types';
import type { Property } from '@homiio/shared-types';
import { resolvePrimaryOffering } from '@/utils/propertyUtils';
import { browseModeFromOffering } from './types';

import { SearchActionPill } from './SearchActionPill';
import { SearchSummaryBar } from './SearchSummaryBar';
import { resolveSortLabel, SortControl } from './SortControl';
import type {
  SearchBounds,
  SearchQuery,
  SearchSortBy,
  SearchSortOrder,
} from './types';

/** Default zoom applied when no location bbox is known. */
const DEFAULT_MAP_ZOOM = 12;
/** Number of skeleton cards shown during the first load. */
const SKELETON_COUNT = 6;

/** Build map markers ([lng, lat] pins) from a property list. */
function toMarkers(
  properties: readonly Property[],
  offering: OfferingType,
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
      const priceLabel =
        primary.amount > 0
          ? `€${Math.round(primary.amount).toLocaleString()}`
          : primary.label;
      return {
        id: p._id,
        coordinates: [coords[0], coords[1]] as [number, number],
        priceLabel,
      };
    })
    .filter(
      (m): m is { id: string; coordinates: [number, number]; priceLabel: string } =>
        m !== null,
    );
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
  return count;
}

interface SearchResultsViewProps {
  /** The active search query (source of truth for the data + map + summary). */
  query: SearchQuery;
  /** Reopen the expanding panel (editable summary / "edit search"). */
  onEditSearch: () => void;
  /** Open a property's detail screen. */
  onPropertyPress: (property: Property) => void;
  /** Patch the active query (filters, sort, map bounds). */
  onQueryChange: (patch: Partial<SearchQuery>) => void;
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
  canSaveSearch = true,
  onRequireAuth,
}) => {
  const { t } = useTranslation();
  const isWide = useIsScreenNotMobile();
  const insets = useSafeAreaInsets();
  const bottomSheet = useContext(BottomSheetContext);

  const mapRef = useRef<MapApi>(null);
  const [highlightedId, setHighlightedId] = useState<string | null>(null);
  const [pendingBounds, setPendingBounds] = useState<SearchBounds | null>(null);
  const [showMobileMap, setShowMobileMap] = useState(false);

  const search = usePropertySearch(query);
  const { properties, total, isLoading, isError, error, fetchNextPage, hasNextPage, isFetchingNextPage, refetch } =
    search;

  const { searchExists } = useSavedSearches();

  const markers = useMemo(
    () => toMarkers(properties, query.offering),
    [properties, query.offering],
  );

  // --- Top-bar control state (drives the action pills' active/badge UI) ---
  const activeFilterCount = useMemo(() => countActiveFilters(query), [query]);

  const sort = useMemo(
    () => resolveSortLabel(query.sortBy, query.sortOrder, t),
    [query.sortBy, query.sortOrder, t],
  );

  // A search is "saved" when one already exists matching this location label.
  const isSearchSaved = useMemo(() => {
    const label = query.location?.label;
    return label ? searchExists(label, label) : false;
  }, [query.location?.label, searchExists]);

  const initialCoordinates = useMemo<[number, number] | undefined>(
    () => query.location?.center,
    [query.location],
  );

  const selectedProperty = useMemo(
    () => (highlightedId ? properties.find((p) => p._id === highlightedId) ?? null : null),
    [highlightedId, properties],
  );

  const handleMarkerPress = useCallback(
    ({ id }: { id: string }) => {
      setHighlightedId(id);
      mapRef.current?.highlightMarker(id);
    },
    [],
  );

  const handleRegionChange = useCallback(
    ({ bounds, isFinal }: { bounds: SearchBounds; isFinal?: boolean }) => {
      if (!bounds || !isFinal) return;
      setPendingBounds(bounds);
    },
    [],
  );

  const handleSearchThisArea = useCallback(() => {
    if (!pendingBounds) return;
    const center: [number, number] =
      query.location?.center ?? [
        (pendingBounds.west + pendingBounds.east) / 2,
        (pendingBounds.south + pendingBounds.north) / 2,
      ];
    onQueryChange({
      location: {
        label:
          query.location?.label ||
          (t('search.summary.mapArea', 'Map area') || 'Map area'),
        shortLabel:
          query.location?.shortLabel ||
          (t('search.summary.mapArea', 'Map area') || 'Map area'),
        center,
        bounds: pendingBounds,
      },
    });
    setPendingBounds(null);
  }, [pendingBounds, query.location, onQueryChange, t]);

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
    const label = query.location?.label ?? '';
    bottomSheet.openBottomSheet(
      <SaveSearchBottomSheet
        defaultName={query.location?.shortLabel || 'My Search'}
        query={label}
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
  }, [bottomSheet, canSaveSearch, onRequireAuth, query]);

  const handleEndReached = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) {
      void fetchNextPage();
    }
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const resultsHeading = useMemo(() => {
    if (isLoading) {
      return t('search.header.loading', 'Searching homes...') || 'Searching homes...';
    }
    if (total === 0) {
      return t('search.header.noResults', 'No homes match this search') ||
        'No homes match this search';
    }
    return (
      t('search.header.count', `${total} homes`) || `${total} homes`
    );
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

  const listBody = (gridColumns?: Partial<{ sm: number; md: number; lg: number; xl: number }>) => {
    if (isLoading && properties.length === 0) {
      return (
        <PropertyResultsGridSkeleton
          count={SKELETON_COUNT}
          columns={gridColumns}
          style={styles.gridPadding}
        />
      );
    }
    if (isError) {
      return (
        <ErrorState
          title={t('search.error.title', 'Could not load homes') || 'Could not load homes'}
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
            t('search.empty.title', 'No homes match this search') ||
            'No homes match this search'
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
        columns={gridColumns}
        style={styles.gridPadding}
      />
    );
  };

  const listScroll = (gridColumns?: Partial<{ sm: number; md: number; lg: number; xl: number }>) => (
    <ScrollView
      style={styles.listScroll}
      contentContainerStyle={styles.listScrollContent}
      onScroll={({ nativeEvent }) => {
        const { layoutMeasurement, contentOffset, contentSize } = nativeEvent;
        const distanceFromEnd =
          contentSize.height - (layoutMeasurement.height + contentOffset.y);
        if (distanceFromEnd < layoutMeasurement.height) handleEndReached();
      }}
      scrollEventThrottle={200}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.resultsHeader}>
        <BloomText style={styles.resultsTitle}>{resultsHeading}</BloomText>
      </View>
      {listBody(gridColumns)}
      {isFetchingNextPage ? (
        <PropertyResultsGridSkeleton
          count={2}
          columns={gridColumns}
          style={styles.gridPadding}
        />
      ) : null}
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
          <View style={styles.splitListColumn}>{listScroll({ sm: 1, md: 2, lg: 2, xl: 2 })}</View>
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
        <View style={styles.fullColumn}>{listScroll({ sm: 1, md: 2, lg: 2, xl: 2 })}</View>
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
  container: {
    flex: 1,
    backgroundColor: colors.surface,
  },
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
  splitRow: {
    flex: 1,
    flexDirection: 'row',
  },
  splitListColumn: {
    flex: 1,
    minWidth: 0,
  },
  splitMapColumn: {
    flex: 1,
    minWidth: 0,
    borderLeftWidth: hairline.width,
    borderLeftColor: hairline.color,
  },
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
  resultsHeader: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
  },
  resultsTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.COLOR_BLACK,
  },
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
