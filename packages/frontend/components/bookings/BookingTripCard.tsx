/**
 * One upcoming booking as a Bloom `TripCard` — the card every booking surface
 * draws, whether the row is a paid stay, a swap or a viewing.
 *
 * Nothing on it is invented. The photo, the title and the PUBLISHED location
 * label come from the listing (ADR 0003: never the street address); the dates
 * and the status come from the row. There is no "Message host" and no
 * "Directions" — Homiio has no conversation attached to a booking, and
 * directions would need a precision the listing does not publish.
 *
 * **An external listing keeps its source CTA and gets no in-app action.** The
 * card stops being a button and carries `ExternalSourceButton` instead, so a
 * row pointing at somebody else's advertisement cannot lead into a Homiio flow.
 *
 * Dates are formatted by KIND, and the difference is not cosmetic: a stay's
 * window is a pair of civil dates stored at midnight UTC, so formatting it in
 * the device zone would slide a check-in to the previous day west of Greenwich;
 * a viewing is an instant and belongs in the reader's own zone, named, with the
 * clock time that instant actually lands on.
 */
import React from 'react';
import { useTranslation } from 'react-i18next';
import { router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';

import { TripCard } from '@oxy.so/bloom/booking';
import { deviceTimeZone, formatDate, formatDateRange } from '@homiio/shared-types';

import { ExternalSourceButton } from '@/components/property/ExternalSourceButton';
import { propertyService } from '@/services/propertyService';
import { useFormatting } from '@/utils/format';
import {
  getPropertyLocationLabel,
  getPropertyPhotoUrls,
  getPropertyTitle,
} from '@/utils/propertyUtils';
import type { UpcomingBooking } from '@/utils/upcomingBookings';

/** Where a booking of each kind opens in Homiio. Viewings have no detail route. */
const routeFor = (booking: UpcomingBooking): string => {
  switch (booking.kind) {
    case 'stay':
      return `/reservations/${booking.id}`;
    case 'swap':
      return `/exchange/${booking.id}`;
    case 'viewing':
      return '/viewings';
  }
};

export function BookingTripCard({
  booking,
  testIDPrefix = 'booking-trip',
}: {
  booking: UpcomingBooking;
  testIDPrefix?: string;
}) {
  const { t } = useTranslation();
  const { locale } = useFormatting();

  // The same key and fetcher as `useProperty`, so the detail screen opens warm.
  const { data: property } = useQuery({
    queryKey: ['property', booking.propertyId],
    queryFn: () => propertyService.getPropertyById(booking.propertyId),
    staleTime: 1000 * 30,
    gcTime: 1000 * 60 * 10,
  });

  const title = property ? getPropertyTitle(property) : t('reservations.card.propertyFallback');
  const place = property ? getPropertyLocationLabel(property) : '';
  const kindLabel =
    booking.kind === 'swap' && booking.mode
      ? t(`listing.exchange.mode.${booking.mode}`)
      : t(`bookings.kind.${booking.kind}`);
  const subtitle = [kindLabel, place].filter(Boolean).join(' · ');
  const image = property
    ? getPropertyPhotoUrls(property.images, property.coverImageIndex, 'medium')[0]
    : undefined;

  const dates =
    booking.kind === 'viewing'
      ? formatDate(booking.start, locale, deviceTimeZone(), {
          year: 'numeric',
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
          timeZoneName: 'short',
        })
      : formatDateRange(booking.start, booking.end, locale, 'UTC', { dateStyle: 'medium' });

  const statusLabel =
    booking.kind === 'viewing'
      ? t(`viewings.status.${booking.status === 'confirmed' ? 'approved' : 'pending'}`)
      : t(`statusBadge.reservation.${booking.status}`);

  const isExternal = Boolean(property?.isExternal);

  return (
    <TripCard
      image={image}
      title={title}
      subtitle={subtitle || undefined}
      dates={dates || undefined}
      status={booking.status}
      statusLabel={statusLabel}
      actions={isExternal && property ? <ExternalSourceButton property={property} /> : undefined}
      onPress={isExternal ? undefined : () => router.push(routeFor(booking))}
      testID={`${testIDPrefix}-${booking.key}`}
    />
  );
}

export default BookingTripCard;
