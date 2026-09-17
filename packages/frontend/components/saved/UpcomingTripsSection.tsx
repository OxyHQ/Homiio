/**
 * Upcoming stays and swaps as Bloom `TripCard`s — the booking summaries the
 * housing template puts beside saved searches.
 *
 * Built only from what Homiio records: the reservations the person booked as a
 * guest and the exchange requests they sent, each still pending or confirmed
 * and not yet over. The card shows the listing's cover, title and PUBLISHED
 * location label (ADR 0003 — never the street address), the dates and the
 * status. There are no "Message host" or "Directions" actions: a reservation
 * carries no conversation, and directions would need a precise address the
 * listing does not publish.
 *
 * With nothing upcoming the section renders nothing at all.
 */
import React, { useMemo } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';

import { TripCard, type TripStatus } from '@oxy.so/bloom/booking';
import { Button } from '@oxy.so/bloom/button';
import { RiArrowRightSLine } from '@oxy.so/bloom/icons';
import {
  ExchangeRequestStatus,
  ReservationStatus,
  formatDateRange,
  type ExchangeMode,
} from '@homiio/shared-types';

import { useMyExchangeRequests } from '@/hooks/useExchangeQueries';
import { useReservationsQuery } from '@/hooks/useReservationQueries';
import { propertyService } from '@/services/propertyService';
import { useFormatting } from '@/utils/format';
import {
  getPropertyLocationLabel,
  getPropertyPhotoUrls,
  getPropertyTitle,
} from '@/utils/propertyUtils';

import { SavedSection } from './SavedSection';

/** How many upcoming trips the section lists before "All stays" / "All swaps". */
const MAX_TRIPS = 4;

interface UpcomingTrip {
  readonly key: string;
  readonly kind: 'stay' | 'swap';
  readonly id: string;
  readonly propertyId: string;
  readonly start: string;
  readonly end: string;
  readonly status: TripStatus;
  readonly mode?: ExchangeMode;
}

const isOpen = (status: string): status is 'pending' | 'confirmed' =>
  status === ReservationStatus.PENDING ||
  status === ReservationStatus.CONFIRMED ||
  status === ExchangeRequestStatus.PENDING ||
  status === ExchangeRequestStatus.CONFIRMED;

/** Not over yet: the last day is today or later. */
const notOver = (end: string, now: Date): boolean => {
  const time = new Date(end).getTime();
  return Number.isFinite(time) && time >= now.getTime() - 24 * 60 * 60 * 1000;
};

function TripItem({ trip }: { trip: UpcomingTrip }) {
  const { t } = useTranslation();
  const { locale } = useFormatting();
  // The same key and fetcher as `useProperty`, so the detail screen opens warm.
  const { data: property } = useQuery({
    queryKey: ['property', trip.propertyId],
    queryFn: () => propertyService.getPropertyById(trip.propertyId),
    staleTime: 1000 * 30,
    gcTime: 1000 * 60 * 10,
  });

  const title = property ? getPropertyTitle(property) : t('reservations.card.propertyFallback');
  const place = property ? getPropertyLocationLabel(property) : '';
  const subtitle =
    trip.kind === 'swap' && trip.mode
      ? [t(`listing.exchange.mode.${trip.mode}`), place].filter(Boolean).join(' · ')
      : place || undefined;
  const image = property
    ? getPropertyPhotoUrls(property.images, property.coverImageIndex, 'medium')[0]
    : undefined;

  return (
    <TripCard
      image={image}
      title={title}
      subtitle={subtitle}
      // Stay dates are civil dates stored at midnight UTC; formatting them in
      // UTC keeps a check-in from sliding to the previous day west of Greenwich.
      dates={formatDateRange(trip.start, trip.end, locale, 'UTC', { dateStyle: 'medium' }) || undefined}
      status={trip.status}
      statusLabel={t(`statusBadge.reservation.${trip.status}`)}
      onPress={() => router.push(trip.kind === 'stay' ? `/reservations/${trip.id}` : `/exchange/${trip.id}`)}
      testID={`saved-trip-${trip.key}`}
    />
  );
}

export function UpcomingTripsSection({
  enabled,
  style,
}: {
  enabled: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const { t } = useTranslation();
  const reservations = useReservationsQuery({ limit: 50 }, { enabled });
  const exchanges = useMyExchangeRequests({ limit: 50 }, { enabled });

  const reservationItems = reservations.data?.items;
  const exchangeItems = exchanges.data?.items;

  // `dataUpdatedAt` as "now" keeps the render pure; it advances on every refetch.
  const now = Math.max(reservations.dataUpdatedAt, exchanges.dataUpdatedAt);

  const trips = useMemo<UpcomingTrip[]>(() => {
    const at = new Date(now);
    const stays: UpcomingTrip[] = (reservationItems ?? [])
      .filter((r) => isOpen(r.status) && notOver(r.checkOut, at))
      .map((r) => ({
        key: `stay-${r.id}`,
        kind: 'stay',
        id: r.id,
        propertyId: r.propertyId,
        start: r.checkIn,
        end: r.checkOut,
        status: r.status as TripStatus,
      }));
    const swaps: UpcomingTrip[] = (exchangeItems ?? [])
      .filter((x) => isOpen(x.status) && notOver(x.requestedWindow.end, at))
      .map((x) => ({
        key: `swap-${x.id}`,
        kind: 'swap',
        id: x.id,
        propertyId: x.propertyId,
        start: x.requestedWindow.start,
        end: x.requestedWindow.end,
        status: x.status as TripStatus,
        mode: x.mode,
      }));
    return [...stays, ...swaps].sort(
      (a, b) => new Date(a.start).getTime() - new Date(b.start).getTime(),
    );
  }, [reservationItems, exchangeItems, now]);

  if (!enabled || trips.length === 0) return null;

  const hasStays = trips.some((trip) => trip.kind === 'stay');
  const hasSwaps = trips.some((trip) => trip.kind === 'swap');

  return (
    <SavedSection title={t('saved.sections.trips')} style={style} testID="saved-trips">
      <View style={{ gap: 12 }}>
        {trips.slice(0, MAX_TRIPS).map((trip) => (
          <TripItem key={trip.key} trip={trip} />
        ))}
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {hasStays ? (
          <Button variant="ghost" size="small" trailingIcon={RiArrowRightSLine} onPress={() => router.push('/stays')}>
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
    </SavedSection>
  );
}
