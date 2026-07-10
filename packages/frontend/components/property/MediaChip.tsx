/**
 * MediaChip — the single visual language for every chip that floats over a
 * property photo (offering intents, verified, eco, rating). One backdrop, one
 * height, one radius, one padding: only the accent colour, icon, and optional
 * label vary, so a row of them reads as ONE aligned family.
 *
 * Backdrop strategy: a frosted near-white surface (the same treatment as the
 * save heart and rating pill) with the accent applied to the icon + label. A
 * light surface gives reliable contrast over arbitrary photos for the app's
 * dark/saturated accents (amber sale, teal exchange, green eco, deep brand) far
 * better than tinting the chip itself, and it visually unifies the overlay set
 * with the heart already living in the opposite corner.
 *
 * Every chip is the SAME fixed height (`CHIP_HEIGHT_MD` / `CHIP_HEIGHT_SM`) so a
 * `flexDirection: 'row'` stack aligns perfectly regardless of which chips are
 * present. Icon-only chips (no `label`) collapse to a square of that height.
 */
import React from 'react';
import { StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { Text as BloomText } from '@oxyhq/bloom/typography';

import { colors } from '@/styles/colors';
import { radius, spacing } from '@/constants/styles';

type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

export type MediaChipSize = 'sm' | 'md';

/**
 * Fixed chip heights — the contract that lets a row of mixed chips (labelled +
 * icon-only) align on a single baseline. Tuned to sit alongside the save heart
 * without crowding the photo.
 */
const CHIP_HEIGHT_MD = 28;
const CHIP_HEIGHT_SM = 22;

/** Icon glyph sizes per chip size (kept off the shared `ICON_SIZES` scale because
 *  the chip is intentionally a touch smaller than a dense badge). */
const CHIP_ICON_MD = 14;
const CHIP_ICON_SM = 12;

interface MediaChipProps {
  icon: IoniconName;
  /** Accent colour applied to the icon and label. Omit defaults to brand. */
  accent?: string;
  /** Optional label. When absent the chip renders icon-only (a square). */
  label?: string;
  /** `sm` for dense grids, `md` (default) for roomy cards. */
  size?: MediaChipSize;
}

export const MediaChip: React.FC<MediaChipProps> = ({
  icon,
  accent = colors.primarySubtleForeground,
  label,
  size = 'md',
}) => {
  const isSmall = size === 'sm';
  const iconSize = isSmall ? CHIP_ICON_SM : CHIP_ICON_MD;
  const hasLabel = typeof label === 'string' && label.length > 0;

  return (
    <View
      style={[
        styles.chip,
        isSmall ? styles.chipSmall : styles.chipMedium,
        hasLabel
          ? isSmall
            ? styles.chipLabelledSmall
            : styles.chipLabelledMedium
          : styles.chipIconOnly,
      ]}
    >
      <Ionicons name={icon} size={iconSize} color={accent} />
      {hasLabel ? (
        <BloomText
          style={[
            styles.label,
            isSmall ? styles.labelSmall : styles.labelMedium,
            { color: accent },
          ]}
          numberOfLines={1}
        >
          {label}
        </BloomText>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  // Shared backdrop + shape. The frosted near-white surface (flat, no shadow)
  // matches the save heart and the "new" chip so the whole overlay set reads as
  // one flat Airbnb-style family.
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
    backgroundColor: 'rgba(255, 255, 255, 0.92)',
  },
  chipMedium: {
    height: CHIP_HEIGHT_MD,
    gap: spacing.xs,
  },
  chipSmall: {
    height: CHIP_HEIGHT_SM,
    gap: 3,
  },
  // Labelled chips get horizontal padding; icon-only chips become a square of
  // the chip height so they line up with the labelled ones.
  chipLabelledMedium: {
    paddingHorizontal: spacing.md,
  },
  chipLabelledSmall: {
    paddingHorizontal: spacing.sm,
  },
  chipIconOnly: {
    aspectRatio: 1,
    paddingHorizontal: 0,
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

export default MediaChip;
