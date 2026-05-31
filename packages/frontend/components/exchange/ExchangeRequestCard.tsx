import React, { useMemo } from 'react';
import { Image, Pressable, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { format, parseISO } from 'date-fns';

import { Text as BloomText } from '@oxyhq/bloom/typography';
import { Ionicons } from '@expo/vector-icons';
import { ExchangeMode, type ExchangeRequest } from '@homiio/shared-types';

import { ExchangeStatusBadge } from '@/components/exchange/ExchangeStatusBadge';
import { useProperty } from '@/hooks';
import { getPropertyImageSource, getPropertyTitle } from '@/utils/propertyUtils';
import { colors } from '@/styles/colors';
import { radius, spacing, withShadow } from '@/constants/styles';

export interface ExchangeRequestCardProps {
  request: ExchangeRequest;
  /** Optional action row rendered below the meta (e.g. host approve/decline). */
  actions?: React.ReactNode;
}

const formatRange = (start: string, end: string): string => {
  const startDate = parseISO(start);
  const endDate = parseISO(end);
  if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) return '';
  return `${format(startDate, 'MMM d, yyyy')} → ${format(endDate, 'MMM d, yyyy')}`;
};

export const ExchangeRequestCard: React.FC<ExchangeRequestCardProps> = ({
  request,
  actions,
}) => {
  const router = useRouter();
  const { t } = useTranslation();
  const { property } = useProperty(request.propertyId);

  const title = useMemo(
    () => (property ? getPropertyTitle(property) : t('listing.exchange.cardFallback', 'Home')),
    [property, t],
  );
  const imageSource = useMemo(
    () => (property ? getPropertyImageSource(property) : null),
    [property],
  );

  const modeLabel =
    request.mode === ExchangeMode.SWAP
      ? t('listing.exchange.mode.swap', 'Home swap')
      : t('listing.exchange.mode.host', 'Free hosting');

  return (
    <View style={styles.card}>
      <Pressable
        style={styles.body}
        onPress={() => router.push(`/exchange/${request.id}`)}
        accessibilityRole="button"
        accessibilityLabel={title}
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
            <ExchangeStatusBadge status={request.status} />
          </View>
          <BloomText style={styles.dates} numberOfLines={1}>
            {formatRange(request.requestedWindow.start, request.requestedWindow.end)}
          </BloomText>
          <View style={styles.metaRow}>
            <Ionicons
              name={request.mode === ExchangeMode.SWAP ? 'swap-horizontal' : 'bed-outline'}
              size={13}
              color={colors.exchangeAccent}
            />
            <BloomText style={styles.meta} numberOfLines={1}>
              {modeLabel}
            </BloomText>
          </View>
        </View>
      </Pressable>
      {actions ? <View style={styles.actions}>{actions}</View> : null}
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.white,
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
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
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

export default ExchangeRequestCard;
