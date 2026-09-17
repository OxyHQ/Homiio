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

import { Button } from '@oxy.so/bloom/button';
import {
  RiAlertLine,
  RiCheckLine,
  RiCloseCircleLine,
  RiCloseLine,
} from '@oxy.so/bloom/icons';
import { useTheme } from '@oxy.so/bloom/theme';
import { Loading } from '@oxy.so/bloom/loading';
import { SettingsListGroup, SettingsListItem } from '@oxy.so/bloom/settings-list';
import { Text as BloomText, H2 } from '@oxy.so/bloom/typography';
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
import { confirm } from '@oxy.so/bloom/surfaces';
import { Card } from '@oxy.so/bloom/card';
import { ErrorState } from '@/components/ui/ErrorState';
import { getPropertyImageSource, getPropertyTitle } from '@/utils/propertyUtils';
import { formatLocalized } from '@/utils/dateLocale';
import { toast } from '@oxy.so/bloom/toast';
import { radius, spacing, tracker } from '@/constants/styles';

type PendingAction = 'confirm' | 'decline' | 'cancel' | 'complete';

const formatWindow = (window: ExchangeWindow): string => {
  const start = parseISO(window.start);
  const end = parseISO(window.end);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return '';
  return `${formatLocalized(start, 'EEE, MMM d, yyyy')} → ${formatLocalized(end, 'EEE, MMM d, yyyy')}`;
};

