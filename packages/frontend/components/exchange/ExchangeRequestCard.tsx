import React, { useMemo } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { Text as BloomText } from '@oxy.so/bloom/typography';
import { RiArrowLeftRightLine, RiHotelBedLine } from '@oxy.so/bloom/icons';
import { useTheme } from '@oxy.so/bloom/theme';
import { ExchangeMode, type ExchangeRequest } from '@homiio/shared-types';

import { ExchangeStatusBadge } from '@/components/exchange/ExchangeStatusBadge';
import { Card, CardFooter } from '@oxy.so/bloom/card';
import { ThumbnailImage } from '@/components/ui/ThumbnailImage';
import { useProperty } from '@/hooks';
import { getPropertyImageSource, getPropertyTitle } from '@/utils/propertyUtils';
import { formatDateRange } from '@/utils/dateFormatting';
import { colors } from '@/styles/colors';
import { spacing } from '@/constants/styles';

export interface ExchangeRequestCardProps {
  request: ExchangeRequest;
  /** Optional action row rendered below the meta (e.g. host approve/decline). */
  actions?: React.ReactNode;
}

export const ExchangeRequestCard: React.FC<ExchangeRequestCardProps> = ({
  request,
  actions,
}) => {
  const router = useRouter();
  const { t } = useTranslation();
  const theme = useTheme();
  const { property } = useProperty(request.propertyId);

  const title = useMemo(
    () => (property ? getPropertyTitle(property) : t('listing.exchange.cardFallback')),
    [property, t],
  );
  const imageSource = useMemo(
    () => (property ? getPropertyImageSource(property) : null),
    [property],
  );

  const modeLabel =
    request.mode === ExchangeMode.SWAP
      ? t('listing.exchange.mode.swap')
      : t('listing.exchange.mode.host');

  return (
    <Card variant="outlined" radius="radius-16" style={styles.card}>
      <Pressable
        style={styles.row}
        onPress={() => router.push(`/exchange/${request.id}`)}
        accessibilityRole="button"
        accessibilityLabel={title}
      >
        <View style={styles.thumb}><ThumbnailImage source={imageSource} /></View>
        <View style={styles.body}>
          <View style={styles.headerRow}>
            <BloomText style={[styles.title, { color: theme.colors.text }]} numberOfLines={1}>
              {title}
            </BloomText>
            <ExchangeStatusBadge status={request.status} />
          </View>
          <BloomText style={[styles.dates, { color: theme.colors.textSecondary }]} numberOfLines={1}>
            {formatDateRange(request.requestedWindow.start, request.requestedWindow.end)}
          </BloomText>
          <View style={styles.metaRow}>
            {request.mode === ExchangeMode.SWAP ? (
              <RiArrowLeftRightLine size="xs" fill={colors.exchangeAccent} />
            ) : (
              <RiHotelBedLine size="xs" fill={colors.exchangeAccent} />
            )}
            <BloomText style={[styles.meta, { color: theme.colors.textTertiary }]} numberOfLines={1}>
              {modeLabel}
            </BloomText>
          </View>
        </View>
      </Pressable>
      {actions ? <CardFooter style={styles.actions}>{actions}</CardFooter> : null}
    </Card>
  );
};

/** Edge length of the square thumbnail slot. */
const THUMBNAIL_SIZE = 96;

const styles = StyleSheet.create({
  card: {
    marginBottom: spacing.md,
  },
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
  title: {
    fontSize: 15,
    fontWeight: '700',
    flex: 1,
  },
  dates: {
    fontSize: 13,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  meta: {
    fontSize: 12,
  },
});

export default ExchangeRequestCard;
