/**
 * Saved properties — folders + recent grid.
 *
 * Stream P polish: two-pane shell (Folders | Recent) driven by Bloom
 * SegmentedControl. SearchInput is the Bloom primitive. Category and
 * recency filters use Bloom Chip. The hand-rolled "sort dropdown" plus
 * bulk-selection mode were retired in favour of a cleaner, single-purpose
 * grid view. Folder grid cards use CardSurface with a cover-photo tile
 * + name + count. Empty / error / loading states all go through the
 * shared components.
 */
import React, {
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import {
  FlatList,
  RefreshControl,
  StyleSheet,
  View,
  Pressable,
  Image,
  type ListRenderItem,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { Chip } from '@oxyhq/bloom/chip';
import * as SegmentedControl from '@oxyhq/bloom/segmented-control';
import { SearchInput } from '@oxyhq/bloom/search-input';
import { Text as BloomText, H3 } from '@oxyhq/bloom/typography';
import { useOxy, showSignInModal } from '@oxyhq/services';
import type { SavedProperty } from '@homiio/shared-types';

import { Header } from '@/components/Header';
import { PropertyCard } from '@/components/PropertyCard';
import { CardSurface } from '@/components/ui/CardSurface';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { ListSkeleton } from '@/components/ui/ListSkeleton';
import savedPropertyService from '@/services/savedPropertyService';
import savedPropertyFolderService, {
  type SavedPropertyFolder,
} from '@/services/savedPropertyFolderService';
import { getPropertyImageSource, getPropertyTitle } from '@/utils/propertyUtils';
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

export default function SavedPropertiesScreen() {
  const { t } = useTranslation();
  const { oxyServices, activeSessionId } = useOxy();
  const queryClient = useQueryClient();
  const params = useLocalSearchParams<{ tab?: string }>();

  const initialTab: Tab =
    params.tab === 'folders' || params.tab === 'recent' ? params.tab : 'recent';

  const [tab, setTab] = useState<Tab>(initialTab);
  const [searchQuery, setSearchQuery] = useState('');
  const [recency, setRecency] = useState<RecencyFilter>('all');

  useEffect(() => {
    if (params.tab === 'folders' || params.tab === 'recent') {
      setTab(params.tab);
    }
  }, [params.tab]);

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

  const filteredRecent = useMemo<SavedProperty[]>(() => {
    const now = Date.now();
    return savedProperties.filter((property) => {
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const title = getPropertyTitle(property as any).toLowerCase();
        const city = property.address?.city?.toLowerCase() ?? '';
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
  }, [savedProperties, searchQuery, recency]);

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
        title: t('saved.header', 'Saved'),
        titlePosition: 'left',
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
            title={t('profile.signInRequired', 'Sign in to view saved')}
            description={t(
              'profile.signInMessage',
              'You need an account to save and revisit places.',
            )}
            actionText={t('common.signIn', 'Sign in')}
            actionIcon="log-in"
            onAction={() => showSignInModal()}
          />
        </View>
      </View>
    );
  }

  const renderFolder: ListRenderItem<SavedPropertyFolder> = ({ item }) => (
    <FolderTile folder={item} />
  );

  const renderProperty: ListRenderItem<SavedProperty> = ({ item }) => (
    <View style={styles.gridItem}>
      <PropertyCard
        property={item as any}
        variant="compact"
        orientation="vertical"
        onPress={() => {
          const id = (item._id || item.id) as string;
          if (id) router.push(`/properties/${id}`);
        }}
      />
    </View>
  );

  return (
    <View style={styles.root}>
      {header}

      <View style={styles.controls}>
        <SearchInput
          value={searchQuery}
          label={t('saved.searchPlaceholder', 'Search saved properties')}
          onChangeText={setSearchQuery}
          onClearText={() => setSearchQuery('')}
        />

        <View style={styles.segmentedWrap}>
          <SegmentedControl.Root<Tab>
            label={t('saved.tabs.label', 'Saved view')}
            type="tabs"
            value={tab}
            onChange={(next) => {
              setTab(next);
              try {
                router.setParams?.({ tab: next });
              } catch {
                // Best-effort URL sync; ignore failures on native.
              }
            }}
          >
            <SegmentedControl.Item value="folders">
              <SegmentedControl.ItemText>
                {t('saved.tabs.folders', 'Folders')}
              </SegmentedControl.ItemText>
            </SegmentedControl.Item>
            <SegmentedControl.Item value="recent">
              <SegmentedControl.ItemText>
                {t('saved.tabs.recent', 'Recent')}
              </SegmentedControl.ItemText>
            </SegmentedControl.Item>
          </SegmentedControl.Root>
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
            title={t('saved.loadFailed', "We couldn't load your saved items")}
            description={
              savedQuery.error instanceof Error
                ? savedQuery.error.message
                : t('common.tryAgain', 'Please try again.')
            }
            retryLabel={t('common.retry', 'Retry')}
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
                title={t('saved.noFolders', 'No folders yet')}
                description={t(
                  'saved.noFoldersDescription',
                  'Create folders to organise the places you like.',
                )}
                actionText={t('saved.createFolder', 'Create folder')}
                actionIcon="add"
                onAction={() => router.push('/saved')}
              />
            </View>
          }
        />
      ) : (
        <FlatList
          data={filteredRecent}
          keyExtractor={(property) =>
            (property._id || property.id) as string
          }
          numColumns={2}
          columnWrapperStyle={styles.gridRow}
          contentContainerStyle={styles.gridContent}
          renderItem={renderProperty}
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
                icon="bookmark-outline"
                title={
                  searchQuery || recency !== 'all'
                    ? t('saved.noResults', 'No matches')
                    : t('saved.noProperties', 'No saved properties')
                }
                description={
                  searchQuery || recency !== 'all'
                    ? t(
                        'saved.adjustFilters',
                        'Try a different filter or clear your search.',
                      )
                    : t(
                        'saved.noPropertiesDescription',
                        'Save properties to see them here.',
                      )
                }
                actionText={t('saved.exploreCta', 'Explore properties')}
                actionIcon="search"
                onAction={() => router.push('/search')}
              />
            </View>
          }
        />
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

const _RecentCard: React.FC<{ property: SavedProperty }> = ({ property }) => {
  const imageSource = getPropertyImageSource(property as any);
  return imageSource ? (
    <Image source={imageSource} style={styles.recentImage} resizeMode="cover" />
  ) : null;
};

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.surface,
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
  gridItem: {
    flex: 1,
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
  recentImage: {
    width: '100%',
    height: 160,
  },
});
