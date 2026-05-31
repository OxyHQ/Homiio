/**
 * Host reservations inbox.
 *
 * Stream Q polish:
 *   - Bloom Chip filter row, Bloom Button actions, Bloom Skeleton + Loading.
 *   - Shared EmptyState / ErrorState components.
 *   - SectionEyebrow + H2 with design tokens for visual rhythm.
 */
import React, { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { toast } from '@/lib/sonner';
import { Button } from '@oxyhq/bloom/button';
import { Chip } from '@oxyhq/bloom/chip';
import * as Skeleton from '@oxyhq/bloom/skeleton';
import { H2 } from '@oxyhq/bloom/typography';
import { useOxy, showSignInModal } from '@oxyhq/services';
import {
  Reservation,
  ReservationStatus,
} from '@homiio/shared-types';
import { Header } from '@/components/Header';
import { ReservationCard } from '@/components/ReservationCard';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { SectionEyebrow } from '@/components/ui/SectionEyebrow';
import {
  useReservationsQuery,
  useUpdateReservation,
} from '@/hooks/useReservationQueries';
import { radius, spacing, withShadow } from '@/constants/styles';
import { colors } from '@/styles/colors';

type StatusFilter = 'all' | ReservationStatus;

const FILTERS: { id: StatusFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: ReservationStatus.PENDING, label: 'Pending' },
  { id: ReservationStatus.CONFIRMED, label: 'Confirmed' },
  { id: ReservationStatus.DECLINED, label: 'Declined' },
  { id: ReservationStatus.CANCELLED, label: 'Cancelled' },
  { id: ReservationStatus.COMPLETED, label: 'Completed' },
];

interface PendingActionsProps {
  reservation: Reservation;
}

