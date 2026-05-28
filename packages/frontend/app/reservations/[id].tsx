import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Modal,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { Button } from '@oxyhq/bloom/button';
import { Text as BloomText, H3 } from '@oxyhq/bloom/typography';
import {
  CancellationPolicy,
  Reservation,
  ReservationStatus,
} from '@homiio/shared-types';
import { Header } from '@/components/Header';
import { useProperty } from '@/hooks';
import { useProfile } from '@/context/ProfileContext';
import {
  useReservationQuery,
  useUpdateReservation,
} from '@/hooks/useReservationQueries';
import { PriceBreakdown } from '@/components/PriceBreakdown';
import { ReservationStatusBadge } from '@/components/ReservationStatusBadge';
import {
  getPropertyImageSource,
  getPropertyTitle,
} from '@/utils/propertyUtils';
import { colors } from '@/styles/colors';

const hoursUntil = (when: Date): number => {
  const now = Date.now();
  return (when.getTime() - now) / (1000 * 60 * 60);
};

/**
 * Mirror of backend `canGuestCancel`. Backend remains the source of truth;
 * this is a UI preview to avoid surfacing a button that will always fail.
 */
const canGuestCancelPreview = (reservation: Reservation): boolean => {
  if (reservation.status === ReservationStatus.PENDING) return true;
  if (reservation.status !== ReservationStatus.CONFIRMED) return false;
  const remaining = hoursUntil(new Date(reservation.checkIn));
  switch (reservation.cancellationPolicy) {
    case CancellationPolicy.FLEXIBLE:
      return remaining > 0;
    case CancellationPolicy.MODERATE:
      return remaining >= 24 * 5;
    case CancellationPolicy.STRICT:
      return remaining >= 24 * 7;
    case CancellationPolicy.SUPER_STRICT:
      return remaining >= 24 * 30;
    default:
      return remaining > 0;
  }
};

interface ConfirmDialogProps {
  visible: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  confirmDestructive?: boolean;
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  visible,
  title,
  message,
  confirmLabel,
  confirmDestructive,
  loading,
  onConfirm,
  onCancel,
}) => (
  <Modal
    visible={visible}
    transparent
    animationType="fade"
    onRequestClose={onCancel}
  >
    <View style={styles.modalBackdrop}>
      <View style={styles.modalCard}>
        <H3 style={styles.modalTitle}>{title}</H3>
        <BloomText style={styles.modalBody}>{message}</BloomText>
        <View style={styles.modalActions}>
          <Button variant="ghost" size="medium" onPress={onCancel} disabled={loading}>
            Cancel
          </Button>
          <Button
            variant="primary"
            size="medium"
            onPress={onConfirm}
            loading={loading}
            disabled={loading}
            style={confirmDestructive ? styles.destructiveButton : undefined}
          >
            {confirmLabel}
          </Button>
        </View>
      </View>
    </View>
  </Modal>
);

