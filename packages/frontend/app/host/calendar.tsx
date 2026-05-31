/**
 * Host calendar — date-based availability view per property.
 *
 * Stream Q polish (Airbnb-2026):
 *   - Bloom primitives only (Typography, Button, Chip, Menu, Skeleton, Loading).
 *   - Property picker uses Bloom Menu (dropdown) instead of a horizontal chip row.
 *   - Cards rendered on white surfaces with `withShadow('sm')`, `radius.lg`.
 *   - All copy lives in Bloom Typography, no raw RN <Text>.
 *   - Block-dates flow now reuses ConfirmDialog + Bloom TextField.
 */
import React, { useCallback, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { format } from 'date-fns';
import { toast } from '@/lib/sonner';
import { useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { Button } from '@oxyhq/bloom/button';
import { Loading } from '@oxyhq/bloom/loading';
import * as Menu from '@oxyhq/bloom/menu';
import * as Skeleton from '@oxyhq/bloom/skeleton';
import * as TextField from '@oxyhq/bloom/text-field';
import { Text as BloomText, H2 } from '@oxyhq/bloom/typography';
import { useOxy, showSignInModal } from '@oxyhq/services';
import {
  AvailabilityWindow,
  AvailabilityWindowStatus,
  Property,
  Reservation,
  ReservationStatus,
} from '@homiio/shared-types';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Header } from '@/components/Header';
import { HostCalendarGrid, HostCalendarSelection } from '@/components/HostCalendarGrid';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { SectionEyebrow } from '@/components/ui/SectionEyebrow';
import { useProfile } from '@/context/ProfileContext';
import {
  reservationKeys,
  usePropertyAvailabilityQuery,
  useReservationsQuery,
} from '@/hooks/useReservationQueries';
import { useUserProperties } from '@/hooks/usePropertyQueries';
import { propertyService } from '@/services/propertyService';
import { getPropertyTitle } from '@/utils/propertyUtils';
import { radius, spacing, withShadow } from '@/constants/styles';
import { colors } from '@/styles/colors';

interface BlockDialogState {
  visible: boolean;
  start: Date | null;
  end: Date | null;
  reason: string;
}

const INITIAL_BLOCK_STATE: BlockDialogState = {
  visible: false,
  start: null,
  end: null,
  reason: '',
};

const HOST_CALENDAR_TITLE = 'Host calendar';

export default function HostCalendarScreen() {
  const router = useRouter();
  const { oxyServices, activeSessionId } = useOxy();
  const isAuthed = Boolean(oxyServices && activeSessionId);
  const { primaryProfile } = useProfile();
  const profileId = primaryProfile?._id ?? primaryProfile?.id;

  const propertiesQuery = useUserProperties(profileId);
  const properties = propertiesQuery.data?.properties ?? [];
  const [selectedPropertyId, setSelectedPropertyId] = useState<string | null>(
    null,
  );

  const effectivePropertyId = useMemo(() => {
    if (selectedPropertyId) return selectedPropertyId;
    const first = properties[0];
    if (!first) return null;
    return first._id ?? first.id ?? null;
  }, [properties, selectedPropertyId]);

  const selectedProperty = useMemo<Property | null>(() => {
    if (!effectivePropertyId) return null;
    return (
      properties.find(
        (item) => (item._id ?? item.id) === effectivePropertyId,
      ) ?? null
    );
  }, [effectivePropertyId, properties]);

  const availabilityQuery = usePropertyAvailabilityQuery(
    effectivePropertyId ?? undefined,
  );
  const hostReservationsQuery = useReservationsQuery(
    { asHost: true, limit: 100 },
    { enabled: isAuthed },
  );

  const reservationsForProperty = useMemo<Reservation[]>(() => {
    if (!effectivePropertyId) return [];
    return (
      hostReservationsQuery.data?.items.filter(
        (item) =>
          item.propertyId === effectivePropertyId &&
          (item.status === ReservationStatus.PENDING ||
            item.status === ReservationStatus.CONFIRMED),
      ) ?? []
    );
  }, [effectivePropertyId, hostReservationsQuery.data?.items]);

  const queryClient = useQueryClient();
  const [blockState, setBlockState] = useState<BlockDialogState>(
    INITIAL_BLOCK_STATE,
  );
  const [submitting, setSubmitting] = useState(false);

  const handleSelectRange = useCallback((range: HostCalendarSelection) => {
    setBlockState({
      visible: true,
      start: range.start,
      end: range.end,
      reason: '',
    });
  }, []);

  const closeDialog = useCallback(() => {
    setBlockState(INITIAL_BLOCK_STATE);
  }, []);

  const handleConfirmBlock = useCallback(async () => {
    if (!effectivePropertyId || !blockState.start || !blockState.end) {
      closeDialog();
      return;
    }
    setSubmitting(true);
    try {
      const property = await propertyService.getPropertyById(effectivePropertyId);
      if (!property) {
        throw new Error('Property not found');
      }
      const next: AvailabilityWindow = {
        start: blockState.start.toISOString(),
        end: blockState.end.toISOString(),
        status: AvailabilityWindowStatus.BLOCKED,
      };
      const merged: AvailabilityWindow[] = [
        ...(property.availabilityWindows ?? []),
        next,
      ];
      await propertyService.updateProperty(effectivePropertyId, {
        availabilityWindows: merged,
      });
      queryClient.invalidateQueries({
        queryKey: reservationKeys.availability(effectivePropertyId),
      });
      toast.success('Dates blocked');
      closeDialog();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Block failed';
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  }, [
    blockState.end,
    blockState.start,
    closeDialog,
    effectivePropertyId,
    queryClient,
  ]);

  if (!isAuthed) {
    return (
      <View style={styles.root}>
        <Header
          options={{
            showBackButton: true,
            title: HOST_CALENDAR_TITLE,
            titlePosition: 'center',
          }}
        />
        <SafeAreaView edges={['bottom']} style={styles.safeArea}>
          <View style={styles.emptyWrap}>
            <EmptyState
              icon="calendar-outline"
              title="Sign in to manage your calendar"
              description="Block dates and track bookings from one place."
              actionText="Sign in"
              actionIcon="log-in-outline"
              onAction={() => showSignInModal()}
            />
          </View>
        </SafeAreaView>
      </View>
    );
  }

  if (propertiesQuery.isLoading) {
    return (
      <View style={styles.root}>
        <Header
          options={{
            showBackButton: true,
            title: HOST_CALENDAR_TITLE,
            titlePosition: 'center',
          }}
        />
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.skeletonHeader}>
            <Skeleton.Text style={{ width: 120, lineHeight: 14 }} />
            <Skeleton.Box height={48} borderRadius={radius.md} />
          </View>
          <View style={styles.skeletonHeader}>
            <Skeleton.Text style={{ width: 200, lineHeight: 28 }} />
            <Skeleton.Text style={{ width: 160, lineHeight: 16 }} />
          </View>
          <Skeleton.Box height={320} borderRadius={radius.lg} />
        </ScrollView>
      </View>
    );
  }

  if (propertiesQuery.error) {
    return (
      <View style={styles.root}>
        <Header
          options={{
            showBackButton: true,
            title: HOST_CALENDAR_TITLE,
            titlePosition: 'center',
          }}
        />
        <SafeAreaView edges={['bottom']} style={styles.safeArea}>
          <ErrorState
            icon="cloud-offline-outline"
            title="Couldn't load your properties"
            description={
              typeof propertiesQuery.error === 'string'
                ? propertiesQuery.error
                : 'Please try again.'
            }
            onRetry={() => propertiesQuery.refetch()}
          />
        </SafeAreaView>
      </View>
    );
  }

  if (properties.length === 0) {
    return (
      <View style={styles.root}>
        <Header
          options={{
            showBackButton: true,
            title: HOST_CALENDAR_TITLE,
            titlePosition: 'center',
          }}
        />
        <SafeAreaView edges={['bottom']} style={styles.safeArea}>
          <View style={styles.emptyWrap}>
            <EmptyState
              icon="home-outline"
              title="Add your first property"
              description="List a place so guests can request dates here."
              actionText="Create listing"
              actionIcon="add"
              onAction={() => router.push('/properties/create')}
            />
          </View>
        </SafeAreaView>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <Header
        options={{
          showBackButton: true,
          title: HOST_CALENDAR_TITLE,
          titlePosition: 'center',
        }}
      />
      <SafeAreaView edges={['bottom']} style={styles.safeArea}>
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.pickerCard}>
            <SectionEyebrow>Property</SectionEyebrow>
            <Menu.Root>
              <Menu.Trigger label="Choose property">
                {({ props: triggerProps }) => (
                  <Button
                    onPress={triggerProps.onPress}
                    accessibilityLabel={triggerProps.accessibilityLabel}
                    accessibilityHint={triggerProps.accessibilityHint}
                    variant="secondary"
                    size="large"
                    style={styles.pickerButton}
                    icon={
                      <Ionicons
                        name="chevron-down"
                        size={18}
                        color={colors.COLOR_BLACK}
                      />
                    }
                    iconPosition="right"
                  >
                    {selectedProperty
                      ? getPropertyTitle(selectedProperty)
                      : 'Choose property'}
                  </Button>
                )}
              </Menu.Trigger>
              <Menu.Outer>
                <Menu.Group>
                  {properties.map((property) => {
                    const id = property._id ?? property.id ?? '';
                    return (
                      <Menu.Item
                        key={id}
                        label={getPropertyTitle(property)}
                        onPress={() => setSelectedPropertyId(id)}
                      >
                        <Menu.ItemText>{getPropertyTitle(property)}</Menu.ItemText>
                      </Menu.Item>
                    );
                  })}
                </Menu.Group>
              </Menu.Outer>
            </Menu.Root>
          </View>

          {selectedProperty ? (
            <>
              <View style={styles.titleBlock}>
                <H2 style={styles.title}>{getPropertyTitle(selectedProperty)}</H2>
                {selectedProperty.address ? (
                  <BloomText style={styles.subtitle}>
                    {[selectedProperty.address.city, selectedProperty.address.country]
                      .filter(Boolean)
                      .join(', ')}
                  </BloomText>
                ) : null}
              </View>

              <View style={styles.legendRow}>
                <LegendChip color={colors.successSubtle} dot={colors.success} label="Confirmed" />
                <LegendChip color={colors.warningSubtle} dot={colors.warning} label="Pending" />
                <LegendChip color={colors.blockedSubtle} dot={colors.danger} label="Blocked" />
                <LegendChip color={colors.mutedSubtle} dot={colors.COLOR_BLACK_LIGHT_4} label="Available" />
              </View>

              <View style={styles.calendarCard}>
                {availabilityQuery.isLoading ? (
                  <View style={styles.loadingWrap}>
                    <Loading variant="spinner" />
                  </View>
                ) : availabilityQuery.isError ? (
                  <ErrorState
                    icon="cloud-offline-outline"
                    title="Couldn't load availability"
                    description={
                      availabilityQuery.error?.message ?? 'Please try again.'
                    }
                    onRetry={() => availabilityQuery.refetch()}
                  />
                ) : (
                  <HostCalendarGrid
                    windows={availabilityQuery.data?.windows}
                    reservations={reservationsForProperty}
                    onSelectRange={handleSelectRange}
                    onPressReservation={(reservationId) =>
                      router.push(`/reservations/${reservationId}`)
                    }
                  />
                )}
              </View>
            </>
          ) : null}
        </ScrollView>

        <ConfirmDialog
          visible={blockState.visible}
          title="Block these dates"
          message={
            blockState.start && blockState.end
              ? `${format(blockState.start, 'EEE, MMM d')} → ${format(
                  new Date(blockState.end.getTime() - 24 * 60 * 60 * 1000),
                  'EEE, MMM d, yyyy',
                )}`
              : 'Choose how long these dates are unavailable.'
          }
          confirmLabel="Block"
          loading={submitting}
          onConfirm={handleConfirmBlock}
          onCancel={closeDialog}
        >
          <TextField.Input
            label="Reason (optional)"
            value={blockState.reason}
            onChangeText={(reason) =>
              setBlockState((state) => ({ ...state, reason }))
            }
            editable={!submitting}
            placeholder="Maintenance, personal use, ..."
          />
        </ConfirmDialog>
      </SafeAreaView>
    </View>
  );
}

interface LegendChipProps {
  color: string;
  dot: string;
  label: string;
}

const LegendChip: React.FC<LegendChipProps> = ({ color, dot, label }) => (
  <View style={[styles.legendChip, { backgroundColor: color }]}>
    <View style={[styles.legendDot, { backgroundColor: dot }]} />
    <BloomText style={styles.legendLabel}>{label}</BloomText>
  </View>
);

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  safeArea: {
    flex: 1,
  },
  content: {
    padding: spacing.lg,
    gap: spacing['2xl'],
  },
  skeletonHeader: {
    gap: spacing.sm,
  },
  loadingWrap: {
    padding: spacing['2xl'],
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyWrap: {
    flex: 1,
    justifyContent: 'center',
  },
  pickerCard: {
    gap: spacing.sm,
    backgroundColor: colors.surfaceElevated,
    padding: spacing.lg,
    borderRadius: radius.lg,
    ...withShadow('sm'),
  },
  pickerButton: {
    justifyContent: 'space-between',
    alignSelf: 'stretch',
  },
  titleBlock: {
    gap: spacing.xs,
  },
  title: {
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: 14,
    color: colors.muted,
  },
  legendRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  legendChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
  },
  legendDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  legendLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.COLOR_BLACK_LIGHT_2,
  },
  calendarCard: {
    backgroundColor: colors.surfaceElevated,
    padding: spacing.lg,
    borderRadius: radius.lg,
    ...withShadow('sm'),
  },
});
