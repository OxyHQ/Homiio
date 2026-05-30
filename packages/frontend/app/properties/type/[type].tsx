/**
 * Property type results — every published listing of a single `PropertyType`
 * (the `type` route param), e.g. `/properties/type/apartment`.
 *
 * Rebuilt as a sibling of the `/properties` browse screen: the shared
 * `PropertyListHeader` + `SearchActionPill` row (Filters / Sort) over a
 * responsive `PropertyResultsGrid` of photo-carousel `PropertyCard`s, with the
 * shared skeleton / empty / error states.
 *
 * Data now comes from `usePropertySearch` — the same paginated
 * `GET /api/properties/search` path the search/browse screens use — seeded from
 * `DEFAULT_SEARCH_QUERY` with `propertyTypes` locked to the route's type. This
 * replaces the old `useProperties` + `useEffect(loadProperties)` +
 * client-side filter/sort with server-side filtering, sorting and infinite
 * scroll, and removes the loading effect entirely (pure derived / React-Query
 * state).
 */
import React, { useCallback, useContext, useMemo, useState } from 'react';
import { Platform, ScrollView, StyleSheet, View, type ViewStyle } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { PropertyListHeader } from '@/components/ui/PropertyListHeader';
import { PropertyResultsGrid } from '@/components/ui/PropertyResultsGrid';
import { PropertyResultsGridSkeleton } from '@/components/ui/PropertyResultsGridSkeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
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
import { contentClamp, spacing } from '@/constants/styles';
import { PropertyType, type Property } from '@homiio/shared-types';

/** Number of skeleton cards shown during the first load. */
const SKELETON_COUNT = 6;
/** Roomy columns — like `/properties`, this surface owns the full width. */
const GRID_COLUMNS = { sm: 1, md: 2, lg: 3, xl: 3 } as const;

/** Localized display name for a property type, falling back to the raw id. */
function useTypeName(): (typeId: string) => string {
  const { t } = useTranslation();
  return useCallback(
    (typeId: string) => {
      const map: Record<string, string> = {
        apartment: t('search.propertyType.apartments'),
        house: t('search.propertyType.houses'),
        room: t('search.propertyType.rooms'),
        studio: t('search.propertyType.studios'),
        coliving: t('search.propertyType.coliving'),
        public_housing: t('search.propertyType.publicHousing'),
      };
      return map[typeId] ?? typeId;
    },
    [t],
  );
}

/** Mirror of `/properties` — flatten the active query into the sheet model. */
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
 * Count applied refinements for the Filters pill badge. The locked type is not
 * counted (it's the screen's identity, not a user refinement).
 */
function countActiveFilters(query: SearchQuery): number {
  let count = 0;
  if (query.priceMin !== undefined || query.priceMax !== undefined) count += 1;
  if (query.bedrooms !== undefined) count += 1;
  if (query.bathrooms !== undefined) count += 1;
  count += query.amenities.length;
  return count;
}

export default function PropertyTypeScreen() {
  const { type } = useLocalSearchParams<{ type: string }>();
  const { t } = useTranslation();
  const router = useRouter();
  const bottomSheet = useContext(BottomSheetContext);
  const getTypeName = useTypeName();

  const typeId = typeof type === 'string' ? type : '';
  const propertyType = typeId as PropertyType;

  // Local query locked to this screen's type. Filters/sort patch it in place;
  // the grid re-keys off it via usePropertySearch (server-side filter + sort).
  const [query, setQuery] = useState<SearchQuery>(() => ({
    ...DEFAULT_SEARCH_QUERY,
    propertyTypes: [propertyType],
    sortBy: 'createdAt',
    sortOrder: 'desc',
  }));
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

  const handlePropertyPress = useCallback(
    (property: Property) => {
      router.push(`/properties/${property._id || property.id}`);
    },
    [router],
  );

  const handleSheetFilterChange = useCallback(
    (sectionId: string, value: FilterValue) => {
      switch (sectionId) {
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

  const handleEndReached = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) {
      void fetchNextPage();
    }
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const typeName = getTypeName(typeId);
  const subtitle = isLoading
    ? undefined
    : t('properties.type.subtitle', {
        count: total,
        type: typeName.toLowerCase(),
      });

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
          title={t('properties.my.errorTitle')}
          description={error?.message}
          retryLabel={t('common.tryAgain')}
          onRetry={() => void refetch()}
        />
      );
    }
    if (properties.length === 0) {
      return (
        <EmptyState
          icon="home-outline"
          title={t('properties.type.empty', { type: typeName.toLowerCase() })}
          actionText={t('properties.type.filters.clear')}
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

  return (
    <View style={styles.container}>
      <PropertyListHeader
        title={t('properties.type.title', { type: typeName })}
        subtitle={subtitle}
      />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        onScroll={({ nativeEvent }) => {
          const { layoutMeasurement, contentOffset, contentSize } = nativeEvent;
          const distanceFromEnd =
            contentSize.height - (layoutMeasurement.height + contentOffset.y);
          if (distanceFromEnd < layoutMeasurement.height) handleEndReached();
        }}
        scrollEventThrottle={200}
        showsVerticalScrollIndicator={false}
      >
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.actionsScroll}
          contentContainerStyle={styles.actions}
        >
          <SearchActionPill
            label={t('search.actions.filters', 'Filters') || 'Filters'}
            icon="options-outline"
            active={activeFilterCount > 0}
            count={activeFilterCount}
            onPress={handleFiltersPress}
            accessibilityLabel={t('search.actions.filters', 'Filters') || 'Filters'}
          />
          <SearchActionPill
            label={sort.isDefault ? t('search.actions.sort', 'Sort') || 'Sort' : sort.label}
            icon="swap-vertical"
            active={!sort.isDefault}
            onPress={handleSortPress}
            accessibilityLabel={`${t('search.actions.sort', 'Sort') || 'Sort'}: ${sort.label}`}
          />
        </ScrollView>
        {body}
        {isFetchingNextPage ? (
          <PropertyResultsGridSkeleton count={2} columns={GRID_COLUMNS} style={styles.gridPadding} />
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.surface,
  },
  scroll: Platform.select<ViewStyle>({
    web: { flex: 1, overflow: 'auto' } as unknown as ViewStyle,
    default: { flex: 1 },
  }) as ViewStyle,
  scrollContent: {
    paddingTop: spacing.md,
    paddingBottom: spacing['4xl'],
    maxWidth: contentClamp.page,
    width: '100%',
    alignSelf: 'center',
  },
  actionsScroll: {
    flexGrow: 0,
    marginBottom: spacing.md,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
  },
  gridPadding: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
  },
});
