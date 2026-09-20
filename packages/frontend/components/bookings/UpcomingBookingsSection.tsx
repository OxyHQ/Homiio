/**
 * "Coming up" — the dated commitments on a tenancy surface (#518 §7.5).
 *
 * ## Why this belongs on My home
 *
 * My home is the screen about the place somebody is living in and the
 * obligations attached to it. A confirmed stay next week, an accepted swap and
 * an approved viewing are the same KIND of fact as the rent date already on
 * this screen: a day with the person's name on it that they must not miss.
 * Until now the screen named for a person's home mentioned no reservation,
 * exchange or viewing at all, which §7.5 names as the gap — a confirmed
 * booking has to be "visible para ambas partes y actualizado en Saved/My home".
 *
 * Only COMMITTED rows are drawn here, not open requests. A swap somebody has
 * proposed is a hope, not a date; putting it beside a lease would make the
 * screen's promise — "these are your commitments" — false in the common case.
 * Pending requests stay on Saved, the collection surface, where considering
 * things is the point.
 *
 * ## The four states, drawn as four different things
 *
 * Loading is a skeleton, a total failure is an error with a retry, a partial
 * failure is the rows that DID arrive under a banner saying the rest did not,
 * and genuinely nothing is an empty state that says so. Collapsing any of the
 * first three into the fourth would tell a person they have no bookings on the
 * strength of a 500, which is the silent-empty failure this codebase keeps
 * having to fix.
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { Announcement } from '@oxy.so/bloom/announcement';
import { Button } from '@oxy.so/bloom/button';
import { RiAlertLine, RiArrowRightSLine, RiSuitcaseLine } from '@oxy.so/bloom/icons';
import { H3 } from '@oxy.so/bloom/typography';

import { BookingTripCard } from '@/components/bookings/BookingTripCard';
import { EmptyState } from '@/components/ui/EmptyState';
import { ErrorState } from '@/components/ui/ErrorState';
import { ListSkeleton } from '@/components/ui/ListSkeleton';
import type { UpcomingBookingsResult } from '@/hooks/useUpcomingBookings';
import { spacing } from '@/constants/styles';

/** How many are drawn before the "all of them" links take over. */
const MAX_CARDS = 4;

export function UpcomingBookingsSection({ bookings }: { bookings: UpcomingBookingsResult }) {
  const { t } = useTranslation();
  const { items, isPending, isError, isPartial } = bookings;

  const body = () => {
    if (isPending) return <ListSkeleton rows={2} rowHeight={140} />;
    if (isError && items.length === 0) {
      return (
        <ErrorState
          icon={RiAlertLine}
          title={t('bookings.upcoming.loadError')}
          description={bookings.error?.message}
          retryLabel={t('common.retry')}
          onRetry={bookings.refetch}
        />
      );
    }
    if (items.length === 0) {
      return (
        <EmptyState
          icon={RiSuitcaseLine}
          title={t('bookings.upcoming.emptyTitle')}
          description={t('bookings.upcoming.emptyDescription')}
        />
      );
    }
    return (
      <View style={styles.cards}>
        {isPartial ? (
          <Announcement
            icon={RiAlertLine}
            title={t('bookings.upcoming.loadErrorPartial')}
            description={bookings.error?.message}
            actionLabel={t('common.retry')}
            onAction={bookings.refetch}
          />
        ) : null}
        {items.slice(0, MAX_CARDS).map((booking) => (
          <BookingTripCard key={booking.key} booking={booking} testIDPrefix="my-home-booking" />
        ))}
      </View>
    );
  };

  const kinds = new Set(items.map((booking) => booking.kind));

  return (
    <View style={styles.section} testID="my-home-upcoming">
      <H3 style={styles.heading}>{t('bookings.upcoming.title')}</H3>
      {body()}
      {/* One link per kind actually present: a "All viewings" button on an
          account that has never booked one leads to an empty screen. */}
      {kinds.size > 0 ? (
        <View style={styles.links}>
          {kinds.has('stay') ? (
            <Button
              variant="ghost"
              size="small"
              trailingIcon={RiArrowRightSLine}
              onPress={() => router.push('/stays')}
            >
              {t('bookings.upcoming.allStays')}
            </Button>
          ) : null}
          {kinds.has('swap') ? (
            <Button
              variant="ghost"
              size="small"
              trailingIcon={RiArrowRightSLine}
              onPress={() => router.push('/exchange/requests')}
            >
              {t('bookings.upcoming.allSwaps')}
            </Button>
          ) : null}
          {kinds.has('viewing') ? (
            <Button
              variant="ghost"
              size="small"
              trailingIcon={RiArrowRightSLine}
              onPress={() => router.push('/viewings')}
            >
              {t('bookings.upcoming.allViewings')}
            </Button>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { gap: spacing.md },
  heading: { letterSpacing: -0.3 },
  cards: { gap: spacing.md },
  links: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
});

export default UpcomingBookingsSection;
