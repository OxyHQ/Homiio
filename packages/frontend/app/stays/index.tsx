/**
 * Stays — applicant-side list of vacation/short-term bookings.
 *
 * Polished to the Stream P personal-surface language:
 * - Bloom Chip filter (All / Upcoming / Past / Cancelled)
 * - Bloom Skeleton.Box list while loading (no spinner)
 * - Shared EmptyState / ErrorState components
 * - Bloom typography for every label
 */
import React, { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';

import { Chip } from '@oxyhq/bloom/chip';
import { Text as BloomText } from '@oxyhq/bloom/typography';
import { useOxy, showSignInModal } from '@oxyhq/services';
import {
  Reservation,
  ReservationStatus,
} from '@homiio/shared-types';

import { Header } from '@/components/Header';
import { ReservationCard } from '@/components/ReservationCard';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { ListSkeleton } from '@/components/ui/ListSkeleton';
import { useReservationsQuery } from '@/hooks/useReservationQueries';
import { colors } from '@/styles/colors';
import { spacing, tracker } from '@/constants/styles';

type Filter = 'all' | 'upcoming' | 'past' | 'cancelled';

interface FilterOption {
  value: Filter;
  label: string;
}

const FILTERS: FilterOption[] = [
  { value: 'all', label: 'All' },
  { value: 'upcoming', label: 'Upcoming' },
  { value: 'past', label: 'Past' },
  { value: 'cancelled', label: 'Cancelled' },
];

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

export default function StaysScreen() {
  const router = useRouter();
  const { oxyServices, activeSessionId } = useOxy();
  const isAuthed = Boolean(oxyServices && activeSessionId);
  const reservationsQuery = useReservationsQuery(
    { limit: 50 },
    { enabled: isAuthed },
  );
  const [filter, setFilter] = useState<Filter>('all');

  const buckets = useMemo(
    () => bucketReservations(reservationsQuery.data?.items ?? []),
    [reservationsQuery.data?.items],
  );

  const filteredGroups = useMemo<{ label: string; items: Reservation[] }[]>(() => {
    if (filter === 'all') {
      return [
        { label: 'Upcoming', items: buckets.upcoming },
        { label: 'Past', items: buckets.past },
        { label: 'Cancelled', items: buckets.cancelled },
      ].filter((group) => group.items.length > 0);
    }
    if (filter === 'upcoming') {
      return buckets.upcoming.length > 0
        ? [{ label: 'Upcoming', items: buckets.upcoming }]
        : [];
    }
    if (filter === 'past') {
      return buckets.past.length > 0
        ? [{ label: 'Past', items: buckets.past }]
        : [];
    }
    return buckets.cancelled.length > 0
      ? [{ label: 'Cancelled', items: buckets.cancelled }]
      : [];
  }, [filter, buckets]);

  const header = (
    <Header
      options={{
        showBackButton: true,
        title: 'Stays',
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
              icon="bed-outline"
              title="Sign in to see your stays"
              description="Bookings across hosts and dates live here."
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
        {header}
        <SafeAreaView edges={['bottom']} style={styles.safeArea}>
          <View style={styles.content}>
            <FilterRow value={filter} onChange={setFilter} />
            <ListSkeleton rows={4} rowHeight={140} />
          </View>
        </SafeAreaView>
      </View>
    );
  }

  if (reservationsQuery.isError) {
    return (
      <View style={styles.root}>
        {header}
        <SafeAreaView edges={['bottom']} style={styles.safeArea}>
          <View style={styles.centerWrap}>
            <ErrorState
              title="Couldn't load your stays"
              description={reservationsQuery.error?.message ?? 'Please try again.'}
              retryLabel="Retry"
              onRetry={() => reservationsQuery.refetch()}
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
          <FilterRow value={filter} onChange={setFilter} />

          {filteredGroups.length === 0 ? (
            <View style={styles.emptyWrap}>
              <EmptyState
                icon="bed-outline"
                title={filter === 'all' ? 'No stays yet' : 'Nothing in this view.'}
                description={
                  filter === 'all'
                    ? 'Once you book a place it will show up here.'
                    : 'Try a different filter or explore new stays.'
                }
                actionText={filter === 'all' ? 'Explore stays' : 'Explore stays'}
                actionIcon="search-outline"
                onAction={() => router.push('/search?rentMode=vacation')}
              />
            </View>
          ) : (
            filteredGroups.map((group) => (
              <View key={group.label} style={styles.section}>
                <BloomText style={styles.sectionEyebrow}>{group.label}</BloomText>
                <View style={styles.cards}>
                  {group.items.map((reservation) => (
                    <ReservationCard
                      key={reservation.id}
                      reservation={reservation}
                    />
                  ))}
                </View>
              </View>
            ))
          )}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

interface FilterRowProps {
  value: Filter;
  onChange: (next: Filter) => void;
}

const FilterRow: React.FC<FilterRowProps> = ({ value, onChange }) => (
  <ScrollView
    horizontal
    showsHorizontalScrollIndicator={false}
    contentContainerStyle={styles.filterRow}
  >
    {FILTERS.map((option) => (
      <Chip
        key={option.value}
        variant={value === option.value ? 'solid' : 'outlined'}
        color={value === option.value ? 'primary' : 'default'}
        size="medium"
        selected={value === option.value}
        onPress={() => onChange(option.value)}
      >
        {option.label}
      </Chip>
    ))}
  </ScrollView>
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
    gap: spacing['2xl'],
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
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xs,
  },
  section: {
    gap: spacing.md,
  },
  sectionEyebrow: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.muted,
    textTransform: 'uppercase',
    letterSpacing: tracker.eyebrow,
  },
  cards: {
    gap: spacing.md,
  },
});
