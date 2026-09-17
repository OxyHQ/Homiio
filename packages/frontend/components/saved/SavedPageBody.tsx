/**
 * The signed-in Saved page — the Bloom housing template's Saved page, inside
 * Homiio's frame. The route (`app/(tabs)/saved/index.tsx`) owns the `Header`
 * and the sign-in gate; this owns everything under them.
 *
 * One column, top to bottom, each section from real data only:
 *
 * - **Saved searches** (`SavedSearchCard`) beside **upcoming stays and swaps**
 *   (`TripCard`) once the column is wide; the trips section is absent when
 *   nothing is upcoming.
 * - **Folders** (`WishlistCard`), covers from the homes in each, plus "New
 *   folder".
 * - **Saved homes** (`ListingCardGrid` through `PropertyResultsGrid`), grouped
 *   by the offering each card prices.
 */
import React, { useCallback, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { useTheme } from '@oxy.so/bloom/theme';

import { useInfiniteScroll } from '@/hooks/useInfiniteScroll';
import savedPropertyFolderService from '@/services/savedPropertyFolderService';
import savedPropertyService from '@/services/savedPropertyService';

import { SavedFoldersSection } from './SavedFoldersSection';
import { SavedHomesSection } from './SavedHomesSection';
import { SavedSearchesSection } from './SavedSearchesSection';
import { UpcomingTripsSection } from './UpcomingTripsSection';

/** The template's content column. */
const COLUMN_MAX_WIDTH = 1120;
/** From this column width saved searches and trips sit side by side. */
const TWO_COLUMN_MIN_WIDTH = 900;

export function SavedPageBody({ enabled }: { enabled: boolean }) {
  const theme = useTheme();
  const queryClient = useQueryClient();

  // The same keys and fetchers `SavedPropertiesContext` reads, so this page,
  // the hearts on every card and the folder sheet share one cache. Read here
  // for their loading and error states, which the context does not expose.
  const savedQuery = useQuery({
    queryKey: ['savedProperties'],
    queryFn: () => savedPropertyService.getSavedProperties(),
    enabled,
    staleTime: 1000 * 30,
    gcTime: 1000 * 60 * 10,
  });
  const foldersQuery = useQuery({
    queryKey: ['savedFolders'],
    queryFn: () => savedPropertyFolderService.getSavedPropertyFolders(),
    enabled,
    staleTime: 1000 * 60,
    gcTime: 1000 * 60 * 10,
  });

  const [columnWidth, setColumnWidth] = useState(0);
  const onColumnLayout = useCallback(
    (event: LayoutChangeEvent) => setColumnWidth(event.nativeEvent.layout.width),
    [],
  );
  const twoColumns = columnWidth >= TWO_COLUMN_MIN_WIDTH;
  const gutter = columnWidth >= 640 ? 32 : 16;

  // Native end-of-scroll reveals the next window of saved homes; web uses the
  // sentinel inside the section.
  const [loadMoreSignal, setLoadMoreSignal] = useState(0);
  const { onScroll } = useInfiniteScroll({
    onEndReached: () => setLoadMoreSignal((signal) => signal + 1),
    enabled,
  });

  const handleRefresh = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['savedProperties'] }),
      queryClient.invalidateQueries({ queryKey: ['savedFolders'] }),
      queryClient.invalidateQueries({ queryKey: ['savedSearches'] }),
    ]);
  }, [queryClient]);

  const savedProperties = savedQuery.data?.properties ?? [];
  const folders = foldersQuery.data?.folders ?? [];

  return (
    <ScrollView
      onScroll={onScroll}
      scrollEventThrottle={16}
      showsVerticalScrollIndicator={false}
      refreshControl={
        <RefreshControl
          refreshing={savedQuery.isRefetching || foldersQuery.isRefetching}
          onRefresh={handleRefresh}
          tintColor={theme.colors.primary}
          colors={[theme.colors.primary]}
        />
      }
    >
      <View
        onLayout={onColumnLayout}
        style={[
          styles.column,
          { maxWidth: COLUMN_MAX_WIDTH + gutter * 2, paddingLeft: gutter, paddingRight: gutter },
        ]}
      >
        <View style={[styles.topRow, twoColumns && styles.topRowWide]}>
          <View style={twoColumns ? styles.topCell : undefined}>
            <SavedSearchesSection />
          </View>
          <UpcomingTripsSection enabled={enabled} style={twoColumns ? styles.topCell : undefined} />
        </View>

        <SavedFoldersSection
          folders={folders}
          savedProperties={savedProperties}
          loading={foldersQuery.isPending}
        />

        <SavedHomesSection
          savedProperties={savedProperties}
          fetchedAt={savedQuery.dataUpdatedAt}
          loading={savedQuery.isPending}
          error={savedQuery.error}
          onRetry={() => void savedQuery.refetch()}
          loadMoreSignal={loadMoreSignal}
        />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  column: {
    width: '100%',
    alignSelf: 'center',
    paddingTop: 24,
    paddingBottom: 64,
    gap: 48,
  },
  topRow: { gap: 40 },
  topRowWide: { flexDirection: 'row', alignItems: 'flex-start' },
  topCell: { flex: 1, minWidth: 0 },
});
