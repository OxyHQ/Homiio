import React, { useMemo } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Text as BloomText, H3 } from '@oxyhq/bloom/typography';
import { Button } from '@oxyhq/bloom/button';
import { useOxy, showSignInModal } from '@oxyhq/services';
import {
  Reservation,
  ReservationStatus,
} from '@homiio/shared-types';
import { Header } from '@/components/Header';
import { ReservationCard } from '@/components/ReservationCard';
import { EmptyState } from '@/components/ui/EmptyState';
import { useReservationsQuery } from '@/hooks/useReservationQueries';
import { colors } from '@/styles/colors';

interface Buckets {
  upcoming: Reservation[];
  past: Reservation[];
  cancelled: Reservation[];
}

const bucketReservations = (items: Reservation[]): Buckets => {
  const now = Date.now();
  const buckets: Buckets = { upcoming: [], past: [], cancelled: [] };
  for (const reservation of items) {
    const checkOut = new Date(reservation.checkOut).getTime();
    const checkIn = new Date(reservation.checkIn).getTime();
    if (
      reservation.status === ReservationStatus.CANCELLED ||
      reservation.status === ReservationStatus.DECLINED
    ) {
      buckets.cancelled.push(reservation);
      continue;
    }
    if (reservation.status === ReservationStatus.COMPLETED || checkOut < now) {
      buckets.past.push(reservation);
      continue;
    }
    if (
      (reservation.status === ReservationStatus.PENDING ||
        reservation.status === ReservationStatus.CONFIRMED) &&
      checkIn >= now - 24 * 60 * 60 * 1000
    ) {
      buckets.upcoming.push(reservation);
      continue;
    }
    buckets.past.push(reservation);
  }
  return buckets;
};

export default function TripsScreen() {
  const router = useRouter();
  const { oxyServices, activeSessionId } = useOxy();
  const isAuthed = Boolean(oxyServices && activeSessionId);
  const reservationsQuery = useReservationsQuery(
    { limit: 50 },
    { enabled: isAuthed },
  );

  const buckets = useMemo(
    () => bucketReservations(reservationsQuery.data?.items ?? []),
    [reservationsQuery.data?.items],
  );

  if (!isAuthed) {
    return (
      <View style={styles.root}>
        <Header
          options={{
            showBackButton: true,
            title: 'Trips',
            titlePosition: 'center',
          }}
        />
        <SafeAreaView edges={['bottom']} style={styles.safeArea}>
          <View style={styles.emptyWrapper}>
            <EmptyState
              icon="airplane-outline"
              title="Sign in to see your trips"
              description="Reservations across hosts and dates live here."
              actionText="Sign in"
              actionIcon="log-in-outline"
              onAction={() => showSignInModal()}
            />
          </View>
        </SafeAreaView>
      </View>
    );
  }

  if (reservationsQuery.isPending) {
    return (
      <View style={styles.root}>
        <Header
          options={{
            showBackButton: true,
            title: 'Trips',
            titlePosition: 'center',
          }}
        />
        <View style={styles.loadingWrapper}>
          <ActivityIndicator color={colors.primaryColor} />
        </View>
      </View>
    );
  }

  if (reservationsQuery.isError) {
    return (
      <View style={styles.root}>
        <Header
          options={{
            showBackButton: true,
            title: 'Trips',
            titlePosition: 'center',
          }}
        />
        <SafeAreaView edges={['bottom']} style={styles.safeArea}>
          <View style={styles.errorWrap}>
            <BloomText style={styles.errorTitle}>
              Couldn't load your trips
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
        </SafeAreaView>
      </View>
    );
  }

  const hasItems =
    buckets.upcoming.length + buckets.past.length + buckets.cancelled.length > 0;

  return (
    <View style={styles.root}>
      <Header
        options={{
          showBackButton: true,
          title: 'Trips',
          titlePosition: 'center',
        }}
      />
      <SafeAreaView edges={['bottom']} style={styles.safeArea}>
        <ScrollView contentContainerStyle={styles.content}>
          {!hasItems ? (
            <EmptyState
              icon="bed-outline"
              title="No trips yet"
              description="Once you book a stay it will show up here."
              actionText="Explore stays"
              actionIcon="search-outline"
              onAction={() => router.push('/search')}
            />
          ) : null}
          {buckets.upcoming.length > 0 ? (
            <Section title="Upcoming" items={buckets.upcoming} />
          ) : null}
          {buckets.past.length > 0 ? (
            <Section title="Past" items={buckets.past} />
          ) : null}
          {buckets.cancelled.length > 0 ? (
            <Section title="Cancelled" items={buckets.cancelled} />
          ) : null}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

interface SectionProps {
  title: string;
  items: Reservation[];
}

const Section: React.FC<SectionProps> = ({ title, items }) => (
  <View style={styles.section}>
    <H3 style={styles.sectionTitle}>{title}</H3>
    {items.map((reservation) => (
      <ReservationCard key={reservation.id} reservation={reservation} />
    ))}
  </View>
);

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
  emptyWrapper: {
    flex: 1,
    justifyContent: 'center',
  },
  loadingWrapper: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  errorWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
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
  section: {
    marginBottom: 8,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 8,
  },
});
