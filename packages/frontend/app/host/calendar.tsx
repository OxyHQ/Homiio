import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@oxyhq/bloom/button';
import { Chip } from '@oxyhq/bloom/chip';
import { Text as BloomText, H3 } from '@oxyhq/bloom/typography';
import { useOxy, showSignInModal } from '@oxyhq/services';
import {
  AvailabilityWindow,
  AvailabilityWindowStatus,
  Property,
  Reservation,
  ReservationStatus,
} from '@homiio/shared-types';
import { Header } from '@/components/Header';
import { HostCalendarGrid, HostCalendarSelection } from '@/components/HostCalendarGrid';
import { EmptyState } from '@/components/ui/EmptyState';
import { useProfile } from '@/context/ProfileContext';
import {
  reservationKeys,
  usePropertyAvailabilityQuery,
  useReservationsQuery,
} from '@/hooks/useReservationQueries';
import { useUserProperties } from '@/hooks/usePropertyQueries';
import { propertyService } from '@/services/propertyService';
import { getPropertyTitle } from '@/utils/propertyUtils';
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
            title: 'Host calendar',
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
            title: 'Host calendar',
            titlePosition: 'center',
          }}
        />
        <View style={styles.loadingWrap}>
          <ActivityIndicator color={colors.primaryColor} />
        </View>
      </View>
    );
  }

  if (properties.length === 0) {
    return (
      <View style={styles.root}>
        <Header
          options={{
            showBackButton: true,
            title: 'Host calendar',
            titlePosition: 'center',
          }}
        />
        <SafeAreaView edges={['bottom']} style={styles.safeArea}>
          <View style={styles.emptyWrap}>
            <EmptyState
              icon="home-outline"
              title="No hosted properties"
              description="List a property to start receiving bookings."
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
          title: 'Host calendar',
          titlePosition: 'center',
        }}
      />
      <SafeAreaView edges={['bottom']} style={styles.safeArea}>
        <ScrollView contentContainerStyle={styles.content}>
          <View>
            <BloomText style={styles.sectionLabel}>Property</BloomText>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.chipsRow}
            >
              {properties.map((property) => {
                const id = property._id ?? property.id ?? '';
                const isActive = id === effectivePropertyId;
                return (
                  <Chip
                    key={id}
                    onPress={() => setSelectedPropertyId(id)}
                    variant={isActive ? 'solid' : 'outlined'}
                    color={isActive ? 'primary' : 'default'}
                    selected={isActive}
                  >
                    {getPropertyTitle(property)}
                  </Chip>
                );
              })}
            </ScrollView>
          </View>

          {selectedProperty ? (
            <>
              <View>
                <H3 style={styles.title}>{getPropertyTitle(selectedProperty)}</H3>
                {selectedProperty.address ? (
                  <BloomText style={styles.subtitle}>
                    {[selectedProperty.address.city, selectedProperty.address.country]
                      .filter(Boolean)
                      .join(', ')}
                  </BloomText>
                ) : null}
              </View>

              {availabilityQuery.isLoading ? (
                <View style={styles.loadingWrap}>
                  <ActivityIndicator color={colors.primaryColor} />
                </View>
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
            </>
          ) : null}
        </ScrollView>

        <Modal
          visible={blockState.visible}
          transparent
          animationType="fade"
          onRequestClose={closeDialog}
        >
          <View style={styles.modalBackdrop}>
            <View style={styles.modalCard}>
              <H3 style={styles.modalTitle}>Block these dates</H3>
              {blockState.start && blockState.end ? (
                <BloomText style={styles.modalBody}>
                  {format(blockState.start, 'EEE, MMM d')}
                  {' → '}
                  {format(
                    new Date(blockState.end.getTime() - 24 * 60 * 60 * 1000),
                    'EEE, MMM d, yyyy',
                  )}
                </BloomText>
              ) : null}
              <TextInput
                value={blockState.reason}
                onChangeText={(reason) =>
                  setBlockState((state) => ({ ...state, reason }))
                }
                placeholder="Reason (optional)"
                style={styles.input}
                editable={!submitting}
                placeholderTextColor={colors.COLOR_BLACK_LIGHT_4}
              />
              <View style={styles.modalActions}>
                <Button
                  variant="ghost"
                  size="medium"
                  onPress={closeDialog}
                  disabled={submitting}
                >
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  size="medium"
                  onPress={handleConfirmBlock}
                  loading={submitting}
                  disabled={submitting}
                >
                  Block
                </Button>
              </View>
            </View>
          </View>
        </Modal>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.primaryLight,
  },
  safeArea: {
    flex: 1,
  },
  content: {
    padding: 16,
    gap: 16,
  },
  loadingWrap: {
    padding: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyWrap: {
    flex: 1,
    justifyContent: 'center',
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    color: colors.COLOR_BLACK_LIGHT_3,
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  chipsRow: {
    flexDirection: 'row',
    gap: 8,
    paddingVertical: 4,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
  },
  subtitle: {
    fontSize: 13,
    color: colors.COLOR_BLACK_LIGHT_3,
    marginTop: 4,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 16,
  },
  modalCard: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 20,
    gap: 12,
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: '700',
  },
  modalBody: {
    fontSize: 14,
    color: colors.COLOR_BLACK_LIGHT_3,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.COLOR_BLACK_LIGHT_6,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    color: colors.COLOR_BLACK,
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
    marginTop: 8,
  },
});
