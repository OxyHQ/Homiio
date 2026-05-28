import React, { useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { toast } from 'sonner';
import { Button } from '@oxyhq/bloom/button';
import { Chip } from '@oxyhq/bloom/chip';
import { Text as BloomText, H3 } from '@oxyhq/bloom/typography';
import { useOxy, showSignInModal } from '@oxyhq/services';
import {
  Reservation,
  ReservationStatus,
} from '@homiio/shared-types';
import { Header } from '@/components/Header';
import { ReservationCard } from '@/components/ReservationCard';
import { EmptyState } from '@/components/ui/EmptyState';
import {
  useReservationsQuery,
  useUpdateReservation,
} from '@/hooks/useReservationQueries';
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

          {reservationsQuery.isLoading ? (
            <View style={styles.loadingWrap}>
              <ActivityIndicator color={colors.primaryColor} />
            </View>
          ) : null}

          {reservationsQuery.isError ? (
            <View style={styles.errorWrap}>
              <BloomText style={styles.errorTitle}>
                Couldn't load reservations
              </BloomText>
              <BloomText style={styles.errorSubtitle}>
                {reservationsQuery.error?.message ?? 'Please try again.'}
              </BloomText>
              <Button
                variant="primary"
                size="medium"
                onPress={() => reservationsQuery.refetch()}
              >
                Retry
              </Button>
            </View>
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
              <H3 style={styles.sectionTitle}>
                {statusFilter === 'all'
                  ? 'All reservations'
                  : FILTERS.find((entry) => entry.id === statusFilter)?.label}
              </H3>
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
    backgroundColor: colors.primaryLight,
  },
  safeArea: {
    flex: 1,
  },
  content: {
    padding: 16,
    gap: 12,
  },
  filterRow: {
    flexDirection: 'row',
    gap: 8,
    paddingVertical: 4,
  },
  loadingWrap: {
    padding: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorWrap: {
    alignItems: 'center',
    padding: 24,
    gap: 12,
  },
  errorTitle: {
    fontSize: 17,
    fontWeight: '700',
  },
  errorSubtitle: {
    fontSize: 13,
    color: colors.COLOR_BLACK_LIGHT_3,
    textAlign: 'center',
  },
  emptyWrap: {
    flex: 1,
    justifyContent: 'center',
  },
  listWrap: {
    gap: 4,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 8,
  },
});
