/**
 * OfferingBadge — marks one of a listing's offerings ("For sale" / "Exchange" /
 * "By night"). The offering vocabulary (label, accent colour, icon) lives here,
 * in exactly one place; the chip's shape/backdrop/height is delegated to the
 * shared {@link MediaChip} so every photo overlay reads as one aligned family.
 *
 * Long-term rent is the default and needs no badge, so
 * {@link OfferingType.LONG_TERM_RENT} renders nothing. Accents: amber for sale,
 * teal for exchange, deep brand for by-night.
 */
import React from 'react';
import { useTranslation } from 'react-i18next';

import { OfferingType } from '@homiio/shared-types';

import { colors } from '@/styles/colors';
import { MediaChip, type MediaChipSize } from './MediaChip';
import type { Ionicons } from '@expo/vector-icons';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

export type OfferingBadgeSize = MediaChipSize;

interface OfferingBadgeProps {
  offering: OfferingType;
  /** `sm` for dense grids, `md` (default) for roomy cards. */
  size?: OfferingBadgeSize;
}

interface OfferingMeta {
  accent: string;
  icon: IoniconName;
  i18nKey: string;
  fallback: string;
}

const OFFERING_META: Partial<Record<OfferingType, OfferingMeta>> = {
  [OfferingType.SHORT_TERM_RENT]: {
    accent: colors.primarySubtleForeground,
    icon: 'moon',
    i18nKey: 'listing.badge.byNight',
    fallback: 'By night',
  },
  [OfferingType.SALE]: {
    accent: colors.saleAccent,
    icon: 'pricetag',
    i18nKey: 'listing.badge.forSale',
    fallback: 'For sale',
  },
  [OfferingType.EXCHANGE]: {
    accent: colors.exchangeAccent,
    icon: 'swap-horizontal',
    i18nKey: 'listing.badge.exchange',
    fallback: 'Exchange',
  },
};

export const OfferingBadge: React.FC<OfferingBadgeProps> = ({ offering, size = 'md' }) => {
  const { t } = useTranslation();
  const meta = OFFERING_META[offering];
  // Long-term rent (or any unmapped offering) carries no badge.
  if (!meta) return null;

  return (
    <MediaChip
      icon={meta.icon}
      accent={meta.accent}
      label={t(meta.i18nKey, meta.fallback)}
      size={size}
    />
  );
};

export default OfferingBadge;
