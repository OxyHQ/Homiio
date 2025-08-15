import React, { useMemo, useCallback, useContext } from 'react';
import { View, FlatList, StyleSheet, TouchableOpacity, RefreshControl } from 'react-native';
import { useLocalSearchParams, router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';

import { Header } from '@/components/Header';
import { PropertyCard } from '@/components/PropertyCard';
import { colors } from '@/styles/colors';
import { useSavedPropertiesContext } from '@/context/SavedPropertiesContext';
import { EmptyState } from '@/components/ui/EmptyState';
import { BottomSheetContext } from '@/context/BottomSheetContext';

export default function SavedFolderScreen() {
  const { t } = useTranslation();
  const { folderId } = useLocalSearchParams<{ folderId: string }>();
  const { savedProperties, folders } = useSavedPropertiesContext();
  const bottomSheetContext = useContext(BottomSheetContext);

  const folder = useMemo(() => folders.find((f) => f._id === folderId), [folders, folderId]);
  const propertiesInFolder = useMemo(
    () => savedProperties.filter((p) => (p as any).folderId === folderId),
    [savedProperties, folderId],
  );

  const renderItem = useCallback(({ item }: { item: any }) => {
    return (
      <View style={styles.gridItemContainer}>
        <PropertyCard
          property={item}
          variant="compact"
          onPress={() => {
            const id = (item._id || item.id) as string;
            if (id) router.push(`/properties/${id}`);
          }}
          noteText={item.notes || ''}
          onPressNote={() => { }}
        />
      </View>
    );
  }, []);

  if (!folder) {
    return (
      <View style={styles.container}>
        <Header options={{ title: t('saved.title'), showBackButton: true }} />
        <EmptyState
          icon="folder-open-outline"
          title={t('saved.noFolder')}
          description={t('saved.noFolderDescription')}
        />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Header
        options={{
          title: `${folder.icon || '📁'} ${folder.name}`,
          titlePosition: 'left',
          showBackButton: true,
          rightComponents: folder.isDefault
            ? []
            : [
              <TouchableOpacity
                key="editFolder"
                style={styles.headerButton}
                onPress={() => router.push(`/saved/${folderId}/edit`)}
              >
                <Ionicons name="create-outline" size={20} color={colors.COLOR_BLACK} />
              </TouchableOpacity>,
            ],
        }}
      />

      <FlatList
        data={propertiesInFolder}
        renderItem={renderItem}
        keyExtractor={(item) => (item._id || item.id) as string}
        numColumns={2}
        columnWrapperStyle={styles.gridRow}
        contentContainerStyle={StyleSheet.flatten([
          styles.listContent,
          propertiesInFolder.length === 0 && styles.emptyListContent,
        ])}
        ListEmptyComponent={() => (
          <EmptyState
            icon="folder-outline"
            title={t('saved.noFolderItems')}
            description={t('saved.noFolderItemsDescription')}
          />
        )}
        refreshControl={
          <RefreshControl
            refreshing={false}
            onRefresh={() => { }}
            colors={[colors.primaryColor]}
            tintColor={colors.primaryColor}
          />
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fafbfc',
  },
  headerButton: {
    padding: 8,
    borderRadius: 8,
    backgroundColor: 'rgba(99, 102, 241, 0.1)',
  },
  listContent: {
    paddingTop: 16,
  },
  emptyListContent: {
    flexGrow: 1,
    justifyContent: 'center',
  },
  gridRow: {
    justifyContent: 'space-between',
    gap: 16,
    paddingHorizontal: 16,
  },
  gridItemContainer: {
    flex: 1,
    marginBottom: 16,
  },
});
