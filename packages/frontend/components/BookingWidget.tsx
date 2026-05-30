import React, { useCallback, useMemo, useState } from 'react';
import { Modal, Platform, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { format } from 'date-fns';
import { toast } from '@/lib/sonner';
import { Button } from '@oxyhq/bloom/button';
import { Text as BloomText, H3 } from '@oxyhq/bloom/typography';
import { useOxy, showSignInModal } from '@oxyhq/services';
import {
  Property,
  RentMode,
  CancellationPolicy,
} from '@homiio/shared-types';
import { Ionicons } from '@expo/vector-icons';
import {
  AvailabilityCalendar,
  AvailabilityCalendarRange,
} from '@/components/AvailabilityCalendar';
import { GuestSelector, GuestCounts } from '@/components/GuestSelector';
import { PriceBreakdown } from '@/components/PriceBreakdown';
import {
  useCreateReservation,
  usePropertyAvailabilityQuery,
} from '@/hooks/useReservationQueries';
import { colors } from '@/styles/colors';

export interface BookingWidgetProps {
  property: Property;
}

const DEFAULT_GUESTS: GuestCounts = { adults: 1, children: 0, infants: 0 };

type SheetVariant = 'calendar' | 'guests' | null;

const formatDateRange = (range: AvailabilityCalendarRange | null): string => {
  if (!range) return 'Add dates';
  return `${format(range.checkIn, 'MMM d')} → ${format(range.checkOut, 'MMM d')}`;
};

const formatGuestsLabel = (counts: GuestCounts): string => {
  const billable = counts.adults + counts.children;
  const guestWord = billable === 1 ? 'guest' : 'guests';
  if (counts.infants === 0) return `${billable} ${guestWord}`;
  const infantWord = counts.infants === 1 ? 'infant' : 'infants';
  return `${billable} ${guestWord}, ${counts.infants} ${infantWord}`;
};

const computeNights = (
  range: AvailabilityCalendarRange | null,
): number => {
  if (!range) return 0;
  const ms = range.checkOut.getTime() - range.checkIn.getTime();
  return Math.max(0, Math.round(ms / (1000 * 60 * 60 * 24)));
};

const isVacationCapable = (property: Property): boolean => {
  if (property.rentMode === RentMode.LONG_TERM) return false;
  if (property.isExternal) return false;
  return true;
};

export const BookingWidget: React.FC<BookingWidgetProps> = ({ property }) => {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { oxyServices, activeSessionId } = useOxy();
  const propertyId = property._id || property.id || '';
  const [sheet, setSheet] = useState<SheetVariant>(null);
  const [range, setRange] = useState<AvailabilityCalendarRange | null>(null);
  const [guests, setGuests] = useState<GuestCounts>(DEFAULT_GUESTS);

  const availabilityQuery = usePropertyAvailabilityQuery(propertyId, {
    enabled: Boolean(propertyId) && isVacationCapable(property),
  });

  const createMutation = useCreateReservation();

  const nightlyRate = property.rent?.amount ?? 0;
  const currency = (property.rent?.currency || 'EUR').toUpperCase();
  const cleaningFee = property.priceBreakdown?.cleaningFee ?? 0;
  const serviceFee = property.priceBreakdown?.serviceFee ?? 0;
  const taxesPercent = property.priceBreakdown?.taxesPercent ?? 0;
  const minStay = property.minStay;
  const maxStay = property.maxStay;
  const maxGuests = property.maxGuests;

  const nights = useMemo(() => computeNights(range), [range]);

  const closeSheet = useCallback(() => setSheet(null), []);

  const handleOpenCalendar = useCallback(() => setSheet('calendar'), []);
  const handleOpenGuests = useCallback(() => setSheet('guests'), []);

  const handleApplyDates = useCallback(
    (next: AvailabilityCalendarRange | null) => {
      setRange(next);
      setSheet(null);
    },
    [],
  );

  const handleReserve = useCallback(async () => {
    if (!oxyServices || !activeSessionId) {
      showSignInModal();
      return;
    }
    if (!range || nights === 0) {
      toast.error('Pick check-in and check-out dates first');
      return;
    }
    if (minStay && nights < minStay) {
      toast.error(`Minimum stay is ${minStay} ${minStay === 1 ? 'night' : 'nights'}`);
      return;
    }
    if (maxStay && nights > maxStay) {
      toast.error(`Maximum stay is ${maxStay} ${maxStay === 1 ? 'night' : 'nights'}`);
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
        error instanceof Error ? error.message : 'Booking failed';
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
  ]);

  if (!isVacationCapable(property)) return null;
  if (nightlyRate <= 0) return null;

  const buttonLabel = property.instantBook ? 'Reserve' : 'Request to book';

  return (
    <View style={styles.card}>
      <View style={styles.headerRow}>
        <BloomText style={styles.priceValue}>
          {currency} {nightlyRate}
          <BloomText style={styles.pricePer}> / night</BloomText>
        </BloomText>
        {property.instantBook ? (
          <View style={styles.instantBookPill}>
            <Ionicons name="flash" size={12} color={colors.primaryColor} />
            <BloomText style={styles.instantBookLabel}>Instant book</BloomText>
          </View>
        ) : null}
      </View>

      <View style={styles.triggerGrid}>
        <Pressable
          style={styles.triggerCell}
          onPress={handleOpenCalendar}
          accessibilityRole="button"
          accessibilityLabel="Select dates"
        >
          <BloomText style={styles.triggerLabel}>Dates</BloomText>
          <BloomText style={styles.triggerValue} numberOfLines={1}>
            {formatDateRange(range)}
          </BloomText>
        </Pressable>
        <View style={styles.triggerDivider} />
        <Pressable
          style={styles.triggerCell}
          onPress={handleOpenGuests}
          accessibilityRole="button"
          accessibilityLabel="Select guests"
        >
          <BloomText style={styles.triggerLabel}>Guests</BloomText>
          <BloomText style={styles.triggerValue} numberOfLines={1}>
            {formatGuestsLabel(guests)}
          </BloomText>
        </Pressable>
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
      {!property.instantBook ? (
        <BloomText style={styles.subnote}>
          You won't be charged yet. The host has 24 hours to respond.
        </BloomText>
      ) : null}
      {property.cancellationPolicy ? (
        <BloomText style={styles.subnote}>
          {policyLabel(property.cancellationPolicy)}
        </BloomText>
      ) : null}

      <Modal
        visible={sheet !== null}
        animationType={Platform.OS === 'web' ? 'fade' : 'slide'}
        transparent={Platform.OS === 'web'}
        onRequestClose={closeSheet}
      >
        <View style={styles.modalBackdrop}>
          <View
            style={[
              styles.modalSurface,
              // Native presents this surface as a bottom sheet pinned to the
              // bottom edge, so its content must clear the home indicator. On
              // web it is a centered card and needs no inset.
              Platform.OS === 'web' ? null : { paddingBottom: 16 + insets.bottom },
            ]}
          >
            <View style={styles.modalHeader}>
              <H3 style={styles.modalTitle}>
                {sheet === 'calendar' ? 'Select dates' : 'Guests'}
              </H3>
              <Button
                variant="icon"
                size="small"
                onPress={closeSheet}
                accessibilityLabel="Close"
              >
                {'×'}
              </Button>
            </View>
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
            ) : null}
            {sheet === 'guests' ? (
              <View style={styles.guestSheetBody}>
                <GuestSelector
                  value={guests}
                  maxGuests={maxGuests}
                  onChange={setGuests}
                  showHeader={false}
                />
                <Button
                  variant="primary"
                  size="medium"
                  onPress={closeSheet}
                  style={styles.guestDoneButton}
                >
                  Done
                </Button>
              </View>
            ) : null}
          </View>
        </View>
      </Modal>
    </View>
  );
};

