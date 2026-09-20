/**
 * useStayBooking — the state and actions of booking a short stay on a listing.
 *
 * One owner for the dates, guests, quote and the reservation call, so the
 * booking card beside a listing and the phone booking bar under it can share
 * one selection. The reservation API calls are the existing ones:
 * `usePropertyAvailabilityQuery` feeds the calendar's blocked days and
 * `useCreateReservation` creates the reservation.
 *
 * A listing is bookable here only when it carries the short-term offering with
 * a nightly rate and is NOT external — an external listing is booked on its
 * source website, never in Homiio.
 *
 * `dialog` is the dates dialog; whoever calls the hook renders it once.
 */
import React, { useCallback, useMemo, useState } from 'react';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Dialog } from '@oxy.so/bloom/dialog';
import { Text as BloomText } from '@oxy.so/bloom/typography';
import { toast } from '@oxy.so/bloom/toast';
import type { GuestCounts } from '@oxy.so/bloom/stay-search';
import { openAccountDialog, useOxy } from '@oxy.so/services';
import { formatMoney, type Property } from '@homiio/shared-types';

import {
  AvailabilityCalendar,
  type AvailabilityCalendarRange,
} from '@/components/AvailabilityCalendar';
import { useStayQuoteBreakdown } from '@/components/PriceBreakdown';
import {
  useCreateReservation,
  usePropertyAvailabilityQuery,
} from '@/hooks/useReservationQueries';
import { formatLocalized } from '@/utils/dateLocale';
import { useFormatting } from '@/utils/format';
import { isShortTermRentable } from '@/utils/propertyUtils';

const DEFAULT_GUESTS: GuestCounts = { adults: 1, children: 0, infants: 0, pets: 0 };
const DAY_MS = 1000 * 60 * 60 * 24;

export type StayDateField = 'checkIn' | 'checkOut';

export interface StayBooking {
  /** False when the listing cannot be booked in Homiio (no nightly rate, external). */
  bookable: boolean;
  /** The nightly rate, formatted in the listing's currency. */
  price: string;
  /** "night", translated. */
  priceUnit: string;
  /** The price spoken in full ("€110 per night"). */
  priceAccessibilityLabel: string;
  instantBook: boolean;
  maxGuests?: number;
  range: AvailabilityCalendarRange | null;
  /** Formatted check-in / checkout, `undefined` while unselected. */
  checkIn?: string;
  checkOut?: string;
  /** "Oct 12 – 17", `undefined` while unselected. */
  datesSummary?: string;
  guests: GuestCounts;
  setGuests: (next: GuestCounts) => void;
  /** "2 guests, 1 infant". */
  guestsSummary: string;
  /** The field whose picker is open, for the card's outline. */
  activeField: StayDateField | null;
  openDates: (field?: StayDateField) => void;
  breakdown: ReturnType<typeof useStayQuoteBreakdown>;
  /** Reserve (or request) the selected stay; opens the dates first when none are picked. */
  reserve: () => void;
  reserving: boolean;
  dialog: React.ReactNode;
}

type TFn = ReturnType<typeof useTranslation>['t'];

/** "2 guests, 1 infant" — infants are listed apart and do not count as guests. */
export function formatGuestSummary(t: TFn, counts: GuestCounts): string {
  const guests = t('booking.guests.count', { count: counts.adults + counts.children });
  if (counts.infants === 0) return guests;
  return `${guests}, ${t('booking.guests.infantCount', { count: counts.infants })}`;
}

