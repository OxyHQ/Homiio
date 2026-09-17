import React, { useMemo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Text as BloomText } from '@oxy.so/bloom/typography';
import { Reservation, formatMoney } from '@homiio/shared-types';
import { ReservationStatusBadge } from '@/components/ReservationStatusBadge';
import { Card, CardFooter } from '@oxy.so/bloom/card';
import { ThumbnailImage } from '@/components/ui/ThumbnailImage';
import { useProperty } from '@/hooks';
import { getPropertyImageSource, getPropertyTitle } from '@/utils/propertyUtils';
import { useFormatting } from '@/utils/format';
import { formatDateRange } from '@/utils/dateFormatting';
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
  const { t } = useTranslation();
  const { locale } = useFormatting();
  const router = useRouter();
  const { property } = useProperty(reservation.propertyId);

  const title = useMemo(() => {
    if (!property) return t('reservations.card.propertyFallback');
    return getPropertyTitle(property);
  }, [property, t]);

  const imageSource = useMemo(() => {
    if (!property) return null;
    return getPropertyImageSource(property);
  }, [property]);

  const handlePress = () => {
    router.push(`/reservations/${reservation.id}`);
  };

  const guestLabel =
    reservation.guestCount === 1
      ? t('reservations.card.guest')
      : t('reservations.card.guests');
  const nightLabel =
    reservation.nights === 1
      ? t('reservations.card.night')
      : t('reservations.card.nights');

  return (
    <Card variant="outlined" radius="radius-16">
      <Pressable
        style={styles.row}
        onPress={handlePress}
        accessibilityRole="button"
        accessibilityLabel={t('reservations.card.accessibility', { id: reservation.id })}
      >
        <View style={styles.thumb}><ThumbnailImage source={imageSource} /></View>
        <View style={styles.body}>
          <View style={styles.headerRow}>
            <BloomText className="flex-1 text-[15px] font-bold text-foreground" numberOfLines={1}>
              {title}
            </BloomText>
            <ReservationStatusBadge status={reservation.status} />
          </View>
          <BloomText className="text-[13px] text-muted-foreground" numberOfLines={1}>
            {formatDateRange(reservation.checkIn, reservation.checkOut)}
          </BloomText>
          <BloomText className="text-xs text-muted-foreground" numberOfLines={1}>
            {reservation.nights} {nightLabel} · {reservation.guestCount} {guestLabel}
            {variant === 'host' ? ` ${t('reservations.card.hostGuestSuffix')}` : ''} ·{' '}
            {formatMoney(reservation.total, reservation.currency, locale)}
          </BloomText>
        </View>
      </Pressable>
      {actions ? <CardFooter style={styles.actions}>{actions}</CardFooter> : null}
    </Card>
  );
};

/** Edge length of the square thumbnail slot. */
const THUMBNAIL_SIZE = 96;

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
  },
  thumb: {
    width: THUMBNAIL_SIZE,
    height: THUMBNAIL_SIZE,
  },
  body: {
    flex: 1,
    padding: spacing.md,
    justifyContent: 'space-between',
  },
  actions: {
    justifyContent: 'flex-start',
    paddingHorizontal: spacing.md,
    paddingTop: 0,
    paddingBottom: spacing.md,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
});

export default ReservationCard;
