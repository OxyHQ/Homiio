import React, { useCallback, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { toast } from '@oxy.so/bloom/toast';
import { Button } from '@oxy.so/bloom/button';
import { Chip } from '@oxy.so/bloom/chip';
import { Dialog } from '@oxy.so/bloom/dialog';
import { RiFlashlightLine } from '@oxy.so/bloom/icons';
import { Item } from '@oxy.so/bloom/item';
import { useTheme } from '@oxy.so/bloom/theme';
import { Text as BloomText } from '@oxy.so/bloom/typography';
import { useOxy, openAccountDialog } from '@oxy.so/services';
import {
  Property,
  CancellationPolicy,
} from '@homiio/shared-types';
import { isShortTermRentable } from '@/utils/propertyUtils';
import {
  AvailabilityCalendar,
  AvailabilityCalendarRange,
} from '@/components/AvailabilityCalendar';
import {
  GuestSelector,
  GuestCounts,
  formatGuestSummary,
} from '@/components/GuestSelector';
import { PriceBreakdown } from '@/components/PriceBreakdown';
import {
  useCreateReservation,
  usePropertyAvailabilityQuery,
} from '@/hooks/useReservationQueries';
import { formatLocalized } from '@/utils/dateLocale';

export interface BookingWidgetProps {
  property: Property;
}

const DEFAULT_GUESTS: GuestCounts = { adults: 1, children: 0, infants: 0 };

type SheetVariant = 'calendar' | 'guests';

const computeNights = (
  range: AvailabilityCalendarRange | null,
): number => {
  if (!range) return 0;
  const ms = range.checkOut.getTime() - range.checkIn.getTime();
  return Math.max(0, Math.round(ms / (1000 * 60 * 60 * 24)));
};

const isVacationCapable = (property: Property): boolean => {
  // Bookable as a short-stay iff the listing carries the short-term offering.
  if (!isShortTermRentable(property)) return false;
  if (property.isExternal) return false;
  return true;
};

export const BookingWidget: React.FC<BookingWidgetProps> = ({ property }) => {
  const { t } = useTranslation();
  const theme = useTheme();
  const router = useRouter();
  const { oxyServices, activeSessionId } = useOxy();
  const propertyId = property.id || '';
  // `sheet` keeps the last variant while the dialog animates closed, so its
  // body does not blank mid-exit; `sheetOpen` is what drives the Dialog.
  const [sheet, setSheet] = useState<SheetVariant>('calendar');
  const [sheetOpen, setSheetOpen] = useState(false);
  const [range, setRange] = useState<AvailabilityCalendarRange | null>(null);
  const [guests, setGuests] = useState<GuestCounts>(DEFAULT_GUESTS);

  const availabilityQuery = usePropertyAvailabilityQuery(propertyId, {
    enabled: Boolean(propertyId) && isVacationCapable(property),
  });

  const createMutation = useCreateReservation();

  // All booking inputs come from the short-term priced block — the unit is a
  // per-night rate, never a reinterpreted monthly figure (fixes the overcharge).
  const shortTerm = property.shortTermRent;
  const nightlyRate = shortTerm?.nightlyRate ?? 0;
  const currency = (shortTerm?.currency || 'EUR').toUpperCase();
  const cleaningFee = shortTerm?.cleaningFee ?? 0;
  const serviceFee = shortTerm?.serviceFee ?? 0;
  const taxesPercent = shortTerm?.taxesPercent ?? 0;
  const minStay = shortTerm?.minNights;
  const maxStay = shortTerm?.maxNights;
  const instantBook = Boolean(shortTerm?.instantBook);
  const maxGuests = property.maxGuests;

  const nights = useMemo(() => computeNights(range), [range]);

  const closeSheet = useCallback(() => setSheetOpen(false), []);

  const handleOpenCalendar = useCallback(() => {
    setSheet('calendar');
    setSheetOpen(true);
  }, []);
  const handleOpenGuests = useCallback(() => {
    setSheet('guests');
    setSheetOpen(true);
  }, []);

  const handleApplyDates = useCallback(
    (next: AvailabilityCalendarRange | null) => {
      setRange(next);
      setSheetOpen(false);
    },
    [],
  );

  const handleReserve = useCallback(async () => {
    if (!oxyServices || !activeSessionId) {
      openAccountDialog();
      return;
    }
    if (!range || nights === 0) {
      toast.error(t('booking.toast.pickDates'));
      return;
    }
    if (minStay && nights < minStay) {
      toast.error(
        t('booking.toast.minStay', {
          count: minStay,
          unit: t(minStay === 1 ? 'booking.toast.night' : 'booking.toast.nights'),
        }),
      );
      return;
    }
    if (maxStay && nights > maxStay) {
      toast.error(
        t('booking.toast.maxStay', {
          count: maxStay,
          unit: t(maxStay === 1 ? 'booking.toast.night' : 'booking.toast.nights'),
        }),
      );
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
      const message =
        error instanceof Error ? error.message : t('booking.toast.failed');
      toast.error(message);
    }
  }, [
    activeSessionId,
    createMutation,
    guests,
    maxStay,
    minStay,
    nights,
    oxyServices,
    propertyId,
    range,
    router,
    t,
  ]);

  if (!isVacationCapable(property)) return null;
  if (nightlyRate <= 0) return null;

  const buttonLabel = instantBook
    ? t('property.cta.reserve')
    : t('booking.widget.requestToBook', 'Request to book');
  const datesLabel = range
    ? `${formatLocalized(range.checkIn, 'MMM d')} → ${formatLocalized(range.checkOut, 'MMM d')}`
    : t('search.summary.addDates');
  const sheetTitle =
    sheet === 'calendar' ? t('booking.accessibility.selectDates') : t('search.filters.guests');

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <BloomText style={styles.priceValue}>
          {currency} {nightlyRate}
          <BloomText style={[styles.pricePer, { color: theme.colors.textSecondary }]}>
            {' / '}
            {t('booking.widget.perNight', 'night')}
          </BloomText>
        </BloomText>
        {instantBook ? (
          <Chip
            size="small"
            color="primary"
            variant="subtle"
            startIcon={<RiFlashlightLine width={12} height={12} fill={theme.colors.primary} />}
          >
            {t('listing.badge.instantBook')}
          </Chip>
        ) : null}
      </View>

      <View style={[styles.triggerGrid, { borderColor: theme.colors.border }]}>
        <Item
          style={styles.triggerCell}
          density="compact"
          onPress={handleOpenCalendar}
          accessibilityLabel={t('booking.accessibility.selectDates')}
          title={t('booking.widget.dates', 'Dates')}
          titleStyle={[styles.triggerLabel, { color: theme.colors.textSecondary }]}
          subtitle={datesLabel}
          subtitleStyle={styles.triggerValue}
        />
        <View style={[styles.triggerDivider, { backgroundColor: theme.colors.border }]} />
        <Item
          style={styles.triggerCell}
          density="compact"
          onPress={handleOpenGuests}
          accessibilityLabel={t('booking.accessibility.selectGuests')}
          title={t('search.filters.guests')}
          titleStyle={[styles.triggerLabel, { color: theme.colors.textSecondary }]}
          subtitle={formatGuestSummary(t, guests)}
          subtitleStyle={styles.triggerValue}
        />
      </View>

      <PriceBreakdown
        nights={nights}
        nightlyRate={nightlyRate}
        cleaningFee={cleaningFee}
        serviceFee={serviceFee}
        taxesPercent={taxesPercent}
        currency={currency}
        compact
      />

      <Button
        variant="primary"
        size="large"
        onPress={handleReserve}
        loading={createMutation.isPending}
        disabled={createMutation.isPending}
        style={styles.cta}
      >
        {buttonLabel}
      </Button>
      {!instantBook ? (
        <BloomText style={[styles.subnote, { color: theme.colors.textSecondary }]}>
          {t(
            'booking.widget.requestNote',
            "You won't be charged yet. The host has 24 hours to respond.",
          )}
        </BloomText>
      ) : null}
      {property.cancellationPolicy ? (
        <BloomText style={[styles.subnote, { color: theme.colors.textSecondary }]}>
          {policyLabel(t, property.cancellationPolicy)}
        </BloomText>
      ) : null}

      <Dialog
        open={sheetOpen}
        onClose={closeSheet}
        placement={{ base: 'bottom', md: 'center' }}
        maxWidth={sheet === 'calendar' ? 720 : 480}
        title={sheetTitle}
        label={sheetTitle}
      >
        {sheet === 'calendar' ? (
          <AvailabilityCalendar
            mode="modal"
            windows={availabilityQuery.data?.windows}
            booked={availabilityQuery.data?.booked}
            minStay={minStay}
            maxStay={maxStay}
            initialRange={range}
            onApply={handleApplyDates}
          />
        ) : (
          <View style={styles.guestSheetBody}>
            <GuestSelector
              value={guests}
              maxGuests={maxGuests}
              onChange={setGuests}
              showHeader={false}
            />
            <Button variant="primary" size="medium" onPress={closeSheet}>
              {t('common.done')}
            </Button>
          </View>
        )}
      </Dialog>
    </View>
  );
};

