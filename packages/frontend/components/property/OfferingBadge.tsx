/**
 * OfferingBadge — a small floating chip that marks one of a listing's offerings
 * ("For sale" / "Exchange" / "By night"). Shared across the card grid and any
 * future surface so the offering vocabulary (label, colour, icon) lives in
 * exactly one place.
 *
 * Long-term rent is the default and needs no badge, so
 * {@link OfferingType.LONG_TERM_RENT} renders nothing. The chip reuses
 * PropertyCard's `statusChip` language — a soft tinted pill — with an amber tint
 * for sale, a teal tint for exchange, and the brand tint for by-night.
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';

import { OfferingType } from '@homiio/shared-types';
import { Text as BloomText } from '@oxyhq/bloom/typography';

import { colors } from '@/styles/colors';
import { radius, spacing } from '@/constants/styles';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

export type OfferingBadgeSize = 'sm' | 'md';

interface OfferingBadgeProps {
  offering: OfferingType;
  /** `sm` for dense grids, `md` (default) for roomy cards. */
  size?: OfferingBadgeSize;
}

interface BadgeStyle {
  background: string;
  foreground: string;
  icon: IoniconName;
  i18nKey: string;
  fallback: string;
}

const BADGE_STYLES: Partial<Record<OfferingType, BadgeStyle>> = {
  [OfferingType.SHORT_TERM_RENT]: {
    background: colors.primaryLight_2,
    foreground: colors.primaryColor,
    icon: 'moon',
    i18nKey: 'listing.badge.byNight',
    fallback: 'By night',
  },
  [OfferingType.SALE]: {
    background: colors.saleSubtle,
    foreground: colors.saleAccent,
    icon: 'pricetag',
    i18nKey: 'listing.badge.forSale',
    fallback: 'For sale',
  },
  [OfferingType.EXCHANGE]: {
    background: colors.exchangeSubtle,
    foreground: colors.exchangeAccent,
    icon: 'swap-horizontal',
    i18nKey: 'listing.badge.exchange',
    fallback: 'Exchange',
  },
};

export const OfferingBadge: React.FC<OfferingBadgeProps> = ({ offering, size = 'md' }) => {
  const { t } = useTranslation();
  const config = BADGE_STYLES[offering];
  // Long-term rent (or any unmapped offering) carries no badge.
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

export default OfferingBadge;