export function useStayBooking(
  property: Property | null | undefined,
  options: { enabled?: boolean } = {},
): StayBooking {
  const { t } = useTranslation();
  const formatting = useFormatting();
  const router = useRouter();
  const { oxyServices, activeSessionId } = useOxy();

  const shortTerm = property?.shortTermRent;
  const nightlyRate = shortTerm?.nightlyRate ?? 0;
  const currency = (shortTerm?.currency || 'EUR').toUpperCase();
  const minStay = shortTerm?.minNights;
  const maxStay = shortTerm?.maxNights;
  const instantBook = Boolean(shortTerm?.instantBook);
  const propertyId = property?.id ? String(property.id) : '';
  const bookable = Boolean(
    property && !property.isExternal && isShortTermRentable(property) && nightlyRate > 0,
  );
  const active = bookable && (options.enabled ?? true);

  const [range, setRange] = useState<AvailabilityCalendarRange | null>(null);
  const [guests, setGuests] = useState<GuestCounts>(DEFAULT_GUESTS);
  const [datesOpen, setDatesOpen] = useState(false);
  const [activeField, setActiveField] = useState<StayDateField | null>(null);

  const availabilityQuery = usePropertyAvailabilityQuery(propertyId, { enabled: active });
  const createMutation = useCreateReservation();

  const nights = range
    ? Math.max(0, Math.round((range.checkOut.getTime() - range.checkIn.getTime()) / DAY_MS))
    : 0;

  const breakdown = useStayQuoteBreakdown({
    nights,
    nightlyRate,
    cleaningFee: shortTerm?.cleaningFee ?? 0,
    serviceFee: shortTerm?.serviceFee ?? 0,
    taxesPercent: shortTerm?.taxesPercent ?? 0,
    currency,
  });

  const openDates = useCallback((field: StayDateField = 'checkIn') => {
    setActiveField(field);
    setDatesOpen(true);
  }, []);

  const closeDates = useCallback(() => {
    setDatesOpen(false);
    setActiveField(null);
  }, []);

  const applyDates = useCallback((next: AvailabilityCalendarRange | null) => {
    setRange(next);
    setDatesOpen(false);
    setActiveField(null);
  }, []);

  const reserve = useCallback(async () => {
    if (!oxyServices || !activeSessionId) {
      openAccountDialog();
      return;
    }
    if (!range || nights === 0) {
      openDates('checkIn');
      return;
    }
    const unit = (count: number) => t(count === 1 ? 'booking.toast.night' : 'booking.toast.nights');
    if (minStay && nights < minStay) {
      toast.error(t('booking.toast.minStay', { count: minStay, unit: unit(minStay) }));
      return;
    }
    if (maxStay && nights > maxStay) {
      toast.error(t('booking.toast.maxStay', { count: maxStay, unit: unit(maxStay) }));
      return;
    }
    try {
      const reservation = await createMutation.mutateAsync({
        propertyId,
        checkIn: range.checkIn.toISOString(),
        checkOut: range.checkOut.toISOString(),
        guestCount: guests.adults + guests.children,
      });
      router.push(`/reservations/${reservation.id}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : t('booking.toast.failed'));
    }
  }, [
    oxyServices,
    activeSessionId,
    range,
    nights,
    minStay,
    maxStay,
    createMutation,
    propertyId,
    guests,
    router,
    openDates,
    t,
  ]);

  const price = nightlyRate > 0 ? formatMoney(nightlyRate, currency, formatting.locale) : '';
  const nightLabels = formatting.priceUnitLabels.night;

  const dialog = active ? (
    <Dialog
      open={datesOpen}
      onClose={closeDates}
      placement={{ base: 'bottom', md: 'center' }}
      maxWidth={720}
      title={t('booking.accessibility.selectDates')}
      label={t('booking.accessibility.selectDates')}
    >
      {/* The calendar is only as good as the answer behind it. The service used
          to turn a failed availability read into an empty calendar — every
          night free — so a failure looked exactly like an empty diary. It
          throws now, and the person is told what they are looking at. */}
      {availabilityQuery.isError ? (
        <BloomText
          variant="body-2-regular"
          className="px-4 pb-2 text-center text-muted-foreground"
        >
          {t('booking.calendar.unavailable')}
        </BloomText>
      ) : null}
      <AvailabilityCalendar
        mode="modal"
        windows={availabilityQuery.data?.windows}
        booked={availabilityQuery.data?.booked}
        minStay={minStay}
        maxStay={maxStay}
        initialRange={range}
        onApply={applyDates}
      />
    </Dialog>
  ) : null;

  const guestsSummary = useMemo(() => formatGuestSummary(t, guests), [t, guests]);

  return {
    bookable,
    price,
    priceUnit: nightLabels.short,
    priceAccessibilityLabel: price ? `${price} ${nightLabels.spoken}` : '',
    instantBook,
    maxGuests: property?.maxGuests,
    range,
    checkIn: range ? formatLocalized(range.checkIn, 'P') : undefined,
    checkOut: range ? formatLocalized(range.checkOut, 'P') : undefined,
    datesSummary: range
      ? `${formatLocalized(range.checkIn, 'MMM d')} – ${formatLocalized(range.checkOut, 'MMM d')}`
      : undefined,
    guests,
    setGuests,
    guestsSummary,
    activeField: datesOpen ? activeField : null,
    openDates,
    breakdown,
    reserve: () => void reserve(),
    reserving: createMutation.isPending,
    dialog,
  };
}
