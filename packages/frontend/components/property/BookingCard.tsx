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
 *  - external listing (any mode) → the price and "View on source website";
 *    Homiio never books, applies or arranges a viewing for it;
 *  - long-term rent → Bloom `RentalActionCard`: the monthly price, the bills
 *    note and the real terms (deposit, available from, lease term), "Request a
 *    viewing" and "Apply" — or "View status" when the viewer already applied;
 *  - for sale → Bloom `SaleActionCard`: the asking price, the advertiser's own
 *    price per m², a mortgage estimate on the page calculator's baseline, and
 *    "Request viewing" (Homiio has no messaging product to contact an agent).
 *
 * A reserved, rented or sold listing badges its price and disables the actions
 * with a reason (the Bloom cards' status).
 *
 * A rating is drawn only from the real review aggregate of the listing's
 * address (the same source the reviews section reads) and omitted without one.
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useRouter } from 'expo-router';
import { openAccountDialog, useOxy } from '@oxy.so/services';

import { BookingCard as BloomBookingCard } from '@oxy.so/bloom/booking';
import { Button } from '@oxy.so/bloom/button';
import { Card } from '@oxy.so/bloom/card';
import { RiFlagLine } from '@oxy.so/bloom/icons';
import {
  RentalActionCard,
  SaleActionCard,
  computeMortgage,
  type KeyFact,
} from '@oxy.so/bloom/listing-actions';
import { Rating } from '@oxy.so/bloom/rating';
import { GuestPicker } from '@oxy.so/bloom/stay-search';
import { Text as BloomText } from '@oxy.so/bloom/typography';
import {
  CancellationPolicy,
  DEFAULT_MORTGAGE_CONFIG,
  PropertyStatus,
  UtilitiesIncluded,
  formatDate,
  formatMoney,
  type Property,
} from '@homiio/shared-types';

