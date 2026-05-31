/**
 * IntentBadge — a small floating chip that marks a listing's non-rent offering
 * ("For sale" / "Exchange"). Shared across the card grid and any future surface
 * so the intent vocabulary (label, colour, icon) lives in exactly one place.
 *
 * Rent needs no badge (it's the default), so `RENT` renders nothing. The chip
 * reuses PropertyCard's `statusChip` language — a soft tinted pill — with an
 * amber tint for sale and a teal tint for exchange.
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';

import { ListingIntent } from '@homiio/shared-types';
import { Text as BloomText } from '@oxyhq/bloom/typography';

import { colors } from '@/styles/colors';
import { radius, spacing } from '@/constants/styles';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

export type IntentBadgeSize = 'sm' | 'md';

interface IntentBadgeProps {
  intent: ListingIntent;
  /** `sm` for dense grids, `md` (default) for roomy cards. */
  size?: IntentBadgeSize;
}

interface BadgeStyle {
  background: string;
  foreground: string;
  icon: IoniconName;
  i18nKey: string;
  fallback: string;
}

const BADGE_STYLES: Partial<Record<ListingIntent, BadgeStyle>> = {
  [ListingIntent.SALE]: {
    background: colors.saleSubtle,
    foreground: colors.saleAccent,
    icon: 'pricetag',
    i18nKey: 'listing.badge.forSale',
    fallback: 'For sale',
  },
  [ListingIntent.EXCHANGE]: {
    background: colors.exchangeSubtle,
    foreground: colors.exchangeAccent,
    icon: 'swap-horizontal',
    i18nKey: 'listing.badge.exchange',
    fallback: 'Exchange',
  },
};

export const IntentBadge: React.FC<IntentBadgeProps> = ({ intent, size = 'md' }) => {
  const { t } = useTranslation();
  const config = BADGE_STYLES[intent];
  // Rent (or any unmapped intent) carries no badge.
  if (!config) return null;

  const isSmall = size === 'sm';
  const iconSize = isSmall ? 11 : 13;

  return (
    <View
      style={[
        styles.chip,
        isSmall ? styles.chipSmall : styles.chipMedium,
        { backgroundColor: config.background },
      ]}
    >
      <Ionicons name={config.icon} size={iconSize} color={config.foreground} />
      <BloomText
        style={[styles.label, isSmall ? styles.labelSmall : styles.labelMedium, { color: config.foreground }]}
      >
        {t(config.i18nKey, config.fallback)}
      </BloomText>
    </View>
  );
};

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radius.pill,
  },
  chipMedium: {
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  chipSmall: {
    gap: 3,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  label: {
    fontWeight: '600',
    letterSpacing: 0.2,
  },
  labelMedium: {
    fontSize: 12,
  },
  labelSmall: {
    fontSize: 10,
  },
});

export default IntentBadge;
