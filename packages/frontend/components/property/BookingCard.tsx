/**
 * BookingCard — the price / booking / apply card on the property detail
 * screen.
 *
 * Renders FLAT content (no border / background of its own): the surrounding
 * chrome is owned by the host —
 *  - desktop right column: `PropertyBookingWidget` wraps this in `BaseWidget`
 *    (the shared `primaryLight` + radius-15 surface, sticky on web);
 *  - mobile inline: the detail screen wraps this in a flat `Section`.
 *
 * Layout (Airbnb-style):
 *  - Header: headline price + subtitle, a `SaveButton` wishlist control, the
 *    review rating (stars + count, from the SAME `addressReviews` source the
 *    Reviews block uses), and a host line (name + a "Super host" badge when
 *    applicable).
 *  - Body: vacation → `BookingWidget`, long-term → `ApplyToRentCTA`, chosen by
 *    `resolveBookingMode` (the one branching source, shared with the screen).
 *  - Footer: a "Report this listing" link.
 */
import React, { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { Badge } from '@oxyhq/bloom/badge';
import { H3, Text as BloomText } from '@oxyhq/bloom/typography';

import { BookingWidget } from '@/components/BookingWidget';
import { ApplyToRentCTA } from '@/components/property/ApplyToRentCTA';
import { SaveButton } from '@/components/SaveButton';
import { Stars } from '@/components/ui/Stars';
import { useAddressReviews } from '@/hooks/useAddressReviews';
import { useRentalMode } from '@/context/RentalModeContext';
import { resolveBookingMode } from '@/utils/bookingMode';
import { isSuperHost, resolveHostName } from '@/utils/host';
import { colors } from '@/styles/colors';
import { hairline, spacing } from '@/constants/styles';
import { type Profile, type Property } from '@homiio/shared-types';

interface BookingCardProps {
  property: Property;
  /** Pre-formatted price string from the detail page view model. */
  priceLabel: string;
  /** Optional short copy under the price ("City, Country"). */
  priceSubtitle?: string;
  /** Host profile (already loaded by the screen) for the host line + badge. */
  landlordProfile?: Profile | null;
}

const RATING_STAR_SIZE = 14;
const SAVE_ICON_SIZE = 22;

export const BookingCard: React.FC<BookingCardProps> = ({
  property,
  priceLabel,
  priceSubtitle,
  landlordProfile = null,
}) => {
  const { t } = useTranslation();
  const router = useRouter();
  const { mode: rentalMode } = useRentalMode();
  const [reportPressed, setReportPressed] = useState(false);

  const bookingMode = resolveBookingMode(property, rentalMode);
  const propertyId = String(property._id ?? property.id ?? '');

  // Rating from the same source the Reviews block reads (shared cache key).
  const { ratingSummary } = useAddressReviews(property);
  const hasRating = ratingSummary.totalReviews > 0;

  const hostName = landlordProfile ? resolveHostName(landlordProfile) : '';
  const hostIsSuper = isSuperHost(landlordProfile);

  const handleReport = () => {
    if (!propertyId) return;
    router.push({ pathname: '/properties/[id]/report', params: { id: propertyId } });
  };

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={styles.priceColumn}>
          <H3 style={styles.price}>{priceLabel}</H3>
          {priceSubtitle ? (
            <BloomText style={styles.priceSubtitle}>{priceSubtitle}</BloomText>
          ) : null}
        </View>
        <SaveButton
          property={property}
          variant="heart"
          size={SAVE_ICON_SIZE}
          color={colors.COLOR_BLACK}
          activeColor={colors.error}
        />
      </View>

      {hasRating || hostName ? (
        <View style={styles.trustRow}>
          {hasRating ? (
            <View style={styles.ratingGroup}>
              <Stars rating={ratingSummary.averageRating} size={RATING_STAR_SIZE} />
              <BloomText style={styles.ratingText}>
                {ratingSummary.averageRating.toFixed(1)}
              </BloomText>
              <BloomText style={styles.ratingCount}>
                {t('property.reviews.countWithNumber', {
                  defaultValue: '({{count}} reviews)',
                  count: ratingSummary.totalReviews,
                })}
              </BloomText>
            </View>
          ) : null}
          {hostName ? (
            <View style={styles.hostGroup}>
              <Ionicons
                name="person-circle-outline"
                size={16}
                color={colors.COLOR_BLACK_LIGHT_3}
              />
              <BloomText style={styles.hostName} numberOfLines={1}>
                {t('property.host.hostedBy', 'Hosted by')} {hostName}
              </BloomText>
              {hostIsSuper ? (
                <Badge
                  content={t('property.host.superHost', 'Super host')}
                  variant="solid"
                  color="success"
                  size="small"
                />
              ) : null}
            </View>
          ) : null}
        </View>
      ) : null}

      {bookingMode === 'vacation' ? <BookingWidget property={property} /> : null}
      {bookingMode === 'long_term' ? <ApplyToRentCTA property={property} /> : null}

      <View style={styles.divider} />

      <Pressable
        onPress={handleReport}
        onPressIn={() => setReportPressed(true)}
        onPressOut={() => setReportPressed(false)}
        accessibilityRole="link"
        style={[styles.reportRow, reportPressed && styles.reportRowPressed]}
      >
        <Ionicons name="flag-outline" size={16} color={colors.COLOR_BLACK_LIGHT_3} />
        <BloomText style={styles.reportLabel}>
          {t('property.report', 'Report this listing')}
        </BloomText>
      </Pressable>
    </View>
  );
};

const styles = StyleSheet.create({
  // Flat: no border / background — the host (BaseWidget / Section) owns chrome.
  card: {
    maxWidth: 380,
    width: '100%',
    gap: spacing.lg,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  priceColumn: {
    flex: 1,
    gap: spacing.xs,
  },
  price: {
    fontSize: 22,
    fontWeight: '700',
    color: colors.COLOR_BLACK,
  },
  priceSubtitle: {
    fontSize: 14,
    color: colors.COLOR_BLACK_LIGHT_3,
  },
  trustRow: {
    gap: spacing.sm,
  },
  ratingGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  ratingText: {
    fontSize: 14,
    fontWeight: '700',
    color: colors.COLOR_BLACK,
  },
  ratingCount: {
    fontSize: 13,
    color: colors.COLOR_BLACK_LIGHT_3,
  },
  hostGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  hostName: {
    flexShrink: 1,
    fontSize: 13,
    color: colors.COLOR_BLACK_LIGHT_3,
  },
  divider: {
    height: hairline.width,
    backgroundColor: hairline.color,
  },
  reportRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  reportRowPressed: {
    opacity: 0.6,
  },
  reportLabel: {
    fontSize: 13,
    color: colors.COLOR_BLACK_LIGHT_3,
    textDecorationLine: 'underline',
  },
});

export default BookingCard;