import { ExternalSourceButton } from '@/components/property/ExternalSourceButton';
import { useActiveApplicationForProperty } from '@/hooks/useApplicationQueries';
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
  const { mode: rentalMode, browseMode } = useRentalMode();
  const { isAuthenticated } = useOxy();

  const bookingMode = resolveBookingMode(property, rentalMode, browseMode);
  const ownStay = useStayBooking(property, { enabled: !stay && bookingMode === 'vacation' });
  const booking = stay ?? ownStay;
  const activeApplication =
    useActiveApplicationForProperty(
      isAuthenticated && bookingMode === 'long_term' && !property.isExternal
        ? String(property.id ?? '')
        : undefined,
    ).data ?? null;

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

  if (property.isExternal) {
    const { priceLabel } = resolveHeadlinePrice(property, browseMode, t, formatting);
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
        <ExternalSourceButton property={property} />
        <View style={styles.footer}>{reportLink}</View>
      </Card>
    );
  }

  const money = (amount: number, currency: string) =>
    formatMoney(amount, currency, formatting.locale, { maximumFractionDigits: 0 });

  const handleRequestViewing = () => {
    if (!propertyId) return;
    router.push({ pathname: '/properties/[id]/book-viewing', params: { id: propertyId } });
  };

  if (bookingMode === 'long_term' && property.longTermRent) {
    const rent = property.longTermRent;
    const status =
      property.status === PropertyStatus.RESERVED
        ? 'reserved'
        : property.status === PropertyStatus.RENTED
          ? 'rented'
          : 'available';

    const facts: KeyFact[] = [];
    if (typeof rent.deposit === 'number' && rent.deposit > 0) {
      facts.push({ key: 'deposit', label: t('property.sections.deposit'), value: money(rent.deposit, rent.currency) });
    }
    if (property.availableFrom) {
      facts.push({
        key: 'availableFrom',
        label: t('property.sections.availableFrom'),
        // A civil date: the same day everywhere (see `formatDate`).
        value: formatDate(property.availableFrom, formatting.locale, 'UTC'),
      });
    }
    if (property.leaseTerm) {
      facts.push({ key: 'leaseTerm', label: t('property.sections.leaseTerm'), value: property.leaseTerm });
    }

    const handleApply = () => {
      if (activeApplication) {
        router.push({ pathname: '/applications/[id]', params: { id: String(activeApplication.id) } });
        return;
      }
      if (!isAuthenticated) {
        openAccountDialog();
        return;
      }
      // The move-in date is asked on the application form itself.
      router.push({ pathname: '/properties/[id]/apply', params: { id: propertyId } });
    };

    return (
      <RentalActionCard
        price={money(rent.monthlyAmount, rent.currency)}
        priceUnit={formatting.priceUnitLabels.month.short}
        priceAccessibilityLabel={`${formatMoney(rent.monthlyAmount, rent.currency, formatting.locale, {
          currencyDisplay: 'name',
          maximumFractionDigits: 0,
        })} ${formatting.priceUnitLabels.month.spoken}`}
        billsNote={rent.utilities ? t(`listing.actions.bills.${BILLS_KEY[rent.utilities]}`) : undefined}
        facts={facts}
        status={status}
        statusLabel={status === 'available' ? undefined : t(`listing.actions.status.${status}`)}
        statusMessage={status === 'available' ? undefined : t(`listing.actions.status.${status}Message`)}
        requestViewingLabel={t('listing.sale.requestViewing')}
        onRequestViewing={handleRequestViewing}
        applyLabel={activeApplication ? t('applications.detail.viewStatus') : t('applications.cta.apply')}
        onApply={handleApply}
        note={activeApplication ? t('applications.detail.alreadySubmitted') : undefined}
        footer={reportLink}
      />
    );
  }

  if (bookingMode === 'sale' && property.sale) {
    const sale = property.sale;
    const status =
      property.status === PropertyStatus.RESERVED
        ? 'reserved'
        : property.status === PropertyStatus.SOLD
          ? 'sold'
          : 'available';
    // The same baseline the calculator on the page opens with, so the two agree.
    const mortgage = computeMortgage({
      price: sale.price,
      downPayment: sale.price * DEFAULT_MORTGAGE_CONFIG.defaultDownPaymentFraction,
      years:
        DEFAULT_MORTGAGE_CONFIG.termOptions[Math.floor(DEFAULT_MORTGAGE_CONFIG.termOptions.length / 2)] ??
        DEFAULT_MORTGAGE_CONFIG.termOptions[0],
      annualRate: DEFAULT_MORTGAGE_CONFIG.defaultAnnualRate * 100,
    });

    return (
      <SaleActionCard
        price={money(sale.price, sale.currency)}
        priceAccessibilityLabel={formatMoney(sale.price, sale.currency, formatting.locale, {
          currencyDisplay: 'name',
          maximumFractionDigits: 0,
        })}
        pricePerArea={
          typeof sale.pricePerSqm === 'number' && sale.pricePerSqm > 0
            ? t('property.areaInsights.perSqmValue', { price: money(sale.pricePerSqm, sale.currency) })
            : undefined
        }
        mortgageEstimate={
          mortgage.monthlyPayment > 0
            ? t('listing.mortgage.estimate', { amount: money(mortgage.monthlyPayment, sale.currency) })
            : undefined
        }
        status={status}
        statusLabel={status === 'available' ? undefined : t(`listing.actions.status.${status}`)}
        statusMessage={status === 'available' ? undefined : t(`listing.actions.status.${status}Message`)}
        contactLabel={t('listing.sale.requestViewing')}
        onContact={handleRequestViewing}
        footer={reportLink}
      />
    );
  }

  // Nothing else to offer: a short stay with no nightly rate, or a mode the
  // listing does not carry.
  return null;
};

/** The i18n leaf for each utilities arrangement, under `listing.actions.bills`. */
const BILLS_KEY: Record<UtilitiesIncluded, string> = {
  [UtilitiesIncluded.INCLUDED]: 'included',
  [UtilitiesIncluded.EXCLUDED]: 'excluded',
  [UtilitiesIncluded.PARTIAL]: 'partial',
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
