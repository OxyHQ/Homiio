/**
 * My exchange requests — guest + host views in one screen.
 *
 * A segmented toggle switches between the guest view (requests I made) and the
 * host inbox (requests against my listings). A status chip row filters within
 * the active view. Host rows expose inline approve/decline for pending requests.
 * Mirrors the reservations list patterns (Bloom Chip + Skeleton + Empty/Error
 * states), keyed on the exchange service/hooks.
 */
import React, { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import { Button } from '@oxyhq/bloom/button';
import { Chip } from '@oxyhq/bloom/chip';
import { useOxy, showSignInModal } from '@oxyhq/services';
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
import { toast } from '@/lib/sonner';
import { colors } from '@/styles/colors';
import { radius, spacing } from '@/constants/styles';

type RoleView = 'guest' | 'host';
type StatusFilter = 'all' | ExchangeRequestStatus;

const STATUS_FILTERS: { id: StatusFilter; i18nKey: string; fallback: string }[] = [
  { id: 'all', i18nKey: 'common.all', fallback: 'All' },
  { id: ExchangeRequestStatus.PENDING, i18nKey: 'listing.exchange.status.pending', fallback: 'Pending' },
  { id: ExchangeRequestStatus.CONFIRMED, i18nKey: 'listing.exchange.status.confirmed', fallback: 'Confirmed' },
  { id: ExchangeRequestStatus.COMPLETED, i18nKey: 'listing.exchange.status.completed', fallback: 'Completed' },
  { id: ExchangeRequestStatus.DECLINED, i18nKey: 'listing.exchange.status.declined', fallback: 'Declined' },
  { id: ExchangeRequestStatus.CANCELLED, i18nKey: 'listing.exchange.status.cancelled', fallback: 'Cancelled' },
];

/** Host inline approve/decline for a pending request. Owns its own mutation. */
const HostPendingActions: React.FC<{ request: ExchangeRequest }> = ({ request }) => {
  const { t } = useTranslation();
  const mutation = useUpdateExchangeStatus(request.id);
  const [busy, setBusy] = useState<'confirm' | 'decline' | null>(null);

  if (request.status !== ExchangeRequestStatus.PENDING) return null;

  const handle = async (status: ExchangeRequestStatus) => {
    setBusy(status === ExchangeRequestStatus.CONFIRMED ? 'confirm' : 'decline');
    try {
      await mutation.mutateAsync({ status });
      toast.success(
        status === ExchangeRequestStatus.CONFIRMED
          ? t('listing.exchange.toasts.confirmed', 'Exchange confirmed')
          : t('listing.exchange.toasts.declined', 'Exchange declined'),
      );
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : t('listing.exchange.errors.failed', 'Could not update request');
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
        {t('listing.exchange.actions.approve', 'Approve')}
      </Button>
      <Button
        variant="secondary"
        size="small"
        loading={busy === 'decline'}
        disabled={mutation.isPending}
        onPress={() => handle(ExchangeRequestStatus.DECLINED)}
      >
        {t('listing.exchange.actions.decline', 'Decline')}
      </Button>
    </>
  );
};

export default function ExchangeRequestsScreen() {
  const { t } = useTranslation();
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
        title: t('listing.exchange.requestsTitle', 'Exchanges'),
        titlePosition: 'center',
      }}
    />
  );

  if (!isAuthed) {
    return (
      <View style={styles.root}>
        {header}
        <SafeAreaView edges={['bottom']} style={styles.safeArea}>
          <View style={styles.centerWrap}>
            <EmptyState
              icon="swap-horizontal"
              title={t('listing.exchange.signInTitle', 'Sign in to see your exchanges')}
              description={t(
                'listing.exchange.signInBody',
                'Your home swaps and hosting requests live here.',
              )}
              actionText={t('common.signIn', 'Sign in')}
              actionIcon="log-in-outline"
              onAction={() => showSignInModal()}
            />
          </View>
        </SafeAreaView>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      {header}
      <SafeAreaView edges={['bottom']} style={styles.safeArea}>
        <ScrollView contentContainerStyle={styles.content}>
          {/* Role segmented toggle */}
          <View style={styles.segmented}>
            <SegmentButton
              label={t('listing.exchange.asGuest', 'My requests')}
              active={role === 'guest'}
              onPress={() => setRole('guest')}
            />
            <SegmentButton
              label={t('listing.exchange.asHost', 'For my homes')}
              active={role === 'host'}
              onPress={() => setRole('host')}
            />
          </View>

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
                  variant={active ? 'solid' : 'outlined'}
                  color={active ? 'primary' : 'default'}
                  selected={active}
                  onPress={() => setStatusFilter(entry.id)}
                >
                  {t(entry.i18nKey, entry.fallback)}
                </Chip>
              );
            })}
          </ScrollView>

          {query.isPending ? <ListSkeleton rows={4} rowHeight={120} /> : null}

          {query.isError ? (
            <ErrorState
              icon="cloud-offline-outline"
              title={t('listing.exchange.loadErrorTitle', 'Couldn’t load exchanges')}
              description={query.error?.message ?? t('common.tryAgain', 'Please try again.')}
              retryLabel={t('common.retry', 'Retry')}
              onRetry={() => query.refetch()}
            />
          ) : null}

          {!query.isPending && !query.isError && items.length === 0 ? (
            <View style={styles.emptyWrap}>
              <EmptyState
                icon="swap-horizontal"
                title={
                  role === 'guest'
                    ? t('listing.exchange.emptyGuestTitle', 'No exchange requests yet')
                    : t('listing.exchange.emptyHostTitle', 'No requests for your homes yet')
                }
                description={
                  role === 'guest'
                    ? t(
                        'listing.exchange.emptyGuestBody',
                        'When you request a swap or hosting stay it shows up here.',
                      )
                    : t(
                        'listing.exchange.emptyHostBody',
                        'When someone proposes an exchange with your home it shows up here.',
                      )
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

interface SegmentButtonProps {
  label: string;
  active: boolean;
  onPress: () => void;
}

const SegmentButton: React.FC<SegmentButtonProps> = ({ label, active, onPress }) => (
  <Button
    variant={active ? 'primary' : 'ghost'}
    size="medium"
    onPress={onPress}
    style={styles.segmentButton}
  >
    {label}
  </Button>
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
    justifyContent: 'center',
  },
  emptyWrap: {
    paddingVertical: spacing['3xl'],
  },
  segmented: {
    flexDirection: 'row',
    gap: spacing.xs,
    backgroundColor: colors.surfaceElevated,
    borderRadius: radius.lg,
    padding: spacing.xs,
  },
  segmentButton: {
    flex: 1,
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