type TFn = ReturnType<typeof useTranslation>['t'];

const policyLabel = (t: TFn, policy: CancellationPolicy): string => {
  switch (policy) {
    case CancellationPolicy.FLEXIBLE:
      return t(
        'booking.policy.flexible',
        'Flexible cancellation — full refund any time before check-in.',
      );
    case CancellationPolicy.MODERATE:
      return t(
        'booking.policy.moderate',
        'Moderate cancellation — full refund up to 5 days before check-in.',
      );
    case CancellationPolicy.STRICT:
      return t(
        'booking.policy.strict',
        'Strict cancellation — full refund up to 7 days before check-in.',
      );
    case CancellationPolicy.SUPER_STRICT:
      return t(
        'booking.policy.superStrict',
        'Super strict cancellation — full refund up to 30 days before check-in.',
      );
    default:
      return '';
  }
};

const styles = StyleSheet.create({
  // Flat content: no border / background / radius / outer margin — the
  // BookingCard (and the host chrome around it) owns the surface. We keep
  // only the internal vertical rhythm between rows.
  card: {
    gap: 14,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  priceValue: {
    fontSize: 20,
    fontWeight: '700',
  },
  pricePer: {
    fontSize: 14,
    fontWeight: '500',
  },
  triggerGrid: {
    borderWidth: 1,
    borderRadius: 12,
    flexDirection: 'row',
    overflow: 'hidden',
  },
  triggerCell: {
    flex: 1,
  },
  triggerDivider: {
    width: 1,
  },
  triggerLabel: {
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  triggerValue: {
    fontSize: 14,
  },
  cta: {
    marginTop: 4,
  },
  subnote: {
    fontSize: 11,
    textAlign: 'center',
  },
  guestSheetBody: {
    gap: 12,
  },
});

export default BookingWidget;