export default function ReservationDetailScreen() {
  const params = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const id = typeof params.id === 'string' ? params.id : params.id?.[0];
  const reservationQuery = useReservationQuery(id);
  const updateMutation = useUpdateReservation(id ?? '');
  const { primaryProfile } = useProfile();

  const reservation = reservationQuery.data;
  const { property } = useProperty(reservation?.propertyId ?? '');

  const [pendingAction, setPendingAction] = useState<
    'cancel' | 'confirm' | 'decline' | null
  >(null);

  const role = useMemo<'guest' | 'host' | null>(() => {
    if (!reservation || !primaryProfile) return null;
    const profileId = primaryProfile._id ?? primaryProfile.id;
    if (!profileId) return null;
    if (String(reservation.hostProfileId) === String(profileId)) return 'host';
    if (String(reservation.guestProfileId) === String(profileId)) return 'guest';
    return null;
  }, [reservation, primaryProfile]);

  const handleAction = useCallback(
    async (target: ReservationStatus) => {
      if (!id) return;
      try {
        await updateMutation.mutateAsync({ status: target });
        const verb =
          target === ReservationStatus.CONFIRMED
            ? 'confirmed'
            : target === ReservationStatus.DECLINED
              ? 'declined'
              : 'cancelled';
        toast.success(`Reservation ${verb}`);
        setPendingAction(null);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Update failed';
        toast.error(message);
        setPendingAction(null);
      }
    },
    [id, updateMutation],
  );

  if (!id) {
    return (
      <View style={styles.errorView}>
        <BloomText>Invalid reservation id.</BloomText>
      </View>
    );
  }

  if (reservationQuery.isPending) {
    return (
      <View style={styles.loadingView}>
        <ActivityIndicator color={colors.primaryColor} />
      </View>
    );
  }

  if (reservationQuery.isError || !reservation) {
    return (
      <View style={styles.errorView}>
        <BloomText style={styles.errorTitle}>Reservation unavailable</BloomText>
        <BloomText style={styles.errorSubtitle}>
          {reservationQuery.error?.message ?? 'This reservation could not be loaded.'}
        </BloomText>
        <Button variant="primary" size="medium" onPress={() => router.back()}>
          Go back
        </Button>
      </View>
    );
  }

  const propertyTitle = property ? getPropertyTitle(property) : 'Property';
  const imageSource = property ? getPropertyImageSource(property) : null;
  const showGuestCancel =
    role === 'guest' &&
    (reservation.status === ReservationStatus.PENDING ||
      reservation.status === ReservationStatus.CONFIRMED) &&
    canGuestCancelPreview(reservation);
  const showHostCancel =
    role === 'host' &&
    (reservation.status === ReservationStatus.PENDING ||
      reservation.status === ReservationStatus.CONFIRMED);
  const showHostApproveDecline =
    role === 'host' && reservation.status === ReservationStatus.PENDING;

  return (
    <View style={styles.root}>
      <Header
        options={{
          showBackButton: true,
          title: 'Reservation',
          titlePosition: 'center',
        }}
      />
      <SafeAreaView edges={['bottom']} style={styles.safeArea}>
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.thumbWrap}>
            {imageSource ? (
              <Image source={imageSource} style={styles.thumb} resizeMode="cover" />
            ) : (
              <View style={[styles.thumb, styles.thumbPlaceholder]} />
            )}
          </View>
          <View style={styles.section}>
            <View style={styles.headerRow}>
              <H3 style={styles.title}>{propertyTitle}</H3>
              <ReservationStatusBadge status={reservation.status} />
            </View>
            {property?.address ? (
              <BloomText style={styles.subtitle}>
                {[property.address.city, property.address.country]
                  .filter(Boolean)
                  .join(', ')}
              </BloomText>
            ) : null}
          </View>

          <View style={styles.section}>
            <BloomText style={styles.sectionLabel}>Trip details</BloomText>
            <View style={styles.detailRow}>
              <BloomText style={styles.detailLabel}>Check-in</BloomText>
              <BloomText style={styles.detailValue}>
                {format(new Date(reservation.checkIn), 'EEE, MMM d, yyyy')}
              </BloomText>
            </View>
            <View style={styles.detailRow}>
              <BloomText style={styles.detailLabel}>Check-out</BloomText>
              <BloomText style={styles.detailValue}>
                {format(new Date(reservation.checkOut), 'EEE, MMM d, yyyy')}
              </BloomText>
            </View>
            <View style={styles.detailRow}>
              <BloomText style={styles.detailLabel}>Guests</BloomText>
              <BloomText style={styles.detailValue}>
                {reservation.guestCount}{' '}
                {reservation.guestCount === 1 ? 'guest' : 'guests'}
              </BloomText>
            </View>
            <View style={styles.detailRow}>
              <BloomText style={styles.detailLabel}>Nights</BloomText>
              <BloomText style={styles.detailValue}>{reservation.nights}</BloomText>
            </View>
          </View>

          <View style={styles.section}>
            <BloomText style={styles.sectionLabel}>Price</BloomText>
            <PriceBreakdown
              nights={reservation.nights}
              nightlyRate={reservation.nightlyRate}
              cleaningFee={reservation.cleaningFee}
              serviceFee={reservation.serviceFee}
              taxesPercent={
                reservation.taxes && reservation.subtotal > 0
                  ? Math.round(
                      (reservation.taxes /
                        (reservation.subtotal +
                          (reservation.cleaningFee ?? 0) +
                          (reservation.serviceFee ?? 0))) *
                        10000,
                    ) / 100
                  : 0
              }
              currency={reservation.currency}
            />
          </View>

          <View style={styles.actionRow}>
            {showHostApproveDecline ? (
              <>
                <Button
                  variant="primary"
                  size="medium"
                  onPress={() => setPendingAction('confirm')}
                  disabled={updateMutation.isPending}
                  style={styles.actionButton}
                >
                  Approve
                </Button>
                <Button
                  variant="secondary"
                  size="medium"
                  onPress={() => setPendingAction('decline')}
                  disabled={updateMutation.isPending}
                  style={styles.actionButton}
                >
                  Decline
                </Button>
              </>
            ) : null}
            {showGuestCancel || showHostCancel ? (
              <Button
                variant="ghost"
                size="medium"
                onPress={() => setPendingAction('cancel')}
                disabled={updateMutation.isPending}
                style={styles.actionButton}
              >
                Cancel reservation
              </Button>
            ) : null}
          </View>

          {role === 'guest' &&
          reservation.status === ReservationStatus.CONFIRMED &&
          !showGuestCancel ? (
            <BloomText style={styles.policyNote}>
              Cancellation is no longer possible under the
              {' '}
              {reservation.cancellationPolicy.replace('_', ' ')}
              {' '}
              policy. Contact your host if you need to make changes.
            </BloomText>
          ) : null}
        </ScrollView>

        <ConfirmDialog
          visible={pendingAction === 'cancel'}
          title="Cancel reservation?"
          message="This will release the dates back to the host and end the booking."
          confirmLabel="Yes, cancel"
          confirmDestructive
          loading={updateMutation.isPending}
          onConfirm={() => handleAction(ReservationStatus.CANCELLED)}
          onCancel={() => setPendingAction(null)}
        />
        <ConfirmDialog
          visible={pendingAction === 'confirm'}
          title="Approve reservation?"
          message="The guest will be notified and the dates will be marked confirmed on your calendar."
          confirmLabel="Approve"
          loading={updateMutation.isPending}
          onConfirm={() => handleAction(ReservationStatus.CONFIRMED)}
          onCancel={() => setPendingAction(null)}
        />
        <ConfirmDialog
          visible={pendingAction === 'decline'}
          title="Decline reservation?"
          message="The guest will be notified that this request was declined."
          confirmLabel="Decline"
          confirmDestructive
          loading={updateMutation.isPending}
          onConfirm={() => handleAction(ReservationStatus.DECLINED)}
          onCancel={() => setPendingAction(null)}
        />
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
  loadingView: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorView: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
    gap: 12,
  },
  errorTitle: {
    fontSize: 18,
    fontWeight: '700',
  },
  errorSubtitle: {
    fontSize: 13,
    color: colors.COLOR_BLACK_LIGHT_3,
    textAlign: 'center',
  },
  thumbWrap: {
    width: '100%',
    aspectRatio: 16 / 9,
    borderRadius: 12,
    overflow: 'hidden',
    backgroundColor: colors.COLOR_BLACK_LIGHT_7,
  },
  thumb: {
    width: '100%',
    height: '100%',
  },
  thumbPlaceholder: {
    backgroundColor: colors.COLOR_BLACK_LIGHT_7,
  },
  section: {
    gap: 8,
    paddingVertical: 8,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    flex: 1,
  },
  subtitle: {
    fontSize: 13,
    color: colors.COLOR_BLACK_LIGHT_3,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    color: colors.COLOR_BLACK_LIGHT_3,
    letterSpacing: 0.5,
    marginBottom: 4,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.COLOR_BLACK_LIGHT_6,
  },
  detailLabel: {
    fontSize: 13,
    color: colors.COLOR_BLACK_LIGHT_4,
  },
  detailValue: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.COLOR_BLACK,
  },
  actionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  actionButton: {
    flex: 1,
    minWidth: 120,
  },
  policyNote: {
    fontSize: 12,
    color: colors.COLOR_BLACK_LIGHT_4,
    fontStyle: 'italic',
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
    lineHeight: 20,
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
    marginTop: 8,
  },
  destructiveButton: {
    backgroundColor: '#dc2626',
  },
});
