import React, { useMemo } from 'react';
import { Image, Pressable, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { format } from 'date-fns';
import { Text as BloomText } from '@oxyhq/bloom/typography';
import { Reservation } from '@homiio/shared-types';
import { ReservationStatusBadge } from '@/components/ReservationStatusBadge';
import { useProperty } from '@/hooks';
import { getPropertyImageSource, getPropertyTitle } from '@/utils/propertyUtils';
import { colors } from '@/styles/colors';
import { radius, spacing, withShadow } from '@/constants/styles';

export interface ReservationCardProps {
  reservation: Reservation;
  /** Show host-side data (e.g., guest count emphasised). */
  variant?: 'guest' | 'host';
  /** Optional action row rendered below the meta. */
  actions?: React.ReactNode;
}

const formatRange = (checkIn: string, checkOut: string): string => {
  const startDate = new Date(checkIn);
  const endDate = new Date(checkOut);
  return `${format(startDate, 'MMM d, yyyy')} → ${format(endDate, 'MMM d, yyyy')}`;
};

const formatTotal = (total: number, currency: string): string => {
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(total);
  } catch {
    return `${currency} ${total.toFixed(0)}`;
  }
};

export const ReservationCard: React.FC<ReservationCardProps> = ({
  reservation,
  variant = 'guest',
  actions,
}) => {
  const router = useRouter();
  const { property } = useProperty(reservation.propertyId);

  const title = useMemo(() => {
    if (!property) return 'Property';
    return getPropertyTitle(property);
  }, [property]);

  const imageSource = useMemo(() => {
    if (!property) return null;
    return getPropertyImageSource(property);
  }, [property]);

  const handlePress = () => {
    router.push(`/reservations/${reservation.id}`);
  };

  const guestLabel = reservation.guestCount === 1 ? 'guest' : 'guests';

  return (
    <View style={styles.card}>
      <Pressable
        style={styles.body}
        onPress={handlePress}
        accessibilityRole="button"
        accessibilityLabel={`Reservation ${reservation.id}`}
      >
        <View style={styles.thumbWrapper}>
          {imageSource ? (
            <Image source={imageSource} style={styles.thumb} resizeMode="cover" />
          ) : (
            <View style={[styles.thumb, styles.thumbPlaceholder]} />
          )}
        </View>
        <View style={styles.bodyText}>
          <View style={styles.headerRow}>
            <BloomText style={styles.title} numberOfLines={1}>
              {title}
            </BloomText>
            <ReservationStatusBadge status={reservation.status} />
          </View>
          <BloomText style={styles.dates} numberOfLines={1}>
            {formatRange(reservation.checkIn, reservation.checkOut)}
          </BloomText>
          <BloomText style={styles.meta} numberOfLines={1}>
            {reservation.nights} {reservation.nights === 1 ? 'night' : 'nights'} ·{' '}
            {reservation.guestCount} {guestLabel}
            {variant === 'host' ? ' (guest)' : ''} ·{' '}
            {formatTotal(reservation.total, reservation.currency)}
          </BloomText>
        </View>
      </Pressable>
      {actions ? <View style={styles.actions}>{actions}</View> : null}
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#ffffff',
    borderRadius: radius.lg,
    overflow: 'hidden',
    marginBottom: spacing.md,
    ...withShadow('sm'),
  },
  body: {
    flexDirection: 'row',
  },
  thumbWrapper: {
    width: 96,
    height: 96,
  },
  thumb: {
    width: '100%',
    height: '100%',
  },
  thumbPlaceholder: {
    backgroundColor: colors.COLOR_BLACK_LIGHT_7,
  },
  bodyText: {
    flex: 1,
    padding: spacing.md,
    justifyContent: 'space-between',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  title: {
    fontSize: 15,
    fontWeight: '700',
    flex: 1,
  },
  dates: {
    fontSize: 13,
    color: colors.COLOR_BLACK_LIGHT_3,
  },
  meta: {
    fontSize: 12,
    color: colors.COLOR_BLACK_LIGHT_4,
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
  },
});

export default ReservationCard;
