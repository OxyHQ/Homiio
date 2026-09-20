/**
 * Upcoming stays and swaps on Saved, as Bloom `TripCard`s.
 *
 * ## Does a trip card belong on a collection surface at all?
 *
 * Yes, and the reason is the status it shows rather than the card. Saved is
 * where somebody keeps what they are CONSIDERING — searches they have not run
 * again, homes they have not decided about — so a swap request awaiting an
 * answer is the same kind of object as the rest of the page, and this is the
 * one surface that shows PENDING rows. What is already committed is a different
 * question, answered on My home, which asks for confirmed rows only. The split
 * is `statuses`, one argument, not two components.
 *
 * Viewings are deliberately NOT here. A viewing is a tour of a rental somebody
 * is applying for, not a trip, and it has its own screen; adding it to a
 * section headed "Upcoming stays and swaps" would make the heading a lie.
 *
 * ## A failed fetch is not an empty diary
 *
 * This section used to `return null` whenever the list came back empty — which
 * a failed request also does. A person whose reservations endpoint 500s was
 * shown a page with no trips section, indistinguishable from having no trips.
 * It now says so, and keeps whichever rows DID arrive.
 *
 * The classification (what counts as upcoming, and until when) lives in
 * `utils/upcomingBookings.ts` and is shared with My home.
 */
import React from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { Announcement } from '@oxy.so/bloom/announcement';
import { Button } from '@oxy.so/bloom/button';
import { RiAlertLine, RiArrowRightSLine } from '@oxy.so/bloom/icons';

import { BookingTripCard } from '@/components/bookings/BookingTripCard';
import { ErrorState } from '@/components/ui/ErrorState';
import { ListSkeleton } from '@/components/ui/ListSkeleton';
import { useUpcomingBookings } from '@/hooks/useUpcomingBookings';
import { OPEN_STATUSES } from '@/utils/upcomingBookings';

import { SavedSection } from './SavedSection';

/** How many upcoming trips the section lists before "All stays" / "All swaps". */
const MAX_TRIPS = 4;

export function UpcomingTripsSection({
  enabled,
  style,
}: {
  enabled: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const { t } = useTranslation();
  const bookings = useUpcomingBookings({ enabled, statuses: OPEN_STATUSES });
  const { items, isPending, isError, isPartial } = bookings;

  // Nothing upcoming, nothing failing: the section stays out of the page
  // entirely, as it always has. An empty state here would push the saved homes
  // down the screen to say nothing.
  if (!enabled || (!isPending && !isError && items.length === 0)) return null;

  const hasStays = items.some((booking) => booking.kind === 'stay');
  const hasSwaps = items.some((booking) => booking.kind === 'swap');

  return (
    <SavedSection title={t('saved.sections.trips')} style={style} testID="saved-trips">
      {isPending ? <ListSkeleton rows={2} rowHeight={140} /> : null}

      {isError && items.length === 0 ? (
        <ErrorState
          icon={RiAlertLine}
          title={t('bookings.upcoming.loadError')}
          description={bookings.error?.message}
          retryLabel={t('common.retry')}
          onRetry={bookings.refetch}
        />
      ) : null}

      {items.length > 0 ? (
        <View style={{ gap: 12 }}>
          {isPartial ? (
            <Announcement
              icon={RiAlertLine}
              title={t('bookings.upcoming.loadErrorPartial')}
              description={bookings.error?.message}
              actionLabel={t('common.retry')}
              onAction={bookings.refetch}
            />
          ) : null}
          {items.slice(0, MAX_TRIPS).map((booking) => (
            <BookingTripCard key={booking.key} booking={booking} testIDPrefix="saved-trip" />
          ))}
        </View>
      ) : null}

      {hasStays || hasSwaps ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {hasStays ? (
            <Button
              variant="ghost"
              size="small"
              trailingIcon={RiArrowRightSLine}
              onPress={() => router.push('/stays')}
            >
              {t('saved.trips.allStays')}
            </Button>
          ) : null}
          {hasSwaps ? (
            <Button
              variant="ghost"
              size="small"
              trailingIcon={RiArrowRightSLine}
              onPress={() => router.push('/exchange/requests')}
            >
              {t('saved.trips.allSwaps')}
            </Button>
          ) : null}
        </View>
      ) : null}
    </SavedSection>
  );
}
