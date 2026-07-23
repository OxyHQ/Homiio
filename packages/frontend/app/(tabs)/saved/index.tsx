/**
 * Saved properties — folders + recent grid.
 *
 * Stream P polish: two-pane shell (Folders | Recent) driven by Bloom
 * SegmentedControl. Search is the Bloom primitive. Category and
 * recency filters use Bloom Chip. The hand-rolled "sort dropdown" plus
 * bulk-selection mode were retired in favour of a cleaner, single-purpose
 * grid view. Folder grid cards use CardSurface with a cover-photo tile
 * + name + count. Empty / error / loading states all go through the
 * shared components.
 */
import React, {
  useCallback,
  useMemo,
  useState,
} from 'react';
import {
  FlatList,
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
  Pressable,
  type ListRenderItem,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { Chip } from '@oxyhq/bloom/chip';
import {
  SegmentedControl,
  SegmentedControlItem,
  SegmentedControlItemText,
} from '@oxyhq/bloom/segmented-control';
import { Search } from '@oxyhq/bloom/search';
import { Text as BloomText, H3 } from '@oxyhq/bloom/typography';
import { useOxy, openAccountDialog } from '@oxyhq/services';
import type { Property, SavedProperty } from '@homiio/shared-types';

import { Header } from '@/components/Header';
import { CardSurface } from '@/components/ui/CardSurface';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { ListSkeleton } from '@/components/ui/ListSkeleton';
import { PropertyResultsGrid } from '@/components/ui/PropertyResultsGrid';
import { LoadMoreSentinel } from '@/components/common/LoadMoreSentinel';
import { useInfiniteScroll } from '@/hooks/useInfiniteScroll';
import savedPropertyService from '@/services/savedPropertyService';
import savedPropertyFolderService, {
  type SavedPropertyFolder,
} from '@/services/savedPropertyFolderService';
import { getPropertyTitle } from '@/utils/propertyUtils';
import { colors } from '@/styles/colors';
import { radius, spacing, tracker } from '@/constants/styles';

type Tab = 'folders' | 'recent';
type RecencyFilter = 'all' | 'recent' | 'noted';

const RECENCY_CHIPS: { value: RecencyFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'recent', label: 'This week' },
  { value: 'noted', label: 'With notes' },
];

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** Saved has no backend list endpoint, so the Recent grid reveals its in-memory
 *  array incrementally: an initial window, grown a page at a time via the same
 *  sentinel (web) / onEndReached (native) primitive as the server-paginated grids. */
const SAVED_INITIAL_WINDOW = 24;
const SAVED_WINDOW_STEP = 24;

