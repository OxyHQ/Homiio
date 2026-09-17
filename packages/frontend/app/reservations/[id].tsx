/**
 * Reservation detail (guest + host view).
 *
 * Stream P polish:
 * - Each section is an outlined Bloom `Card`.
 * - Bloom Loading + ErrorState replace the ad-hoc spinner/error views.
 * - Bloom Button for every CTA; the inline modal was replaced by the
 *   Bloom `confirm()` surface.
 * - Bloom typography across the board, semantic color tokens (`colors.surface`,
 *   `colors.muted`) — no more raw hex literals.
 */
import React, { useCallback, useMemo } from 'react';
import {
  Image,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { format } from 'date-fns';
import { toast } from '@oxy.so/bloom/toast';
import { useTranslation } from 'react-i18next';

import { Button } from '@oxy.so/bloom/button';
import { Loading } from '@oxy.so/bloom/loading';
import { Text as BloomText, H2 } from '@oxy.so/bloom/typography';
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
import { confirm } from '@oxy.so/bloom/surfaces';
import { Card } from '@oxy.so/bloom/card';
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
  const { t } = useTranslation();
  const params = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const id = typeof params.id === 'string' ? params.id : params.id?.[0];
  const reservationQuery = useReservationQuery(id);
  const updateMutation = useUpdateReservation(id ?? '');
  const { profile } = useProfile();

  const reservation = reservationQuery.data;
  const { property } = useProperty(reservation?.propertyId ?? '');

  const role = useMemo<'guest' | 'host' | null>(() => {
    if (!reservation || !profile) return null;
    const sessionOxyUserId = profile?.oxyUserId;
    if (!sessionOxyUserId) return null;
    if (String(reservation.hostOxyUserId) === sessionOxyUserId) return 'host';
    if (String(reservation.guestOxyUserId) === sessionOxyUserId) return 'guest';
    return null;
  }, [reservation, profile]);

  const handleAction = useCallback(
    async (target: ReservationStatus) => {
      if (!id) return;
      try {
        await updateMutation.mutateAsync({ status: target });
        const toastKey =
          target === ReservationStatus.CONFIRMED
            ? 'reservations.detail.toastConfirmed'
            : target === ReservationStatus.DECLINED
              ? 'reservations.detail.toastDeclined'
              : 'reservations.detail.toastCancelled';
        toast.success(t(toastKey));
      } catch (error) {
        const message = error instanceof Error ? error.message : t('reservations.detail.toastUpdateFailed');
        toast.error(message);
      }
    },
    [id, updateMutation, t],
  );

  const confirmAction = useCallback(
    async (action: 'cancel' | 'confirm' | 'decline') => {
      const options = {
        cancel: {
          title: t('reservations.detail.confirmCancelTitle'),
          description: t('reservations.detail.confirmCancelBody'),
          confirmLabel: t('reservations.detail.confirmCancelAction'),
          destructive: true,
          status: ReservationStatus.CANCELLED,
        },
        confirm: {
          title: t('reservations.detail.confirmApproveTitle'),
          description: t('reservations.detail.confirmApproveBody'),
          confirmLabel: t('reservations.detail.approve'),
          destructive: false,
          status: ReservationStatus.CONFIRMED,
        },
        decline: {
          title: t('reservations.detail.confirmDeclineTitle'),
          description: t('reservations.detail.confirmDeclineBody'),
          confirmLabel: t('reservations.detail.decline'),
          destructive: true,
          status: ReservationStatus.DECLINED,
        },
      }[action];
      const { status, ...prompt } = options;
      if (await confirm({ ...prompt, cancelLabel: t('common.cancel') })) {
        await handleAction(status);
      }
    },
    [handleAction, t],
  );

  const header = (
    <Header
      options={{
        showBackButton: true,
        title: t('reservations.detail.title'),
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
            title={t('reservations.detail.invalidId')}
            description={t('reservations.detail.invalidIdDescription')}
            retryLabel={t('reservations.detail.goBack')}
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
            title={t('reservations.detail.unavailable')}
            description={
              reservationQuery.error?.message ?? t('reservations.detail.unavailableDescription')
            }
            retryLabel={t('reservations.detail.goBack')}
            onRetry={() => router.back()}
          />
        </View>
      </View>
    );
  }

  const propertyTitle = property ? getPropertyTitle(property) : t('reservations.card.propertyFallback');
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

          <Card variant="outlined" radius="radius-16" className="p-5">
            <View style={styles.headerRow}>
              <H2 style={styles.title}>{propertyTitle}</H2>
              <ReservationStatusBadge status={reservation.status} />
            </View>
            {property?.address ? (
              <BloomText style={styles.subtitle}>
                {[property.address.cityName, property.address.countryName]
                  .filter(Boolean)
                  .join(', ')}
              </BloomText>
            ) : null}
          </Card>

          <Card variant="outlined" radius="radius-16" className="p-5">
            <BloomText style={styles.sectionLabel}>{t('reservations.detail.tripDetails')}</BloomText>
            <DetailRow
              label={t('reservations.detail.checkIn')}
              value={format(new Date(reservation.checkIn), 'EEE, MMM d, yyyy')}
            />
            <DetailRow
              label={t('reservations.detail.checkOut')}
              value={format(new Date(reservation.checkOut), 'EEE, MMM d, yyyy')}
            />
            <DetailRow
              label={t('reservations.detail.guests')}
              value={`${reservation.guestCount} ${
                reservation.guestCount === 1
                  ? t('reservations.card.guest')
                  : t('reservations.card.guests')
              }`}
            />
            <DetailRow label={t('reservations.detail.nights')} value={String(reservation.nights)} />
          </Card>

          <Card variant="outlined" radius="radius-16" className="p-5">
            <BloomText style={styles.sectionLabel}>{t('reservations.detail.price')}</BloomText>
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
          </Card>

          {(showHostApproveDecline || showGuestCancel || showHostCancel) ? (
            <View style={styles.actionRow}>
              {showHostApproveDecline ? (
                <>
                  <Button
                    variant="primary"
                    size="medium"
                    onPress={() => void confirmAction('confirm')}
                    disabled={updateMutation.isPending}
                    style={styles.actionButton}
                  >
                    {t('reservations.detail.approve')}
                  </Button>
                  <Button
                    variant="secondary"
                    size="medium"
                    onPress={() => void confirmAction('decline')}
                    disabled={updateMutation.isPending}
                    style={styles.actionButton}
                  >
                    {t('reservations.detail.decline')}
                  </Button>
                </>
              ) : null}
              {showGuestCancel || showHostCancel ? (
                <Button
                  variant="ghost"
                  size="medium"
                  onPress={() => void confirmAction('cancel')}
                  disabled={updateMutation.isPending}
                  style={styles.actionButton}
                >
                  {t('reservations.detail.cancelReservation')}
                </Button>
              ) : null}
            </View>
          ) : null}

          {role === 'guest' &&
          reservation.status === ReservationStatus.CONFIRMED &&
          !showGuestCancel ? (
            <BloomText style={styles.policyNote}>
              {t('reservations.detail.cancelPolicyNote', {
                policy: reservation.cancellationPolicy.replace('_', ' '),
              })}
            </BloomText>
          ) : null}
        </ScrollView>
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
    backgroundColor: colors.background,
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
