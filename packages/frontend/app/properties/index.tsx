/**
 * Properties browse screen — the full-width "explore all listings" surface.
 *
 * Structurally and visually a sibling of the search results screen
 * (`components/search/SearchResultsView`), minus the map: a sticky top bar with
 * Bloom's `StaySearchCompact` trigger (tap → opens `/explore`) plus Bloom's
 * `FilterTriggerButton`, the `SortMenu` and a Recently viewed button, over a
 * responsive `PropertyResultsGrid` of `PropertyCard`s.
 *
 * Data comes from `usePropertySearch` keyed by a *local* browse query (seeded
 * from `DEFAULT_SEARCH_QUERY`). This is the SAME endpoint + infinite-scroll +
 * sort path the search screen uses, so the two screens read identically — but
 * the browse query is local state, not the shared `useSearchQueryStore`: tapping
 * the summary navigates to `/search`, where the shared store is the source of
 * truth, so the browse refinements never clobber an in-flight search. No
 * `useEffect` — the grid is pure derived/React-Query state.
 */
import React, { useCallback, useMemo, useState } from 'react';
import { Platform, ScrollView, StyleSheet, View, type ViewStyle } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useRouter } from 'expo-router';

import { Button } from '@oxy.so/bloom/button';
import { Fab } from '@oxy.so/bloom/fab';
import { RiAddLine, RiEqualizerLine, RiHomeLine, RiTimeLine } from '@oxy.so/bloom/icons';
import { FilterTriggerButton } from '@oxy.so/bloom/stay-filters';
import { StaySearchCompact } from '@oxy.so/bloom/stay-search';
import { Text as BloomText } from '@oxy.so/bloom/typography';

import { PropertyResultsGrid } from '@/components/ui/PropertyResultsGrid';
import { PropertyResultsGridSkeleton } from '@/components/ui/PropertyResultsGridSkeleton';
import { LoadMoreSentinel } from '@/components/common/LoadMoreSentinel';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { SortMenu } from '@/components/search/SortMenu';
import { SearchFiltersDialog, countActiveFilters } from '@/components/search/SearchFiltersDialog';
import { summaryLine } from '@/components/search/searchLabels';
import {
  locationDisplayLabel,
  type SearchQuery,
  type SearchSortBy,
  type SearchSortOrder,
} from '@/components/search/types';

import { usePropertySearch } from '@/hooks/usePropertySearch';
import { DEFAULT_SEARCH_QUERY } from '@/store/searchQueryStore';
import { colors } from '@/styles/colors';
import { hairline, spacing } from '@/constants/styles';
import { useFormatting } from '@/utils/format';
import type { Property } from '@homiio/shared-types';

/** Number of skeleton cards shown during the first load. */
const SKELETON_COUNT = 6;

export default function PropertiesScreen() {
  const { t } = useTranslation();
  const { locale } = useFormatting();
  const router = useRouter();
  const [filtersOpen, setFiltersOpen] = useState(false);

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

  const handleEditSearch = useCallback(() => {
    router.push('/explore');
  }, [router]);

  const handlePropertyPress = useCallback(
    (property: Property) => {
      router.push(`/properties/${property.id}`);
    },
    [router],
  );

  const handleSortChange = useCallback(
    (sortBy: SearchSortBy, sortOrder: SearchSortOrder) => patchQuery({ sortBy, sortOrder }),
    [patchQuery],
  );
  const handleFiltersPress = useCallback(() => setFiltersOpen(true), []);

  // Infinite scroll: the shell owns the scroll, so the `<LoadMoreSentinel>` at
  // the grid's end triggers the guarded loader.
  const handleEndReached = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) {
      void fetchNextPage();
    }
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const resultsHeading = useMemo(() => {
    if (isLoading) {
      return t('properties.header.loading');
    }
    if (total === 0) {
      return t('properties.header.empty');
    }
    return t('search.header.count', { count: total });
  }, [t, isLoading, total]);

  const body = (() => {
    if (isLoading && properties.length === 0) {
      return <PropertyResultsGridSkeleton count={SKELETON_COUNT} style={styles.gridPadding} />;
    }
    if (isError) {
      return (
        <ErrorState
          title={t('properties.error.title')}
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
          title={t('properties.empty.title')}
          description={t('properties.empty.description')}
          actionText={t('properties.empty.action')}
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

  const topBar = (
    <View style={styles.topBar}>
      <View style={styles.topBarContent}>
        <StaySearchCompact
          onPress={handleEditSearch}
          title={locationDisplayLabel(query.location, t)}
          summary={summaryLine(query, t, locale)}
          accessibilityLabel={t('search.summary.edit')}
          style={styles.summaryWrap}
        />
        {/* Horizontally-scrollable so the controls never wrap or clip on a narrow
            phone; on wide screens the content fits and the scroll never engages. */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.topBarActionsScroll}
          contentContainerStyle={styles.topBarActions}
        >
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
          <View className="sm:hidden">
            <Button
              size="md"
              icon={RiTimeLine}
              iconOnly
              onPress={() => router.push('/properties/recently-viewed')}
              accessibilityLabel={t('properties.actions.recent')}
              tone="neutral"
              appearance="outline"
            />
          </View>
          <View className="hidden sm:flex">
            <Button
              size="md"
              icon={RiTimeLine}
              onPress={() => router.push('/properties/recently-viewed')}
              accessibilityLabel={t('properties.actions.recent')}
              tone="neutral"
              appearance="outline"
            >
              {t('properties.actions.recent')}
            </Button>
          </View>
        </ScrollView>
      </View>
    </View>
  );

  return (
    <View>
      {topBar}
      <SearchFiltersDialog
        open={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        query={query}
        onApply={patchQuery}
      />
      <View style={styles.listContent}>
        <View style={styles.resultsHeader}>
          <BloomText style={styles.resultsTitle}>{resultsHeading}</BloomText>
        </View>
        {body}
        {isFetchingNextPage ? (
          <PropertyResultsGridSkeleton count={2} style={styles.gridPadding} />
        ) : null}
        <LoadMoreSentinel enabled={hasNextPage} onLoadMore={handleEndReached} />
      </View>
      {/* Bloom 6 leaves a FAB's position to its parent: this anchor is it. */}
      <View style={styles.fabAnchor}>
        <Fab
          icon={RiAddLine}
          size="lg"
          onPress={() => router.push('/properties/create')}
          accessibilityLabel={t('properties.actions.create')}
          appearance="solid"
          tone="accent"
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  fabAnchor: {
    position: 'absolute',
    right: spacing['2xl'],
    bottom: spacing['3xl'],
    pointerEvents: 'box-none',
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
  listContent: {
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
});
