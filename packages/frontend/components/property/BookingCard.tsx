/**
 * BookingCard — the booking / apply card of a listing, beside it in the app
 * shell's right column (`PropertyBookingWidget`) or inline on a narrow screen.
 *
 * Which card is decided by `resolveBookingMode` (the one branching source,
 * shared with the screen) and by whether the listing is external:
 *
 *  - short stay, bookable in Homiio → Bloom `BookingCard`: nightly price, the
 *    check-in / checkout / guests box (dates in the availability calendar,
 *    guests in Bloom's `GuestPicker`), Reserve for instant book or Request to
 *    book, and the itemised quote once dates are picked;
 *  - long-term rent → the same card frame holding the price and
 *    `ApplyToRentCTA` (move-in date + apply);
 *  - external listing (any mode) → the price and "View on source website";
 *    Homiio never books or applies for it.
 *
 * A rating is drawn only from the real review aggregate of the listing's
 * address (the same source the reviews section reads) and omitted without one.
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useRouter } from 'expo-router';

import { BookingCard as BloomBookingCard } from '@oxy.so/bloom/booking';
import { Button } from '@oxy.so/bloom/button';
import { Card } from '@oxy.so/bloom/card';
import { RiFlagLine } from '@oxy.so/bloom/icons';
import { Rating } from '@oxy.so/bloom/rating';
import { GuestPicker } from '@oxy.so/bloom/stay-search';
import { Text as BloomText } from '@oxy.so/bloom/typography';
import { CancellationPolicy, type Property } from '@homiio/shared-types';

import { ApplyToRentCTA } from '@/components/property/ApplyToRentCTA';
import { ExternalSourceButton } from '@/components/property/ExternalSourceButton';
import { useAddressReviews } from '@/hooks/useAddressReviews';
import { useStayBooking, type StayBooking } from '@/hooks/useStayBooking';
import { useRentalMode } from '@/context/RentalModeContext';
import { resolveBookingMode } from '@/utils/bookingMode';
import { resolveHeadlinePrice } from '@/utils/propertyPricing';
import { useFormatting } from '@/utils/format';

const GUEST_KINDS = ['adults', 'children', 'infants'] as const;

interface BookingCardProps {
  property: Property;
  /**
   * A stay selection owned by the screen, when the phone booking bar shares it.
   * Without one the card owns its selection and renders its own dates dialog.
   */
  stay?: StayBooking;
}

type TFn = ReturnType<typeof useTranslation>['t'];

const policyLabel = (t: TFn, policy: CancellationPolicy | undefined): string => {
  switch (policy) {
    case CancellationPolicy.FLEXIBLE:
      return t('booking.policy.flexible');
    case CancellationPolicy.MODERATE:
      return t('booking.policy.moderate');
    case CancellationPolicy.STRICT:
      return t('booking.policy.strict');
    case CancellationPolicy.SUPER_STRICT:
      return t('booking.policy.superStrict');
    default:
      return '';
  }
};

export const BookingCard: React.FC<BookingCardProps> = ({ property, stay }) => {
  const { t } = useTranslation();
  const router = useRouter();
  const formatting = useFormatting();
  const { mode: rentalMode } = useRentalMode();

  const bookingMode = resolveBookingMode(property, rentalMode);
  const ownStay = useStayBooking(property, { enabled: !stay && bookingMode === 'vacation' });
  const booking = stay ?? ownStay;

  const { ratingSummary } = useAddressReviews(property);
  const hasRating = ratingSummary.totalReviews > 0;

  const propertyId = String(property.id ?? '');
  const handleReport = () => {
    if (!propertyId) return;
    router.push({ pathname: '/properties/[id]/report', params: { id: propertyId } });
  };

  const reportLink = (
    <Button
      variant="link"
      linkTone="secondary"
      size="small"
      leadingIcon={RiFlagLine}
      onPress={handleReport}
    >
      {t('property.report.title')}
    </Button>
  );

  if (bookingMode === 'vacation' && booking.bookable) {
    const policy = policyLabel(t, property.cancellationPolicy);
    const datesChosen = Boolean(booking.range);
    return (
      <>
        <BloomBookingCard
          price={booking.price}
          priceUnit={booking.priceUnit}
          priceAccessibilityLabel={booking.priceAccessibilityLabel}
          rating={hasRating ? ratingSummary.averageRating : undefined}
          reviewCount={hasRating ? ratingSummary.totalReviews : undefined}
          checkIn={booking.checkIn}
          checkOut={booking.checkOut}
          guests={booking.guestsSummary}
          onPressDates={booking.openDates}
          activeField={booking.activeField}
          guestPicker={
            <GuestPicker
              size="small"
              kinds={GUEST_KINDS}
              value={booking.guests}
              onChange={booking.setGuests}
              maxGuests={booking.maxGuests}
              labels={{
                adults: t('booking.guests.adults'),
                children: t('booking.guests.children'),
                infants: t('booking.guests.infants'),
              }}
              descriptions={{
                adults: t('booking.guests.adultsHint'),
                children: t('booking.guests.childrenHint'),
                infants: t('booking.guests.infantsHint'),
              }}
              note={
                booking.maxGuests
                  ? t('booking.guests.maxNote', { count: booking.maxGuests })
                  : undefined
              }
              closeLabel={t('common.close')}
            />
          }
          checkInLabel={t('search.filters.checkIn')}
          checkOutLabel={t('search.filters.checkOut')}
          guestsLabel={t('search.filters.guests')}
          datePlaceholder={t('search.filters.addDate')}
          reserveLabel={
            !datesChosen
              ? t('booking.widget.checkAvailability')
              : booking.instantBook
                ? t('property.cta.reserve')
                : t('booking.widget.requestToBook')
          }
          onReserve={booking.reserve}
          loading={booking.reserving}
          note={datesChosen && !booking.instantBook ? t('booking.widget.requestNote') : null}
          breakdown={booking.breakdown ?? undefined}
          footer={
            <View style={styles.footer}>
              {policy ? (
                <BloomText variant="body-2-regular" className="text-center text-muted-foreground">
                  {policy}
                </BloomText>
              ) : null}
              {reportLink}
            </View>
          }
        />
        {stay ? null : ownStay.dialog}
      </>
    );
  }

  // Nothing else to offer: a short stay with no nightly rate, or a mode the
  // listing does not carry.
  if (!property.isExternal && bookingMode !== 'long_term') return null;

  const { priceLabel } = resolveHeadlinePrice(property, rentalMode, t, formatting);

  return (
    <Card variant="outlined" radius="radius-16" className="p-6" style={styles.card}>
      <View style={styles.header}>
        {priceLabel ? (
          <BloomText variant="title-3-semibold" style={styles.price}>
            {priceLabel}
          </BloomText>
        ) : null}
        {hasRating ? (
          <Rating
            size="small"
            value={ratingSummary.averageRating}
            count={ratingSummary.totalReviews}
          />
        ) : null}
      </View>
      {property.isExternal ? (
        <ExternalSourceButton property={property} />
      ) : (
        <ApplyToRentCTA property={property} />
      )}
      <View style={styles.footer}>{reportLink}</View>
    </Card>
  );
};

const styles = StyleSheet.create({
  card: {
    width: '100%',
    maxWidth: 372,
    gap: 20,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  price: {
    flexShrink: 1,
  },
  footer: {
    alignItems: 'center',
    gap: 8,
  },
});

export default BookingCard;