export default function ExchangeRequestDetailScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const params = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const id = typeof params.id === 'string' ? params.id : params.id?.[0];

  const requestQuery = useExchangeRequest(id);
  const updateMutation = useUpdateExchangeStatus(id ?? '');
  const { profile } = useProfile();

  const request = requestQuery.data;
  const { property } = useProperty(request?.propertyId ?? '');
  const { property: offeredProperty } = useProperty(request?.offeredPropertyId ?? '');

  // Capture "now" once per screen instance (lazy initializer keeps render pure —
  // reading `Date.now()` directly in render is flagged as impure). The
  // complete-after-end gate compares the stay window against this snapshot.
  const [now] = useState(() => Date.now());

  const role = useMemo<'guest' | 'host' | null>(() => {
    if (!request || !profile) return null;
    const sessionOxyUserId = profile?.oxyUserId;
    if (!sessionOxyUserId) return null;
    if (String(request.hostOxyUserId) === sessionOxyUserId) return 'host';
    if (String(request.requesterOxyUserId) === sessionOxyUserId) return 'guest';
    return null;
  }, [request, profile]);

  // Reviews for this exchange (used to hide the form once I've already reviewed).
  const reviewsQuery = useExchangeRequestReviews(id, {
    enabled: request?.status === ExchangeRequestStatus.COMPLETED,
  });
  const sessionOxyUserId = profile?.oxyUserId;
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
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : t('listing.exchange.errors.failed');
        toast.error(message);
      }
    },
    [id, updateMutation, t],
  );

  const confirmAction = useCallback(
    async (action: PendingAction) => {
      const options = {
        confirm: {
          title: t('listing.exchange.confirm.approveTitle'),
          description: t('listing.exchange.confirm.approveBody'),
          confirmLabel: t('listing.exchange.actions.approve'),
          destructive: false,
          status: ExchangeRequestStatus.CONFIRMED,
        },
        decline: {
          title: t('listing.exchange.confirm.declineTitle'),
          description: t('listing.exchange.confirm.declineBody'),
          confirmLabel: t('listing.exchange.actions.decline'),
          destructive: true,
          status: ExchangeRequestStatus.DECLINED,
        },
        cancel: {
          title: t('listing.exchange.confirm.cancelTitle'),
          description: t('listing.exchange.confirm.cancelBody'),
          confirmLabel: t('listing.exchange.confirm.cancelConfirm'),
          destructive: true,
          status: ExchangeRequestStatus.CANCELLED,
        },
        complete: {
          title: t('listing.exchange.confirm.completeTitle'),
          description: t('listing.exchange.confirm.completeBody'),
          confirmLabel: t('listing.exchange.actions.complete'),
          destructive: false,
          status: ExchangeRequestStatus.COMPLETED,
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
        title: t('listing.exchange.detailTitle'),
      }}
    />
  );

  if (!id) {
    return (
      <View style={[styles.root, { backgroundColor: theme.colors.background }]}>
        {header}
        <View style={styles.centerWrap}>
          <ErrorState
            icon={RiAlertLine}
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
      <View style={[styles.root, { backgroundColor: theme.colors.background }]}>
        {header}
        <View style={styles.centerWrap}>
          <Loading variant="spinner" size="medium" />
        </View>
      </View>
    );
  }

  if (requestQuery.isError || !request) {
    return (
      <View style={[styles.root, { backgroundColor: theme.colors.background }]}>
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
    <View style={[styles.root, { backgroundColor: theme.colors.background }]}>
      {header}
      <SafeAreaView edges={['bottom']} style={styles.safeArea}>
        <ScrollView contentContainerStyle={styles.content}>
          <View style={[styles.thumbWrap, { backgroundColor: theme.colors.backgroundTertiary }]}>
            {imageSource ? (
              <Image source={imageSource} style={styles.thumb} resizeMode="cover" />
            ) : (
              <View style={styles.thumb} />
            )}
          </View>

          <Card variant="outlined" radius="radius-16" className="p-5">
            <View style={styles.headerRow}>
              <H2 style={styles.title}>{propertyTitle}</H2>
              <ExchangeStatusBadge status={request.status} />
            </View>
            {property?.address ? (
              <BloomText style={[styles.subtitle, { color: theme.colors.textSecondary }]}>
                {[property.address.cityName, property.address.countryName].filter(Boolean).join(', ')}
              </BloomText>
            ) : null}
          </Card>

          <SettingsListGroup title={t('listing.exchange.detailsLabel')}>
            <SettingsListItem title={t('listing.exchange.modeLabelShort')} value={modeLabel} />
            <SettingsListItem
              title={t('listing.exchange.requestedStay')}
              value={formatWindow(request.requestedWindow)}
            />
            {isSwap && request.offeredWindow ? (
              <SettingsListItem
                title={t('listing.exchange.offeredStay')}
                value={formatWindow(request.offeredWindow)}
              />
            ) : null}
            {isSwap && offeredProperty ? (
              <SettingsListItem
                title={t('listing.exchange.offeredHome')}
                value={getPropertyTitle(offeredProperty)}
              />
            ) : null}
          </SettingsListGroup>

          {request.message ? (
            <Card variant="outlined" radius="radius-16" className="p-5">
              <BloomText style={[styles.sectionLabel, { color: theme.colors.textSecondary }]}>
                {t('listing.exchange.messageHeading')}
              </BloomText>
              <BloomText style={[styles.messageText, { color: theme.colors.text }]}>{request.message}</BloomText>
            </Card>
          ) : null}

          {(showHostConfirmDecline || showRequesterCancel || showComplete) ? (
            <View style={styles.actionRow}>
              {showHostConfirmDecline ? (
                <>
                  <Button
                    variant="primary"
                    size="medium"
                    leadingIcon={RiCheckLine}
                    onPress={() => void confirmAction('confirm')}
                    disabled={updateMutation.isPending}
                    style={styles.actionButton}
                  >
                    {t('listing.exchange.actions.approve')}
                  </Button>
                  <Button
                    variant="secondary"
                    size="medium"
                    leadingIcon={RiCloseLine}
                    onPress={() => void confirmAction('decline')}
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
                  leadingIcon={RiCheckLine}
                  onPress={() => void confirmAction('complete')}
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
                  leadingIcon={RiCloseCircleLine}
                  onPress={() => void confirmAction('cancel')}
                  disabled={updateMutation.isPending}
                  style={styles.actionButton}
                >
                  {t('listing.exchange.actions.cancel')}
                </Button>
              ) : null}
            </View>
          ) : null}

          {showReviewForm ? (
            <Card variant="outlined" radius="radius-16" className="p-5">
              <ExchangeReviewForm
                exchangeRequestId={request.id}
                onSubmitted={() => reviewsQuery.refetch()}
              />
            </Card>
          ) : null}

          {request.status === ExchangeRequestStatus.COMPLETED && alreadyReviewed ? (
            <BloomText style={[styles.note, { color: theme.colors.textSecondary }]}>
              {t('listing.exchange.review.alreadyLeft')}
            </BloomText>
          ) : null}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
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
  },
  thumb: {
    width: '100%',
    height: '100%',
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
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: tracker.eyebrow,
    marginBottom: spacing.sm,
  },
  messageText: {
    fontSize: 14,
    lineHeight: 20,
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
    fontStyle: 'italic',
  },
});
