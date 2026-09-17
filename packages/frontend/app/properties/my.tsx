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
 * Bloom `confirm()` surface (the RN `Alert` it replaced is a no-op on web).
 */
import React, { useCallback, useMemo } from 'react';
import { Platform, ScrollView, StyleSheet, View, type ViewStyle } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useRouter } from 'expo-router';

import { Button } from '@oxy.so/bloom/button';
import { RiAddLine, RiCheckboxCircleLine, RiDeleteBinLine, RiEditLine } from '@oxy.so/bloom/icons';
import { useTheme } from '@oxy.so/bloom/theme';

import { PropertyListHeader } from '@/components/ui/PropertyListHeader';
import { PropertyResultsGrid } from '@/components/ui/PropertyResultsGrid';
import { PropertyResultsGridSkeleton } from '@/components/ui/PropertyResultsGridSkeleton';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { confirm } from '@oxy.so/bloom/surfaces';
import { useUserProperties, useDeleteProperty } from '@/hooks/usePropertyQueries';
import { useMarkPropertyTransacted } from '@/hooks/usePartner';
import { generatePropertyTitle } from '@/utils/propertyTitleGenerator';
import { toast } from '@oxy.so/bloom/toast';
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
  const theme = useTheme();
  const router = useRouter();
  const { data, isLoading, error, refetch } = useUserProperties();
  const { deleteProperty } = useDeleteProperty();
  const markTransacted = useMarkPropertyTransacted();


  const properties = useMemo<Property[]>(
    () => data?.properties ?? [],
    [data?.properties],
  );

  const handleCreateProperty = useCallback(() => {
    router.push('/properties/create');
  }, [router]);

  const handlePropertyPress = useCallback(
    (property: Property) => {
      router.push(`/properties/${property.id}`);
    },
    [router],
  );

  const handleEditProperty = useCallback(
    (propertyId: string) => {
      router.push(`/properties/create?id=${propertyId}`);
    },
    [router],
  );

  const handleDelete = useCallback(async (deleteTarget: DeleteTarget) => {
    const ok = await confirm({
      title: t('properties.my.deleteTitle'),
      description: t('properties.my.deleteMessage', { title: deleteTarget.title }),
      confirmLabel: t('common.delete'),
      cancelLabel: t('common.cancel'),
      destructive: true,
    });
    if (!ok) return;
    try {
      await deleteProperty(deleteTarget.id);
      await refetch();
    } catch (deleteError: unknown) {
      logger.error('Failed to delete property:', deleteError);
    }
  }, [deleteProperty, refetch, t]);

  const handleTransact = useCallback(async (transactTarget: TransactTarget) => {
    const sold = transactTarget.status === PropertyStatus.SOLD;
    const ok = await confirm({
      title: sold ? t('properties.my.markSoldTitle') : t('properties.my.markRentedTitle'),
      description: t('properties.my.transactMessage', { title: transactTarget.title }),
      confirmLabel: sold ? t('properties.my.markSold') : t('properties.my.markRented'),
      cancelLabel: t('common.cancel'),
    });
    if (!ok) return;
    try {
      const result = await markTransacted.mutateAsync({
        propertyId: transactTarget.id,
        status: transactTarget.status,
      });
      await refetch();
      if (result.commission) {
        toast.success(
          t('properties.my.transactCommission'),
        );
      } else {
        toast.success(t('properties.my.transactDone'));
      }
    } catch (transactError: unknown) {
      logger.error('Failed to mark property transacted:', transactError);
      toast.error(t('properties.my.transactError'));
    }
  }, [markTransacted, refetch, t]);

  const renderFooter = useCallback(
    (property: Property) => {
      const propertyId = property.id as string;
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
                void handleTransact({ id: propertyId, title, status: closeStatus })
              }
              leadingIcon={RiCheckboxCircleLine}
              style={styles.ownerActionButton}
            >
              {closeStatus === PropertyStatus.SOLD
                ? t('properties.my.markSold')
                : t('properties.my.markRented')}
            </Button>
          ) : null}
          <View style={styles.ownerActions}>
            <Button
              variant="secondary"
              size="small"
              onPress={() => handleEditProperty(propertyId)}
              leadingIcon={RiEditLine}
              style={styles.ownerActionButton}
            >
              {t('properties.my.edit')}
            </Button>
            <Button
              variant="secondary"
              size="small"
              onPress={() => void handleDelete({ id: propertyId, title })}
              icon={<RiDeleteBinLine width={16} height={16} fill={theme.colors.negative} />}
              textStyle={{ color: theme.colors.negative }}
              style={styles.ownerActionButton}
            >
              {t('properties.my.delete')}
            </Button>
          </View>
        </View>
      );
    },
    [t, theme.colors.negative, handleEditProperty, handleDelete, handleTransact],
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
            leadingIcon={RiAddLine}
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
});