export default function SavedPropertiesScreen() {
  const { t } = useTranslation();
  const { oxyServices, activeSessionId } = useOxy();
  const queryClient = useQueryClient();
  const params = useLocalSearchParams<{ tab?: string }>();

  // URL is the source of truth for the active tab so external navigations
  // (e.g. /saved?tab=folders) flip the view without an effect.
  const tab: Tab =
    params.tab === 'folders' || params.tab === 'recent' ? params.tab : 'recent';
  const setTab = useCallback((next: Tab) => {
    try {
      router.setParams?.({ tab: next });
    } catch {
      // Best-effort URL sync; ignore failures on native.
    }
  }, []);

  const [searchQuery, setSearchQuery] = useState('');
  const [recency, setRecency] = useState<RecencyFilter>('all');

  const isAuthed = Boolean(oxyServices && activeSessionId);

  const savedQuery = useQuery({
    queryKey: ['savedProperties'],
    queryFn: () => savedPropertyService.getSavedProperties(),
    enabled: isAuthed,
    staleTime: 1000 * 30,
    gcTime: 1000 * 60 * 10,
  });

  const foldersQuery = useQuery({
    queryKey: ['savedFolders'],
    queryFn: () => savedPropertyFolderService.getSavedPropertyFolders(),
    enabled: isAuthed,
    staleTime: 1000 * 60,
    gcTime: 1000 * 60 * 10,
  });

  const savedProperties: SavedProperty[] = useMemo(
    () => savedQuery.data?.properties ?? [],
    [savedQuery.data?.properties],
  );
  const folders: SavedPropertyFolder[] = useMemo(
    () => foldersQuery.data?.folders ?? [],
    [foldersQuery.data?.folders],
  );

  const filteredFolders = useMemo<SavedPropertyFolder[]>(() => {
    if (!searchQuery.trim()) return folders;
    const q = searchQuery.toLowerCase().trim();
    return folders.filter(
      (folder) =>
        folder.name.toLowerCase().includes(q) ||
        (folder.description || '').toLowerCase().includes(q),
    );
  }, [folders, searchQuery]);

  // Use the moment the saved-properties data was fetched as "now" instead of
  // calling the impure `Date.now()` during render. `dataUpdatedAt` advances on
  // every refetch, so the recency window stays accurate without render-phase
  // impurity.
  const dataUpdatedAt = savedQuery.dataUpdatedAt;
  const filteredRecent = useMemo<SavedProperty[]>(() => {
    // When `dataUpdatedAt` is 0 (no successful fetch yet) `savedProperties` is
    // empty, so the value of `now` is irrelevant to the (empty) result.
    const now = dataUpdatedAt;
    return savedProperties.filter((property) => {
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const title = getPropertyTitle(property).toLowerCase();
        const city = property.address?.cityName?.toLowerCase() ?? '';
        if (!title.includes(q) && !city.includes(q)) return false;
      }
      switch (recency) {
        case 'recent': {
          const savedTime = property.savedAt
            ? new Date(property.savedAt).getTime()
            : now;
          return now - savedTime <= WEEK_MS;
        }
        case 'noted':
          return Boolean(property.notes && property.notes.trim().length > 0);
        default:
          return true;
      }
    });
  }, [savedProperties, searchQuery, recency, dataUpdatedAt]);

  // Incremental reveal for the Recent grid. Reset the window when the filter set
  // changes — the "adjust state during render" pattern (React's sanctioned way to
  // reset state on a derived change) keeps it effect-free.
  const [visibleCount, setVisibleCount] = useState(SAVED_INITIAL_WINDOW);
  const filterSignature = `${tab}|${searchQuery}|${recency}`;
  const [prevSignature, setPrevSignature] = useState(filterSignature);
  if (filterSignature !== prevSignature) {
    setPrevSignature(filterSignature);
    setVisibleCount(SAVED_INITIAL_WINDOW);
  }
  const visibleRecent = useMemo(
    () => filteredRecent.slice(0, visibleCount),
    [filteredRecent, visibleCount],
  );
  const hasMoreRecent = visibleCount < filteredRecent.length;
  const loadMoreRecent = useCallback(() => {
    setVisibleCount((count) =>
      count < filteredRecent.length
        ? Math.min(count + SAVED_WINDOW_STEP, filteredRecent.length)
        : count,
    );
  }, [filteredRecent.length]);
  const { onScroll: handleRecentScroll } = useInfiniteScroll({
    onEndReached: loadMoreRecent,
    enabled: hasMoreRecent,
  });

  const handleRefresh = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['savedProperties'] }),
      queryClient.invalidateQueries({ queryKey: ['savedFolders'] }),
    ]);
  }, [queryClient]);

  const isLoading = savedQuery.isPending || foldersQuery.isPending;
  const isError = savedQuery.isError || foldersQuery.isError;
  const isRefreshing = savedQuery.isFetching || foldersQuery.isFetching;

  const header = (
    <Header
      options={{
        title: t('saved.header'),
      }}
    />
  );

  if (!isAuthed) {
    return (
      <View style={styles.root}>
        {header}
        <View style={styles.centerWrap}>
          <EmptyState
            icon="lock-closed"
            title={t('profile.signInRequired')}
            description={t('profile.signInMessage')}
            actionText={t('common.signIn')}
            actionIcon="log-in"
            onAction={() => openAccountDialog()}
          />
        </View>
      </View>
    );
  }

  const renderFolder: ListRenderItem<SavedPropertyFolder> = ({ item }) => (
    <FolderTile folder={item} />
  );

  const handlePropertyPress = useCallback((property: Property) => {
    const id = (property._id || property.id) as string;
    if (id) router.push(`/properties/${id}`);
  }, []);

  return (
    <View style={styles.root}>
      {header}

      <View style={styles.controls}>
        <Search
          value={searchQuery}
          label={t('saved.searchPlaceholder')}
          onChangeText={setSearchQuery}
          onClearText={() => setSearchQuery('')}
        />

        <View style={styles.segmentedWrap}>
          <SegmentedControl<Tab>
            label={t('saved.tabs.label')}
            type="tabs"
            value={tab}
            onChange={setTab}
          >
            <SegmentedControlItem value="folders">
              <SegmentedControlItemText>
                {t('saved.tabs.folders')}
              </SegmentedControlItemText>
            </SegmentedControlItem>
            <SegmentedControlItem value="recent">
              <SegmentedControlItemText>
                {t('saved.tabs.recent')}
              </SegmentedControlItemText>
            </SegmentedControlItem>
          </SegmentedControl>
        </View>

        {tab === 'recent' ? (
          <View style={styles.chipsRow}>
            {RECENCY_CHIPS.map((chip) => {
              const isActive = recency === chip.value;
              return (
                <Chip
                  key={chip.value}
                  variant={isActive ? 'solid' : 'outlined'}
                  color={isActive ? 'primary' : 'default'}
                  size="medium"
                  selected={isActive}
                  onPress={() => setRecency(chip.value)}
                >
                  {chip.label}
                </Chip>
              );
            })}
          </View>
        ) : null}
      </View>

      {isLoading ? (
        <View style={styles.skeletonWrap}>
          <ListSkeleton rows={4} rowHeight={140} />
        </View>
      ) : isError ? (
        <View style={styles.centerWrap}>
          <ErrorState
            title={t('saved.loadFailed')}
            description={
              savedQuery.error instanceof Error
                ? savedQuery.error.message
                : t('common.tryAgain')
            }
            retryLabel={t('common.retry')}
            onRetry={handleRefresh}
          />
        </View>
      ) : tab === 'folders' ? (
        <FlatList
          data={filteredFolders}
          keyExtractor={(folder) => folder._id}
          numColumns={2}
          columnWrapperStyle={styles.gridRow}
          contentContainerStyle={styles.gridContent}
          renderItem={renderFolder}
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={handleRefresh}
              colors={[colors.primaryColor]}
              tintColor={colors.primaryColor}
            />
          }
          ListEmptyComponent={
            <View style={styles.emptyInner}>
              <EmptyState
                icon="folder-open-outline"
                title={t('saved.noFolders')}
                description={t('saved.noFoldersDescription')}
                actionText={t('saved.createFolder')}
                actionIcon="add"
                onAction={() => router.push('/saved')}
              />
            </View>
          }
        />
      ) : (
        <ScrollView
          contentContainerStyle={styles.gridContent}
          showsVerticalScrollIndicator={false}
          onScroll={handleRecentScroll}
          scrollEventThrottle={16}
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={handleRefresh}
              colors={[colors.primaryColor]}
              tintColor={colors.primaryColor}
            />
          }
        >
          {filteredRecent.length === 0 ? (
            <View style={styles.emptyInner}>
              <EmptyState
                icon="bookmark-outline"
                title={
                  searchQuery || recency !== 'all'
                    ? t('saved.noResults')
                    : t('saved.noProperties')
                }
                description={
                  searchQuery || recency !== 'all'
                    ? t('saved.adjustFilters')
                    : t('saved.noPropertiesDescription')
                }
                actionText={t('saved.exploreCta')}
                actionIcon="search"
                onAction={() => router.push('/explore')}
              />
            </View>
          ) : (
            <>
              <PropertyResultsGrid
                properties={visibleRecent}
                onPropertyPress={handlePropertyPress}
              />
              {/* Reveal is synchronous (a client-side slice grows), so no loading
                  skeleton — the next window renders instantly. Web reveals via the
                  sentinel; native via the ScrollView onScroll. */}
              <LoadMoreSentinel enabled={hasMoreRecent} onLoadMore={loadMoreRecent} />
            </>
          )}
        </ScrollView>
      )}
    </View>
  );
}

