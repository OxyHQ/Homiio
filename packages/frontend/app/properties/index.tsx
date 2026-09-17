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
import { useSafeAreaInsets } from 'react-native-safe-area-context';
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
import { useInfiniteScroll } from '@/hooks/useInfiniteScroll';
import { useIsScreenNotMobile } from '@/hooks/useOptimizedMediaQuery';
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
  const insets = useSafeAreaInsets();
  const isWide = useIsScreenNotMobile();
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

  // Shared infinite-scroll primitive: native fires `onScroll` end-detect, web
  // uses the `<LoadMoreSentinel>` at the grid's end. Both funnel through the same
  // guarded loader (no hand-rolled distance math).
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
      return t('properties.header.loading');
    }
    if (total === 0) {
      return t('properties.header.empty');
    }
    return t('search.header.count', { count: total });
  }, [t, isLoading, total]);

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
          description={
            t('properties.empty.description')
          }
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

  // The route mounts this screen in a plain View, so the sticky top bar clears
  // the status bar itself (mirrors SearchResultsView). On web `insets.top` is 0
  // and the `position: sticky; top: 0` placement is unchanged.
  const topBar = (
    <View style={[styles.topBar, { paddingTop: insets.top }]}>
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
          <SortMenu
            sortBy={query.sortBy}
            sortOrder={query.sortOrder}
            onChange={handleSortChange}
            iconOnly={!isWide}
          />
          <Button
            variant="outline"
            size="medium"
            icon={RiTimeLine}
            iconOnly={!isWide}
            onPress={() => router.push('/properties/recently-viewed')}
            accessibilityLabel={t('properties.actions.recent')}
          >
            {isWide ? t('properties.actions.recent') : undefined}
          </Button>
        </ScrollView>
      </View>
    </View>
  );

  return (
    <View style={styles.container}>
      {topBar}
      <SearchFiltersDialog
        open={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        query={query}
        onApply={patchQuery}
      />
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
        {body}
        {isFetchingNextPage ? (
          <PropertyResultsGridSkeleton
            count={2}
            style={styles.gridPadding}
          />
        ) : null}
        <LoadMoreSentinel enabled={hasNextPage} onLoadMore={handleEndReached} />
      </ScrollView>
      <Fab
        placement="bottom-right"
        variant="primary"
        offset={spacing['2xl']}
        icon={<RiAddLine size="lg" />}
        onPress={() => router.push('/properties/create')}
        accessibilityLabel={t('properties.actions.create')}
        style={{ bottom: insets.bottom + spacing['3xl'] }}
      />
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
});