const policyLabel = (policy: CancellationPolicy): string => {
  switch (policy) {
    case CancellationPolicy.FLEXIBLE:
      return 'Flexible cancellation — full refund any time before check-in.';
    case CancellationPolicy.MODERATE:
      return 'Moderate cancellation — full refund up to 5 days before check-in.';
    case CancellationPolicy.STRICT:
      return 'Strict cancellation — full refund up to 7 days before check-in.';
    case CancellationPolicy.SUPER_STRICT:
      return 'Super strict cancellation — full refund up to 30 days before check-in.';
    default:
      return '';
  }
};

const styles = StyleSheet.create({
  card: {
    borderRadius: 16,
    backgroundColor: colors.white,
    borderWidth: 1,
    borderColor: colors.COLOR_BLACK_LIGHT_6,
    padding: 20,
    gap: 14,
    marginVertical: 16,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  priceValue: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.COLOR_BLACK,
  },
  pricePer: {
    fontSize: 14,
    fontWeight: '500',
    color: colors.COLOR_BLACK_LIGHT_3,
  },
  instantBookPill: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.primaryLight_2,
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
    gap: 4,
  },
  instantBookLabel: {
    fontSize: 11,
    color: colors.primaryColor,
    fontWeight: '600',
  },
  triggerGrid: {
    borderWidth: 1,
    borderColor: colors.COLOR_BLACK_LIGHT_6,
    borderRadius: 12,
    flexDirection: 'row',
    overflow: 'hidden',
  },
  triggerCell: {
    flex: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    gap: 2,
  },
  triggerDivider: {
    width: 1,
    backgroundColor: colors.COLOR_BLACK_LIGHT_6,
  },
  triggerLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: colors.COLOR_BLACK_LIGHT_3,
    textTransform: 'uppercase',
  },
  triggerValue: {
    fontSize: 14,
    color: colors.COLOR_BLACK,
  },
  cta: {
    marginTop: 4,
  },
  subnote: {
    fontSize: 11,
    color: colors.COLOR_BLACK_LIGHT_4,
    textAlign: 'center',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: Platform.OS === 'web' ? 'center' : 'flex-end',
    alignItems: 'center',
  },
  modalSurface: {
    backgroundColor: colors.white,
    width: '100%',
    maxWidth: 720,
    maxHeight: '92%',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderBottomLeftRadius: Platform.OS === 'web' ? 24 : 0,
    borderBottomRightRadius: Platform.OS === 'web' ? 24 : 0,
    padding: 16,
    gap: 12,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
  },
  guestSheetBody: {
    gap: 12,
  },
  guestDoneButton: {
    alignSelf: 'stretch',
  },
});

export default BookingWidget;
