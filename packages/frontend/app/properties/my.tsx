import React, { useState } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  TouchableOpacity,
  Alert,
  RefreshControl,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { colors } from '@/styles/colors';
import { Header } from '@/components/Header';
import { PropertyCard } from '@/components/PropertyCard';
import { useUserProperties, useDeleteProperty } from '@/hooks/usePropertyQueries';
import { generatePropertyTitle } from '@/utils/propertyTitleGenerator';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { PropertyListSkeleton } from '@/components/ui/skeletons/PropertyListSkeleton';
import type { Property } from '@homiio/shared-types';
import { logger } from '@/utils/logger';

export default function MyPropertiesScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { data, isLoading, error, refetch } = useUserProperties();
  const { deleteProperty } = useDeleteProperty();
  const [refreshing, setRefreshing] = useState(false);
  const [headerHeight, setHeaderHeight] = useState(0);

  const handleRefresh = async () => {
    setRefreshing(true);
    await refetch();
    setRefreshing(false);
  };

  const handleCreateProperty = () => {
    router.push('/properties/create');
  };

  const handlePropertyPress = (propertyId: string) => {
    router.push(`/properties/${propertyId}`);
  };

  const handleEditProperty = (propertyId: string) => {
    router.push(`/properties/create?id=${propertyId}`);
  };

  const handleDeleteProperty = (propertyId: string, propertyTitle: string) => {
    Alert.alert(
      t('properties.my.deleteTitle'),
      t('properties.my.deleteMessage', { title: propertyTitle }),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('common.delete'),
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteProperty(propertyId);
              await refetch();
            } catch (deleteError: unknown) {
              logger.error('Failed to delete property:', deleteError);
            }
          },
        },
      ],
    );
  };

  const renderProperty = ({ item }: { item: Property }) => {
    const propertyId = (item._id || item.id) as string;
    // Generate title dynamically from property data for the delete function
    const title = generatePropertyTitle({
      type: item.type,
      address: item.address,
      bedrooms: item.bedrooms,
      bathrooms: item.bathrooms,
    });

    return (
      <View style={styles.propertyContainer}>
        <PropertyCard
          property={item}
          onPress={() => handlePropertyPress(propertyId)}
          style={styles.propertyCard}
        />

        <View style={styles.propertyActions}>
          <TouchableOpacity
            style={[styles.actionButton, styles.editButton]}
            onPress={() => handleEditProperty(propertyId)}
          >
            <Ionicons name="create-outline" size={16} color={colors.primaryColor} />
            <Text style={[styles.actionText, styles.editText]}>{t('properties.my.edit')}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.actionButton, styles.deleteButton]}
            onPress={() => handleDeleteProperty(propertyId, title)}
          >
            <Ionicons name="trash-outline" size={16} color={colors.danger} />
            <Text style={[styles.actionText, styles.deleteText]}>{t('properties.my.delete')}</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  const renderEmptyState = () => (
    <EmptyState
      icon="home-outline"
      title={t('properties.my.emptyTitle')}
      description={t('properties.my.emptyDescription')}
      actionText={t('properties.my.createFirst')}
      actionIcon="add"
      onAction={handleCreateProperty}
    />
  );

  const renderErrorState = () => (
    <ErrorState
      title={t('properties.my.errorTitle')}
      description={t('properties.my.errorDescription')}
      retryLabel={t('common.retry')}
      onRetry={handleRefresh}
    />
  );

  if (isLoading && !data) {
    return (
      <View style={styles.container}>
        <View
          style={styles.stickyHeaderWrapper}
          onLayout={(e) => setHeaderHeight(e.nativeEvent.layout.height)}
        >
          <Header options={{ title: t('properties.my.title') }} />
        </View>
        <View style={{ paddingTop: headerHeight, flex: 1 }}>
          <PropertyListSkeleton viewMode="list" />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View
        style={styles.stickyHeaderWrapper}
        onLayout={(e) => setHeaderHeight(e.nativeEvent.layout.height)}
      >
        <Header
          options={{
            title: t('properties.my.title'),
            rightComponents: [
              <TouchableOpacity key="add" onPress={handleCreateProperty} style={styles.addButton}>
                <Ionicons name="add" size={24} color={colors.primaryColor} />
              </TouchableOpacity>,
            ],
          }}
        />
      </View>
      <View style={{ paddingTop: headerHeight, flex: 1 }}>
        {error ? (
          renderErrorState()
        ) : data?.properties.length === 0 ? (
          renderEmptyState()
        ) : (
          <FlatList
            data={data?.properties || []}
            renderItem={renderProperty}
            keyExtractor={(item) => item._id || item.id || ''}
            contentContainerStyle={styles.listContainer}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={handleRefresh}
                colors={[colors.primaryColor]}
                tintColor={colors.primaryColor}
              />
            }
            showsVerticalScrollIndicator={false}
          />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.mutedSubtle,
  },
  listContainer: {
    padding: 16,
    paddingBottom: 32,
  },
  propertyContainer: {
    marginBottom: 20,
  },
  propertyCard: {
    marginBottom: 8,
  },
  propertyActions: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    backgroundColor: colors.white,
    borderRadius: 12,
    padding: 12,
    shadowColor: colors.COLOR_BLACK,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 8,
    flex: 1,
    marginHorizontal: 4,
  },
  editButton: {
    backgroundColor: colors.primaryLight,
    borderWidth: 1,
    borderColor: colors.primaryColor,
  },
  deleteButton: {
    backgroundColor: colors.dangerSubtle,
    borderWidth: 1,
    borderColor: colors.danger,
  },
  actionText: {
    fontSize: 14,
    fontWeight: '500',
    marginLeft: 6,
  },
  editText: {
    color: colors.primaryColor,
  },
  deleteText: {
    color: colors.danger,
  },
  addButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.primaryLight,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.primaryColor,
  },
  stickyHeaderWrapper: {
    zIndex: 100,
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    backgroundColor: colors.primaryLight,
  },
});
