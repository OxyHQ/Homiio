/**
 * Exchange request detail (guest + host views).
 *
 * Shows the requested + offered windows, mode, message and status, plus the
 * role-appropriate status actions:
 *   - Host:      pending   → confirm | decline
 *   - Requester: pending|confirmed → cancel
 *   - Either:    confirmed → complete (only after the stay window ended)
 *   - Either:    completed → leave a review (once, via ExchangeReviewForm)
 * The backend owns the authoritative transition rules; this screen mirrors them
 * to avoid surfacing actions that would always fail. Modeled on reservations/[id].
 */
import React, { useCallback, useMemo, useState } from 'react';
import { Image, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { parseISO } from 'date-fns';

import { Button } from '@oxyhq/bloom/button';
import { Loading } from '@oxyhq/bloom/loading';
import { Text as BloomText, H2 } from '@oxyhq/bloom/typography';
import {
  ExchangeMode,
  ExchangeRequestStatus,
  type ExchangeWindow,
} from '@homiio/shared-types';

import { Header } from '@/components/Header';
import { useProperty } from '@/hooks';
import { useProfile } from '@/context/ProfileContext';
import {
  useExchangeRequest,
  useExchangeRequestReviews,
  useUpdateExchangeStatus,
} from '@/hooks/useExchangeQueries';
import { ExchangeStatusBadge } from '@/components/exchange/ExchangeStatusBadge';
import { ExchangeReviewForm } from '@/components/exchange/ExchangeReviewForm';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { CardSurface } from '@/components/ui/CardSurface';
import { ErrorState } from '@/components/ui/ErrorState';
import { getPropertyImageSource, getPropertyTitle } from '@/utils/propertyUtils';
import { formatLocalized } from '@/utils/dateLocale';
import { toast } from '@/lib/sonner';
import { colors } from '@/styles/colors';
import { radius, spacing, tracker } from '@/constants/styles';

type PendingAction = 'confirm' | 'decline' | 'cancel' | 'complete' | null;

const formatWindow = (window: ExchangeWindow): string => {
  const start = parseISO(window.start);
  const end = parseISO(window.end);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return '';
  return `${formatLocalized(start, 'EEE, MMM d, yyyy')} → ${formatLocalized(end, 'EEE, MMM d, yyyy')}`;
};

export default function ExchangeRequestDetailScreen() {
  const { t } = useTranslation();
  const params = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const id = typeof params.id === 'string' ? params.id : params.id?.[0];

  const requestQuery = useExchangeRequest(id);
  const updateMutation = useUpdateExchangeStatus(id ?? '');
  const { primaryProfile } = useProfile();

  const request = requestQuery.data;
  const { property } = useProperty(request?.propertyId ?? '');
  const { property: offeredProperty } = useProperty(request?.offeredPropertyId ?? '');

  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  // Capture "now" once per screen instance (lazy initializer keeps render pure —
  // reading `Date.now()` directly in render is flagged as impure). The
  // complete-after-end gate compares the stay window against this snapshot.
  const [now] = useState(() => Date.now());

  const role = useMemo<'guest' | 'host' | null>(() => {
    if (!request || !primaryProfile) return null;
    const sessionOxyUserId = primaryProfile?.oxyUserId;
    if (!sessionOxyUserId) return null;
    if (String(request.hostOxyUserId) === sessionOxyUserId) return 'host';
    if (String(request.requesterOxyUserId) === sessionOxyUserId) return 'guest';
    return null;
  }, [request, primaryProfile]);

  // Reviews for this exchange (used to hide the form once I've already reviewed).
  const reviewsQuery = useExchangeRequestReviews(id, {
    enabled: request?.status === ExchangeRequestStatus.COMPLETED,
  });
  const sessionOxyUserId = primaryProfile?.oxyUserId;
  const alreadyReviewed = useMemo(
    () =>
      (reviewsQuery.data ?? []).some(
        (review) => review.reviewerOxyUserId === sessionOxyUserId,
      ),
    [reviewsQuery.data, sessionOxyUserId],
  );

  const handleAction = useCallback(
    async (status: ExchangeRequestStatus) => {
      if (!id) return;
      try {
        await updateMutation.mutateAsync({ status });
        const toastKey: Record<string, string> = {
          [ExchangeRequestStatus.CONFIRMED]: t('listing.exchange.toasts.confirmed'),
          [ExchangeRequestStatus.DECLINED]: t('listing.exchange.toasts.declined'),
          [ExchangeRequestStatus.CANCELLED]: t('listing.exchange.toasts.cancelled'),
          [ExchangeRequestStatus.COMPLETED]: t('listing.exchange.toasts.completed'),
        };
        toast.success(toastKey[status] ?? t('listing.exchange.toasts.updated'));
        setPendingAction(null);
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : t('listing.exchange.errors.failed');
        toast.error(message);
        setPendingAction(null);
      }
    },
    [id, updateMutation, t],
  );

  const header = (
    <Header
      options={{
        showBackButton: true,
        title: t('listing.exchange.detailTitle'),
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
            title={t('listing.exchange.invalidId')}
            description={t('listing.exchange.invalidIdBody')}
            retryLabel={t('goBack')}
            onRetry={() => router.back()}
          />
        </View>
      </View>
    );
  }

  if (requestQuery.isPending) {
    return (
      <View style={styles.root}>
        {header}
        <View style={styles.centerWrap}>
          <Loading variant="spinner" size="medium" />
        </View>
      </View>
    );
  }

  if (requestQuery.isError || !request) {
    return (
      <View style={styles.root}>
        {header}
        <View style={styles.centerWrap}>
          <ErrorState
            title={t('listing.exchange.unavailable')}
            description={requestQuery.error?.message ?? t('listing.exchange.unavailableBody')}
            retryLabel={t('goBack')}
            onRetry={() => router.back()}
          />
        </View>
      </View>
    );
  }

  const propertyTitle = property ? getPropertyTitle(property) : t('listing.exchange.cardFallback');
  const imageSource = property ? getPropertyImageSource(property) : null;
  const isSwap = request.mode === ExchangeMode.SWAP;
  const modeLabel = isSwap
    ? t('listing.exchange.mode.swap')
    : t('listing.exchange.mode.host');

  // Whether the requested stay window has already ended (gates "complete"),
  // compared against the `now` snapshot captured above so render stays pure.
  const stayEndMs = parseISO(request.requestedWindow.end).getTime();
  const stayEnded = !Number.isNaN(stayEndMs) && stayEndMs <= now;

  const showHostConfirmDecline =
    role === 'host' && request.status === ExchangeRequestStatus.PENDING;
  const showRequesterCancel =
    role === 'guest' &&
    (request.status === ExchangeRequestStatus.PENDING ||
      request.status === ExchangeRequestStatus.CONFIRMED);
  const showComplete =
    request.status === ExchangeRequestStatus.CONFIRMED && stayEnded;
  const showReviewForm =
    request.status === ExchangeRequestStatus.COMPLETED &&
    role !== null &&
    !reviewsQuery.isPending &&
    !alreadyReviewed;

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
              <ExchangeStatusBadge status={request.status} />
            </View>
            {property?.address ? (
              <BloomText style={styles.subtitle}>
                {[property.address.cityName, property.address.countryName].filter(Boolean).join(', ')}
              </BloomText>
            ) : null}
          </CardSurface>

          <CardSurface>
            <BloomText style={styles.sectionLabel}>
              {t('listing.exchange.detailsLabel')}
            </BloomText>
            <DetailRow label={t('listing.exchange.modeLabelShort')} value={modeLabel} />
            <DetailRow
              label={t('listing.exchange.requestedStay')}
              value={formatWindow(request.requestedWindow)}
            />
            {isSwap && request.offeredWindow ? (
              <DetailRow
                label={t('listing.exchange.offeredStay')}
                value={formatWindow(request.offeredWindow)}
              />
            ) : null}
            {isSwap && offeredProperty ? (
              <DetailRow
                label={t('listing.exchange.offeredHome')}
                value={getPropertyTitle(offeredProperty)}
              />
            ) : null}
          </CardSurface>

          {request.message ? (
            <CardSurface>
              <BloomText style={styles.sectionLabel}>
                {t('listing.exchange.messageHeading')}
              </BloomText>
              <BloomText style={styles.messageText}>{request.message}</BloomText>
            </CardSurface>
          ) : null}

          {(showHostConfirmDecline || showRequesterCancel || showComplete) ? (
            <View style={styles.actionRow}>
              {showHostConfirmDecline ? (
                <>
                  <Button
                    variant="primary"
                    size="medium"
                    onPress={() => setPendingAction('confirm')}
                    disabled={updateMutation.isPending}
                    style={styles.actionButton}
                  >
                    {t('listing.exchange.actions.approve')}
                  </Button>
                  <Button
                    variant="secondary"
                    size="medium"
                    onPress={() => setPendingAction('decline')}
                    disabled={updateMutation.isPending}
                    style={styles.actionButton}
                  >
                    {t('listing.exchange.actions.decline')}
                  </Button>
                </>
              ) : null}
              {showComplete ? (
                <Button
                  variant="primary"
                  size="medium"
                  onPress={() => setPendingAction('complete')}
                  disabled={updateMutation.isPending}
                  style={styles.actionButton}
                >
                  {t('listing.exchange.actions.complete')}
                </Button>
              ) : null}
              {showRequesterCancel ? (
                <Button
                  variant="ghost"
                  size="medium"
                  onPress={() => setPendingAction('cancel')}
                  disabled={updateMutation.isPending}
                  style={styles.actionButton}
                >
                  {t('listing.exchange.actions.cancel')}
                </Button>
              ) : null}
            </View>
          ) : null}

          {showReviewForm ? (
            <CardSurface>
              <ExchangeReviewForm
                exchangeRequestId={request.id}
                onSubmitted={() => reviewsQuery.refetch()}
              />
            </CardSurface>
          ) : null}

          {request.status === ExchangeRequestStatus.COMPLETED && alreadyReviewed ? (
            <BloomText style={styles.note}>
              {t('listing.exchange.review.alreadyLeft')}
            </BloomText>
          ) : null}
        </ScrollView>

        <ConfirmDialog
          visible={pendingAction === 'confirm'}
          title={t('listing.exchange.confirm.approveTitle')}
          message={t('listing.exchange.confirm.approveBody')}
          confirmLabel={t('listing.exchange.actions.approve')}
          loading={updateMutation.isPending}
          onConfirm={() => handleAction(ExchangeRequestStatus.CONFIRMED)}
          onCancel={() => setPendingAction(null)}
        />
        <ConfirmDialog
          visible={pendingAction === 'decline'}
          title={t('listing.exchange.confirm.declineTitle')}
          message={t('listing.exchange.confirm.declineBody')}
          confirmLabel={t('listing.exchange.actions.decline')}
          confirmDestructive
          loading={updateMutation.isPending}
          onConfirm={() => handleAction(ExchangeRequestStatus.DECLINED)}
          onCancel={() => setPendingAction(null)}
        />
        <ConfirmDialog
          visible={pendingAction === 'cancel'}
          title={t('listing.exchange.confirm.cancelTitle')}
          message={t('listing.exchange.confirm.cancelBody')}
          confirmLabel={t('listing.exchange.confirm.cancelConfirm')}
          confirmDestructive
          loading={updateMutation.isPending}
          onConfirm={() => handleAction(ExchangeRequestStatus.CANCELLED)}
          onCancel={() => setPendingAction(null)}
        />
        <ConfirmDialog
          visible={pendingAction === 'complete'}
          title={t('listing.exchange.confirm.completeTitle')}
          message={t('listing.exchange.confirm.completeBody')}
          confirmLabel={t('listing.exchange.actions.complete')}
          loading={updateMutation.isPending}
          onConfirm={() => handleAction(ExchangeRequestStatus.COMPLETED)}
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
    gap: spacing.lg,
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
    flexShrink: 1,
    textAlign: 'right',
  },
  messageText: {
    fontSize: 14,
    lineHeight: 20,
    color: colors.COLOR_BLACK_LIGHT_2,
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
  note: {
    fontSize: 12,
    color: colors.muted,
    fontStyle: 'italic',
  },
});
