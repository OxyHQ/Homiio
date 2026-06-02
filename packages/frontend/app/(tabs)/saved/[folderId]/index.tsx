/**
 * Saved → Folder detail. Grid of property cards inside the folder.
 *
 * Stream P polish: Bloom Button for the header edit action (no more
 * tinted TouchableOpacity), shared EmptyState / ErrorState / ListSkeleton
 * states, and surface tokens for the page background.
 */
import React, { useCallback, useContext, useMemo } from 'react';
import {
  RefreshControl,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useOxy } from '@oxyhq/services';

import { Button } from '@oxyhq/bloom/button';
import { Text as BloomText } from '@oxyhq/bloom/typography';

import { Header } from '@/components/Header';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { ListSkeleton } from '@/components/ui/ListSkeleton';
import { PropertyResultsGrid } from '@/components/ui/PropertyResultsGrid';
import { BottomSheetContext } from '@/context/BottomSheetContext';
import savedPropertyService from '@/services/savedPropertyService';
import savedPropertyFolderService from '@/services/savedPropertyFolderService';
import { colors } from '@/styles/colors';
import { spacing } from '@/constants/styles';
import type { Property, SavedProperty } from '@homiio/shared-types';

export default function SavedFolderScreen() {
  const { t } = useTranslation();
  const { folderId } = useLocalSearchParams<{ folderId: string }>();
  const { oxyServices, activeSessionId } = useOxy();
  const queryClient = useQueryClient();
  useContext(BottomSheetContext);

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

  const savedProperties = savedQuery.data?.properties ?? [];
  const folders = foldersQuery.data?.folders ?? [];

  const folder = useMemo(
    () => folders.find((f) => f._id === folderId),
    [folders, folderId],
  );
  const propertiesInFolder = useMemo(
    () =>
      savedProperties.filter(
        (property) =>
          (property as SavedProperty & { folderId?: string }).folderId === folderId,
      ),
    [savedProperties, folderId],
  );

  const handleRefresh = useCallback(async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['savedProperties'] }),
      queryClient.invalidateQueries({ queryKey: ['savedFolders'] }),
    ]);
  }, [queryClient]);

  // Map property id → saved note so the shared grid's footer slot can surface
  // the note (the grid receives plain `Property` objects, not `SavedProperty`).
  const notesById = useMemo(() => {
    const map = new Map<string, string>();
    propertiesInFolder.forEach((property) => {
      const id = (property._id || property.id) as string | undefined;
      const note = property.notes?.trim();
      if (id && note) map.set(id, note);
    });
    return map;
  }, [propertiesInFolder]);

  const handlePropertyPress = useCallback((property: Property) => {
    const id = (property._id || property.id) as string;
    if (id) router.push(`/properties/${id}`);
  }, []);

  const renderNoteFooter = useCallback(
    (property: Property) => {
      const note = notesById.get((property._id || property.id) as string);
      if (!note) return undefined;
      return (
        <BloomText style={styles.noteText} numberOfLines={2}>
          {note}
        </BloomText>
      );
    },
    [notesById],
  );

  const isLoading = savedQuery.isPending || foldersQuery.isPending;
  const isError = savedQuery.isError || foldersQuery.isError;
  const isRefreshing = savedQuery.isFetching || foldersQuery.isFetching;

  if (isLoading) {
    return (
      <View style={styles.root}>
        <Header
          options={{
            title: t('saved.title', 'Folder'),
            showBackButton: true,
          }}
        />
        <View style={styles.skeletonWrap}>
          <ListSkeleton rows={4} rowHeight={160} />
        </View>
      </View>
    );
  }

  if (isError) {
    return (
      <View style={styles.root}>
        <Header
          options={{
            title: t('saved.title', 'Folder'),
            showBackButton: true,
          }}
        />
        <View style={styles.centerWrap}>
          <ErrorState
            title={t('saved.loadFailed', "We couldn't load this folder")}
            retryLabel={t('common.retry', 'Retry')}
            onRetry={handleRefresh}
          />
        </View>
      </View>
    );
  }

  if (!folder) {
    return (
      <View style={styles.root}>
        <Header
          options={{
            title: t('saved.title', 'Folder'),
            showBackButton: true,
          }}
        />
        <View style={styles.centerWrap}>
          <EmptyState
            icon="folder-open-outline"
            title={t('saved.noFolder', 'Folder not found')}
            description={t(
              'saved.noFolderDescription',
              'This folder might have been removed.',
            )}
          />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <Header
        options={{
          title: `${folder.icon || '📁'} ${folder.name}`,
          showBackButton: true,
          rightComponents: folder.isDefault
            ? []
            : [
                <Button
                  key="editFolder"
                  variant="ghost"
                  size="small"
                  onPress={() => router.push(`/saved/${folderId}/edit`)}
                  icon={
                    <Ionicons
                      name="create-outline"
                      size={18}
                      color={colors.COLOR_BLACK}
                    />
                  }
                >
                  {t('common.edit', 'Edit')}
                </Button>,
              ],
        }}
      />

      <ScrollView
        contentContainerStyle={styles.gridContent}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={handleRefresh}
            colors={[colors.primaryColor]}
            tintColor={colors.primaryColor}
          />
        }
      >
        {propertiesInFolder.length === 0 ? (
          <View style={styles.emptyInner}>
            <EmptyState
              icon="folder-outline"
              title={t('saved.noFolderItems', 'This folder is empty')}
              description={t(
                'saved.noFolderItemsDescription',
                'Save properties to add them to this folder.',
              )}
              actionText={t('saved.exploreCta', 'Explore properties')}
              actionIcon="search"
              onAction={() => router.push('/explore')}
            />
          </View>
        ) : (
          <PropertyResultsGrid
            properties={propertiesInFolder}
            onPropertyPress={handlePropertyPress}
            renderFooter={renderNoteFooter}
          />
        )}
      </ScrollView>
    </View>
  );
}

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
  skeletonWrap: {
    padding: spacing.lg,
    gap: spacing.lg,
  },
  gridContent: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing['4xl'],
  },
  noteText: {
    fontSize: 13,
    color: colors.muted,
    paddingTop: spacing.xs,
  },
  emptyInner: {
    paddingVertical: spacing['4xl'],
  },
});