interface FolderTileProps {
  folder: SavedPropertyFolder;
}

const FolderTile: React.FC<FolderTileProps> = ({ folder }) => {
  const handlePress = useCallback(() => {
    router.push(`/saved/${folder._id}`);
  }, [folder._id]);

  return (
    <Pressable
      onPress={handlePress}
      style={styles.folderTile}
      accessibilityRole="button"
      accessibilityLabel={`Open folder ${folder.name}`}
    >
      <CardSurface padding={0}>
        <View style={styles.folderCover}>
          <View
            style={[
              styles.folderCoverPlaceholder,
              { backgroundColor: folder.color || colors.mutedSubtle },
            ]}
          >
            <BloomText style={styles.folderIcon}>
              {folder.icon || '📁'}
            </BloomText>
          </View>
        </View>
        <View style={styles.folderInfo}>
          <H3 style={styles.folderName} numberOfLines={1}>
            {folder.name}
          </H3>
          <BloomText style={styles.folderMeta}>
            {`${folder.propertyCount} ${folder.propertyCount === 1 ? 'place' : 'places'}`}
          </BloomText>
        </View>
      </CardSurface>
    </Pressable>
  );
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  centerWrap: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: spacing['2xl'],
  },
  controls: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.md,
    gap: spacing.md,
    backgroundColor: colors.surface,
  },
  segmentedWrap: {
    marginTop: spacing.xs,
  },
  chipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  skeletonWrap: {
    padding: spacing.lg,
    gap: spacing.lg,
  },
  gridContent: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing['4xl'],
    gap: spacing.lg,
  },
  gridRow: {
    gap: spacing.lg,
  },
  emptyInner: {
    paddingVertical: spacing['4xl'],
  },
  folderTile: {
    flex: 1,
  },
  folderCover: {
    width: '100%',
    aspectRatio: 16 / 10,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    overflow: 'hidden',
  },
  folderCoverPlaceholder: {
    width: '100%',
    height: '100%',
    alignItems: 'center',
    justifyContent: 'center',
  },
  folderIcon: {
    fontSize: 32,
  },
  folderInfo: {
    padding: spacing.md,
    gap: spacing.xs,
  },
  folderName: {
    fontSize: 15,
    fontWeight: '700',
  },
  folderMeta: {
    fontSize: 12,
    color: colors.muted,
    letterSpacing: tracker.normal,
  },
});
