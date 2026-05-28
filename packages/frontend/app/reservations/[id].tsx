/**
 * Reservation detail (guest + host view).
 *
 * Stream P polish:
 * - Each section becomes a `CardSurface` with `withShadow('sm')`, no border.
 * - Bloom Loading + ErrorState replace the ad-hoc spinner/error views.
 * - Bloom Button for every CTA; the inline modal was replaced by the
 *   shared `ConfirmDialog` (Modal + Bloom Button).
 * - Bloom typography across the board, semantic color tokens (`colors.surface`,
 *   `colors.muted`) — no more raw hex literals.
 */
import React, { useCallback, useMemo, useState } from 'react';
import {
  Image,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { format } from 'date-fns';
import { toast } from 'sonner';

import { Button } from '@oxyhq/bloom/button';
import { Loading } from '@oxyhq/bloom/loading';
import { Text as BloomText, H2 } from '@oxyhq/bloom/typography';
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
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { CardSurface } from '@/components/ui/CardSurface';
import { ErrorState } from '@/components/ui/ErrorState';
import {
  getPropertyImageSource,
  getPropertyTitle,
} from '@/utils/propertyUtils';
import { colors } from '@/styles/colors';
import { radius, spacing, tracker } from '@/constants/styles';

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

  const header = (
    <Header
      options={{
        showBackButton: true,
        title: 'Reservation',
        titlePosition: 'center',
      }}
    />
  );

  if (!id) {
    return (
      <View style={styles.root}>
        {header}
        <View style={styles.centerWrap}>
          <ErrorState
            icon="warning-outline"
            title="Invalid reservation id"
            description="The link is missing the reservation reference."
            retryLabel="Go back"
            onRetry={() => router.back()}
          />
        </View>
      </View>
    );
  }

  if (reservationQuery.isPending) {
    return (
      <View style={styles.root}>
        {header}
        <View style={styles.centerWrap}>
          <Loading variant="spinner" size="medium" />
        </View>
      </View>
    );
  }

  if (reservationQuery.isError || !reservation) {
    return (
      <View style={styles.root}>
        {header}
        <View style={styles.centerWrap}>
          <ErrorState
            title="Reservation unavailable"
            description={
              reservationQuery.error?.message ?? 'This reservation could not be loaded.'
            }
            retryLabel="Go back"
            onRetry={() => router.back()}
          />
        </View>
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
      {header}
      <SafeAreaView edges={['bottom']} style={styles.safeArea}>
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.thumbWrap}>
            {imageSource ? (
              <Image source={imageSource} style={styles.thumb} resizeMode="cover" />
            ) : (
              <View style={[styles.thumb, styles.thumbPlaceholder]} />
            )}
          </View>

          <CardSurface>
            <View style={styles.headerRow}>
              <H2 style={styles.title}>{propertyTitle}</H2>
              <ReservationStatusBadge status={reservation.status} />
            </View>
            {property?.address ? (
              <BloomText style={styles.subtitle}>
                {[property.address.city, property.address.country]
                  .filter(Boolean)
                  .join(', ')}
              </BloomText>
            ) : null}
          </CardSurface>

          <CardSurface>
            <BloomText style={styles.sectionLabel}>Trip details</BloomText>
            <DetailRow
              label="Check-in"
              value={format(new Date(reservation.checkIn), 'EEE, MMM d, yyyy')}
            />
            <DetailRow
              label="Check-out"
              value={format(new Date(reservation.checkOut), 'EEE, MMM d, yyyy')}
            />
            <DetailRow
              label="Guests"
              value={`${reservation.guestCount} ${
                reservation.guestCount === 1 ? 'guest' : 'guests'
              }`}
            />
            <DetailRow label="Nights" value={String(reservation.nights)} />
          </CardSurface>

          <CardSurface>
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
          </CardSurface>

          {(showHostApproveDecline || showGuestCancel || showHostCancel) ? (
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
          ) : null}

          {role === 'guest' &&
          reservation.status === ReservationStatus.CONFIRMED &&
          !showGuestCancel ? (
            <BloomText style={styles.policyNote}>
              Cancellation is no longer possible under the{' '}
              {reservation.cancellationPolicy.replace('_', ' ')} policy. Contact your
              host if you need to make changes.
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

interface DetailRowProps {
  label: string;
  value: string;
}

const DetailRow: React.FC<DetailRowProps> = ({ label, value }) => (
  <View style={styles.detailRow}>
    <BloomText style={styles.detailLabel}>{label}</BloomText>
    <BloomText style={styles.detailValue}>{value}</BloomText>
  </View>
);

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.surface,
  },
  safeArea: {
    flex: 1,
  },
  content: {
    padding: spacing.lg,
    gap: spacing.lg,
  },
  centerWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing['2xl'],
  },
  thumbWrap: {
    width: '100%',
    aspectRatio: 16 / 9,
    borderRadius: radius.photo,
    overflow: 'hidden',
    backgroundColor: colors.mutedSubtle,
  },
  thumb: {
    width: '100%',
    height: '100%',
  },
  thumbPlaceholder: {
    backgroundColor: colors.mutedSubtle,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    marginBottom: spacing.xs,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    flex: 1,
  },
  subtitle: {
    fontSize: 13,
    color: colors.muted,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    color: colors.muted,
    letterSpacing: tracker.eyebrow,
    marginBottom: spacing.sm,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.COLOR_BLACK_LIGHT_6,
  },
  detailLabel: {
    fontSize: 13,
    color: colors.muted,
  },
  detailValue: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.COLOR_BLACK,
  },
  actionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  actionButton: {
    flex: 1,
    minWidth: 120,
  },
  policyNote: {
    fontSize: 12,
    color: colors.muted,
    fontStyle: 'italic',
  },
});
