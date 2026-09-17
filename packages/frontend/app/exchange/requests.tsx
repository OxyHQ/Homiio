/**
 * My exchange requests — guest + host views in one screen.
 *
 * A Bloom SegmentedControl switches between the guest view (requests I made) and the
 * host inbox (requests against my listings). A status chip row filters within
 * the active view. Host rows expose inline approve/decline for pending requests.
 * Mirrors the reservations list patterns (Bloom Chip + Skeleton + Empty/Error
 * states), keyed on the exchange service/hooks.
 */
import React, { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { Button } from '@oxy.so/bloom/button';
import { Chip } from '@oxy.so/bloom/chip';
import {
  SegmentedControl,
  SegmentedControlItem,
  SegmentedControlItemText,
} from '@oxy.so/bloom/segmented-control';
import { confirm } from '@oxy.so/bloom/surfaces';
import { useOxy, openAccountDialog } from '@oxy.so/services';
import {
  ExchangeRequest,
  ExchangeRequestStatus,
} from '@homiio/shared-types';

import { Header } from '@/components/Header';
import { ExchangeRequestCard } from '@/components/exchange/ExchangeRequestCard';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { ListSkeleton } from '@/components/ui/ListSkeleton';
import {
  useMyExchangeRequests,
  useUpdateExchangeStatus,
} from '@/hooks/useExchangeQueries';
import { toast } from '@oxy.so/bloom/toast';
import { useTheme } from '@oxy.so/bloom/theme';
import { spacing } from '@/constants/styles';
import { RiAlertLine, RiArrowLeftRightLine, RiLoginBoxLine } from '@oxy.so/bloom/icons';

type RoleView = 'guest' | 'host';
type StatusFilter = 'all' | ExchangeRequestStatus;

const STATUS_FILTERS: { id: StatusFilter; i18nKey: string }[] = [
  { id: 'all', i18nKey: 'common.all' },
  { id: ExchangeRequestStatus.PENDING, i18nKey: 'listing.exchange.status.pending' },
  { id: ExchangeRequestStatus.CONFIRMED, i18nKey: 'listing.exchange.status.confirmed' },
  { id: ExchangeRequestStatus.COMPLETED, i18nKey: 'listing.exchange.status.completed' },
  { id: ExchangeRequestStatus.DECLINED, i18nKey: 'listing.exchange.status.declined' },
  { id: ExchangeRequestStatus.CANCELLED, i18nKey: 'listing.exchange.status.cancelled' },
];

/** Host inline approve/decline for a pending request. Owns its own mutation. */
const HostPendingActions: React.FC<{ request: ExchangeRequest }> = ({ request }) => {
  const { t } = useTranslation();
  const mutation = useUpdateExchangeStatus(request.id);
  const [busy, setBusy] = useState<'confirm' | 'decline' | null>(null);

  if (request.status !== ExchangeRequestStatus.PENDING) return null;

  const handle = async (status: ExchangeRequestStatus) => {
    const approving = status === ExchangeRequestStatus.CONFIRMED;
    const accepted = await confirm({
      title: approving
        ? t('listing.exchange.confirm.approveTitle')
        : t('listing.exchange.confirm.declineTitle'),
      description: approving
        ? t('listing.exchange.confirm.approveBody')
        : t('listing.exchange.confirm.declineBody'),
      confirmLabel: approving
        ? t('listing.exchange.actions.approve')
        : t('listing.exchange.actions.decline'),
      cancelLabel: t('common.cancel'),
      destructive: !approving,
    });
    if (!accepted) return;
    setBusy(status === ExchangeRequestStatus.CONFIRMED ? 'confirm' : 'decline');
    try {
      await mutation.mutateAsync({ status });
      toast.success(
        status === ExchangeRequestStatus.CONFIRMED
          ? t('listing.exchange.toasts.confirmed')
          : t('listing.exchange.toasts.declined'),
      );
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : t('listing.exchange.errors.failed');
      toast.error(message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <Button
        variant="primary"
        size="small"
        loading={busy === 'confirm'}
        disabled={mutation.isPending}
        onPress={() => handle(ExchangeRequestStatus.CONFIRMED)}
      >
        {t('listing.exchange.actions.approve')}
      </Button>
      <Button
        variant="secondary"
        size="small"
        loading={busy === 'decline'}
        disabled={mutation.isPending}
        onPress={() => handle(ExchangeRequestStatus.DECLINED)}
      >
        {t('listing.exchange.actions.decline')}
      </Button>
    </>
  );
};

export default function ExchangeRequestsScreen() {
  const { t } = useTranslation();
  const theme = useTheme();
  const { oxyServices, activeSessionId } = useOxy();
  const isAuthed = Boolean(oxyServices && activeSessionId);

  const [role, setRole] = useState<RoleView>('guest');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

  const query = useMyExchangeRequests(
    {
      asHost: role === 'host',
      status: statusFilter === 'all' ? undefined : statusFilter,
      limit: 100,
    },
    { enabled: isAuthed },
  );

  const items = useMemo<ExchangeRequest[]>(
    () => query.data?.items ?? [],
    [query.data?.items],
  );

  const header = (
    <Header
      options={{
        showBackButton: true,
        title: t('listing.exchange.requestsTitle'),
      }}
    />
  );

  if (!isAuthed) {
    return (
      <View style={[styles.root, { backgroundColor: theme.colors.background }]}>
        {header}
        <SafeAreaView edges={['bottom']} style={styles.safeArea}>
          <View style={styles.centerWrap}>
            <EmptyState
              icon={RiArrowLeftRightLine}
              title={t('listing.exchange.signInTitle')}
              description={t('listing.exchange.signInBody')}
              actionText={t('common.signIn')}
              actionIcon={RiLoginBoxLine}
              onAction={() => openAccountDialog()}
            />
          </View>
        </SafeAreaView>
      </View>
    );
  }

  return (
    <View style={[styles.root, { backgroundColor: theme.colors.background }]}>
      {header}
      <SafeAreaView edges={['bottom']} style={styles.safeArea}>
        <ScrollView contentContainerStyle={styles.content}>
          {/* Role segmented toggle */}
          <SegmentedControl<RoleView>
            label={t('listing.exchange.requestsTitle')}
            type="tabs"
            value={role}
            onChange={setRole}
          >
            <SegmentedControlItem value="guest">
              <SegmentedControlItemText>{t('listing.exchange.asGuest')}</SegmentedControlItemText>
            </SegmentedControlItem>
            <SegmentedControlItem value="host">
              <SegmentedControlItemText>{t('listing.exchange.asHost')}</SegmentedControlItemText>
            </SegmentedControlItem>
          </SegmentedControl>

          {/* Status chips */}
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.filterRow}
          >
            {STATUS_FILTERS.map((entry) => {
              const active = statusFilter === entry.id;
              return (
                <Chip
                  key={entry.id}
                  variant="subtle"
                  selected={active}
                  onPress={() => setStatusFilter(entry.id)}
                >
                  {t(entry.i18nKey)}
                </Chip>
              );
            })}
          </ScrollView>

          {query.isPending ? <ListSkeleton rows={4} rowHeight={120} /> : null}

          {query.isError ? (
            <ErrorState
              icon={RiAlertLine}
              title={t('listing.exchange.loadErrorTitle')}
              description={query.error?.message ?? t('common.tryAgain')}
              retryLabel={t('common.retry')}
              onRetry={() => query.refetch()}
            />
          ) : null}

          {!query.isPending && !query.isError && items.length === 0 ? (
            <View style={styles.emptyWrap}>
              <EmptyState
                icon={RiArrowLeftRightLine}
                title={
                  role === 'guest'
                    ? t('listing.exchange.emptyGuestTitle')
                    : t('listing.exchange.emptyHostTitle')
                }
                description={
                  role === 'guest'
                    ? t('listing.exchange.emptyGuestBody')
                    : t('listing.exchange.emptyHostBody')
                }
              />
            </View>
          ) : null}

          {items.length > 0 ? (
            <View style={styles.list}>
              {items.map((request) => (
                <ExchangeRequestCard
                  key={request.id}
                  request={request}
                  actions={
                    role === 'host' ? (
                      <HostPendingActions request={request} />
                    ) : undefined
                  }
                />
              ))}
            </View>
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
    justifyContent: 'center',
  },
  emptyWrap: {
    paddingVertical: spacing['3xl'],
  },
  filterRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingVertical: spacing.xs,
  },
  list: {
    gap: spacing.md,
  },
});
