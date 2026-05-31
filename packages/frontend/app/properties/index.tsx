/**
 * Properties browse screen — the full-width "explore all listings" surface.
 *
 * Structurally and visually a sibling of the search results screen
 * (`components/search/SearchResultsView`), minus the map: a sticky top bar with
 * an editable `SearchSummaryBar` (tap → opens the real `/search` experience)
 * plus the shared `SearchActionPill` language for Filters / Sort / Recently
 * viewed, over a responsive `PropertyResultsGrid` of `PropertyCard`s.
 *
 * Data comes from `usePropertySearch` keyed by a *local* browse query (seeded
 * from `DEFAULT_SEARCH_QUERY`). This is the SAME endpoint + infinite-scroll +
 * sort path the search screen uses, so the two screens read identically — but
 * the browse query is local state, not the shared `useSearchQueryStore`: tapping
 * the summary navigates to `/search`, where the shared store is the source of
 * truth, so the browse refinements never clobber an in-flight search. No
 * `useEffect` — the grid is pure derived/React-Query state.
 */
import React, { useCallback, useContext, useMemo, useState } from 'react';
import { Platform, ScrollView, StyleSheet, View, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { Button } from '@oxyhq/bloom/button';
import { Text as BloomText } from '@oxyhq/bloom/typography';

import { PropertyResultsGrid } from '@/components/ui/PropertyResultsGrid';
import { PropertyResultsGridSkeleton } from '@/components/ui/PropertyResultsGridSkeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { SearchSummaryBar } from '@/components/search/SearchSummaryBar';
import { SearchActionPill } from '@/components/search/SearchActionPill';
import { resolveSortLabel, SortControl } from '@/components/search/SortControl';
import {
  SearchFiltersBottomSheet,
  type SearchFilters,
} from '@/components/SearchFiltersBottomSheet';
import type { FilterValue } from '@/components/FiltersBar/FiltersBottomSheet';
import type {
  SearchQuery,
  SearchSortBy,
  SearchSortOrder,
} from '@/components/search/types';

import { BottomSheetContext } from '@/context/BottomSheetContext';
import { usePropertySearch } from '@/hooks/usePropertySearch';
import { DEFAULT_SEARCH_QUERY } from '@/store/searchQueryStore';
import { colors } from '@/styles/colors';
import { cardShadow, hairline, radius, spacing } from '@/constants/styles';
import { PropertyType, type Property } from '@homiio/shared-types';

/** Number of skeleton cards shown during the first load. */
const SKELETON_COUNT = 6;
/** Diameter of the circular create FAB. */
const FAB_SIZE = 56;
/** Full-width browse has no side map, so it gets the roomy home-style columns. */
const GRID_COLUMNS = { sm: 1, md: 2, lg: 3, xl: 3 } as const;

/**
 * Derive the {@link SearchFilters} shape (consumed by the reused filters sheet)
 * from the active browse {@link SearchQuery}. The sheet edits a flatter model.
 * Mirrors `SearchResultsView.toSheetFilters`.
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
 * Count the *applied* refinements for the Filters pill badge — property
 * type(s), price, bedrooms, bathrooms, and each amenity. Sort lives on its own
 * pill. Mirrors `SearchResultsView.countActiveFilters`.
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

export default function PropertiesScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const bottomSheet = useContext(BottomSheetContext);

  // Local browse query (NOT the shared search store — see file header). Filters
  // and sort patch this in place; the grid re-keys off it via usePropertySearch.
  const [query, setQuery] = useState<SearchQuery>(DEFAULT_SEARCH_QUERY);
  const patchQuery = useCallback(
    (patch: Partial<SearchQuery>) => setQuery((prev) => ({ ...prev, ...patch })),
    [],
  );

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
  } = usePropertySearch(query);

  const activeFilterCount = useMemo(() => countActiveFilters(query), [query]);
  const sort = useMemo(
    () => resolveSortLabel(query.sortBy, query.sortOrder, t),
    [query.sortBy, query.sortOrder, t],
  );

  const handleEditSearch = useCallback(() => {
    router.push('/search');
  }, [router]);

  const handlePropertyPress = useCallback(
    (property: Property) => {
      router.push(`/properties/${property._id || property.id}`);
    },
    [router],
  );

  const handleSortPress = useCallback(() => {
    bottomSheet.openBottomSheet(
      <SortControl
        sortBy={query.sortBy}
        sortOrder={query.sortOrder}
        onChange={(sortBy: SearchSortBy, sortOrder: SearchSortOrder) =>
          patchQuery({ sortBy, sortOrder })
        }
        onClose={() => bottomSheet.closeBottomSheet()}
      />,
    );
  }, [bottomSheet, query.sortBy, query.sortOrder, patchQuery]);

  const handleSheetFilterChange = useCallback(
    (sectionId: string, value: FilterValue) => {
      switch (sectionId) {
        case 'type':
          patchQuery({
            propertyTypes: typeof value === 'string' ? [value as PropertyType] : [],
          });
          return;
        case 'price':
          if (Array.isArray(value)) {
            const [min, max] = value;
            patchQuery({
              priceMin: typeof min === 'number' && min > 0 ? min : undefined,
              priceMax: typeof max === 'number' && max > 0 ? max : undefined,
            });
          }
          return;
        case 'bedrooms':
          patchQuery({
            bedrooms:
              typeof value === 'string' || typeof value === 'number'
                ? Number(value)
                : undefined,
          });
          return;
        case 'bathrooms':
          patchQuery({
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
          patchQuery({ amenities: next });
          return;
        }
        case 'guests':
          patchQuery({ guests: typeof value === 'number' ? value : undefined });
          return;
        default:
          return;
      }
    },
    [patchQuery, query.amenities],
  );

  const handleFiltersPress = useCallback(() => {
    bottomSheet.openBottomSheet(
      <SearchFiltersBottomSheet
        filters={toSheetFilters(query)}
        onFilterChange={handleSheetFilterChange}
        onApply={() => bottomSheet.closeBottomSheet()}
        onClear={() => {
          patchQuery({
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
  }, [bottomSheet, query, handleSheetFilterChange, patchQuery]);

  const handleEndReached = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) {
      void fetchNextPage();
    }
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const resultsHeading = useMemo(() => {
    if (isLoading) {
      return t('properties.header.loading', 'Loading homes…') || 'Loading homes…';
    }
    if (total === 0) {
      return t('properties.header.empty', 'No homes available') || 'No homes available';
    }
    return t('search.header.count', `${total} homes`) || `${total} homes`;
  }, [t, isLoading, total]);

  const body = (() => {
    if (isLoading && properties.length === 0) {
      return (
        <PropertyResultsGridSkeleton
          count={SKELETON_COUNT}
          columns={GRID_COLUMNS}
          style={styles.gridPadding}
        />
      );
    }
    if (isError) {
      return (
        <ErrorState
          title={t('properties.error.title', 'Could not load homes') || 'Could not load homes'}
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
          title={t('properties.empty.title', 'No homes available') || 'No homes available'}
          description={
            t('properties.empty.description', 'Try relaxing your filters.') ||
            'Try relaxing your filters.'
          }
          actionText={t('properties.empty.action', 'Clear filters') || 'Clear filters'}
          actionIcon="options-outline"
          onAction={handleFiltersPress}
        />
      );
    }
    return (
      <PropertyResultsGrid
        properties={properties}
        onPropertyPress={handlePropertyPress}
        columns={GRID_COLUMNS}
        style={styles.gridPadding}
      />
    );
  })();

  // The route mounts this screen in a plain View, so the sticky top bar clears
  // the status bar itself (mirrors SearchResultsView). On web `insets.top` is 0
  // and the `position: sticky; top: 0` placement is unchanged.
  const topBar = (
    <View style={[styles.topBar, { paddingTop: insets.top }]}>
      <View style={styles.topBarContent}>
        <View style={styles.summaryWrap}>
          <SearchSummaryBar query={query} onPress={handleEditSearch} compact />
        </View>
        {/* Horizontally-scrollable so the pills never wrap or clip on a narrow
            phone; on wide screens the content fits and the scroll never engages. */}
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
            label={sort.isDefault ? t('search.actions.sort', 'Sort') || 'Sort' : sort.label}
            icon="swap-vertical"
            active={!sort.isDefault}
            onPress={handleSortPress}
            accessibilityLabel={`${t('search.actions.sort', 'Sort') || 'Sort'}: ${sort.label}`}
          />
          <SearchActionPill
            label={t('properties.actions.recent', 'Recently viewed') || 'Recently viewed'}
            icon="time-outline"
            onPress={() => router.push('/properties/recently-viewed')}
            accessibilityLabel={
              t('properties.actions.recent', 'Recently viewed') || 'Recently viewed'
            }
          />
        </ScrollView>
      </View>
    </View>
  );

  return (
    <View style={styles.container}>
      {topBar}
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
        {body}
        {isFetchingNextPage ? (
          <PropertyResultsGridSkeleton
            count={2}
            columns={GRID_COLUMNS}
            style={styles.gridPadding}
          />
        ) : null}
      </ScrollView>
      <View style={[styles.fab, cardShadow.md, { bottom: insets.bottom + spacing['3xl'] }]}>
        <Button
          onPress={() => router.push('/properties/create')}
          variant="primary"
          style={styles.fabButton}
          icon={<Ionicons name="add" size={24} color={colors.white} />}
          accessibilityLabel={t('properties.actions.create', 'Add property') || 'Add property'}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
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
  topBarActionsScroll: {
    flexGrow: 0,
    flexShrink: 1,
  },
  topBarActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  listScroll: Platform.select<ViewStyle>({
    web: { flex: 1, overflow: 'auto' } as unknown as ViewStyle,
    default: { flex: 1 },
  }) as ViewStyle,
  listScrollContent: {
    paddingBottom: spacing['4xl'],
    maxWidth: 1440,
    width: '100%',
    alignSelf: 'center',
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
  fab: {
    position: 'absolute',
    right: spacing['2xl'],
    borderRadius: radius.pill,
    zIndex: 100,
  },
  // Force the Bloom primary Button into a fixed circular FAB. The primary
  // variant fills with the brand color but doesn't set its own width/height,
  // so we pin a square size + pill radius; the icon-only content centers.
  fabButton: {
    width: FAB_SIZE,
    height: FAB_SIZE,
    borderRadius: radius.pill,
  },
});
