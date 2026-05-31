/**
 * My properties — the signed-in owner's own listings.
 *
 * Rebuilt to match the `/properties` browse surface: the shared
 * `PropertyListHeader` (with an "Add property" action) over a responsive
 * `PropertyResultsGrid` of photo-carousel `PropertyCard`s, with the shared
 * `PropertyResultsGridSkeleton` / `EmptyState` / `ErrorState` states.
 *
 * Data source is unchanged in spirit — `useUserProperties`, the owner-listings
 * query — but it now receives the resolved `profileId` from `ProfileContext`
 * (mirroring `app/host/calendar.tsx`). The previous call passed no id, so the
 * hook short-circuited and the list never loaded.
 *
 * Owner actions (edit / delete) are preserved as clean Bloom buttons attached
 * to each card via the grid's `renderFooter` slot. Delete confirmation uses the
 * shared `ConfirmDialog` (the app's modern pattern; the RN `Alert` it replaced
 * is a no-op on web).
 */
import React, { useCallback, useMemo, useState } from 'react';
import { Platform, ScrollView, StyleSheet, View, type ViewStyle } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { Button } from '@oxyhq/bloom/button';

import { PropertyListHeader } from '@/components/ui/PropertyListHeader';
import { PropertyResultsGrid } from '@/components/ui/PropertyResultsGrid';
import { PropertyResultsGridSkeleton } from '@/components/ui/PropertyResultsGridSkeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { useProfile } from '@/context/ProfileContext';
import { useUserProperties, useDeleteProperty } from '@/hooks/usePropertyQueries';
import { generatePropertyTitle } from '@/utils/propertyTitleGenerator';
import { colors } from '@/styles/colors';
import { contentClamp, spacing } from '@/constants/styles';
import type { Property } from '@homiio/shared-types';
import { logger } from '@/utils/logger';

/** Number of skeleton cards shown during the first load. */
const SKELETON_COUNT = 4;
/** Roomy columns — like `/properties`, this surface owns the full width. */
const GRID_COLUMNS = { sm: 1, md: 2, lg: 3, xl: 3 } as const;

/** A pending delete target, carried while the confirm dialog is open. */
interface DeleteTarget {
  id: string;
  title: string;
}

export default function MyPropertiesScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { primaryProfile } = useProfile();
  const profileId = primaryProfile?._id ?? primaryProfile?.id;

  const { data, isLoading, error, refetch } = useUserProperties(profileId);
  const { deleteProperty, loading: isDeleting } = useDeleteProperty();

  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);

  const properties = useMemo<Property[]>(
    () => data?.properties ?? [],
    [data?.properties],
  );

  const handleCreateProperty = useCallback(() => {
    router.push('/properties/create');
  }, [router]);

  const handlePropertyPress = useCallback(
    (property: Property) => {
      router.push(`/properties/${property._id || property.id}`);
    },
    [router],
  );

  const handleEditProperty = useCallback(
    (propertyId: string) => {
      router.push(`/properties/create?id=${propertyId}`);
    },
    [router],
  );

  const handleConfirmDelete = useCallback(async () => {
    if (!deleteTarget) return;
    try {
      await deleteProperty(deleteTarget.id);
      await refetch();
    } catch (deleteError: unknown) {
      logger.error('Failed to delete property:', deleteError);
    } finally {
      setDeleteTarget(null);
    }
  }, [deleteTarget, deleteProperty, refetch]);

  const renderFooter = useCallback(
    (property: Property) => {
      const propertyId = (property._id || property.id) as string;
      const title = generatePropertyTitle({
        type: property.type,
        address: property.address,
        bedrooms: property.bedrooms,
        bathrooms: property.bathrooms,
      });
      return (
        <View style={styles.ownerActions}>
          <Button
            variant="secondary"
            size="small"
            onPress={() => handleEditProperty(propertyId)}
            icon={
              <Ionicons name="create-outline" size={16} color={colors.primaryColor} />
            }
            style={styles.ownerActionButton}
          >
            {t('properties.my.edit')}
          </Button>
          <Button
            variant="secondary"
            size="small"
            onPress={() => setDeleteTarget({ id: propertyId, title })}
            icon={<Ionicons name="trash-outline" size={16} color={colors.danger} />}
            textStyle={styles.deleteText}
            style={styles.ownerActionButton}
          >
            {t('properties.my.delete')}
          </Button>
        </View>
      );
    },
    [t, handleEditProperty],
  );

  const body = (() => {
    if (isLoading && properties.length === 0) {
      return (
        <PropertyResultsGridSkeleton
          count={SKELETON_COUNT}
          columns={GRID_COLUMNS}
          style={styles.gridPadding}
        />
      );
    }
    if (error) {
      return (
        <ErrorState
          title={t('properties.my.errorTitle')}
          description={t('properties.my.errorDescription')}
          retryLabel={t('common.retry')}
          onRetry={() => void refetch()}
        />
      );
    }
    if (properties.length === 0) {
      return (
        <EmptyState
          icon="home-outline"
          title={t('properties.my.emptyTitle')}
          description={t('properties.my.emptyDescription')}
          actionText={t('properties.my.createFirst')}
          actionIcon="add"
          onAction={handleCreateProperty}
        />
      );
    }
    return (
      <PropertyResultsGrid
        properties={properties}
        onPropertyPress={handlePropertyPress}
        columns={GRID_COLUMNS}
        style={styles.gridPadding}
        renderFooter={renderFooter}
      />
    );
  })();

  return (
    <View style={styles.container}>
      <PropertyListHeader
        title={t('properties.my.title')}
        right={
          <Button
            variant="primary"
            size="small"
            onPress={handleCreateProperty}
            icon={<Ionicons name="add" size={18} color={colors.white} />}
            accessibilityLabel={t('properties.my.createFirst')}
          >
            {t('common.add')}
          </Button>
        }
      />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {body}
      </ScrollView>
      <ConfirmDialog
        visible={deleteTarget !== null}
        title={t('properties.my.deleteTitle')}
        message={t('properties.my.deleteMessage', { title: deleteTarget?.title ?? '' })}
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        confirmDestructive
        loading={isDeleting}
        onConfirm={() => void handleConfirmDelete()}
        onCancel={() => setDeleteTarget(null)}
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
    paddingTop: spacing.lg,
    paddingBottom: spacing['4xl'],
    maxWidth: contentClamp.page,
    width: '100%',
    alignSelf: 'center',
  },
  gridPadding: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
  },
  ownerActions: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  ownerActionButton: {
    flex: 1,
  },
  deleteText: {
    color: colors.danger,
  },
});