const PendingActions: React.FC<PendingActionsProps> = ({ reservation }) => {
  const router = useRouter();
  const mutation = useUpdateReservation(reservation.id);
  const [busyAction, setBusyAction] = useState<'confirm' | 'decline' | null>(
    null,
  );

  const handle = async (target: ReservationStatus) => {
    setBusyAction(target === ReservationStatus.CONFIRMED ? 'confirm' : 'decline');
    try {
      await mutation.mutateAsync({ status: target });
      toast.success(
        target === ReservationStatus.CONFIRMED
          ? 'Reservation confirmed'
          : 'Reservation declined',
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Update failed';
      toast.error(message);
    } finally {
      setBusyAction(null);
    }
  };

  if (reservation.status !== ReservationStatus.PENDING) return null;

  return (
    <>
      <Button
        variant="primary"
        size="small"
        loading={busyAction === 'confirm'}
        disabled={mutation.isPending}
        onPress={() => handle(ReservationStatus.CONFIRMED)}
      >
        Approve
      </Button>
      <Button
        variant="secondary"
        size="small"
        loading={busyAction === 'decline'}
        disabled={mutation.isPending}
        onPress={() => handle(ReservationStatus.DECLINED)}
      >
        Decline
      </Button>
      <Button
        variant="ghost"
        size="small"
        onPress={() => router.push(`/reservations/${reservation.id}`)}
      >
        View
      </Button>
    </>
  );
};

const ReservationListSkeleton: React.FC = () => (
  <View style={styles.listWrap}>
    {Array.from({ length: 3 }).map((_, index) => (
      <View key={index} style={styles.skeletonCard}>
        <View style={styles.skeletonHeader}>
          <Skeleton.Text style={{ width: 140, lineHeight: 20 }} />
          <Skeleton.Pill size={20} />
        </View>
        <Skeleton.Text style={{ width: 200, lineHeight: 16 }} />
        <Skeleton.Text style={{ width: 160, lineHeight: 14 }} />
      </View>
    ))}
  </View>
);

export default function HostReservationsScreen() {
  const { oxyServices, activeSessionId } = useOxy();
  const isAuthed = Boolean(oxyServices && activeSessionId);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');

  const reservationsQuery = useReservationsQuery(
    {
      asHost: true,
      limit: 100,
      status: statusFilter === 'all' ? undefined : statusFilter,
    },
    { enabled: isAuthed },
  );

  const items = useMemo<Reservation[]>(
    () => reservationsQuery.data?.items ?? [],
    [reservationsQuery.data?.items],
  );

  if (!isAuthed) {
    return (
      <View style={styles.root}>
        <Header
          options={{
            showBackButton: true,
            title: 'Reservations',
            titlePosition: 'center',
          }}
        />
        <SafeAreaView edges={['bottom']} style={styles.safeArea}>
          <View style={styles.emptyWrap}>
            <EmptyState
              icon="mail-unread-outline"
              title="Sign in to manage reservations"
              description="Approve or decline guest requests from one place."
              actionText="Sign in"
              actionIcon="log-in-outline"
              onAction={() => showSignInModal()}
            />
          </View>
        </SafeAreaView>
      </View>
    );
  }

  const activeLabel =
    statusFilter === 'all'
      ? 'All reservations'
      : FILTERS.find((entry) => entry.id === statusFilter)?.label ?? 'Reservations';

  return (
    <View style={styles.root}>
      <Header
        options={{
          showBackButton: true,
          title: 'Reservations',
          titlePosition: 'center',
        }}
      />
      <SafeAreaView edges={['bottom']} style={styles.safeArea}>
        <ScrollView contentContainerStyle={styles.content}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.filterRow}
          >
            {FILTERS.map((entry) => {
              const isActive = statusFilter === entry.id;
              return (
                <Chip
                  key={entry.id}
                  onPress={() => setStatusFilter(entry.id)}
                  variant={isActive ? 'solid' : 'outlined'}
                  color={isActive ? 'primary' : 'default'}
                  selected={isActive}
                >
                  {entry.label}
                </Chip>
              );
            })}
          </ScrollView>

          {reservationsQuery.isLoading ? <ReservationListSkeleton /> : null}

          {reservationsQuery.isError ? (
            <ErrorState
              icon="cloud-offline-outline"
              title="Couldn't load reservations"
              description={
                reservationsQuery.error?.message ?? 'Please try again.'
              }
              onRetry={() => reservationsQuery.refetch()}
            />
          ) : null}

          {!reservationsQuery.isLoading &&
          !reservationsQuery.isError &&
          items.length === 0 ? (
            <View style={styles.emptyWrap}>
              <EmptyState
                icon="mail-outline"
                title="No reservations yet"
                description="When guests book your places, requests will show up here."
              />
            </View>
          ) : null}

          {items.length > 0 ? (
            <View style={styles.listWrap}>
              <View style={styles.sectionHeader}>
                <SectionEyebrow>Reservations</SectionEyebrow>
                <H2 style={styles.sectionTitle}>{activeLabel}</H2>
              </View>
              {items.map((reservation) => (
                <ReservationCard
                  key={reservation.id}
                  reservation={reservation}
                  variant="host"
                  actions={<PendingActions reservation={reservation} />}
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
    backgroundColor: colors.background,
  },
  safeArea: {
    flex: 1,
  },
  content: {
    padding: spacing.lg,
    gap: spacing.lg,
  },
  filterRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingVertical: spacing.xs,
  },
  emptyWrap: {
    flex: 1,
    justifyContent: 'center',
  },
  listWrap: {
    gap: spacing.md,
  },
  sectionHeader: {
    gap: spacing.xs,
    paddingHorizontal: spacing.xs,
  },
  sectionTitle: {
    letterSpacing: -0.5,
  },
  skeletonCard: {
    backgroundColor: colors.surfaceElevated,
    padding: spacing.lg,
    borderRadius: radius.lg,
    gap: spacing.sm,
    ...withShadow('sm'),
  },
  skeletonHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
});
