/**
 * Stays — applicant-side list of vacation/short-term bookings.
 *
 * Polished to the Stream P personal-surface language:
 * - Bloom SegmentedControl filter (All / Upcoming / Past / Cancelled)
 * - Bloom Skeleton.Box list while loading (no spinner)
 * - Shared EmptyState / ErrorState components
 * - Bloom typography for every label
 */
import React, { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import {
  SegmentedControl,
  SegmentedControlItem,
  SegmentedControlItemText,
} from '@oxy.so/bloom/segmented-control';
import { useOxy, openAccountDialog } from '@oxy.so/services';
import {
  Reservation,
  ReservationStatus,
} from '@homiio/shared-types';

import { Header } from '@/components/Header';
import { ReservationCard } from '@/components/ReservationCard';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { ListSkeleton } from '@/components/ui/ListSkeleton';
import { SectionEyebrow } from '@/components/ui/SectionEyebrow';
import { useReservationsQuery } from '@/hooks/useReservationQueries';
import { colors } from '@/styles/colors';
import { spacing } from '@/constants/styles';
import { RiHotelBedLine, RiLoginBoxLine, RiSearchLine } from '@oxy.so/bloom/icons';

type Filter = 'all' | 'upcoming' | 'past' | 'cancelled';

interface FilterOption {
  value: Filter;
  i18nKey: string;
}

const FILTERS: FilterOption[] = [
  { value: 'all', i18nKey: 'stays.list.filterAll' },
  { value: 'upcoming', i18nKey: 'stays.list.filterUpcoming' },
  { value: 'past', i18nKey: 'stays.list.filterPast' },
  { value: 'cancelled', i18nKey: 'stays.list.filterCancelled' },
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
  const { t } = useTranslation();
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
        { label: t('stays.list.groupUpcoming'), items: buckets.upcoming },
        { label: t('stays.list.groupPast'), items: buckets.past },
        { label: t('stays.list.groupCancelled'), items: buckets.cancelled },
      ].filter((group) => group.items.length > 0);
    }
    if (filter === 'upcoming') {
      return buckets.upcoming.length > 0
        ? [{ label: t('stays.list.groupUpcoming'), items: buckets.upcoming }]
        : [];
    }
    if (filter === 'past') {
      return buckets.past.length > 0
        ? [{ label: t('stays.list.groupPast'), items: buckets.past }]
        : [];
    }
    return buckets.cancelled.length > 0
      ? [{ label: t('stays.list.groupCancelled'), items: buckets.cancelled }]
      : [];
  }, [filter, buckets, t]);

  const header = (
    <Header
      options={{
        showBackButton: true,
        title: t('stays.list.title'),
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
              icon={RiHotelBedLine}
              title={t('stays.list.signInTitle')}
              description={t('stays.list.signInDescription')}
              actionText={t('stays.list.signIn')}
              actionIcon={RiLoginBoxLine}
              onAction={() => openAccountDialog()}
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
            <FilterRow value={filter} onChange={setFilter} t={t} />
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
              title={t('stays.list.loadError')}
              description={reservationsQuery.error?.message ?? t('stays.list.tryAgain')}
              retryLabel={t('applications.list.retry')}
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
          <FilterRow value={filter} onChange={setFilter} t={t} />

          {filteredGroups.length === 0 ? (
            <View style={styles.emptyWrap}>
              <EmptyState
                icon={RiHotelBedLine}
                title={
                  filter === 'all'
                    ? t('stays.list.emptyAllTitle')
                    : t('stays.list.emptyFilteredTitle')
                }
                description={
                  filter === 'all'
                    ? t('stays.list.emptyAllDescription')
                    : t('stays.list.emptyFilteredDescription')
                }
                actionText={t('stays.list.exploreStays')}
                actionIcon={RiSearchLine}
                onAction={() => router.push('/explore?offering=short_term_rent')}
              />
            </View>
          ) : (
            filteredGroups.map((group) => (
              <View key={group.label} style={styles.section}>
                <SectionEyebrow>{group.label}</SectionEyebrow>
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
  t: (key: string) => string;
}

const FilterRow: React.FC<FilterRowProps> = ({ value, onChange, t }) => (
  <SegmentedControl<Filter>
    label={t('stays.list.title')}
    type="tabs"
    value={value}
    onChange={onChange}
    style={styles.filterRow}
  >
    {FILTERS.map((option) => (
      <SegmentedControlItem key={option.value} value={option.value}>
        <SegmentedControlItemText>{t(option.i18nKey)}</SegmentedControlItemText>
      </SegmentedControlItem>
    ))}
  </SegmentedControl>
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
    alignSelf: 'flex-start',
  },
  section: {
    gap: spacing.md,
  },
  cards: {
    gap: spacing.md,
  },
});
