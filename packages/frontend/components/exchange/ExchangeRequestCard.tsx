import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { Text as BloomText } from '@oxyhq/bloom/typography';
import { Ionicons } from '@expo/vector-icons';
import { ExchangeMode, type ExchangeRequest } from '@homiio/shared-types';

import { ExchangeStatusBadge } from '@/components/exchange/ExchangeStatusBadge';
import { ThumbnailCard } from '@/components/ui/ThumbnailCard';
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

/** Glyph size for the small mode line ("Home swap" / "Free hosting"). */
const MODE_ICON_SIZE = 13;

export const ExchangeRequestCard: React.FC<ExchangeRequestCardProps> = ({
  request,
  actions,
}) => {
  const router = useRouter();
  const { t } = useTranslation();
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
    <ThumbnailCard
      thumbnail={<ThumbnailImage source={imageSource} />}
      onPress={() => router.push(`/exchange/${request.id}`)}
      accessibilityLabel={title}
      actions={actions}
    >
      <View style={styles.headerRow}>
        <BloomText style={styles.title} numberOfLines={1}>
          {title}
        </BloomText>
        <ExchangeStatusBadge status={request.status} />
      </View>
      <BloomText style={styles.dates} numberOfLines={1}>
        {formatDateRange(request.requestedWindow.start, request.requestedWindow.end)}
      </BloomText>
      <View style={styles.metaRow}>
        <Ionicons
          name={request.mode === ExchangeMode.SWAP ? 'swap-horizontal' : 'bed-outline'}
          size={MODE_ICON_SIZE}
          color={colors.exchangeAccent}
        />
        <BloomText style={styles.meta} numberOfLines={1}>
          {modeLabel}
        </BloomText>
      </View>
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
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  meta: {
    fontSize: 12,
    color: colors.COLOR_BLACK_LIGHT_4,
  },
});

export default ExchangeRequestCard;
