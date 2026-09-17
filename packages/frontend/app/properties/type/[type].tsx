/**
 * Property type results — every published listing of a single `PropertyType`
 * (the `type` route param), e.g. `/properties/type/apartment`.
 *
 * Rebuilt as a sibling of the `/properties` browse screen: the shared
 * `PropertyListHeader` + Bloom `FilterTriggerButton` / `SortMenu` row over a
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
import React, { useCallback, useMemo, useState } from 'react';
import { Platform, ScrollView, StyleSheet, View, type ViewStyle } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { PropertyListHeader } from '@/components/ui/PropertyListHeader';
import { PropertyResultsGrid } from '@/components/ui/PropertyResultsGrid';
import { PropertyResultsGridSkeleton } from '@/components/ui/PropertyResultsGridSkeleton';
import { LoadMoreSentinel } from '@/components/common/LoadMoreSentinel';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { RiEqualizerLine, RiHomeLine } from '@oxy.so/bloom/icons';
import { FilterTriggerButton } from '@oxy.so/bloom/stay-filters';
import { SortMenu } from '@/components/search/SortMenu';
import { SearchFiltersDialog, countActiveFilters } from '@/components/search/SearchFiltersDialog';
import type {
  SearchQuery,
  SearchSortBy,
  SearchSortOrder,
} from '@/components/search/types';
import { usePropertySearch } from '@/hooks/usePropertySearch';
import { useInfiniteScroll } from '@/hooks/useInfiniteScroll';
import { DEFAULT_SEARCH_QUERY } from '@/store/searchQueryStore';
import { colors } from '@/styles/colors';
import { contentClamp, spacing } from '@/constants/styles';
import { PropertyType, type Property } from '@homiio/shared-types';

/** Number of skeleton cards shown during the first load. */
const SKELETON_COUNT = 6;

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

export default function PropertyTypeScreen() {
  const { type } = useLocalSearchParams<{ type: string }>();
  const { t } = useTranslation();
  const router = useRouter();
  const [filtersOpen, setFiltersOpen] = useState(false);
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

  // The route owns the type, so it is neither offered nor counted.
  const activeFilterCount = useMemo(
    () => countActiveFilters(query, { includeTypes: false }),
    [query],
  );

  const handlePropertyPress = useCallback(
    (property: Property) => {
      router.push(`/properties/${property.id}`);
    },
    [router],
  );

  const handleFiltersPress = useCallback(() => setFiltersOpen(true), []);
  const handleSortChange = useCallback(
    (sortBy: SearchSortBy, sortOrder: SearchSortOrder) => patchQuery({ sortBy, sortOrder }),
    [patchQuery],
  );

  const handleEndReached = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) {
      void fetchNextPage();
    }
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);
  const { onScroll: handleListScroll } = useInfiniteScroll({
    onEndReached: handleEndReached,
    enabled: hasNextPage,
  });

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
          icon={RiHomeLine}
          title={t('properties.type.empty', { type: typeName.toLowerCase() })}
          actionText={t('properties.type.filters.clear')}
          actionIcon={RiEqualizerLine}
          onAction={handleFiltersPress}
        />
      );
    }
    return (
      <PropertyResultsGrid
        properties={properties}
        onPropertyPress={handlePropertyPress}
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
        onScroll={handleListScroll}
        scrollEventThrottle={16}
        showsVerticalScrollIndicator={false}
      >
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.actionsScroll}
          contentContainerStyle={styles.actions}
        >
          <FilterTriggerButton
            count={activeFilterCount}
            onPress={handleFiltersPress}
            label={t('search.actions.filters')}
          />
          <SortMenu sortBy={query.sortBy} sortOrder={query.sortOrder} onChange={handleSortChange} />
        </ScrollView>
        {body}
        {isFetchingNextPage ? (
          <PropertyResultsGridSkeleton count={2} style={styles.gridPadding} />
        ) : null}
        <LoadMoreSentinel enabled={hasNextPage} onLoadMore={handleEndReached} />
      </ScrollView>
      <SearchFiltersDialog
        open={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        query={query}
        onApply={patchQuery}
        showTypes={false}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
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
