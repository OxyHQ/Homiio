/**
 * Saved → Folder detail. Grid of property cards inside the folder.
 *
 * Bloom Button (with a Remix `leadingIcon`) for the header edit action, and
 * shared EmptyState / ErrorState / ListSkeleton states.
 */
import { useCallback, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useOxy } from '@oxy.so/services';

import { AppShellMenuButton } from '@oxy.so/bloom/app-shell';
import { Button } from '@oxy.so/bloom/button';
import { RiEditLine, RiFolderLine, RiFolderOpenLine, RiSearchLine } from '@oxy.so/bloom/icons';
import { PageHeader } from '@oxy.so/bloom/page-header';
import { Screen, ScreenScrollView } from '@oxy.so/bloom/screen';
import { Text as BloomText } from '@oxy.so/bloom/typography';

import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { ListSkeleton } from '@/components/ui/ListSkeleton';
import { PropertyResultsGrid } from '@/components/ui/PropertyResultsGrid';
import savedPropertyService from '@/services/savedPropertyService';
import savedPropertyFolderService from '@/services/savedPropertyFolderService';
import { spacing } from '@/constants/styles';
import { propertiesInFolder } from '@/utils/savedFolders';
import type { Property } from '@homiio/shared-types';

export default function SavedFolderScreen() {
  const { t } = useTranslation();
  const { folderId } = useLocalSearchParams<{ folderId: string }>();
  const { oxyServices, activeSessionId } = useOxy();
  const queryClient = useQueryClient();

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

  const savedProperties = savedQuery.data?.properties;
  const folders = foldersQuery.data?.folders;

  const folder = useMemo(() => (folders ?? []).find((f) => f.id === folderId), [folders, folderId]);
  const folderProperties = useMemo(
    () =>
      // `folderId` is declared on `SavedProperty` now, so the cast this used to
      // carry is gone. The rule lives in `utils/savedFolders.ts`.
      propertiesInFolder(savedProperties ?? [], folderId),
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
    folderProperties.forEach((property) => {
      const id = property.id as string | undefined;
      const note = property.notes?.trim();
      if (id && note) map.set(id, note);
    });
    return map;
  }, [folderProperties]);

  const handlePropertyPress = useCallback((property: Property) => {
    const id = property.id as string;
    if (id) router.push(`/properties/${id}`);
  }, []);

  const renderNoteFooter = useCallback(
    (property: Property) => {
      const note = notesById.get(property.id as string);
      if (!note) return undefined;
      return (
        <BloomText className="pt-1 text-[13px] text-muted-foreground" numberOfLines={2}>
          {note}
        </BloomText>
      );
    },
    [notesById],
  );

  const isLoading = savedQuery.isPending || foldersQuery.isPending;
  const isError = savedQuery.isError || foldersQuery.isError;

  const fallbackHeader = (
    <PageHeader
      title={t('saved.title')}
      titleAlign="center"
      leading={<AppShellMenuButton accessibilityLabel={t('sidebar.open')} />}
      onBack={router.canGoBack() ? router.back : undefined}
      backLabel={t('goBack')}
    />
  );

  if (isLoading) {
    return (
      <Screen documentScroll header={fallbackHeader}>
        <ScreenScrollView contentContainerStyle={styles.skeletonWrap}>
          <ListSkeleton rows={4} rowHeight={160} />
        </ScreenScrollView>
      </Screen>
    );
  }

  if (isError) {
    return (
      <Screen documentScroll header={fallbackHeader}>
        <ScreenScrollView contentContainerStyle={styles.centerWrap}>
          <ErrorState
            title={t('saved.loadFailed')}
            retryLabel={t('common.retry')}
            onRetry={handleRefresh}
          />
        </ScreenScrollView>
      </Screen>
    );
  }

  if (!folder) {
    return (
      <Screen documentScroll header={fallbackHeader}>
        <ScreenScrollView contentContainerStyle={styles.centerWrap}>
          <EmptyState
            icon={RiFolderOpenLine}
            title={t('saved.noFolder')}
            description={t('saved.noFolderDescription')}
          />
        </ScreenScrollView>
      </Screen>
    );
  }

  return (
    <Screen
      documentScroll
      header={
        <PageHeader
          title={`${folder.icon || '📁'} ${folder.name}`}
          titleAlign="center"
          leading={<AppShellMenuButton accessibilityLabel={t('sidebar.open')} />}
          onBack={router.canGoBack() ? router.back : undefined}
          backLabel={t('goBack')}
          actions={
            folder.isDefault ? undefined : (
              <Button
                size="sm"
                onPress={() => router.push(`/saved/${folderId}/edit`)}
                leadingIcon={RiEditLine}
                tone="accent"
                appearance="subtle"
              >
                {t('common.edit')}
              </Button>
            )
          }
        />
      }
    >
      <ScreenScrollView contentContainerStyle={styles.gridContent}>
        {folderProperties.length === 0 ? (
          <View style={styles.emptyInner}>
            <EmptyState
              icon={RiFolderLine}
              title={t('saved.noFolderItems')}
              description={t('saved.noFolderItemsDescription')}
              actionText={t('saved.exploreCta')}
              actionIcon={RiSearchLine}
              onAction={() => router.push('/explore')}
            />
          </View>
        ) : (
          <PropertyResultsGrid
            properties={folderProperties}
            onPropertyPress={handlePropertyPress}
            renderFooter={renderNoteFooter}
          />
        )}
      </ScreenScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  centerWrap: {
    flexGrow: 1,
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
  emptyInner: {
    paddingVertical: spacing['4xl'],
  },
});
