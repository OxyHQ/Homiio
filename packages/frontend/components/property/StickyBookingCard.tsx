/**
 * Sticky right-column booking / apply card on the property detail screen.
 *
 * Wraps either BookingWidget (vacation mode) or ApplyToRentCTA (long-term
 * mode) plus a quick price header, dividers, and a "Report this listing"
 * link — Airbnb pattern. On web the outer wrapper uses CSS `position:
 * sticky` so the card hovers as the user scrolls the long detail page;
 * on native the wrapper falls through to a plain View because
 * sticky positioning isn't a React Native concept.
 *
 * Mobile callers should NOT render this — the detail screen already
 * inlines the BookingWidget/ApplyToRentCTA in the main column for
 * narrow viewports. We expose `isWideScreen` so the parent gates
 * rendering instead of this component trying to guess.
 */
import React from 'react';
import { Linking, Platform, Pressable, StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';

import { H3, Text as BloomText } from '@oxyhq/bloom/typography';

import { BookingWidget } from '@/components/BookingWidget';
import { ApplyToRentCTA } from '@/components/property/ApplyToRentCTA';
import { useRentalMode } from '@/context/RentalModeContext';
import { colors } from '@/styles/colors';
import { hairline, radius, spacing } from '@/constants/styles';
import { RentMode, type Property } from '@homiio/shared-types';

interface StickyBookingCardProps {
  property: Property;
  /** Pre-formatted price string from the detail page view model. */
  priceLabel: string;
  /** Optional short copy under the price ("for 1 month", "per night"). */
  priceSubtitle?: string;
}

const REPORT_URL = 'https://homiio.com/report-listing';

export const StickyBookingCard: React.FC<StickyBookingCardProps> = ({
  property,
  priceLabel,
  priceSubtitle,
}) => {
  const { t } = useTranslation();
  const { mode: rentalMode } = useRentalMode();

  const isVacationMode =
    rentalMode === 'vacation' &&
    (property.rentMode === RentMode.VACATION ||
      property.rentMode === RentMode.BOTH);

  const isLongTermMode =
    rentalMode === 'long_term' && property.rentMode !== RentMode.VACATION;

  const handleReport = () => {
    Linking.openURL(REPORT_URL).catch(() => {
      // best-effort; OS will surface its own error if the URL is unreachable
    });
  };

  return (
    <View style={Platform.OS === 'web' ? styles.stickyWrapperWeb : null}>
      <View style={styles.card}>
        <View style={styles.priceRow}>
          <H3 style={styles.price}>{priceLabel}</H3>
          {priceSubtitle ? (
            <BloomText style={styles.priceSubtitle}>{priceSubtitle}</BloomText>
          ) : null}
        </View>

        {isVacationMode ? (
          <View style={styles.widgetSlot}>
            <BookingWidget property={property} />
          </View>
        ) : null}

        {isLongTermMode ? (
          <View style={styles.widgetSlot}>
            <ApplyToRentCTA
              propertyId={String(property._id ?? property.id ?? '')}
            />
          </View>
        ) : null}

        <View style={styles.divider} />

        <Pressable
          onPress={handleReport}
          accessibilityRole="link"
          style={styles.reportRow}
        >
          <Ionicons name="flag-outline" size={16} color={colors.COLOR_BLACK_LIGHT_3} />
          <BloomText style={styles.reportLabel}>
            {t('property.report', 'Report this listing')}
          </BloomText>
        </Pressable>
      </View>
    </View>
  );
};

const STICKY_TOP_OFFSET = 80;

const styles = StyleSheet.create({
  stickyWrapperWeb: {
    // Tell react-native-web to emit `position: sticky`; the cast is
    // contained inside the StyleSheet so consumers don't see it.
    position: 'sticky' as 'absolute',
    top: STICKY_TOP_OFFSET,
  },
  card: {
    backgroundColor: colors.white,
    borderRadius: radius.lg,
    borderWidth: hairline.width,
    borderColor: hairline.color,
    padding: spacing['2xl'],
    maxWidth: 380,
    width: '100%',
    gap: spacing.lg,
  },
  priceRow: {
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
  widgetSlot: {
    // The wrapped widgets carry their own padding; clip the slot
    // so the negative-margin styles from BookingWidget don't leak.
    marginHorizontal: -spacing.sm,
  },
  divider: {
    height: hairline.width,
    backgroundColor: hairline.color,
    marginVertical: spacing.xs,
  },
  reportRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  reportLabel: {
    fontSize: 13,
    color: colors.COLOR_BLACK_LIGHT_3,
    textDecorationLine: 'underline',
  },
});

export default StickyBookingCard;
