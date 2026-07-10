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
import { useMarkPropertyTransacted } from '@/hooks/usePartner';
import { generatePropertyTitle } from '@/utils/propertyTitleGenerator';
import { toast } from '@/lib/sonner';
import { colors } from '@/styles/colors';
import { contentClamp, spacing } from '@/constants/styles';
import { OfferingType, PropertyStatus, type Property } from '@homiio/shared-types';
import { logger } from '@/utils/logger';

/** Number of skeleton cards shown during the first load. */
const SKELETON_COUNT = 4;

/** A pending delete target, carried while the confirm dialog is open. */
interface DeleteTarget {
  id: string;
  title: string;
}

/** A pending close-deal target, carried while the transact confirm is open. */
interface TransactTarget {
  id: string;
  title: string;
  /** Terminal status this listing closes into (sold for sale listings, else rented). */
  status: PropertyStatus;
}

/**
 * Whether an owned listing can still be closed as a deal: only a live
 * (published) listing — drafts, already-closed (rented/sold), reserved and
 * archived listings show no close action.
 */
function canCloseDeal(status: string | undefined): boolean {
  return status === PropertyStatus.PUBLISHED;
}

/**
 * The terminal status a listing closes into: a listing that offers a SALE
 * closes as SOLD, otherwise as RENTED (long/short-term rent, exchange). Mirrors
 * the backend's `defaultTerminalStatus` inference so the confirm copy matches
 * what actually persists.
 */
function terminalStatusFor(offerings: readonly string[] | undefined): PropertyStatus {
  return Array.isArray(offerings) && offerings.includes(OfferingType.SALE)
    ? PropertyStatus.SOLD
    : PropertyStatus.RENTED;
}

export default function MyPropertiesScreen() {
  const { t } = useTranslation();
  const router = useRouter();
  const { primaryProfile } = useProfile();
  const profileId = primaryProfile?._id ?? primaryProfile?.id;

  const { data, isLoading, error, refetch } = useUserProperties(profileId);
  const { deleteProperty, loading: isDeleting } = useDeleteProperty();
  const markTransacted = useMarkPropertyTransacted();

  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [transactTarget, setTransactTarget] = useState<TransactTarget | null>(null);

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

  const handleConfirmTransact = useCallback(async () => {
    if (!transactTarget) return;
    try {
      const result = await markTransacted.mutateAsync({
        propertyId: transactTarget.id,
        status: transactTarget.status,
      });
      await refetch();
      if (result.commission) {
        toast.success(
          t('properties.my.transactCommission', 'Deal closed — commission recorded'),
        );
      } else {
        toast.success(t('properties.my.transactDone', 'Listing marked as closed'));
      }
    } catch (transactError: unknown) {
      logger.error('Failed to mark property transacted:', transactError);
      toast.error(t('properties.my.transactError', 'Could not close this listing'));
    } finally {
      setTransactTarget(null);
    }
  }, [transactTarget, markTransacted, refetch, t]);

  const renderFooter = useCallback(
    (property: Property) => {
      const propertyId = (property._id || property.id) as string;
      const title = generatePropertyTitle({
        type: property.type,
        address: property.address,
        bedrooms: property.bedrooms,
        bathrooms: property.bathrooms,
      });
      const closeStatus = terminalStatusFor(property.offerings);
      return (
        <View style={styles.ownerActionsColumn}>
          {canCloseDeal(property.status) ? (
            <Button
              variant="primary"
              size="small"
              onPress={() =>
                setTransactTarget({ id: propertyId, title, status: closeStatus })
              }
              icon={
                <Ionicons
                  name="checkmark-done-outline"
                  size={16}
                  color={colors.primaryForeground}
                />
              }
              style={styles.ownerActionButton}
            >
              {closeStatus === PropertyStatus.SOLD
                ? t('properties.my.markSold', 'Mark as sold')
                : t('properties.my.markRented', 'Mark as rented')}
            </Button>
          ) : null}
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
            icon={<Ionicons name="add" size={18} color={colors.primaryForeground} />}
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
      <ConfirmDialog
        visible={transactTarget !== null}
        title={
          transactTarget?.status === PropertyStatus.SOLD
            ? t('properties.my.markSoldTitle', 'Mark as sold?')
            : t('properties.my.markRentedTitle', 'Mark as rented?')
        }
        message={t(
          'properties.my.transactMessage',
          'This closes "{{title}}" and removes it from active listings. This cannot be undone.',
          { title: transactTarget?.title ?? '' },
        )}
        confirmLabel={
          transactTarget?.status === PropertyStatus.SOLD
            ? t('properties.my.markSold', 'Mark as sold')
            : t('properties.my.markRented', 'Mark as rented')
        }
        cancelLabel={t('common.cancel')}
        loading={markTransacted.isPending}
        onConfirm={() => void handleConfirmTransact()}
        onCancel={() => setTransactTarget(null)}
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
  ownerActionsColumn: {
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  ownerActions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  ownerActionButton: {
    flex: 1,
  },
  deleteText: {
    color: colors.danger,
  },
});
