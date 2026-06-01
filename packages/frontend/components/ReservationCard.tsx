import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Text as BloomText } from '@oxyhq/bloom/typography';
import { Reservation } from '@homiio/shared-types';
import { ReservationStatusBadge } from '@/components/ReservationStatusBadge';
import { ThumbnailCard } from '@/components/ui/ThumbnailCard';
import { ThumbnailImage } from '@/components/ui/ThumbnailImage';
import { useProperty } from '@/hooks';
import { getPropertyImageSource, getPropertyTitle } from '@/utils/propertyUtils';
import { formatCurrency } from '@/utils/currency';
import { formatDateRange } from '@/utils/dateFormatting';
import { colors } from '@/styles/colors';
import { spacing } from '@/constants/styles';

export interface ReservationCardProps {
  reservation: Reservation;
  /** Show host-side data (e.g., guest count emphasised). */
  variant?: 'guest' | 'host';
  /** Optional action row rendered below the meta. */
  actions?: React.ReactNode;
}

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
    <ThumbnailCard
      thumbnail={<ThumbnailImage source={imageSource} />}
      onPress={handlePress}
      accessibilityLabel={`Reservation ${reservation.id}`}
      actions={actions}
    >
      <View style={styles.headerRow}>
        <BloomText style={styles.title} numberOfLines={1}>
          {title}
        </BloomText>
        <ReservationStatusBadge status={reservation.status} />
      </View>
      <BloomText style={styles.dates} numberOfLines={1}>
        {formatDateRange(reservation.checkIn, reservation.checkOut)}
      </BloomText>
      <BloomText style={styles.meta} numberOfLines={1}>
        {reservation.nights} {reservation.nights === 1 ? 'night' : 'nights'} ·{' '}
        {reservation.guestCount} {guestLabel}
        {variant === 'host' ? ' (guest)' : ''} ·{' '}
        {formatCurrency(reservation.total, reservation.currency)}
      </BloomText>
    </ThumbnailCard>
  );
};

const styles = StyleSheet.create({
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
});

export default ReservationCard;
